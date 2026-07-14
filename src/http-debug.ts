export const describeInboundAuth = (authHeader: string | undefined): string => {
  if (!authHeader) return "missing";
  if (authHeader.startsWith("Bearer ")) {
    const tokenLength = authHeader.length - 7;
    return tokenLength === 0 ? "Bearer(empty)" : `Bearer(${tokenLength} chars)`;
  }
  const scheme = authHeader.split(" ")[0] || "unknown";
  return `present(${scheme})`;
};

export const extractMcpRpcMethod = (body: unknown): string | undefined => {
  if (body && typeof body === "object" && "method" in body) {
    const method = (body as { method?: unknown }).method;
    return typeof method === "string" ? method : undefined;
  }
  return undefined;
};
