# Requirements: Salesforce MCP Server

**Defined:** 2026-04-11
**Core Value:** AI agents can safely and efficiently interact with Salesforce orgs through well-defined, permission-controlled MCP tools.

## v1.1 Requirements (Complete)

All 24 requirements shipped 2026-04-11. See MILESTONES.md for details.

## v1.2 Requirements (Complete)

All 8 requirements shipped 2026-04-12. See traceability below.

### Tool Metadata

- [x] **META-01**: All GA tools declare complete `readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint` annotations
- [x] **META-02**: Annotations values are consistent with `tool-categories.ts` read/write/execute classification

### Error Experience

- [x] **ERR-01**: Top-10 most-used GA tools return error messages with recovery guidance (what went wrong + what to try next)

### Structured Output

- [x] **OUT-01**: 5-8 core GA query tools declare `outputSchema` and return `structuredContent` alongside text `content`
- [x] **OUT-02**: Middleware pass-through test confirms `structuredContent` survives `wrappedCb` unchanged

### Discoverability

- [x] **DISC-01**: MCP Resources expose authenticated org list as a discoverable resource
- [x] **DISC-02**: MCP Resources expose per-org permission levels as a discoverable resource
- [x] **DISC-03**: `registry-utils.ts` wires `provideResources()` from providers to `server.registerResource()`

## v1.3 Requirements

Requirements for Smart Schema Cache milestone. Reduces AI SOQL query failures through progressive schema caching, auto-correction on failure, and relationship graph suggestions.

### Schema Infrastructure

- [ ] **SINF-01**: Per-org schema cache isolates cached metadata by org identity (canonical username as key)
- [ ] **SINF-02**: Cache entries expire after configurable TTL (default 1 hour, override via `SF_SCHEMA_CACHE_TTL_MINUTES`)
- [ ] **SINF-03**: Cache stores three data types: full describe results, partial (success-path) field lists, and relationship graph edges
- [ ] **SINF-04**: Concurrent describe requests for the same object coalesce into a single API call (single-flight pattern)
- [ ] **SINF-05**: Cache persists to disk as per-org JSON files; on startup, loads existing cache and discards TTL-expired entries

### Schema Discovery

- [ ] **DISC-04**: `salesforce_describe_object` tool returns object fields (name, label, type, filterable, updateable), relationships, and record key prefix
- [ ] **DISC-05**: `describe_object` checks cache first; on cache hit returns cached data with source metadata (`cache`/`api`, age, full/partial indicator)
- [ ] **DISC-06**: Tool description recommends (not forces) AI to describe unfamiliar objects before querying

### Auto-Cache

- [ ] **ACCH-01**: Successful SOQL queries auto-cache the queried object name and field names as a partial schema entry (zero extra API calls)
- [ ] **ACCH-02**: SOQL FROM clause and SELECT field list are parsed from the query string on success
- [ ] **ACCH-03**: Partial cache entries are merged with full describe results when both exist (full describe wins on conflict)

### Failure Recovery

- [x] **FAIL-01**: On `INVALID_FIELD` SOQL error, auto-call `connection.describe()` for the failing object
- [x] **FAIL-02**: Fuzzy-match the failing field name against actual field names using Levenshtein distance (no external vector dependencies)
- [x] **FAIL-03**: Return top 3 field suggestions ranked by similarity alongside the original error message
- [x] **FAIL-04**: Update schema cache with the fresh describe result from the failure recovery path

### Relationship Graph

- [x] **RELG-01**: Extract `referenceTo[]` and `relationshipName` from describe results to build relationship edges
- [x] **RELG-02**: Store relationship edges as `{ from, to, via, type: 'lookup' | 'master-detail' }` in the per-org cache
- [x] **RELG-03**: When a query touches an object with known relationships, surface join/lookup path suggestions in the response

### Query History

- [x] **QHST-01**: Store N most recent successful SOQL queries per org in a ring buffer (default N=50)
- [x] **QHST-02**: Query history retention limit is configurable (environment variable or server config)
- [x] **QHST-03**: Query history is accessible via a `list_query_history` tool or included in describe_object context

## Future Requirements

Deferred to future milestones.

### Persistence & Training

- **PERS-02**: Use query history as RAG training data for improved SOQL generation (semantic matching against stored queries)
- **PERS-03**: `describeGlobal()` pre-warming at startup for frequently-used orgs

### Protocol Compliance

- **LOG-01**: `logging/setLevel` protocol support with `sendLoggingMessage()` bridge
- **LOG-02**: Telemetry empty catch blocks replaced with protocol-level logging

### Discoverability (Extended)

- **PROMPT-01**: MCP Prompts for common Salesforce workflows (deploy, SOQL)
- **PROMPT-02**: `registry-utils.ts` wires `providePrompts()` from providers

### Upstream Fixes

- **UPSTREAM-01**: scratchOrgCreate() accepts projectPath parameter (requires @salesforce/core change)
- **UPSTREAM-02**: lwc-experts provider ships chdir-free version (requires external team)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Vector embedding fuzzy match | Over-engineering; Levenshtein covers 99% of typos without external deps |
| Persistent disk cache (SQLite) | JSON files sufficient for schema cache; SQLite adds unnecessary complexity |
| Auto-inject full schema into context | Token explosion (100+ fields per object); on-demand describe is sufficient |
| describeGlobal at startup | 800+ objects per org; rate limit risk; low value without field details |
| Cross-org shared cache | Orgs diverge (custom fields); mixing cache entries creates wrong suggestions |
| SDK v2.0 upgrade | Still in alpha; no functional benefit for this milestone |
| Streamable HTTP transport | Not needed for current single-client stdio use case |
| Tool consolidation (merging 49+ tools) | Requires upstream coordination |
| Non-GA tool annotations/output | Not exposed to users by default |
| External provider source modifications | lwc-experts and aura-experts are closed-source |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| META-01 | Phase 6 | Complete |
| META-02 | Phase 6 | Complete |
| ERR-01 | Phase 7 | Complete |
| OUT-02 | Phase 8 | Complete |
| OUT-01 | Phase 8 | Complete |
| DISC-03 | Phase 9 | Complete |
| DISC-01 | Phase 9 | Complete |
| DISC-02 | Phase 9 | Complete |
| SINF-01 | Phase 10 | Pending |
| SINF-02 | Phase 10 | Pending |
| SINF-03 | Phase 10 | Pending |
| SINF-04 | Phase 10 | Pending |
| SINF-05 | Phase 10 | Pending |
| DISC-04 | Phase 11 | Pending |
| DISC-05 | Phase 11 | Pending |
| DISC-06 | Phase 11 | Pending |
| ACCH-01 | Phase 12 | Validated |
| ACCH-02 | Phase 12 | Validated |
| ACCH-03 | Phase 12 | Validated |
| FAIL-01 | Phase 13 | Validated |
| FAIL-02 | Phase 13 | Validated |
| FAIL-03 | Phase 13 | Validated |
| FAIL-04 | Phase 13 | Validated |
| RELG-01 | Phase 14 | Validated |
| RELG-02 | Phase 14 | Validated |
| RELG-03 | Phase 14 | Validated |
| QHST-01 | Phase 15 | Validated |
| QHST-02 | Phase 15 | Validated |
| QHST-03 | Phase 15 | Validated |

**Coverage:**
- v1.3 requirements: 21 total
- Mapped to phases: 21/21
- Unmapped: 0

---
*Requirements defined: 2026-04-11*
*Last updated: 2026-04-12 after v1.3 roadmap creation — all 20 requirements mapped*
