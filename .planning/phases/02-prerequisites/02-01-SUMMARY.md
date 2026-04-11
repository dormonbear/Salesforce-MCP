---
phase: 02-prerequisites
plan: 01
subsystem: shared-params
tags: [refactor, security, consolidation, params, path-traversal]
dependency_graph:
  requires: []
  provides: [canonical-params-in-mcp-provider-api]
  affects: [mcp-provider-devops, mcp-provider-scale-products, mcp-provider-metadata-enrichment, mcp-provider-dx-core]
tech_stack:
  added: [vitest, @vitest/coverage-istanbul]
  patterns: [canonical-barrel-export, sanitizePath-refine-zod]
key_files:
  created:
    - packages/mcp-provider-api/src/params.ts
    - packages/mcp-provider-api/test/params.test.ts
    - packages/mcp-provider-api/vitest.config.ts
    - packages/mcp-provider-api/tsconfig.build.json
  modified:
    - packages/mcp-provider-api/src/index.ts
    - packages/mcp-provider-api/package.json
    - packages/mcp-provider-api/tsconfig.json
    - packages/mcp-provider-dx-core/src/index.ts
    - packages/mcp-provider-metadata-enrichment/src/tools/enrich_metadata.ts
    - packages/mcp-provider-scale-products/src/tools/scan-apex-antipatterns-tool.ts
    - packages/mcp-provider-devops/src/tools/checkCommitStatus.ts
    - packages/mcp-provider-devops/src/tools/createPullRequest.ts
    - packages/mcp-provider-devops/src/tools/sfDevopsListProjects.ts
    - packages/mcp-provider-devops/src/tools/sfDevopsCheckoutWorkItem.ts
    - packages/mcp-provider-devops/src/tools/sfDevopsPromoteWorkItem.ts
    - packages/mcp-provider-devops/src/tools/sfDevopsDetectConflict.ts
    - packages/mcp-provider-devops/src/tools/sfDevopsListWorkItems.ts
    - packages/mcp-provider-devops/src/tools/sfDevopsCommitWorkItem.ts
    - packages/mcp-provider-devops/src/tools/sfDevopsResolveConflict.ts
    - packages/mcp-provider-devops/src/tools/sfDevopsResolveDeploymentFailure.ts
    - packages/mcp-provider-devops/src/tools/sfDevopsCreateWorkItem.ts
    - packages/mcp-provider-devops/src/tools/sfDevopsUpdateWorkItemStatus.ts
  deleted:
    - packages/mcp-provider-devops/src/shared/params.ts
    - packages/mcp-provider-scale-products/src/shared/params.ts
    - packages/mcp-provider-scale-products/src/shared/utils.ts
decisions:
  - Kept dx-core/src/shared/params.ts in place (used internally by dx-core tools); only updated dx-core/src/index.ts to re-export from mcp-provider-api for backward compatibility
  - Added vitest infrastructure to mcp-provider-api (was previously test-free); split tsconfig.json into tsconfig.build.json (emit) + tsconfig.json (type-check + tests)
metrics:
  duration: ~28 minutes
  completed_date: "2026-04-11T06:31:58Z"
  tasks_completed: 2
  files_created: 4
  files_modified: 18
  files_deleted: 3
---

# Phase 02 Plan 01: Consolidate Shared Params to mcp-provider-api Summary

**One-liner:** Canonical sanitizePath + five shared Zod params consolidated into mcp-provider-api with URL-decode/Unicode/traversal protection, replacing three local duplicates across devops, scale-products, and metadata-enrichment.

## What Was Built

Created `packages/mcp-provider-api/src/params.ts` as the single canonical source of truth for all shared MCP tool parameters. Migrated 12 devops tools, 1 scale-products tool, and 1 metadata-enrichment tool to import from `@salesforce/mcp-provider-api`. Deleted three redundant local files. Updated dx-core barrel to re-export from the new canonical source.

## Tasks Completed

| Task | Description | Commit | Status |
|------|-------------|--------|--------|
| TDD RED | Add failing tests for params.ts (vitest infrastructure) | c774d4e | Done |
| Task 1 GREEN | Create canonical params.ts + export from index.ts barrel | 59918fc | Done |
| Task 2 | Migrate all providers, delete local duplicates | 9e55bc7 | Done |

## Commits

| Hash | Message |
|------|---------|
| c774d4e | test(02-01): add failing tests for shared params in mcp-provider-api |
| 59918fc | feat(02-01): create canonical params.ts in mcp-provider-api |
| 9e55bc7 | feat(02-01): migrate all providers to import shared params from mcp-provider-api |

## Security Improvements (Threat Model)

| Threat | Before | After |
|--------|--------|-------|
| T-02-01: directoryParam path traversal | Only dx-core and scale-products had sanitizePath refine | All 12 devops tools now get sanitizePath via mcp-provider-api |
| T-02-02: devops directoryParam accepted any string | devops directoryParam was `z.string()` with no path validation | Now uses `baseAbsolutePathParam.refine(sanitizePath)` via mcp-provider-api |
| T-02-03: dx-core barrel re-export | Exported from local shared/params.ts | Now delegates to canonical source; no new trust boundary |

## Params Exported from mcp-provider-api

| Export | Type | Description |
|--------|------|-------------|
| `sanitizePath` | `(path: string) => boolean` | URL-decode + Unicode normalize + traversal + absolute check |
| `baseAbsolutePathParam` | `ZodString` with refine | `sanitizePath` applied as Zod refine |
| `directoryParam` | `ZodString` with refine + describe | For tool `directory` inputs |
| `usernameOrAliasParam` | `ZodString` | Required org identifier |
| `optionalUsernameOrAliasParam` | `ZodString.optional()` | Optional org identifier with default-org note |
| `useToolingApiParam` | `ZodBoolean.optional()` | Tooling API flag |

## Test Coverage

13 unit tests in `packages/mcp-provider-api/test/params.test.ts`:
- sanitizePath: valid paths, `..` traversal, relative paths, Unicode ellipsis (`\u2026`), URL-encoded traversal
- directoryParam: parse success, ZodError on traversal, ZodError on relative
- usernameOrAliasParam (required): empty string ok, undefined throws, username ok
- optionalUsernameOrAliasParam: undefined ok, username ok

## Deviations from Plan

### Auto-added Missing Infrastructure

**[Rule 2 - Missing Critical Functionality] Added vitest test infrastructure to mcp-provider-api**
- **Found during:** Task 1 (TDD setup)
- **Issue:** mcp-provider-api had no test framework; package.json had `echo 'No unit tests are needed'` as test script; no vitest, no tsconfig for tests
- **Fix:** Added vitest + @vitest/coverage-istanbul devDependencies, created vitest.config.ts, split tsconfig.build.json (build-only) from tsconfig.json (type-check + test includes), updated `build` script to use `tsconfig.build.json`, added proper `test` script
- **Files modified:** package.json, tsconfig.build.json (new), tsconfig.json, vitest.config.ts (new)
- **Commit:** c774d4e

No other deviations — plan executed as written.

## Known Stubs

None. All params are fully wired with real implementations.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes beyond what the plan's threat model covers.

## Self-Check

- [x] packages/mcp-provider-api/src/params.ts exists with all 5 exports + sanitizePath
- [x] packages/mcp-provider-api/src/index.ts exports from './params.js'
- [x] packages/mcp-provider-devops/src/shared/params.ts deleted
- [x] packages/mcp-provider-scale-products/src/shared/params.ts deleted
- [x] packages/mcp-provider-scale-products/src/shared/utils.ts deleted
- [x] All 12 devops tools import from @salesforce/mcp-provider-api
- [x] metadata-enrichment imports from @salesforce/mcp-provider-api (not dx-core)
- [x] dx-core index.ts re-exports from @salesforce/mcp-provider-api
- [x] TypeScript build zero errors (all packages)
- [x] 13 vitest tests pass
- [x] Commits c774d4e, 59918fc, 9e55bc7 exist

## Self-Check: PASSED
