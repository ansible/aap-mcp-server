# JWT Authentication Implementation

This document describes the JWT authentication implementation in the AAP MCP Server.

## Overview

The AAP MCP Server now supports two authentication methods:
1. **JWT Authentication** (X-DAB-JW-TOKEN header) - Primary method
2. **Bearer Token Authentication** (Authorization header) - Fallback method

The server tries JWT authentication first, and if that fails or is not provided, falls back to Bearer token authentication.

## Implementation Details

### JWT Validator Module (`src/jwt-validator.ts`)

The JWT validator is implemented based on the Python version from `ansible-mcp-tools`:

**Key Features:**
- **Public Key Caching**: Fetches RSA public key from AAP Gateway and caches it for 600 seconds (10 minutes)
- **JWT Validation**: Uses RS256 algorithm to verify JWT signatures
- **Claims Validation**: Validates audience (`ansible-services`) and issuer (`ansible-issuer`)
- **Expiration Check**: Automatically checks token expiration
- **User Data Extraction**: Extracts username from `user_data` claim

**Configuration:**
```typescript
const AUTHENTICATION_HEADER_NAME = 'X-DAB-JW-TOKEN';  // Header to check for JWT
const JWT_AUDIENCE = 'ansible-services';               // Expected audience
const JWT_ISSUER = 'ansible-issuer';                  // Expected issuer
const CACHE_TTL = 600;                                // Cache TTL in seconds (10 min)
const CACHE_MAX_KEYS = 100;                           // Max keys in cache
```

### Authentication Flow

When a client initializes a session, the authentication flow is:

```
1. Client sends request with authentication header(s)
   ├─ X-DAB-JW-TOKEN: <JWT token>     (JWT auth)
   └─ Authorization: Bearer <token>    (Bearer auth)

2. Server calls authenticateRequest()
   ├─ Try JWT authentication first
   │  ├─ Look for X-DAB-JW-TOKEN header
   │  ├─ Fetch public key from AAP Gateway (cached)
   │  ├─ Verify JWT signature using RS256
   │  ├─ Validate claims (aud, iss, exp, user_data)
   │  └─ Return JWT token on success
   │
   └─ Fall back to Bearer token if JWT fails/missing
      ├─ Extract Bearer token from Authorization header
      ├─ Validate against /api/gateway/v1/me/
      └─ Return Bearer token on success

3. Store authenticated token in session

4. Session is created successfully
```

### Code Changes

**1. New JWT Validator Module (`src/jwt-validator.ts`)**
- `validateJWT()` - Main validation function
- `getPublicKey()` - Fetches and caches public key
- `decodeJWTToken()` - Decodes and validates JWT
- `clearPublicKeyCache()` - Utility for cache management
- `getCacheStats()` - Utility for monitoring

**2. Updated Authentication in `src/index.ts`**
- Added import: `import { validateJWT } from "./jwt-validator.js";`
- New function: `authenticateRequest()` - Handles both JWT and Bearer token
- Updated `onsessioninitialized` callback to use `authenticateRequest()`

## Usage

### Client Using JWT Authentication

```bash
# Initialize session with JWT
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "X-DAB-JW-TOKEN: <your-jwt-token>" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {
        "name": "test-client",
        "version": "1.0.0"
      }
    },
    "id": 1
  }'
```

### Client Using Bearer Token (Fallback)

```bash
# Initialize session with Bearer token
curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-bearer-token>" \
  -d '{
    "jsonrpc": "2.0",
    "method": "initialize",
    "params": {
      "protocolVersion": "2024-11-05",
      "capabilities": {},
      "clientInfo": {
        "name": "test-client",
        "version": "1.0.0"
      }
    },
    "id": 1
  }'
```

## Configuration

The JWT validator respects the `ignore-certificate-errors` configuration option:

**In `aap-mcp.yaml`:**
```yaml
ignore-certificate-errors: false  # Set to true for dev/testing with self-signed certs
```

**Via Environment Variable:**
```bash
export IGNORE_CERTIFICATE_ERRORS=true  # For development/testing only
```

## Testing

Build and run the server:

```bash
# Build
npm run build

# Run
npm start

# Or run in development mode
npm run dev
```

Test JWT authentication:

```bash
# Get a JWT token from AAP Gateway first
# Then use it to authenticate to the MCP server

curl -X POST http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "X-DAB-JW-TOKEN: $JWT_TOKEN" \
  -d '<initialize-request>'
```

## Monitoring

The JWT validator provides cache statistics for monitoring:

```typescript
import { getCacheStats } from './jwt-validator.js';

// Get cache statistics
const stats = getCacheStats();
console.log('Cache stats:', stats);
// Output: { keys: 2, stats: { hits: 45, misses: 2, ... } }
```

## Security Considerations

1. **Public Key Caching**: The public key is cached for 10 minutes. If you rotate keys, you may need to wait or manually clear the cache.

2. **Certificate Validation**: Always use certificate validation in production (`ignore-certificate-errors: false`).

3. **Token Expiration**: JWT tokens are validated for expiration automatically. Expired tokens will be rejected.

4. **Audience/Issuer Validation**: The validator checks that tokens are intended for `ansible-services` and issued by `ansible-issuer`.

## Differences from Python Implementation

The TypeScript implementation matches the Python version with these minor differences:

1. **HTTP Library**: Uses native `fetch` instead of `httpx`
2. **Caching**: Uses `node-cache` instead of `cachetools`
3. **JWT Library**: Uses `jsonwebtoken` instead of `PyJWT`
4. **Error Handling**: Returns null for missing headers (like Python) and throws errors for validation failures

## Troubleshooting

### JWT Validation Fails

**Check:**
1. JWT token format is correct (should be a valid JWT)
2. Token is not expired
3. Audience is `ansible-services`
4. Issuer is `ansible-issuer`
5. Public key can be fetched from AAP Gateway (`/api/gateway/v1/jwt_key/`)

**Debug:**
```typescript
// Enable debug logging
console.debug('JWT validation details');
```

### Public Key Fetch Fails

**Check:**
1. AAP Gateway is accessible at `BASE_URL`
2. `/api/gateway/v1/jwt_key/` endpoint is available
3. Certificate validation settings are correct
4. Network connectivity to AAP Gateway

### Cache Issues

**Clear cache:**
```typescript
import { clearPublicKeyCache } from './jwt-validator.js';
clearPublicKeyCache();
```

## Dependencies

The JWT authentication implementation requires:

- `jsonwebtoken` (^9.0.2) - JWT validation
- `node-cache` (^5.1.2) - Public key caching
- `@types/jsonwebtoken` (^9.0.5) - TypeScript types

These are installed via:
```bash
npm install jsonwebtoken node-cache @types/jsonwebtoken
```
