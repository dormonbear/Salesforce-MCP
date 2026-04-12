---
phase: 10-schema-cache-foundation
plan: 01
subsystem: schema
tags: [lru-cache, schema, caching, single-flight, ttl]

# Dependency graph
requires: []
provides:
  - "SchemaService class with per-org LRU caches, TTL, single-flight coalescing"
  - "SchemaEntry union type (FullDescribe | PartialFields | RelationshipEdges)"
  - "Barrel export at packages/mcp-provider-dx-core/src/schema/index.ts"
affects: [10-02-disk-persistence, 11-describe-tool, 12-auto-cache, 13-schema-graph]

# Tech tracking
tech-stack:
  added: [lru-cache@^11.1.0]
  patterns: [per-org LRU cache isolation, single-flight promise coalescing, case-insensitive key normalization]

key-files:
  created:
    - packages/mcp-provider-dx-core/src/schema/types.ts
    - packages/mcp-provider-dx-core/src/schema/schema-service.ts
    - packages/mcp-provider-dx-core/src/schema/index.ts
    - packages/mcp-provider-dx-core/test/unit/schema/schema-service.test.ts
  modified:
    - packages/mcp-provider-dx-core/package.json

key-decisions:
  - "Used lru-cache v11 (ESM-native) for per-org LRU isolation with built-in TTL support"
  - "Object names normalized to lowercase for case-insensitive cache keys (Pitfall 11)"
  - "Single-flight via Map<string, Promise> — no external dependency needed"
  - "onMutation callback hook exposed for Plan 02 disk persistence integration"

patterns-established:
  - "Per-org cache partitioning: Map<orgUsername, LRUCache<objectName, SchemaEntry>>"
  - "Single-flight coalescing: Map<flightKey, Promise> with automatic cleanup in .finally()"
  - "TTL override: SF_SCHEMA_CACHE_TTL_MINUTES env var → constructor option → default 3,600,000ms"

requirements-completed: [SINF-01, SINF-02, SINF-03, SINF-04]

# Metrics
duration: 8min
completed: 2026-04-12
---

# Phase 10 Plan 01: Schema Cache Foundation Summary

**In-memory SchemaService with per-org LRU isolation (max 100/org), 1h TTL, three entry types, and single-flight promise coalescing for concurrent describe deduplication**

## What Was Built

### SchemaService (`packages/mcp-provider-dx-core/src/schema/schema-service.ts`)

Core in-memory cache service with:

- **Per-org LRU isolation**: Each org username gets its own `LRUCache<string, SchemaEntry>` instance, preventing cross-org data leakage (T-10-01 mitigated)
- **Configurable TTL**: Defaults to 3,600,000ms (1 hour). Overridable via `SF_SCHEMA_CACHE_TTL_MINUTES` env var or constructor `ttlMs` option
- **LRU eviction**: Max 100 entries per org prevents unbounded memory growth (T-10-02 mitigated)
- **Single-flight coalescing**: `describeAndCache()` deduplicates concurrent API calls for the same org+object via a `Map<string, Promise>` with automatic cleanup
- **Case-insensitive keys**: Object names normalized to lowercase for consistent lookups
- **Mutation hook**: `onMutation` callback for Plan 02 disk persistence integration

### Schema Types (`packages/mcp-provider-dx-core/src/schema/types.ts`)

Three-variant union type for schema cache entries:
- `FullDescribeEntry` — full describe result with `Record<string, unknown>` data
- `PartialFieldsEntry` — lightweight field name list
- `RelationshipEdgesEntry` — object relationship graph edges

### Test Coverage (26 tests)

| Category | Tests | Coverage |
|----------|-------|----------|
| Per-org isolation | 3 | Cross-org reads return undefined; same-org reads return entry |
| TTL expiry | 3 | Immediate get works; expired get returns undefined; env var override |
| Three data types | 4 | All three entry types store and retrieve correctly |
| LRU eviction | 2 | 101st entry evicts oldest; access refreshes LRU position |
| Single-flight | 4 | 10 concurrent → 1 API call; per-object dedup; cleanup after resolve; rejection propagation |
| Object normalization | 1 | Case-insensitive key matching |
| Utility methods | 6 | invalidate, invalidateOrg, clear, getOrgCacheSize, getAllOrgUsernames |
| onMutation callback | 3 | Called on set, called on invalidate (when exists), not called on miss |

## Deviations from Plan

None — plan executed exactly as written.

## Commits

| Commit | Type | Description |
|--------|------|-------------|
| `56465fa` | test | Add failing tests for SchemaService (RED phase) |
| `f5154d0` | feat | Implement SchemaService with per-org LRU, TTL, single-flight (GREEN phase) |

## Self-Check: PASSED

All created files verified present. All commit hashes verified in git log.
