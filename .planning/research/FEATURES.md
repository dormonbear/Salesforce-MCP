# Feature Research

**Domain:** MCP Server refactoring — eliminating process.chdir() and enabling parallel tool execution
**Researched:** 2026-04-11
**Confidence:** HIGH (based on direct code inspection of all 15 affected files)

---

## How the 14 Tools Currently Work

All 14 tools receive a `directory` parameter (an absolute path to the user's Salesforce DX project). They call `process.chdir(input.directory)` so that `@salesforce/core` APIs pick up the local `.sf/config.json` from that directory. The 15th file (`sf-mcp-server.ts`) wraps every tool call in a `toolExecutionMutex.lock()` to prevent concurrent CWD mutations from corrupting each other's state.

The actual APIs that depend on CWD:
- `ConfigAggregator.create()` — reads `.sf/config.json` from `process.cwd()` (used in `getDefaultTargetOrg`, `getDefaultTargetDevHub`)
- `SfProject.resolve()` — walks up from `process.cwd()` to find `sfdx-project.json`
- `SourceTracking.create()` — depends on project path resolved by `SfProject`

After v1.0's `resolveSymbolicOrgs()` at startup, `ConfigAggregator` no longer needs to be called per-tool. The remaining CWD dependency is `SfProject.resolve()` (used in `deploy_metadata` and `retrieve_metadata`) and external library calls in the scale-products and metadata-enrichment packages.

---

## Feature Landscape

### Table Stakes (Users Expect These)

Features that must be delivered to meet the milestone's stated goal.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Remove process.chdir() from Wave 1 tools (10 tools) | chdir is already unnecessary post-v1.0; no risk | LOW | list_all_orgs, get_username, run_soql_query, assign_permission_set, delete_org, open_org, run_apex_test, run_agent_test, resume_tool_operation, create_org_snapshot — all call getConnection() which no longer needs CWD |
| Remove process.chdir() from Wave 2 tools (deploy_metadata, retrieve_metadata, create_scratch_org) | These pass input.directory explicitly to SfProject.resolve() — chdir is redundant | MEDIUM | deploy_metadata and retrieve_metadata already pass `input.directory` to `SfProject.resolve(input.directory)` directly; chdir removal is safe; create_scratch_org reads the definition file from input.directory (already absolute path) |
| Remove process.chdir() from Wave 3 tools (scan_apex_antipatterns, enrich_metadata) | Needed to eliminate all 14 usages before Mutex removal | HIGH | Requires verifying whether internal @salesforce/core calls inside these tools' library dependencies use process.cwd(); may need API changes or explicit path threading |
| Remove toolExecutionMutex from sf-mcp-server.ts | Core goal: enable parallel execution | MEDIUM | Must come last, only after all 14 chdir calls are removed; removal is a single-line change but the precondition (all chdir gone) is the hard part |
| Fix SIGTERM handler bug | Current handler is on process.stdin.on('SIGTERM') which never fires; SIGTERM is a process-level signal | LOW | Change `process.stdin.on('SIGTERM', ...)` to `process.on('SIGTERM', ...)` in index.ts |
| Complete tool-categories.ts | Missing tool classifications default to 'write' — permission system may incorrectly block or allow tools | LOW | scan_apex_antipatterns, enrich_metadata, and several provider tools not yet in the map; missing entries fall through to the 'write' default |
| Consolidate directoryParam/sanitizePath to mcp-provider-api | directoryParam is currently defined in mcp-provider-dx-core/shared/params.ts; enrich_metadata imports it from there — coupling across provider packages | LOW | Move definition to mcp-provider-api package where it belongs; update all imports |

### Differentiators (Competitive Advantage)

Capabilities that become possible once chdir is removed.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| True parallel tool execution across different orgs | An AI agent can query org A's data while deploying to org B simultaneously — currently impossible because the Mutex serializes everything | MEDIUM | Enabled automatically once all chdir removed and Mutex dropped; the MCP SDK's stdio transport already supports concurrent requests |
| Parallel tool execution within same org (read operations) | Multiple read tools (run_soql_query, get_username, run_apex_test) can run concurrently against the same org | LOW | All Wave 1 tools become safe to run concurrently after chdir removal; no additional work needed |
| Accurate wall-clock timing in telemetry | Currently runtimeMs in TOOL_CALLED events includes Mutex wait time, making slow-org tools appear even slower | LOW | After Mutex removal, runtimeMs reflects actual tool execution time |
| Eliminated "directory" parameter requirement for simple tools | Wave 1 tools technically no longer need the directory param at all after chdir removal; it becomes a no-op | LOW | Cannot remove from schema (backward compat), but future deprecation path becomes clear |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Remove "directory" parameter from tool schemas | Once chdir is gone, passing directory feels pointless for Wave 1 tools | Breaking change to MCP tool input schemas; agents that already pass directory would break; MCP convention is to keep schemas stable across versions | Keep the parameter, stop using it internally; add deprecation note to description; plan removal for a future major version |
| Replace Mutex with per-org Mutex | Sounds like an improvement — only serialize tools hitting the same org | Still doesn't solve the root cause (CWD is process-global, not per-org); adds complexity with marginal gain | Remove Mutex entirely after chdir removal — that is the correct fix |
| Patch @salesforce/core's CWD usage globally | Override process.cwd() via sinon-style mocking or AsyncLocalStorage to inject per-call directory | Extremely fragile, not officially supported, will break with any @salesforce/core update, impossible to test reliably | Thread explicit path parameters into API calls that accept them (SfProject.resolve(path), ConfigAggregator.create(path)); verify each Wave 3 tool individually |
| Lazy Mutex removal (remove only when all tools are done) | Wait until every last tool is fixed before touching the Mutex | That is actually the correct approach — listed here to reinforce it is not an anti-feature | Keep existing Mutex until the last chdir is removed in the same PR/commit |

---

## Feature Dependencies

```
Wave 1 chdir removal (10 tools)
    └──enables (partially)──> Mutex removal (still blocked by Waves 2 and 3)

Wave 2 chdir removal (deploy_metadata, retrieve_metadata, create_scratch_org)
    └──enables (partially)──> Mutex removal (still blocked by Wave 3)

Wave 3 chdir removal (scan_apex_antipatterns, enrich_metadata)
    └──requires──> @salesforce/core API path-threading verification (per tool)
    └──enables (fully)──> Mutex removal

[All Waves complete]
    └──enables──> Mutex removal from sf-mcp-server.ts
                      └──enables──> Parallel tool execution

SIGTERM fix ──independent──> (no dependencies)
tool-categories.ts completion ──independent──> (no dependencies)
directoryParam consolidation ──independent──> (no dependencies, minor coupling fix)
```

### Dependency Notes

- **Wave 3 requires API verification:** Unlike Waves 1 and 2, the scale-products and metadata-enrichment packages make deeper `@salesforce/core` calls whose internal CWD usage must be confirmed before removing chdir. This is the unknown that drives the HIGH complexity rating.
- **Mutex removal requires all waves:** Removing the Mutex while any tool still calls chdir would re-introduce the race condition. The three-wave approach exists specifically to enable incremental progress without regressing safety.
- **SIGTERM, tool-categories, directoryParam consolidation are independent:** These can be done in any order, in parallel with Wave 1, and do not block or depend on anything else in the milestone.

---

## Per-Tool Analysis

### Wave 1 — Already Safe to Remove (10 tools)

| Tool | Package | Why chdir is unnecessary | API used after chdir |
|------|---------|--------------------------|----------------------|
| list_all_orgs | mcp-provider-dx-core | Only calls getOrgService().getAllowedOrgs() — startup-resolved | getAllAllowedOrgs() → AuthInfo.listAllAuthorizations() |
| get_username | mcp-provider-dx-core | Only calls OrgService methods — startup-resolved | getDefaultTargetOrg(), getAllowedOrgs() |
| run_soql_query | mcp-provider-dx-core | Only calls getConnection() — no longer CWD-dependent | connection.query() / connection.tooling.query() |
| assign_permission_set | mcp-provider-dx-core | Only calls getConnection(), StateAggregator — no CWD path | Org.create(), User.create() |
| delete_org | mcp-provider-dx-core | Only calls getConnection() | Org.create(), org.delete() |
| open_org | mcp-provider-dx-core | Only calls getConnection(), MetadataResolver (uses absolute filePath, not CWD) | org.getFrontDoorUrl(), org.getMetadataUIURL() |
| run_apex_test | mcp-provider-dx-core | Only calls getConnection() | TestService(connection).runTestAsynchronous() |
| run_agent_test | mcp-provider-dx-core | Only calls getConnection() | AgentTester(connection).start() |
| resume_tool_operation | mcp-provider-dx-core | Only calls getConnection(); MetadataApiDeploy uses explicit connection | MetadataApiDeploy, scratchOrgResume, AgentTester |
| create_org_snapshot | mcp-provider-dx-core | Only calls getConnection() on both sourceOrg and devHub | devHubConnection.sobject('OrgSnapshot').create() |

### Wave 2 — Need Explicit Path Threading (3 tools)

| Tool | Package | Why chdir is needed | Fix |
|------|---------|---------------------|-----|
| deploy_metadata | mcp-provider-dx-core | SfProject.resolve(input.directory) already passes path explicitly; SourceTracking.create() receives the SfProject instance | Remove chdir — SfProject.resolve() already has the path |
| retrieve_metadata | mcp-provider-dx-core | Same as deploy_metadata | Remove chdir — SfProject.resolve() already has the path |
| create_scratch_org | mcp-provider-dx-core | reads definitionFile from `input.definitionFile` (absolute path via join) but chdir is before Org.create({aliasOrUsername}) which may trigger ConfigAggregator | Verify Org.create({aliasOrUsername}) doesn't need CWD; replace with connection-based pattern after W-19828802 fix |

### Wave 3 — Requires Library Verification (2 tools)

| Tool | Package | Why complex | Investigation needed |
|------|---------|-------------|----------------------|
| scan_apex_antipatterns | mcp-provider-scale-products | Calls resolveOrgConnection() which calls getConnection() — OK; but deeper antipattern detection libraries may have own CWD assumptions | Trace all @salesforce/core calls within AntipatternRegistry, RuntimeDataService, SOQLRuntimeEnricher |
| enrich_metadata | mcp-provider-metadata-enrichment | Uses SfProject.resolve(input.directory) (already explicit!), ComponentSetBuilder.build() with explicit projectDir, EnrichmentHandler — but EnrichmentHandler from @salesforce/metadata-enrichment is a closed dependency | Inspect @salesforce/metadata-enrichment for any process.cwd() calls |

---

## MVP Definition

### Launch With (v1.1)

All items below are required to declare the milestone done.

- [ ] Wave 1: Remove chdir from 10 dx-core tools — straightforward, no risk
- [ ] Wave 2: Remove chdir from deploy_metadata, retrieve_metadata, create_scratch_org — medium risk, needs targeted testing
- [ ] Wave 3: Remove chdir from scan_apex_antipatterns and enrich_metadata — after API verification
- [ ] Remove toolExecutionMutex from sf-mcp-server.ts — only after all above
- [ ] Fix SIGTERM handler bug — independent, low risk
- [ ] Complete tool-categories.ts — independent, low risk
- [ ] Consolidate directoryParam to mcp-provider-api — independent, low coupling fix

### Add After Validation (v1.x)

- [ ] Deprecate `directory` parameter in Wave 1 tool descriptions — once users have adapted to parallel execution and the parameter's no-op nature is confirmed in practice
- [ ] Verify and document which tools are safe to run concurrently vs. which have external side effects that require ordering — useful for agent orchestration

### Future Consideration (v2+)

- [ ] Remove `directory` parameter from tool schemas entirely — breaking change, requires major version
- [ ] Per-tool concurrency limits (rate limiting per-operation vs. global) — only if telemetry shows specific operations are being over-called in parallel

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Wave 1 chdir removal (10 tools) | HIGH — unblocks partial parallelism | LOW | P1 |
| Fix SIGTERM handler bug | MEDIUM — telemetry data loss on shutdown | LOW | P1 |
| Complete tool-categories.ts | MEDIUM — permission correctness | LOW | P1 |
| Consolidate directoryParam | LOW — internal cleanup | LOW | P1 |
| Wave 2 chdir removal (3 tools) | HIGH — metadata tools are core workflows | MEDIUM | P1 |
| Wave 3 chdir removal (2 tools) | HIGH — needed to unlock Mutex removal | HIGH | P1 |
| Remove toolExecutionMutex | HIGH — the actual parallelism unlock | LOW (one line, but gates on all above) | P1 |

All items are P1 because the milestone goal (parallel execution) cannot be achieved without every one of them.

---

## Sources

- Direct code inspection: `packages/mcp-provider-dx-core/src/tools/*.ts` (all 13 chdir tools)
- Direct code inspection: `packages/mcp-provider-scale-products/src/tools/scan-apex-antipatterns-tool.ts`
- Direct code inspection: `packages/mcp-provider-metadata-enrichment/src/tools/enrich_metadata.ts`
- Direct code inspection: `packages/mcp/src/sf-mcp-server.ts` (Mutex location, SIGTERM bug)
- Direct code inspection: `packages/mcp/src/utils/auth.ts` (getConnection, ConfigAggregator CWD usage)
- Direct code inspection: `packages/mcp/src/utils/tool-categories.ts` (missing entries)
- Direct code inspection: `packages/mcp-provider-dx-core/src/shared/params.ts` (directoryParam definition)
- `.planning/PROJECT.md` (three-wave approach, out-of-scope constraints)
- `.planning/STATE.md` (v1.0 context, key technical findings)

---
*Feature research for: Salesforce MCP Server v1.1 — process.chdir() elimination and parallel execution*
*Researched: 2026-04-11*
