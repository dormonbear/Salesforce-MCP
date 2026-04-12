# Phase 15: Query History — Context

## Phase Goal
Recent successful SOQL queries are retained per org and accessible to AI agents for pattern reuse.

## Requirements
- **QHST-01**: Store N most recent successful SOQL queries per org in a ring buffer (default N=50)
- **QHST-02**: Query history retention limit is configurable (environment variable or server config)
- **QHST-03**: Query history is accessible via a `list_query_history` tool or included in describe_object context

## Decisions

### D-01: Query history storage model
**Decision:** New `QueryHistoryService` class in `src/schema/` with per-org ring buffer using a fixed-size array. Not stored in SchemaService LRU — different eviction semantics (FIFO ring vs LRU TTL).
**Rationale:** Ring buffer is naturally FIFO with fixed capacity. Mixing into SchemaService would complicate eviction — queries don't have TTL, they have count-based retention.

### D-02: Ring buffer implementation
**Decision:** Simple array-based ring buffer with `push()` that overwrites oldest entry when full. Store `{ query: string, objectName: string, timestamp: number, fieldCount: number }` per entry.
**Rationale:** No external dependencies needed. Array with modulo index is O(1) push.

### D-03: Default retention limit
**Decision:** Default N=50 per org. Configurable via `SF_QUERY_HISTORY_LIMIT` environment variable (parsed as integer at construction time).
**Rationale:** 50 recent queries per org is enough for pattern reuse without excessive memory. Env var follows the `SF_SCHEMA_CACHE_TTL_MINUTES` precedent.

### D-04: What gets stored
**Decision:** Only successful SOQL queries (not Tooling API queries). Store the raw SOQL string, extracted objectName (from parseSoqlFields), timestamp (Date.now()), and field count. Do NOT store query results.
**Rationale:** Results can be large. The history is for pattern reuse — the AI agent needs to know what was queried, not the data returned.

### D-05: Where to record queries
**Decision:** Fire-and-forget in `run_soql_query.ts` after successful query, same location as auto-cache hook. Call `queryHistoryService.record(orgUsername, query, objectName)`.
**Rationale:** Follows the established fire-and-forget pattern from Phase 12. Recording must never fail the query.

### D-06: Access mechanism
**Decision:** New `ListQueryHistoryMcpTool` registered alongside existing tools. Parameters: `usernameOrAlias` (required), `objectName` (optional filter), `limit` (optional, default 10). Returns array of `{ query, objectName, timestamp, fieldCount }`.
**Rationale:** QHST-03 says "accessible via a list_query_history tool". Dedicated tool with optional filters is most useful for AI agents.

### D-07: Tool metadata
**Decision:** Tool name: `salesforce_list_query_history`. Read-only, non-destructive, idempotent. Release state: GA. Toolset: query.
**Rationale:** Follows naming convention of existing tools. Query toolset grouping matches semantic domain.

### D-08: Disk persistence
**Decision:** No disk persistence for query history. In-memory only — history resets on server restart.
**Rationale:** Query history is transient pattern data, not critical state. Adding persistence would add complexity for minimal value in the MCP server lifecycle.

### D-09: Duplicate handling
**Decision:** Allow duplicates — if the same query is run multiple times, each execution is stored as a separate entry. This preserves the "recent activity" semantic.
**Rationale:** AI agents benefit from seeing frequency of queries. Deduplication would lose temporal information.

### D-10: Service lifecycle
**Decision:** QueryHistoryService is instantiated in `DxCoreMcpProvider.provideTools()` alongside SchemaService. Passed to `QueryOrgMcpTool` and `ListQueryHistoryMcpTool` constructors.
**Rationale:** Same lifecycle pattern as SchemaService — created once, shared across tools.

## Codebase Assets
- `run_soql_query.ts` — fire-and-forget hooks established in Phase 12
- `soql-parser.ts` — `parseSoqlFields()` extracts objectName and fieldNames
- `index.ts` — `DxCoreMcpProvider.provideTools()` instantiates services and creates tools
- `schema/` directory — established pattern for cache-related services

## Deferred Ideas
- Disk persistence for query history — future if needed
- Query frequency analytics / most-queried objects — future
