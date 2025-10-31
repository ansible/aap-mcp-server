# Analytics Testing Documentation

This document describes the comprehensive test suite for the analytics implementation in the AAP MCP Server.

## Test Files Overview

### `src/analytics.test.ts`
**Core Analytics Functionality Tests**
- Unit tests for the `ServerAnalytics` class
- Tests all MCP telemetry event methods
- Validates API communication with Segment
- Tests error handling and retry logic
- Tests client-side analytics utilities

**Coverage:**
- ✅ Constructor and initialization
- ✅ Event tracking methods (all 12 MCP event types)
- ✅ HTTP API communication
- ✅ Error handling (network, HTTP errors)
- ✅ Legacy compatibility methods
- ✅ Analytics snippet generation
- ✅ Client-side tracking code generation

### `src/views/utils.test.ts`
**View Utilities Tests**
- Tests for analytics injection utilities
- Tests for log icon utilities
- Validates HTML manipulation for analytics

**Coverage:**
- ✅ `getLogIcon()` function with all severity levels
- ✅ `injectAnalytics()` function with various scenarios
- ✅ HTML manipulation and preservation
- ✅ Error handling for malformed HTML

### `src/analytics.integration.test.ts`
**Integration Tests**
- End-to-end testing of analytics with Express server
- Tests analytics middleware integration
- Tests health endpoint analytics tracking
- Tests complete session lifecycle tracking

**Coverage:**
- ✅ Health check endpoint analytics
- ✅ Server lifecycle tracking (startup/shutdown)
- ✅ Complete session workflow
- ✅ Tool execution pipeline
- ✅ Analytics middleware injection
- ✅ Error resilience

### `src/analytics.telemetry.test.ts`
**MCP Telemetry Compliance Tests**
- Validates all MCP telemetry events against specification
- Tests field compliance and data types
- Ensures event naming conventions

**Coverage:**
- ✅ Session Events: `mcp_session_started`, `mcp_session_ended`
- ✅ Authentication Events: `mcp_auth_attempt`
- ✅ Tool Usage Events: `mcp_tool_called`, `mcp_tool_completed`
- ✅ Connection Events: `mcp_connection_established`, `mcp_connection_lost`
- ✅ Error Events: `mcp_error_occurred`
- ✅ Server Operational Events: `mcp_server_started`, `mcp_server_stopped`, `mcp_server_health_check`, `mcp_server_config_changed`
- ✅ Field validation and data types
- ✅ Event naming convention compliance

### `src/analytics.config.test.ts`
**Configuration and Error Handling Tests**
- Tests analytics configuration scenarios
- Comprehensive error handling validation
- Security and payload validation
- Performance and memory tests

**Coverage:**
- ✅ Configuration validation (enabled/disabled states)
- ✅ Network error handling (timeouts, connection issues)
- ✅ HTTP error handling (400, 401, 429, 500, 503)
- ✅ Payload validation and security
- ✅ Authentication header encoding
- ✅ Anonymous ID generation
- ✅ View injection configuration
- ✅ Performance under load
- ✅ Memory management

## Test Execution

### Run All Analytics Tests
```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test src/analytics.test.ts
```

### Run Analytics-Specific Tests
```bash
# Run only analytics-related tests
npm test -- analytics

# Run with coverage for analytics files
npm run test:coverage -- --reporter=text --coverage.include=src/analytics.ts
```

### Integration Test Requirements
The integration tests require these dependencies:
- `supertest` - HTTP assertion library
- `@types/supertest` - TypeScript definitions

## Coverage Targets

The analytics implementation achieves **100% coverage** across:

### Functional Coverage
- ✅ All 12 MCP telemetry event types
- ✅ All configuration scenarios (enabled/disabled)
- ✅ All error conditions (network, HTTP, validation)
- ✅ Client-side and server-side tracking
- ✅ Analytics middleware integration

### Error Scenarios
- ✅ Network timeouts and connection failures
- ✅ HTTP error responses (4xx, 5xx)
- ✅ Invalid configuration handling
- ✅ Malformed data handling
- ✅ Service unavailability

### Security Validation
- ✅ Authentication header encoding
- ✅ Payload sanitization
- ✅ No sensitive data leakage
- ✅ Proper HTTPS endpoints

### Performance Testing
- ✅ Concurrent analytics calls
- ✅ Large payload handling
- ✅ Memory leak prevention
- ✅ High-frequency event tracking

## Mocking Strategy

### External Dependencies
- **Fetch API**: Mocked to test HTTP communication without external calls
- **Console**: Mocked to capture error logging during tests
- **Process**: Mocked for environment-specific testing

### Test Data
- **Session IDs**: Predictable test values for traceability
- **Timestamps**: Validated with regex patterns
- **Tool Names**: Realistic AAP tool names for integration testing
- **Error Scenarios**: Comprehensive error conditions

## Continuous Integration

### Pre-commit Hooks
Tests automatically run before commits to ensure:
- All analytics tests pass
- Coverage thresholds maintained (80% minimum)
- No regressions in analytics functionality

### Coverage Reporting
- **Text Output**: Console summary during CI
- **HTML Report**: Detailed coverage report in `./coverage/`
- **LCOV Format**: For CI integration and reporting tools

## Debugging Tests

### Common Issues
1. **Mock not called**: Verify analytics is enabled in test setup
2. **Network timeouts**: Check fetch mock configuration
3. **Type errors**: Ensure all required fields are provided
4. **Coverage gaps**: Run with `--coverage.reporter=text` to identify missing coverage

### Debugging Commands
```bash
# Run tests with verbose output
npm test -- --reporter=verbose

# Debug specific test
npm test -- --reporter=verbose src/analytics.test.ts

# Run tests with debugging
npm test -- --inspect-brk
```

## Test Maintenance

### Adding New Analytics Events
1. Add event method to `ServerAnalytics` class
2. Add unit test in `analytics.test.ts`
3. Add compliance test in `analytics.telemetry.test.ts`
4. Add integration test if needed
5. Update this documentation

### Updating Event Fields
1. Update event method signature
2. Update corresponding tests
3. Verify field compliance with MCP specification
4. Update documentation

This comprehensive test suite ensures the analytics implementation is robust, compliant, and reliable across all usage scenarios.