# Phase 1 SUMMARY: Eliminate per-call config reads and resolve orgs at startup

## Outcome
All 5 tasks completed. The concurrent org race condition root cause has been eliminated by resolving symbolic org names at startup and simplifying `getConnection()` to skip redundant per-call config reads.

## What Changed

### Task 1: Startup org resolution in index.ts
Added `resolveSymbolicOrgs()` call at startup after parsing `--orgs` flag. Symbolic names (`DEFAULT_TARGET_ORG`, `DEFAULT_TARGET_DEV_HUB`) are resolved to actual usernames via `ConfigAggregator.create()` once, then stored in Cache and passed to `SfMcpServer`. Gracefully degrades if config resolution fails.

### Task 2: Simplified getConnection()
Removed the `getAllAllowedOrgs()` + `findOrgByUsernameOrAlias()` calls from `getConnection()`. Since the middleware in `sf-mcp-server.ts` (line 156) already validates that `targetOrg` is in the authorized org list, `getConnection()` now directly creates `AuthInfo` + `Connection` without redundant per-call config reads.

### Task 3: getAllAllowedOrgs() preserved for explicit tool use
`getAllAllowedOrgs()`, `filterAllowedOrgs()`, `getDefaultTargetOrg()`, `getDefaultTargetDevHub()` remain unchanged and available for tools like `get_username`, `get_org_info`, `list_all_orgs` that explicitly need them.

### Task 4: TDD tests
8 new tests in `startup-org-resolution.test.ts`:
- 6 tests for `resolveSymbolicOrgs` (resolve DEFAULT_TARGET_ORG, DEFAULT_TARGET_DEV_HUB, both, graceful degradation, ALLOW_ALL_ORGS passthrough, ConfigAggregator failure)
- 2 tests for simplified `getConnection` (no getAllAllowedOrgs call, error propagation)

### Task 5: Full test suite verification
All new tests pass. Pre-existing test results unchanged (27 passing, 10 pre-existing failures due to `ConfigAggregator.Location` undefined in current `@salesforce/core` version).

Also fixed a pre-existing broken import in `auth.test.ts`: `ConfigInfo` needed `type` keyword for ESM compatibility.

## Key Files
- `packages/mcp/src/utils/auth.ts` — Added `resolveSymbolicOrgs()`, simplified `getConnection()`
- `packages/mcp/src/index.ts` — Calls `resolveSymbolicOrgs()` at startup, passes resolved orgs to server
- `packages/mcp/test/unit/startup-org-resolution.test.ts` — New test file (8 tests)
- `packages/mcp/test/unit/auth.test.ts` — Fixed `ConfigInfo` type import

## Commits
1. `ccdf1a1` — test: add TDD tests for startup org resolution and simplified getConnection
2. `46baf28` — feat: add resolveSymbolicOrgs and simplify getConnection
3. `f817fd1` — feat: resolve symbolic org names at startup in index.ts
4. `8c319af` — fix: use type import for ConfigInfo in auth.test.ts

## Deviations
None. All tasks executed as planned.

## Self-Check: PASSED
- [x] All 5 tasks executed
- [x] Each task committed individually
- [x] Tests pass (8 new, 0 regressions)
- [x] TypeScript compiles with no errors
