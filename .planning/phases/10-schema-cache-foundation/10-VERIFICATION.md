---
phase: 10-schema-cache-foundation
verified: 2026-04-12T15:30:24Z
status: passed
score: 7/7 must-haves verified
overrides_applied: 0
---

# Phase 10: Schema Cache Foundation — Verification Report

**Phase Goal:** A per-org, TTL-aware, LRU-bounded schema cache exists as a service accessible to all tools, with concurrent describe requests coalesced into single API calls and disk persistence across restarts
**Verified:** 2026-04-12T15:30:24Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Schema data for org A is never returned when querying org B — per-org isolation | ✓ VERIFIED | `orgCaches: Map<string, LRUCache>` in schema-service.ts:43; test verifies `set("orgA", ...) → get("orgB", ...) === undefined` (3 isolation tests pass) |
| 2 | Cached entry becomes miss after configured TTL (default 1h, overridable via SF_SCHEMA_CACHE_TTL_MINUTES) | ✓ VERIFIED | `DEFAULT_TTL_MS = 3_600_000` (line 27); env var read at lines 53-56; LRUCache `ttl: this.ttlMs` (line 253); 3 TTL tests pass including env override |
| 3 | Cache accepts and stores three data types: full describe, partial fields, relationship edges | ✓ VERIFIED | types.ts defines `FullDescribeEntry`, `PartialFieldsEntry`, `RelationshipEdgesEntry` union; 4 data type tests pass verifying store+retrieve for each |
| 4 | Ten concurrent describe requests produce exactly one API call (single-flight) | ✓ VERIFIED | `inFlight: Map<string, Promise<SchemaEntry>>` (line 44); `describeAndCache()` checks in-flight before calling describeFn (lines 108-128); test fires 10 concurrent → `sinon.assert.calledOnce` passes |
| 5 | LRU eviction prevents unbounded memory growth | ✓ VERIFIED | `MAX_ENTRIES_PER_ORG = 100` (line 28); `new LRUCache({ max: MAX_ENTRIES_PER_ORG, ttl })` (line 252); test inserts 101 entries → first evicted; access-refresh test passes |
| 6 | Cache persists to per-org JSON files; on startup loads existing, discards TTL-expired; survives restart | ✓ VERIFIED | `disk-persistence.ts` writes `{dataDir}/schema-cache/{org}.json`; `loadAll()` → `loadOrg()` discards entries where `Date.now() - cachedAt > ttlMs`; `loadFromDisk()` in schema-service.ts hydrates from disk; 19 disk tests + 6 integration tests pass including round-trip restart |
| 7 | SchemaService singleton wired in DxCoreMcpProvider, accessible for tool injection | ✓ VERIFIED | `index.ts:83` creates `new SchemaService({ dataDir })`, stores in `this.schemaService`; `getSchemaService()` accessor at line 69; SIGTERM handler at line 92; integration test confirms `provider.getSchemaService()` returns instance after `provideTools()` |

**Score:** 7/7 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/mcp-provider-dx-core/src/schema/types.ts` | SchemaEntry union type (3 variants) | ✓ VERIFIED | 49 lines; exports SchemaEntryType, FullDescribeEntry, PartialFieldsEntry, RelationshipEdgesEntry, SchemaEntry |
| `packages/mcp-provider-dx-core/src/schema/schema-service.ts` | SchemaService with per-org LRU, TTL, single-flight, persistence | ✓ VERIFIED | 259 lines; LRUCache import, Map<string, LRUCache>, inFlight Map, describeAndCache, loadFromDisk, flushToDisk, shutdown |
| `packages/mcp-provider-dx-core/src/schema/disk-persistence.ts` | SchemaDiskPersistence: save/load/debounce/flush | ✓ VERIFIED | 189 lines; fs/promises import, per-org JSON files, debounced writes (5s default), TTL discard on load, path traversal protection |
| `packages/mcp-provider-dx-core/src/schema/index.ts` | Barrel export for schema module | ✓ VERIFIED | 27 lines; exports SchemaService, SchemaDiskPersistence, all types |
| `packages/mcp-provider-dx-core/test/unit/schema/schema-service.test.ts` | Unit tests: isolation, TTL, LRU, single-flight, data types | ✓ VERIFIED | 26 tests passing; covers per-org isolation (3), TTL expiry (3), three data types (4), LRU eviction (2), single-flight (4), normalization (1), utility (6), onMutation (3) |
| `packages/mcp-provider-dx-core/test/unit/schema/disk-persistence.test.ts` | Unit tests for disk persistence | ✓ VERIFIED | 19 tests passing; covers save/load, TTL discard, debounce, loadAll, flush, path traversal |
| `packages/mcp-provider-dx-core/test/unit/schema/schema-integration.test.ts` | Integration: round-trip, restart, provider wiring | ✓ VERIFIED | 6 tests passing; round-trip persistence, TTL discard on restart, debounce coalescing, shutdown flush, provider wiring, no-dataDir graceful |
| `packages/mcp-provider-dx-core/src/index.ts` | DxCoreMcpProvider SchemaService singleton + SIGTERM | ✓ VERIFIED | Lines 62-95; `new SchemaService({ dataDir })`, `loadFromDisk()`, SIGTERM → `shutdown()` |
| `packages/mcp-provider-dx-core/package.json` | lru-cache dependency | ✓ VERIFIED | `"lru-cache": "^11.1.0"` in dependencies |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| schema-service.ts | lru-cache | `import { LRUCache } from 'lru-cache'` | ✓ WIRED | Line 17; used at line 251 `new LRUCache<string, SchemaEntry>({ max, ttl })` |
| schema-service.ts | types.ts | `import type { SchemaEntry } from './types.js'` | ✓ WIRED | Line 18; SchemaEntry used throughout as type param for LRUCache, get/set, describeAndCache |
| disk-persistence.ts | node:fs/promises | `import { mkdir, readFile, writeFile, readdir }` | ✓ WIRED | Line 17; all four used in saveOrg, loadOrg, loadAll methods |
| schema-service.ts | disk-persistence.ts | `import { SchemaDiskPersistence }` | ✓ WIRED | Line 19; instantiated at line 62, used in notifyMutation, loadFromDisk, flushToDisk |
| index.ts (provider) | schema-service.ts | `new SchemaService({ dataDir })` | ✓ WIRED | Line 83; stored as singleton, `loadFromDisk()` called, `shutdown()` on SIGTERM |

### Data-Flow Trace (Level 4)

Not applicable — this phase builds a cache service (infrastructure), not a UI component rendering dynamic data. Data flow will be verified when tools consume SchemaService in Phase 11+.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All 51 schema tests pass | `node mocha.js test/unit/schema/**/*.test.ts` | 51 passing (339ms) | ✓ PASS |
| Per-org isolation: orgA data not leaked to orgB | Test: `set("orgA", ...) → get("orgB", ...) === undefined` | Pass | ✓ PASS |
| 10 concurrent → 1 API call | Test: `Promise.all(10 × describeAndCache) → calledOnce` | Pass (54ms) | ✓ PASS |
| LRU eviction at 101 entries | Test: insert 101 → first entry evicted | Pass | ✓ PASS |
| Disk round-trip across restart | Test: set → flush → new instance → loadFromDisk → get | Pass | ✓ PASS |
| TTL-expired discard on load | Test: expired entry not loaded from disk | Pass | ✓ PASS |
| Provider wiring | Test: `provider.getSchemaService()` returns instance | Pass | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-----------|-------------|--------|----------|
| SINF-01 | 10-01 | Per-org schema cache isolates cached metadata by org identity | ✓ SATISFIED | `orgCaches: Map<string, LRUCache>` keyed by canonical username; 3 isolation tests pass |
| SINF-02 | 10-01 | Cache entries expire after configurable TTL (default 1h, SF_SCHEMA_CACHE_TTL_MINUTES) | ✓ SATISFIED | `DEFAULT_TTL_MS = 3_600_000`; env var override; LRUCache `ttl` param; 3 TTL tests pass |
| SINF-03 | 10-01 | Cache stores three data types: full describe, partial fields, relationship edges | ✓ SATISFIED | Union type `SchemaEntry = FullDescribeEntry \| PartialFieldsEntry \| RelationshipEdgesEntry`; 4 type tests pass |
| SINF-04 | 10-01 | Concurrent describe requests coalesce into single API call | ✓ SATISFIED | `inFlight: Map<string, Promise>` with `.finally()` cleanup; 4 single-flight tests pass |
| SINF-05 | 10-02 | Cache persists to disk as per-org JSON; loads on startup; discards TTL-expired | ✓ SATISFIED | `SchemaDiskPersistence` saves/loads `{dataDir}/schema-cache/{org}.json`; TTL check on load; 19 persistence + 6 integration tests pass |

**Orphaned requirements:** None. All 5 requirements (SINF-01 through SINF-05) mapped to Phase 10 in REQUIREMENTS.md are covered by plans 10-01 and 10-02.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No anti-patterns found | — | — |

No TODOs, FIXMEs, placeholders, console.logs, empty implementations, or hardcoded returns found in any schema module source files. All empty catch blocks are intentional (non-fatal disk I/O per design — documented in class JSDoc).

### Human Verification Required

None required. All phase deliverables are infrastructure code verified through unit and integration tests. No visual components, external service integrations, or real-time behaviors to test.

### Gaps Summary

No gaps found. All 7 observable truths verified. All 9 artifacts exist, are substantive, and are properly wired. All 5 key links confirmed. All 5 requirements satisfied. 51 tests pass covering every behavioral aspect.

**Note:** The `yarn workspace test` command fails due to pre-existing lint errors in unrelated test files (org-list-resource.test.ts, org-permissions-resource.test.ts — missing headers, unsafe `any` assignments). These are not phase 10 regressions. All 51 schema-related unit and integration tests pass cleanly via direct mocha invocation.

---

_Verified: 2026-04-12T15:30:24Z_
_Verifier: the agent (gsd-verifier)_
