# Roadmap: Salesforce MCP Server

## Milestones

- ✅ **v1.0 Fix Concurrent Org Race Condition** - Phase 1 (shipped 2026-04-09)
- ✅ **v1.1 Eliminate process.chdir() and Enable Tool Parallelism** - Phases 2-5 (shipped 2026-04-11)
- 🚧 **v1.2 MCP Best Practices Alignment** - Phases 6-9 (in progress)

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

### 🚧 v1.2 MCP Best Practices Alignment (In Progress)

**Milestone Goal:** Align with 2025-2026 MCP best practices — complete tool annotations, error recovery guidance, structured output for core tools, and MCP Resources for org discoverability.

- [ ] **Phase 6: Tool Annotations** - Complete all 4 annotation hints on every GA tool
- [ ] **Phase 7: Error Recovery** - Add recovery guidance to top-10 most-used GA tool error messages
- [ ] **Phase 8: Structured Output** - Middleware pass-through test then outputSchema + structuredContent on 5-8 core tools
- [ ] **Phase 9: MCP Resources** - Wire provideResources() and implement org list + permissions resources

## Phase Details

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
- [ ] 06-02-PLAN.md — Complete 4-hint annotations on mobile-web, code-analyzer, devops, scale-products, and mcp GA tools; fix 2 readOnlyHint bugs (Wave 1)
- [ ] 06-03-PLAN.md — Write readOnlyHint consistency unit test against tool-categories.ts (Wave 2)

### Phase 7: Error Recovery

**Goal**: The top-10 most-used GA tools return actionable error messages that allow an LLM agent to self-repair without human intervention
**Depends on**: Phase 6
**Requirements**: ERR-01
**Success Criteria** (what must be TRUE):
  1. Each of the top-10 GA tools returns error messages that include both what went wrong and what to try next
  2. A shared toolError(message, recovery?) factory in mcp-provider-api produces the standardized error format
  3. No catch block in the top-10 tools silently swallows errors or returns raw stack traces to the LLM
  4. Error messages distinguish between user-fixable errors (wrong org alias, missing permission) and system errors (network timeout, auth expiry)
**Plans**: TBD

### Phase 8: Structured Output

**Goal**: 5-8 core GA query tools return machine-readable structuredContent alongside text content, enabling LLM agents to parse results programmatically
**Depends on**: Phase 7
**Requirements**: OUT-01, OUT-02
**Success Criteria** (what must be TRUE):
  1. A middleware pass-through test confirms that structuredContent set in a tool handler survives wrappedCb unchanged and appears in the final CallToolResult
  2. 5-8 core tools (including run_soql_query, list_all_orgs, get_username, get_org_info) declare outputSchema and return structuredContent on every successful call
  3. Each tool's structuredContent is validated against its outputSchema at test time
  4. Text content remains present alongside structuredContent for backward compatibility with older clients
**Plans**: TBD
**UI hint**: no

### Phase 9: MCP Resources

**Goal**: Authenticated org list and per-org permission levels are discoverable as MCP Resources, so LLM agents can inspect available orgs without calling tools
**Depends on**: Phase 8
**Requirements**: DISC-01, DISC-02, DISC-03
**Success Criteria** (what must be TRUE):
  1. registry-utils.ts calls provideResources() from each provider and registers the results with server.registerResource()
  2. An MCP client can list resources and receive the authenticated org list as a structured resource
  3. An MCP client can read a per-org resource and receive that org's permission levels (read/write/execute for each tool category)
  4. Resources return current data on each read (not cached stale data from startup)
**Plans**: TBD

## Progress

**Execution Order:** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Eliminate per-call config reads | v1.0 | — | Complete | 2026-04-09 |
| 2. Prerequisites | v1.1 | 2/2 | Complete | 2026-04-11 |
| 3. Wave 1 chdir Removal | v1.1 | 1/1 | Complete | 2026-04-11 |
| 4. Wave 2 chdir Removal | v1.1 | 1/1 | Complete | 2026-04-11 |
| 5. Concurrency Enablement | v1.1 | 1/1 | Complete | 2026-04-11 |
| 6. Tool Annotations | v1.2 | 1/3 | In Progress|  |
| 7. Error Recovery | v1.2 | 0/TBD | Not started | - |
| 8. Structured Output | v1.2 | 0/TBD | Not started | - |
| 9. MCP Resources | v1.2 | 0/TBD | Not started | - |
