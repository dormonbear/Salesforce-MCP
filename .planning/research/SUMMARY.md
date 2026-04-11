# Project Research Summary

**Project:** Salesforce MCP Server
**Domain:** Internal refactoring — process.chdir() elimination and tool parallelism
**Researched:** 2026-04-11
**Confidence:** HIGH

## Executive Summary

This is a surgical refactoring of a Salesforce MCP server where 14 open-source tools (plus 1 closed-source provider) call `process.chdir(input.directory)` before invoking `@salesforce/core` APIs, forcing all 49 tools through a single global Mutex. The root cause is clear and the fix path is well-defined: every affected `@salesforce/core` API accepts an explicit `projectPath` parameter, and the MCP SDK is already concurrent by design (each tool handler dispatches as an independent Promise with no built-in serialization).

The recommended approach is a three-wave incremental removal: Wave 1 deletes chdir from 10 tools that only use `getConnection()` (already CWD-free after v1.0); Wave 2 threads explicit paths through 4 tools using `SfProject.resolve()`; Wave 3 fixes the last CWD dependency in `auth.ts::getDefaultConfig()` and removes the global Mutex, while adding a targeted lock for lwc-experts tools that cannot be modified.

The critical risk is premature Mutex removal: the global Mutex inadvertently serializes ConfigAggregator cache operations, StateAggregator initialization, and Lifecycle event handling beyond just chdir races. A concurrent stress test (5+ parallel tool calls) must pass before the Mutex is removed.

## Key Findings

### Recommended Stack

No new technologies needed. The refactoring operates entirely within existing APIs.

**Core API findings (verified against compiled source):**
- `SfProject.resolve(path)`: No CWD dependency when explicit path is provided (lib/sfProject.js:391)
- `ConfigAggregator.create({ projectPath })`: Instance cache keyed on projectPath; must always pass explicitly (lib/config/configAggregator.js:72-73)
- `Org.create({ connection })`: No CWD dependency; all Wave 1 tools already use this form
- `SourceTracking.create({ project })`: Derives all paths from `project.getPath()`, safe with explicit SfProject
- `scratchOrgCreate()`: Internal `ConfigAggregator.create()` calls without projectPath — cannot fix externally

### Expected Features

**Must have (table stakes):**
- Remove chdir from all 14 open-source tools
- Fix SIGTERM handler bug (`process.stdin.on` → `process.on`)
- Complete tool-categories.ts with missing tool classifications
- Consolidate directoryParam/sanitizePath to mcp-provider-api
- Remove global Mutex after all chdir eliminated
- Add targeted Mutex for lwc-experts tools

**Should have (competitive):**
- Concurrent stress test suite validating parallel tool execution
- Per-tool lock mechanism for tools that cannot be made concurrent

**Defer (v2+):**
- Upstream fix for `scratchOrgCreate()` projectPath parameter
- lwc-experts chdir elimination (requires external team)

### Architecture Approach

The middleware layer in `SfMcpServer.registerTool()` changes from `mutex.lock(cb)` to `await cb(args, extra)` — a single-line change, but gated on all chdir removals. For lwc-experts, a static `mutexRequiredTools: Set<string>` replaces the global lock with tool-name-targeted serialization. aura-experts has zero `process.chdir()` calls and can run in parallel immediately.

**Major components affected:**
1. **Tool exec() methods** — remove `process.chdir(input.directory)` calls (14 files)
2. **auth.ts::getDefaultConfig()** — thread explicit projectPath parameter (1 file, blocks Mutex removal)
3. **SfMcpServer middleware** — replace global Mutex with targeted per-tool lock (1 file)
4. **mcp-provider-api/params.ts** — consolidate directoryParam with sanitizePath (new shared export)

### Critical Pitfalls

1. **Premature Mutex removal** — The Mutex masks non-chdir races (ConfigAggregator cache, StateAggregator init, Lifecycle events). Must pass concurrent stress test before removal.
2. **auth.ts::getDefaultConfig() CWD dependency** — `ConfigAggregator.clearInstance(process.cwd())` at line 132 is the last CWD dependency in non-tool code. Must be fixed before Mutex removal.
3. **ShadowRepo.getInstance() concurrent init** — Two concurrent `SourceTracking.create()` calls for the same project can both enter the init branch. Per-projectPath semaphore may be needed.
4. **Lifecycle event cross-contamination** — `global.salesforceCoreLifecycle` singleton shares event listeners across concurrent tool calls. Deploy progress events could bleed across calls.
5. **External provider opacity** — lwc-experts has 2 confirmed `process.chdir()` calls; `@salesforce/metadata-enrichment` CWD usage unknown.

## Implications for Roadmap

### Phase 2: Prerequisites and Quick Fixes
**Rationale:** Independent low-risk changes that establish shared infrastructure for subsequent phases
**Delivers:** Consolidated directoryParam in mcp-provider-api, fixed SIGTERM bug, complete tool-categories.ts
**Addresses:** Code quality issues, devops sanitizePath gap
**Avoids:** Cross-provider coupling from directoryParam in wrong package

### Phase 3: Wave 1 — Remove chdir from connection-only tools (10 tools)
**Rationale:** Zero-risk deletions that build confidence and establish the pattern
**Delivers:** 10 tools free of chdir; Mutex remains as safety net
**Addresses:** run_soql_query, assign_permission_set, open_org, delete_org, run_apex_test, run_agent_test, list_all_orgs, get_username, resume_tool_operation, create_org_snapshot
**Avoids:** Premature Mutex removal by keeping it in place

### Phase 4: Wave 2 — SfProject path threading (4 tools)
**Rationale:** Medium complexity; requires verifying SfProject/SourceTracking/SDR path threading
**Delivers:** deploy_metadata, retrieve_metadata, create_scratch_org, enrich_metadata free of chdir
**Uses:** SfProject.resolve(input.directory), SourceTracking.create({ project })
**Avoids:** Assuming library internals are CWD-free without verification

### Phase 5: Wave 3 — auth.ts fix + Mutex removal
**Rationale:** Final phase; highest risk; requires all prior waves complete
**Delivers:** auth.ts CWD dependency fixed, global Mutex removed, targeted lwc-experts lock added, concurrent stress test passing
**Implements:** Per-tool lock mechanism in SfMcpServer middleware
**Avoids:** Exposing latent races by gating on stress test

### Phase Ordering Rationale

- Prerequisites first because they're independent and establish shared code (directoryParam consolidation)
- Wave 1 before Wave 2 because it's zero-risk and builds pattern confidence
- Wave 2 before Wave 3 because Mutex removal requires ALL chdir eliminated
- auth.ts fix bundled with Mutex removal because they're tightly coupled
- Strict gate: concurrent stress test must pass before Mutex is removed

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 4:** `@salesforce/metadata-enrichment` is closed-source; must inspect its `process.cwd()` usage before execution
- **Phase 5:** ShadowRepo concurrent init safety and Lifecycle event isolation need stress testing

Phases with standard patterns (skip research-phase):
- **Phase 2:** All changes are mechanical (move params, fix 1-line bugs)
- **Phase 3:** All 10 tools verified as connection-only; chdir deletion is safe

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All APIs verified against compiled library source |
| Features | HIGH | Per-tool code inspection confirms wave classification |
| Architecture | HIGH | Middleware change verified; external provider grep confirmed |
| Pitfalls | HIGH | All pitfalls have specific file/line references |

**Overall confidence:** HIGH

### Gaps to Address

- `@salesforce/metadata-enrichment` internal CWD usage: inspect before Phase 4 execution
- `scratchOrgCreate()` upstream fix timeline: accept serialization for now, track upstream
- lwc-experts specific tool names that use chdir: confirm with provider team or runtime observation
- ShadowRepo concurrent init safety: validate with stress test in Phase 5
- `@salesforce/agents` AgentTester CWD dependency: inspect before Phase 3 execution

## Sources

### Primary (HIGH confidence)
- `@salesforce/core` compiled source in node_modules (configAggregator.js, sfProject.js, org.js, scratchOrgCreate.js)
- `@salesforce/source-tracking` compiled source (sourceTracking.js, localShadowRepo.js)
- `@modelcontextprotocol/sdk` compiled source (protocol.js, stdio.js)
- Direct codebase inspection of all 14 tool files

### Secondary (MEDIUM confidence)
- lwc-experts/aura-experts bundle grep (confirmed chdir/cwd patterns, cannot trace full call graph)

---
*Research completed: 2026-04-11*
*Ready for roadmap: yes*
