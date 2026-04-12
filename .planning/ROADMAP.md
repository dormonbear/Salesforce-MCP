# Roadmap: Salesforce MCP Server

## Milestones

- ✅ **v1.0 Fix Concurrent Org Race Condition** - Phase 1 (shipped 2026-04-09)
- ✅ **v1.1 Eliminate process.chdir() and Enable Tool Parallelism** - Phases 2-5 (shipped 2026-04-11)
- ✅ **v1.2 MCP Best Practices Alignment** - Phases 6-9 (shipped 2026-04-11)
- 🚧 **v1.3 Smart Schema Cache** - Phases 10-15 (in progress)

## Phases

<details>
<summary>✅ v1.0 Fix Concurrent Org Race Condition (Phase 1) — SHIPPED 2026-04-09</summary>

### Phase 1: Eliminate per-call config reads and resolve orgs at startup

**Goal**: Remove the root cause of the concurrent org race condition by resolving symbolic org names once at startup, eliminating redundant per-call config reads in getConnection() that depend on process.cwd().
**Depends on**: Nothing (first phase)
**Requirements**: (v1.0 scope)
**Success Criteria** (what must be TRUE):
  1. resolveSymbolicOrgs() resolves DEFAULT_TARGET_ORG and DEFAULT_TARGET_DEV_HUB once at startup
  2. getConnection() no longer calls getAllAllowedOrgs() or findOrgByUsernameOrAlias() on every invocation
  3. All existing tests pass with no regressions
**Plans**: Complete

</details>

<details>
<summary>✅ v1.1 Eliminate process.chdir() and Enable Tool Parallelism (Phases 2-5) — SHIPPED 2026-04-11</summary>

### Phase 2: Prerequisites

**Goal**: Shared infrastructure is in place and ancillary bugs are fixed before any chdir removal begins
**Depends on**: Phase 1
**Requirements**: PREREQ-01, PREREQ-02, PREREQ-03, PREREQ-04
**Success Criteria** (what must be TRUE):
  1. Any provider can import directoryParam and sanitizePath from mcp-provider-api without local copies
  2. SIGTERM signal terminates the server process cleanly (process.on instead of process.stdin.on)
  3. tool-categories.ts returns correct read/write/execute classification for every tool in devops, code-analyzer, mobile-web, scale-products, and metadata-enrichment providers
  4. No provider package contains its own duplicate copy of directoryParam or sanitizePath
**Plans**: 2 plans

Plans:
- [x] 02-01-PLAN.md — Consolidate shared params into mcp-provider-api; migrate all providers
- [x] 02-02-PLAN.md — Complete tool-categories.ts; fix SIGTERM handler with graceful shutdown

### Phase 3: Wave 1 chdir Removal

**Goal**: The 10 connection-only tools execute correctly without calling process.chdir(), while the global Mutex remains in place as a safety net
**Depends on**: Phase 2
**Requirements**: CHDIR-01, CHDIR-02, CHDIR-03, CHDIR-04, CHDIR-05, CHDIR-06, CHDIR-07, CHDIR-08, CHDIR-09, CHDIR-10
**Success Criteria** (what must be TRUE):
  1. run_soql_query, assign_permission_set, open_org, delete_org, run_apex_test, run_agent_test, list_all_orgs, get_username, resume_tool_operation, and create_org_snapshot all return correct results without a process.chdir() call in their execution path
  2. No process.chdir() call appears in the source of any of the 10 Wave 1 tool files
  3. All existing tests pass after removal
**Plans**: 1 plan

Plans:
- [x] 03-01-PLAN.md — Remove process.chdir() from all 10 connection-only tools

### Phase 4: Wave 2 chdir Removal

**Goal**: The 4 SfProject-dependent tools execute correctly by passing explicit projectPath to @salesforce/core APIs, without calling process.chdir()
**Depends on**: Phase 3
**Requirements**: CHDIR-11, CHDIR-12, CHDIR-13, CHDIR-14, CHDIR-15
**Success Criteria** (what must be TRUE):
  1. deploy_metadata and retrieve_metadata pass an explicit path to SfProject.resolve() and SourceTracking.create() and complete without process.chdir()
  2. create_scratch_org completes without process.chdir() with its Org.create() path verified as CWD-free
  3. enrich_metadata completes without process.chdir() with metadata-enrichment library CWD usage confirmed safe
  4. scan_apex_class_for_antipatterns completes without process.chdir()
  5. All existing tests pass after removal
**Plans**: 1 plan

Plans:
- [x] 04-01-PLAN.md — Remove process.chdir() from all 5 SfProject-dependent tools

### Phase 5: Concurrency Enablement

**Goal**: The global toolExecutionMutex is removed and parallel tool execution is safe, with lwc-experts tools protected by a targeted per-tool lock
**Depends on**: Phase 4
**Requirements**: CONC-01, CONC-02, CONC-03, CONC-04, CONC-05
**Success Criteria** (what must be TRUE):
  1. auth.ts getDefaultConfig() accepts an explicit projectPath parameter and no longer calls ConfigAggregator.clearInstance(process.cwd())
  2. SfMcpServer.registerTool() middleware dispatches tool handlers as independent Promises without a global Mutex
  3. lwc-experts tools serialize through a targeted per-tool Mutex while all other tools run concurrently
  4. A concurrent stress test of 5 or more tools executing in parallel completes without race conditions or data corruption
  5. All existing tests pass after Mutex removal
**Plans**: 1 plan

Plans:
- [x] 05-01-PLAN.md — Remove global Mutex, add targeted lwc-experts serialization, concurrent stress test

</details>

<details>
<summary>✅ v1.2 MCP Best Practices Alignment (Phases 6-9) — SHIPPED 2026-04-11</summary>

### Phase 6: Tool Annotations

**Goal**: Every GA tool declares complete, consistent annotations so LLM clients make correct tool selection decisions without false confirmation dialogs
**Depends on**: Phase 5
**Requirements**: META-01, META-02
**Success Criteria** (what must be TRUE):
  1. Every GA tool has all four hints declared: readOnlyHint, destructiveHint, idempotentHint, openWorldHint
  2. A unit test verifies that each tool's readOnlyHint value matches its tool-categories.ts read/write/execute classification
  3. No tool that is classified as "read" in tool-categories.ts has readOnlyHint set to false
  4. No tool that is classified as "write" or "execute" in tool-categories.ts has readOnlyHint set to true
**Plans**: 3 plans

Plans:
- [x] 06-01-PLAN.md — Complete 4-hint annotations on all dx-core GA tools (Wave 1)
- [x] 06-02-PLAN.md — Complete 4-hint annotations on mobile-web, code-analyzer, devops, scale-products, and mcp GA tools; fix 2 readOnlyHint bugs (Wave 1)
- [x] 06-03-PLAN.md — Write readOnlyHint consistency unit test against tool-categories.ts (Wave 2)

### Phase 7: Error Recovery

**Goal**: The top-10 most-used GA tools return actionable error messages that allow an LLM agent to self-repair without human intervention
**Depends on**: Phase 6
**Requirements**: ERR-01
**Success Criteria** (what must be TRUE):
  1. Each of the top-10 GA tools returns error messages that include both what went wrong and what to try next
  2. A shared toolError(message, recovery?) factory in mcp-provider-api produces the standardized error format
  3. No catch block in the top-10 tools silently swallows errors or returns raw stack traces to the LLM
  4. Error messages distinguish between user-fixable errors (wrong org alias, missing permission) and system errors (network timeout, auth expiry)
**Plans**: 2 plans

Plans:
- [x] 07-01-PLAN.md — Create toolError() factory and classifyError() in mcp-provider-api with TDD (Wave 1)
- [x] 07-02-PLAN.md — Migrate all 10 top-used GA tools to toolError() with domain-specific recovery hints (Wave 2)

### Phase 8: Structured Output

**Goal**: 5-8 core GA query tools return machine-readable structuredContent alongside text content, enabling LLM agents to parse results programmatically
**Depends on**: Phase 7
**Requirements**: OUT-01, OUT-02
**Success Criteria** (what must be TRUE):
  1. A middleware pass-through test confirms that structuredContent set in a tool handler survives wrappedCb unchanged and appears in the final CallToolResult
  2. 5-8 core tools (including run_soql_query, list_all_orgs, get_username, get_org_info) declare outputSchema and return structuredContent on every successful call
  3. Each tool's structuredContent is validated against its outputSchema at test time
  4. Text content remains present alongside structuredContent for backward compatibility with older clients
**Plans**: 2 plans

Plans:
- [x] 08-01-PLAN.md — Middleware pass-through test proving structuredContent survives wrappedCb (Wave 1)
- [x] 08-02-PLAN.md — Add outputSchema + structuredContent to 6 core tools with schema validation tests (Wave 2)

### Phase 9: MCP Resources

**Goal**: Authenticated org list and per-org permission levels are discoverable as MCP Resources, so LLM agents can inspect available orgs without calling tools
**Depends on**: Phase 8
**Requirements**: DISC-01, DISC-02, DISC-03
**Success Criteria** (what must be TRUE):
  1. registry-utils.ts calls provideResources() from each provider and registers the results with server.registerResource()
  2. An MCP client can list resources and receive the authenticated org list as a structured resource
  3. An MCP client can read a per-org resource and receive that org's permission levels (read/write/execute for each tool category)
  4. Resources return current data on each read (not cached stale data from startup)
**Plans**: 2 plans

Plans:
- [x] 09-01-PLAN.md — Wire registerResourcesFromProviders() infrastructure and PermissionService on Services
- [x] 09-02-PLAN.md — Implement OrgListResource and OrgPermissionsResource in mcp-provider-dx-core

</details>

### 🚧 v1.3 Smart Schema Cache (In Progress)

**Milestone Goal:** Reduce AI SOQL query failures through progressive schema caching, auto-correction on failure, and relationship graph suggestions.

- [ ] **Phase 10: Schema Cache Foundation** - Per-org cache infrastructure with TTL, LRU eviction, and single-flight coalescing
- [ ] **Phase 11: Schema Discovery Tool** - Implement salesforce_describe_object with cache-first behavior
- [ ] **Phase 12: Auto-Cache on Success** - Side-effect caching of object/field metadata from successful SOQL queries
- [ ] **Phase 13: Failure Recovery** - Auto-describe on INVALID_FIELD errors with fuzzy field suggestions
- [ ] **Phase 14: Relationship Graph** - Extract and surface join/lookup path suggestions from describe results
- [ ] **Phase 15: Query History** - Ring buffer storage with list_query_history tool

## Phase Details

### Phase 10: Schema Cache Foundation
**Goal**: A per-org, TTL-aware, LRU-bounded schema cache exists as a service accessible to all tools, with concurrent describe requests coalesced into single API calls and disk persistence across restarts
**Depends on**: Phase 9
**Requirements**: SINF-01, SINF-02, SINF-03, SINF-04, SINF-05
**Success Criteria** (what must be TRUE):
  1. Schema data for org A is never returned when querying org B — per-org isolation verified with two orgs sharing an alias
  2. A cached entry automatically becomes a cache miss after the configured TTL expires (default 1 hour, overridable via SF_SCHEMA_CACHE_TTL_MINUTES)
  3. The cache accepts and stores three distinct data types: full describe results, partial field lists, and relationship graph edges
  4. Ten concurrent describe requests for the same object on the same org result in exactly one API call (single-flight pattern verified by test)
  5. Cache size remains bounded — LRU eviction prevents unbounded memory growth regardless of how many objects are described
  6. Cache persists to per-org JSON files in dataDir; on startup, loads existing cache and discards TTL-expired entries; survives process restart
**Plans**: 2 plans

Plans:
- [ ] 10-01-PLAN.md — Schema types + SchemaService with per-org LRU cache, TTL, single-flight coalescing
- [ ] 10-02-PLAN.md — Disk persistence (save/load/debounce) + DxCoreMcpProvider wiring

### Phase 11: Schema Discovery Tool
**Goal**: AI agents can explicitly inspect any Salesforce object's schema before writing queries, with results served from cache when available
**Depends on**: Phase 10
**Requirements**: DISC-04, DISC-05, DISC-06
**Success Criteria** (what must be TRUE):
  1. Calling salesforce_describe_object returns field metadata (name, label, type, filterable, updateable), relationships, and record key prefix for any valid sObject
  2. A second call for the same object within TTL returns cached data with source metadata indicating cache hit, age, and full/partial indicator
  3. The tool's description text recommends (not forces) describing unfamiliar objects before querying — visible in tool listing
**Plans**: TBD

### Phase 12: Auto-Cache on Success
**Goal**: Every successful SOQL query progressively enriches the schema cache with zero additional API calls, building a knowledge base of known-valid fields
**Depends on**: Phase 11
**Requirements**: ACCH-01, ACCH-02, ACCH-03
**Success Criteria** (what must be TRUE):
  1. After a successful SOQL query, the queried object name and field names appear in the schema cache as a partial entry — no extra network call is made
  2. The SOQL parser correctly extracts the FROM object and SELECT fields from flat queries, and gracefully skips complex queries (subqueries, GROUP BY, TYPEOF) without error
  3. When a partial cache entry exists and a full describe is later performed, the full describe result takes precedence on conflict while preserving any extra partial-only data
**Plans**: TBD

### Phase 13: Failure Recovery
**Goal**: When a SOQL query fails with an invalid field error, the system automatically describes the object and returns fuzzy-matched field suggestions alongside the error
**Depends on**: Phase 12
**Requirements**: FAIL-01, FAIL-02, FAIL-03, FAIL-04
**Success Criteria** (what must be TRUE):
  1. On INVALID_FIELD SOQL error, connection.describe() is automatically called for the failing object without manual intervention
  2. The failing field name is fuzzy-matched against actual field names using Levenshtein distance, with results ranked by similarity
  3. The error response includes the original error message plus top 3 field suggestions (e.g., "Did you mean: Amount, AmountPaid__c, AnnualRevenue?")
  4. The fresh describe result from the failure path is stored in the schema cache, making subsequent queries benefit from the auto-describe
  5. The single-flight pattern prevents redundant describe calls when multiple parallel queries fail on the same object simultaneously
**Plans**: TBD

### Phase 14: Relationship Graph
**Goal**: The schema cache builds an object relationship graph from describe results and surfaces join/lookup path suggestions when queries touch related objects
**Depends on**: Phase 13
**Requirements**: RELG-01, RELG-02, RELG-03
**Success Criteria** (what must be TRUE):
  1. When an object is described, its referenceTo[] and relationshipName fields are extracted and stored as typed relationship edges
  2. Relationship edges are stored as { from, to, via, type: 'lookup' | 'master-detail' } in the per-org cache alongside the describe data
  3. When a query touches an object that has known relationships to other cached objects, the response includes join/lookup path suggestions (e.g., "Contact.AccountId -> Account: use Account.Name for parent lookup")
**Plans**: TBD

### Phase 15: Query History
**Goal**: Recent successful SOQL queries are retained per org and accessible to AI agents for pattern reuse
**Depends on**: Phase 10
**Requirements**: QHST-01, QHST-02, QHST-03
**Success Criteria** (what must be TRUE):
  1. The N most recent successful SOQL queries per org are stored in a ring buffer (default N=50), with oldest entries automatically overwritten
  2. The retention limit is configurable via environment variable or server config — changing it takes effect without code changes
  3. Query history is accessible via a list_query_history tool that returns stored queries with timestamps and object names
**Plans**: TBD
**UI hint**: no

## Progress

**Execution Order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14 → 15

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Eliminate per-call config reads | v1.0 | — | Complete | 2026-04-09 |
| 2. Prerequisites | v1.1 | 2/2 | Complete | 2026-04-11 |
| 3. Wave 1 chdir Removal | v1.1 | 1/1 | Complete | 2026-04-11 |
| 4. Wave 2 chdir Removal | v1.1 | 1/1 | Complete | 2026-04-11 |
| 5. Concurrency Enablement | v1.1 | 1/1 | Complete | 2026-04-11 |
| 6. Tool Annotations | v1.2 | 3/3 | Complete | 2026-04-11 |
| 7. Error Recovery | v1.2 | 2/2 | Complete | 2026-04-11 |
| 8. Structured Output | v1.2 | 2/2 | Complete | 2026-04-11 |
| 9. MCP Resources | v1.2 | 2/2 | Complete | 2026-04-11 |
| 10. Schema Cache Foundation | v1.3 | 0/2 | Planning | - |
| 11. Schema Discovery Tool | v1.3 | 0/? | Not started | - |
| 12. Auto-Cache on Success | v1.3 | 0/? | Not started | - |
| 13. Failure Recovery | v1.3 | 0/? | Not started | - |
| 14. Relationship Graph | v1.3 | 0/? | Not started | - |
| 15. Query History | v1.3 | 0/? | Not started | - |
