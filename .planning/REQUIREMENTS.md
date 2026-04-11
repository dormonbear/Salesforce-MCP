# Requirements: Salesforce MCP Server

**Defined:** 2026-04-11
**Core Value:** AI agents can safely and efficiently interact with Salesforce orgs through well-defined, permission-controlled MCP tools.

## v1.1 Requirements

Requirements for eliminating process.chdir() and enabling tool parallelism.

### Prerequisites

- [ ] **PREREQ-01**: directoryParam and sanitizePath consolidated from mcp-provider-dx-core to mcp-provider-api as shared exports
- [ ] **PREREQ-02**: All provider packages (devops, scale-products, metadata-enrichment) import directoryParam from mcp-provider-api instead of local copies
- [ ] **PREREQ-03**: SIGTERM handler fixed to use process.on('SIGTERM') instead of process.stdin.on('SIGTERM')
- [ ] **PREREQ-04**: tool-categories.ts includes all tools from devops, code-analyzer, mobile-web, scale-products, and metadata-enrichment providers with correct read/write/execute classification

### chdir Elimination — Wave 1

- [ ] **CHDIR-01**: run_soql_query executes without process.chdir() call
- [ ] **CHDIR-02**: assign_permission_set executes without process.chdir() call
- [ ] **CHDIR-03**: open_org executes without process.chdir() call
- [ ] **CHDIR-04**: delete_org executes without process.chdir() call
- [ ] **CHDIR-05**: run_apex_test executes without process.chdir() call
- [ ] **CHDIR-06**: run_agent_test executes without process.chdir() call
- [ ] **CHDIR-07**: list_all_orgs executes without process.chdir() call
- [ ] **CHDIR-08**: get_username executes without process.chdir() call
- [ ] **CHDIR-09**: resume_tool_operation executes without process.chdir() call
- [ ] **CHDIR-10**: create_org_snapshot executes without process.chdir() call

### chdir Elimination — Wave 2

- [ ] **CHDIR-11**: deploy_metadata executes without process.chdir() by passing explicit path to SfProject.resolve() and SourceTracking.create()
- [ ] **CHDIR-12**: retrieve_metadata executes without process.chdir() by passing explicit path to SfProject.resolve() and SourceTracking.create()
- [ ] **CHDIR-13**: create_scratch_org executes without process.chdir() with verified Org.create() path
- [ ] **CHDIR-14**: enrich_metadata executes without process.chdir() with verified metadata-enrichment library compatibility
- [ ] **CHDIR-15**: scan_apex_class_for_antipatterns executes without process.chdir()

### Concurrency Enablement

- [ ] **CONC-01**: auth.ts getDefaultConfig() accepts and forwards explicit projectPath parameter, eliminating ConfigAggregator.clearInstance(process.cwd()) dependency
- [ ] **CONC-02**: Global toolExecutionMutex removed from SfMcpServer.registerTool() middleware
- [ ] **CONC-03**: Targeted per-tool Mutex added for lwc-experts tools that contain internal process.chdir() calls
- [ ] **CONC-04**: Concurrent stress test suite validates 5+ tools executing in parallel without race conditions
- [ ] **CONC-05**: All existing tests pass after Mutex removal

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Upstream Fixes

- **UPSTREAM-01**: scratchOrgCreate() accepts projectPath parameter (requires @salesforce/core change)
- **UPSTREAM-02**: lwc-experts provider ships chdir-free version (requires external team)

### Architecture

- **ARCH-01**: Per-projectPath semaphore for ShadowRepo concurrent init safety
- **ARCH-02**: Lifecycle event isolation per tool call (prevent cross-contamination)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Streamable HTTP transport | Not needed for current single-client stdio use case |
| MCP Resources/Prompts implementation | Valuable but separate initiative, not related to parallelism |
| Tasks primitive adoption | Depends on SDK support maturity |
| External provider source modifications | lwc-experts and aura-experts are closed-source |
| directory parameter removal from tool schemas | Backward compatibility requirement per MCP convention |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| PREREQ-01 | Phase 2 | Pending |
| PREREQ-02 | Phase 2 | Pending |
| PREREQ-03 | Phase 2 | Pending |
| PREREQ-04 | Phase 2 | Pending |
| CHDIR-01 | Phase 3 | Pending |
| CHDIR-02 | Phase 3 | Pending |
| CHDIR-03 | Phase 3 | Pending |
| CHDIR-04 | Phase 3 | Pending |
| CHDIR-05 | Phase 3 | Pending |
| CHDIR-06 | Phase 3 | Pending |
| CHDIR-07 | Phase 3 | Pending |
| CHDIR-08 | Phase 3 | Pending |
| CHDIR-09 | Phase 3 | Pending |
| CHDIR-10 | Phase 3 | Pending |
| CHDIR-11 | Phase 4 | Pending |
| CHDIR-12 | Phase 4 | Pending |
| CHDIR-13 | Phase 4 | Pending |
| CHDIR-14 | Phase 4 | Pending |
| CHDIR-15 | Phase 4 | Pending |
| CONC-01 | Phase 5 | Pending |
| CONC-02 | Phase 5 | Pending |
| CONC-03 | Phase 5 | Pending |
| CONC-04 | Phase 5 | Pending |
| CONC-05 | Phase 5 | Pending |

**Coverage:**
- v1.1 requirements: 24 total
- Mapped to phases: 24
- Unmapped: 0

---
*Requirements defined: 2026-04-11*
*Last updated: 2026-04-11 after roadmap creation*
