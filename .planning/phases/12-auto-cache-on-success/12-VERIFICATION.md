---
phase: 12-auto-cache-on-success
verified: 2026-04-12T16:39:58Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
---

# Phase 12: Auto-Cache on Success — Verification Report

**Phase Goal:** Every successful SOQL query progressively enriches the schema cache with zero additional API calls, building a knowledge base of known-valid fields
**Verified:** 2026-04-12T16:39:58Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | After a successful flat SOQL query, the queried object name and field names appear in SchemaService as a PartialFieldsEntry — no API call is made | ✓ VERIFIED | `run_soql_query.ts:104-131` — after `connection.query()` succeeds, `parseSoqlFields(input.query)` extracts fields, `schemaService.set()` stores a `PartialFieldsEntry`. No `connection.describe()` in hook. Tests `auto-cache-hook.test.ts:58-88` confirm set() called with correct entry and zero describe calls. |
| 2 | The SOQL parser extracts the FROM object and SELECT fields from flat queries and returns null for complex queries without throwing | ✓ VERIFIED | `soql-parser.ts` — pure function, regex-based. Returns `{ objectName, fieldNames }` for flat queries. Returns `null` for subqueries, COUNT/SUM/AVG/MIN/MAX, GROUP BY, TYPEOF, HAVING, empty/whitespace. 18 passing tests in `soql-parser.test.ts` covering flat, alias, relationship, complex skip, and edge cases. |
| 3 | When a partial cache entry exists and describe_object is called, the full describe result replaces the partial entry — curateDescribeResult never receives a partial | ✓ VERIFIED | `describe_object.ts:179-182` — if `cached.type !== SchemaEntryType.FullDescribe`, calls `schemaService.invalidate()` before `describeAndCache()`. After invalidation, `describeAndCache()` finds no cache hit (schema-service.ts:103-106) and invokes `describeFn()` which returns a `FullDescribeEntry`. `curateDescribeResult` at line 195 always receives a full entry. |
| 4 | When two SOQL queries reference the same object with different fields, the cached partial entry contains the union of both field sets | ✓ VERIFIED | `run_soql_query.ts:114-118` — when existing entry is `PartialFields`, creates union via `[...new Set([...existing.fieldNames, ...fieldNames])]`. Test `auto-cache-hook.test.ts:114-133` verifies: existing partial has `['Id']`, new query adds `['Name']`, result has `['Id', 'Name']` with length 2. |
| 5 | The auto-cache hook never causes a successful SOQL query to fail — fire-and-forget with try/catch | ✓ VERIFIED | `run_soql_query.ts:128-130` — entire auto-cache block wrapped in `try { ... } catch { // Silently ignore }`. Tests `auto-cache-hook.test.ts:154-179`: (1) `schemaService.set()` throws → query result still returned with `isError !== true`; (2) unparseable SOQL → result still returned, no cache attempted. |
| 6 | Tooling API queries are not auto-cached | ✓ VERIFIED | `run_soql_query.ts:106` — `if (!input.useToolingApi)` gates entire auto-cache block. Test `auto-cache-hook.test.ts:101-110` verifies `setSpy.called` is false when `useToolingApi: true`. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/mcp-provider-dx-core/src/schema/soql-parser.ts` | `parseSoqlFields()` pure function; exports `parseSoqlFields`, `ParsedSoql` | ✓ VERIFIED | 54 lines. Exports `ParsedSoql` type (line 17) and `parseSoqlFields` function (line 27). Re-exported via `schema/index.ts:27`. |
| `packages/mcp-provider-dx-core/test/unit/schema/soql-parser.test.ts` | Comprehensive SOQL parser unit tests; min 100 lines | ✓ VERIFIED | 113 lines, 18 test cases. Covers flat queries (6), aliases (1), relationship fields (2), complex skip (5), edge cases (4). All passing. |
| `packages/mcp-provider-dx-core/test/unit/schema/auto-cache-hook.test.ts` | Auto-cache hook + merge logic tests; min 80 lines | ✓ VERIFIED | 191 lines, 9 test cases. Covers auto-cache on success (4), merge logic (2), fire-and-forget (2), constructor (1). All passing. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/tools/run_soql_query.ts` | `src/schema/soql-parser.ts` | `import parseSoqlFields` | ✓ WIRED | Line 25: `import { parseSoqlFields } from '../schema/soql-parser.js';` — used at line 108 in auto-cache hook. |
| `src/tools/run_soql_query.ts` | `src/schema/schema-service.ts` | Constructor injection of SchemaService | ✓ WIRED | Line 60: `private readonly schemaService: SchemaService` — used at lines 111, 114, 116, 120 for get/set. |
| `src/index.ts` | `src/tools/run_soql_query.ts` | `new QueryOrgMcpTool(services, schemaService)` | ✓ WIRED | Line 108: `new QueryOrgMcpTool(services, schemaService)` — passes singleton SchemaService from provideTools. Tool regex escaping caused false negative; manual verification confirms. |
| `src/tools/describe_object.ts` | `src/schema/schema-service.ts` | Invalidate partial before describeAndCache | ✓ WIRED | Line 181: `this.schemaService.invalidate(orgUsername, input.objectName)` — inside guard `cached.type !== SchemaEntryType.FullDescribe` (line 180). |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `run_soql_query.ts` (auto-cache) | `parsed` from `parseSoqlFields()` | SOQL query string (user input) | Yes — extracts from actual query | ✓ FLOWING |
| `run_soql_query.ts` (auto-cache) | `existing` from `schemaService.get()` | LRU in-memory cache | Yes — retrieves prior PartialFieldsEntry | ✓ FLOWING |
| `describe_object.ts` | `cached` from `schemaService.get()` | LRU in-memory cache | Yes — used for invalidation decision | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| SOQL parser module exports correctly | `node -e "const m = require('./packages/mcp-provider-dx-core/src/schema/soql-parser.ts')" 2>&1` | TypeScript — verified via test suite instead | ? SKIP (TS source) |
| 27 phase-specific tests pass | `npx mocha "test/unit/schema/soql-parser.test.ts" "test/unit/schema/auto-cache-hook.test.ts"` | 27 passing (28ms) | ✓ PASS |
| Full test suite (131 tests) — no regressions | `npx nyc mocha "test/**/*.test.ts" --exclude "test/e2e/**/*.test.ts"` | 131 passing (379ms) | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-----------|-------------|--------|----------|
| ACCH-01 | 12-01 | Successful SOQL queries auto-cache queried object name and field names as partial schema entry (zero extra API calls) | ✓ SATISFIED | Auto-cache hook in `run_soql_query.ts:104-131` stores PartialFieldsEntry via `schemaService.set()` after successful `connection.query()`. No `describe()` call. |
| ACCH-02 | 12-01 | SOQL FROM clause and SELECT field list are parsed from the query string on success | ✓ SATISFIED | `parseSoqlFields()` in `soql-parser.ts` extracts FROM object + SELECT fields. Returns null for subqueries, aggregates, GROUP BY, TYPEOF. 18 tests confirm. |
| ACCH-03 | 12-01 | Partial cache entries are merged with full describe results when both exist (full describe wins on conflict) | ✓ SATISFIED | Partial+partial: union merge at `run_soql_query.ts:117`. Full > partial: line 114 skips set when existing is FullDescribe. `describe_object.ts:179-182` invalidates partial before `describeAndCache`. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `soql-parser.ts` | 28-50 | Multiple `return null` | ℹ️ Info | Correct parser behavior — returns null for unsupported queries. Not stubs. |
| `index.ts` | 1-31 | Duplicate license header | ℹ️ Info | Cosmetic — noted in code review (IN-01). No functional impact. |

No TODO, FIXME, PLACEHOLDER, console.log, or stub patterns found in any phase-modified files.

### Human Verification Required

None. All phase deliverables are backend/logic code fully verifiable through static analysis and unit tests. No UI, visual, real-time, or external service integration requiring human verification.

### Gaps Summary

No gaps found. All 6 observable truths verified, all 3 artifacts pass all levels (exist, substantive, wired, data flowing), all 4 key links confirmed, all 3 requirements satisfied, 131 tests passing with 0 regressions.

**Code review observations (non-blocking):** The review identified one warning (WR-01: missing type guard in `curateDescribeResult`) and three info items (duplicate license header, SOQL function expressions, field name case normalization). These are code quality improvements, not goal-blocking gaps — the auto-cache-on-success feature works correctly as designed.

---

_Verified: 2026-04-12T16:39:58Z_
_Verifier: the agent (gsd-verifier)_
