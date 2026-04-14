# Phase 01 — MCP Tool Parameter Hardening: Summary

## Outcome
✅ **Complete** — All 13 org-touching tools in `mcp-provider-dx-core` now enforce explicit org routing, preventing wrong-org execution in multi-org configurations.

## What Changed

### Core Changes (13 tool files)
1. **`requireUsernameOrAlias`** added to 12 tools (all except `list_all_orgs` which lists all orgs, not one specific org). Tools now reject requests with missing/invalid `usernameOrAlias` and return an actionable error listing allowed orgs.
2. **`connectionHeader`** prepended to responses in all 13 org-touching tools. Every response now starts with `Connected to: <username> (<instanceUrl>, OrgId: <orgId>)` so callers can verify the target.
3. **`directory` made optional** for 10 org-only tools. Only `deploy_metadata`, `retrieve_metadata`, and `create_scratch_org` still require `directory` (they need the sfdx-project root).
4. **`process.chdir()` removed** from 9 tools. Only `create_scratch_org` retains it (needed for `definitionFile` resolution) but now wraps it in `try/finally` to restore `process.cwd()`.
5. **Global `target-org` fallback eliminated** — no tool reads `ConfigAggregator` for implicit org resolution.

### Documentation
- README updated with "Org Routing (Multi-Org Safety)" section documenting the `usernameOrAlias` requirement and directory categorization table.

### Test Results
- 42 unit tests passing in `mcp-provider-dx-core`
- 82 total tests passing across the repository
- TypeScript compilation clean (`tsc --noEmit` passes)
- Full `yarn build` succeeds

## Verification Sweeps
| Check | Result |
|-------|--------|
| `connectionHeader(` call sites | 13 ✓ |
| `requireUsernameOrAlias(` call sites | 12 ✓ |
| `process.chdir` in tools | Only `create_scratch_org.ts` with try/finally ✓ |
| `ConfigAggregator` target-org runtime reads | 0 ✓ |

## Commits
1. `feat: harden MCP tool parameter handling for multi-org safety` — all 13 tool files
2. `docs: add org routing multi-org safety section to README` — README.md

## Requirements Coverage
| Requirement | Status |
|-------------|--------|
| REQ-1: Remove global target-org fallback | ✅ Done |
| REQ-2: requireUsernameOrAlias on all org tools | ✅ Done |
| REQ-3: connectionHeader on all org responses | ✅ Done |
| REQ-4: directory optional for org-only tools | ✅ Done |
| REQ-5: process.chdir safety | ✅ Done |
