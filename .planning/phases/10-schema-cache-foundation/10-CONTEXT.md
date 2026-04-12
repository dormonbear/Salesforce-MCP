# Phase 10: Schema Cache Foundation - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Deliver a per-org, TTL-aware, LRU-bounded schema cache as a reusable service internal to `mcp-provider-dx-core`. This cache is the foundation for all subsequent v1.3 features (describe_object, auto-cache, failure recovery, relationship graph, query history). It does not expose any new MCP tools — it is pure infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Service Architecture
- **D-01:** SchemaService lives as a private module inside `packages/mcp-provider-dx-core/src/schema/`. It is NOT added to the shared `Services` interface in `mcp-provider-api`. Only dx-core tools access it directly.
- **D-02:** SchemaService is instantiated once per DxCoreMcpProvider lifecycle (singleton within dx-core), passed to tools that need it via constructor injection or a shared context object.

### Dependency Strategy
- **D-03:** Use `lru-cache` npm package for LRU + TTL eviction. Add as production dependency to `packages/mcp-provider-dx-core/package.json`.
- **D-04:** No other new production dependencies for Phase 10.

### Cache Identity
- **D-05:** Cache keys use canonical username (from `Connection.getUsername()`) — not alias. This prevents cross-org bleed when the same alias points to different orgs.
- **D-06:** Cache is partitioned as `Map<orgUsername, LRUCache<objectName, SchemaEntry>>` — outer Map per org, inner LRU per object within that org.

### TTL & Eviction
- **D-07:** Default TTL: 1 hour (3,600,000 ms). Override via `SF_SCHEMA_CACHE_TTL_MINUTES` env var.
- **D-08:** LRU max entries per org: 100 objects (sufficient for most sessions; evicts least-recently-used objects first).

### Concurrency
- **D-09:** Single-flight pattern for concurrent describe requests — if N parallel tool calls all need to describe the same object, only 1 API call fires. Others await the same Promise.
- **D-10:** No Mutex needed for cache reads/writes — `lru-cache` is synchronous and JS is single-threaded. The single-flight pattern uses a `Map<string, Promise>` for in-flight requests.

### Data Types
- **D-11:** Cache stores three entry types in a union: `FullDescribe` (complete API response), `PartialFields` (field names from successful queries), `RelationshipEdges` (lookup/master-detail graph). Schema design must accommodate all three from day one even though Phases 12-14 populate them later.

### Claude's Discretion
- Internal module structure (file naming, class vs. functional approach)
- Test strategy (unit tests for cache operations, TTL expiry, single-flight coalescing)
- Whether to use a class-based or functional API for SchemaService

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Cache Pattern
- `packages/mcp/src/utils/cache.ts` — Existing Cache class (singleton Map with Mutex); schema cache should NOT extend this — different semantics, different location

### Services Interface
- `packages/mcp-provider-api/src/services.ts` — Services interface definition; SchemaService is NOT added here (D-01)
- `packages/mcp/src/services.ts` — Services implementation; shows how OrgService.getConnection() works

### Integration Point
- `packages/mcp-provider-dx-core/src/tools/run_soql_query.ts` — Primary consumer in later phases; already references `salesforce_describe_object` in error recovery

### Research
- `.planning/research/ARCHITECTURE.md` — SchemaService architecture proposal
- `.planning/research/STACK.md` — lru-cache recommendation and API surface
- `.planning/research/PITFALLS.md` — Single-flight pattern, TTL staleness, cache key collision risks

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `OrgService.getConnection(username)` — returns `Connection` which has `.describe(objectName)` and `.describeGlobal()`
- `Connection.getUsername()` — provides canonical username for cache keying
- `@salesforce/core` Mutex — available but not needed here (JS single-threaded)

### Established Patterns
- Singleton pattern (existing Cache class) — dx-core SchemaService can follow similar singleton-per-provider pattern
- Services injection via constructor — tools receive `services: Services` in constructor
- Error wrapping with `SfError.wrap(error)` — consistent error handling

### Integration Points
- `DxCoreMcpProvider.provideTools(services)` — where SchemaService would be created and passed to tools
- `packages/mcp-provider-dx-core/src/shared/` — shared utilities directory; new `schema/` directory is peer

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches. Research recommends the architecture in `.planning/research/ARCHITECTURE.md`.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 10-schema-cache-foundation*
*Context gathered: 2026-04-12*
