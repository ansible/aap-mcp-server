FROM registry.redhat.io/ubi9/ubi-minimal:latest@sha256:61d5ad475048c2e655cd46d0a55dfeaec182cc3faa6348cb85989a7c9e196483 as dumb_init_build

USER root
# For local build
RUN microdnf install -y openssl \
  && curl -o /etc/pki/ca-trust/source/anchors/2022-IT-Root-CA.pem https://certs.corp.redhat.com/certs/2022-IT-Root-CA.pem \
  && curl -o /etc/pki/tls/certs/2022-IT-Root-CA.pem https://certs.corp.redhat.com/certs/2022-IT-Root-CA.pem \
  && curl -o /etc/openldap/certs/2022-IT-Root-CA.pem https://certs.corp.redhat.com/certs/2022-IT-Root-CA.pem \
  && openssl rehash /etc/openldap/certs \
  && update-ca-trust \
  && curl -o /etc/yum.repos.d/rhel-9.repo 'https://gitlab.cee.redhat.com/aap-konflux/aap-konflux-pipelines/-/raw/main/repositories/rhel-9.repo?ref_type=heads&inline=false' \
  && curl -o /etc/yum.repos.d/codeready-builder-for-rhel-9.repo 'https://gitlab.cee.redhat.com/aap-konflux/aap-konflux-pipelines/-/raw/main/repositories/codeready-builder-for-rhel-9.repo?ref_type=heads&inline=false'

RUN microdnf install --setopt=install_weak_deps=0 --nodocs -y \
    gcc-toolset-13-gcc \
    glibc-static \
    && microdnf clean all

# COPY deps/dumb-init /deps/dumb-init
# WORKDIR /deps/dumb-init
# RUN . /opt/rh/gcc-toolset-13/enable && make

# Multi-stage build for AAP MCP Service
FROM registry.redhat.io/ubi9/nodejs-22-minimal@sha256:d5bcdacfef806413e124784bf023d56da6eac76d8f55d4a2d056586df8e95e25 AS builder

USER root

# Set working directory
# COPY deps/openapi-mcp-generator /deps/openapi-mcp-generator
# WORKDIR /deps/openapi-mcp-generator
# RUN npm install
# RUN npm run build
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies (including dev dependencies for building)
RUN npm ci

# Copy source code
COPY src/ ./src/

RUN npm install

# Build the TypeScript project
RUN npm run build

# Production stage
FROM registry.redhat.io/ubi9/nodejs-22-minimal@sha256:d5bcdacfef806413e124784bf023d56da6eac76d8f55d4a2d056586df8e95e25 AS production

USER root

# For local build
RUN curl -o /etc/pki/ca-trust/source/anchors/2022-IT-Root-CA.pem https://certs.corp.redhat.com/certs/2022-IT-Root-CA.pem \
  && curl -o /etc/pki/tls/certs/2022-IT-Root-CA.pem https://certs.corp.redhat.com/certs/2022-IT-Root-CA.pem \
  && curl -o /etc/openldap/certs/2022-IT-Root-CA.pem https://certs.corp.redhat.com/certs/2022-IT-Root-CA.pem \
  && openssl rehash /etc/openldap/certs \
  && update-ca-trust \
  && curl -o /etc/yum.repos.d/rhel-9.repo 'https://gitlab.cee.redhat.com/aap-konflux/aap-konflux-pipelines/-/raw/main/repositories/rhel-9.repo?ref_type=heads&inline=false' \
  && curl -o /etc/yum.repos.d/codeready-builder-for-rhel-9.repo 'https://gitlab.cee.redhat.com/aap-konflux/aap-konflux-pipelines/-/raw/main/repositories/codeready-builder-for-rhel-9.repo?ref_type=heads&inline=false' \
  && curl -o /etc/yum.repos.d/aap-2.6-rhel9.repo 'https://gitlab.cee.redhat.com/aap-konflux/aap-konflux-pipelines/-/raw/main/repositories/aap-2.6-rhel9.repo?ref_type=heads&inline=false'

RUN microdnf module disable php -y \
  && microdnf module enable nginx:1.24 -y \
  && microdnf install --setopt=install_weak_deps=0 --nodocs -y \
    dumb-init \
    glibc-langpack-en \
    nginx \
  && microdnf reinstall --setopt=install_weak_deps=0 --nodocs -y tzdata \
  && microdnf clean all

RUN ln -s /bin/dumb-init /usr/local/bin/dumb-init

COPY entrypoint.sh /entrypoint.sh
RUN chmod 755 /entrypoint.sh
COPY etc/nginx/nginx.conf /etc/nginx/nginx.conf

RUN chmod -R 777 /var/log/nginx && chmod -R 777 /var/lib/nginx

# Set working directory
WORKDIR /app

COPY aap-mcp.sample.yaml /app/aap-mcp.yaml

# Copy package files
COPY package*.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Inject our openapi-mcp-generator fork
# COPY --from=builder /deps/openapi-mcp-generator /app/node_modules/openapi-mcp-generator

# Copy the OpenAPIv3 schema files
COPY ./data/ ./data/


# COPY --from=dumb_init_build /deps/dumb-init/dumb-init /usr/local/bin

# Switch to non-root user
USER 1000

# Expose port
EXPOSE 8085

# Environment variables
ENV BASE_URL=""
ENV NODE_ENV=production
ENV MCP_PORT=3000


ENV DESCRIPTION="Red Hat Automation MCP"
LABEL com.redhat.component="aap-mcp=server"
LABEL name="ansible-automation-platform-27/aap-mcp-server"
LABEL version="2.7.x"
LABEL vendor="Red Hat, Inc."
LABEL summary="AI MCP interface for Ansible Automation Platform"
LABEL description="$DESCRIPTION"
LABEL io.k8s.description="$DESCRIPTION"
LABEL io.k8s.display-name="Red Hat Ansible Automation MCP"
LABEL io.openshift.tags="ansible,automation,mcp"
LABEL maintainer="Ansible Automation Platform Productization Team"
ENV container=oci

ENTRYPOINT ["/usr/local/bin/dumb-init", "--"]
CMD ["/entrypoint.sh"]
