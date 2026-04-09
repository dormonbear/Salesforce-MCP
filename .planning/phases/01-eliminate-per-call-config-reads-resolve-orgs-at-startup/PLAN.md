# Phase 1 PLAN: Eliminate per-call config reads and resolve orgs at startup

## Goal
Remove the root cause of the concurrent org race condition by resolving symbolic org names (`DEFAULT_TARGET_ORG`, `DEFAULT_TARGET_DEV_HUB`) once at server startup, and simplifying `getConnection()` to skip redundant org re-validation — eliminating per-call `.sf/config.json` reads that depend on the racey `process.cwd()`.

## Approach
Replace the current architecture where every tool call re-reads `.sf/config.json` via `ConfigAggregator` with a startup-time resolution model:

1. At server startup (`index.ts`), resolve `DEFAULT_TARGET_ORG` / `DEFAULT_TARGET_DEV_HUB` to actual usernames by reading config once
2. Store the resolved usernames in the allowedOrgs cache (replacing the symbolic placeholders)
3. Simplify `getConnection()` — since the middleware in `sf-mcp-server.ts` already validates `targetOrg` against `authorizedOrgs`, `getConnection()` no longer needs to call `getAllAllowedOrgs()` + `filterAllowedOrgs()`
4. Keep the Mutex as a safety net (tools still call `process.chdir()` and `@salesforce/core` internally uses `ConfigAggregator`)
5. Keep `getDefaultTargetOrg()` / `getDefaultTargetDevHub()` available for the `get_username` and `get_org_info` tools that explicitly need them

## Key Files
- `packages/mcp/src/index.ts` — startup, resolve symbolic orgs here
- `packages/mcp/src/utils/auth.ts` — simplify `getConnection()`, keep org query functions
- `packages/mcp/src/services.ts` — OrgService wiring
- `packages/mcp/src/sf-mcp-server.ts` — keep Mutex, already has middleware validation
- `packages/mcp/test/unit/auth.test.ts` — existing tests (has broken import)
- `packages/mcp/test/unit/auth-clearinstance.test.ts` — our new tests
- `packages/mcp/test/unit/sf-mcp-server.test.ts` — our serialization tests

## Tasks

### Task 1: Add startup org resolution in index.ts
- **What**: After parsing `--orgs` flag, resolve `DEFAULT_TARGET_ORG` and `DEFAULT_TARGET_DEV_HUB` to actual usernames using `ConfigAggregator` once
- **Where**: `packages/mcp/src/index.ts` (after line 170, before SfMcpServer creation)
- **Details**:
  - Read `ConfigAggregator` for `TARGET_ORG` and `TARGET_DEV_HUB`
  - Replace symbolic values in `flags.orgs` array with resolved usernames
  - Update `Cache.safeSet('allowedOrgs', ...)` with resolved values
  - Log resolved org names to stderr for debugging
  - If resolution fails (no config), log a warning and keep the symbolic value (graceful degradation)
- **Test**: Unit test that startup resolves `DEFAULT_TARGET_ORG` → actual username

### Task 2: Simplify getConnection() to skip redundant validation
- **What**: `getConnection()` should directly create `AuthInfo` + `Connection` without re-calling `getAllAllowedOrgs()` + `filterAllowedOrgs()`
- **Where**: `packages/mcp/src/utils/auth.ts` lines 43-58
- **Details**:
  - Remove the call to `getAllAllowedOrgs()` (which triggers config reads)
  - Remove `findOrgByUsernameOrAlias()` lookup (middleware already validated)
  - Simply do `AuthInfo.create({ username })` + `Connection.create({ authInfo })`
  - The middleware in `sf-mcp-server.ts` (line 156) already ensures `username` is in the authorized list
- **Test**: Unit test that `getConnection()` no longer calls `getAllAllowedOrgs()`

### Task 3: Keep getAllAllowedOrgs() for explicit tool use
- **What**: `getAllAllowedOrgs()` and `filterAllowedOrgs()` must still work for tools like `get_username`, `get_org_info`, `list_all_orgs`
- **Where**: `packages/mcp/src/utils/auth.ts` (keep existing functions, just don't call from getConnection)
- **Details**:
  - These functions stay unchanged — they still need config reads for their explicit purpose
  - They are called within tools that already hold the Mutex lock (serialized), so the CWD race is safe
- **Test**: Verify existing tests for `getAllAllowedOrgs()` still pass

### Task 4: Update and add unit tests (TDD)
- **What**: Write tests first, then implement
- **Where**: `packages/mcp/test/unit/` directory
- **Details**:
  - Test: startup resolves symbolic org names to actual usernames
  - Test: `getConnection()` directly creates Connection without calling `getAllAllowedOrgs`
  - Test: `getConnection()` rejects unknown usernames gracefully
  - Keep existing serialization tests and clearInstance tests
- **Dependencies**: Tests must be RED before implementation

### Task 5: Verify all existing tests pass
- **What**: Run full test suite to ensure no regressions
- **Where**: `packages/mcp/test/`
- **Details**: `npx mocha "test/unit/**/*.test.ts" --timeout 10000`

## Risk Assessment
- **Low risk**: `getConnection()` simplification — middleware already validates, so removing double-check is safe
- **Medium risk**: Startup resolution — if config file is missing/corrupt, must degrade gracefully
- **No risk**: Keeping Mutex — it's a safety net that doesn't hurt performance significantly (tools are already effectively sequential due to LLM turn-taking)

## Dependency Order
Task 4 (tests RED) → Task 1 + Task 2 (implementation GREEN) → Task 3 (verify unchanged) → Task 5 (full suite)
