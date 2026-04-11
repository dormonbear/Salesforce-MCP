# Phase 2: Prerequisites - Context

**Gathered:** 2026-04-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Consolidate shared tool parameters to mcp-provider-api, fix the SIGTERM handler bug with graceful shutdown, and complete tool-categories.ts with all missing tool classifications. This is pure infrastructure — no user-facing feature changes.

</domain>

<decisions>
## Implementation Decisions

### Parameter Consolidation
- **D-01:** Move `directoryParam`, `baseAbsolutePathParam`, `sanitizePath`, and `usernameOrAliasParam` from `mcp-provider-dx-core/src/shared/params.ts` to `mcp-provider-api` as shared exports
- **D-02:** Export both `usernameOrAliasParam` (required, z.string()) and `optionalUsernameOrAliasParam` (optional, z.string().optional()) — Claude's discretion on naming
- **D-03:** All provider packages (devops, scale-products, metadata-enrichment) must import from `mcp-provider-api` instead of local copies or cross-package imports
- **D-04:** Delete local `params.ts` files in devops and scale-products after migration; delete `utils.ts` sanitizePath from scale-products (use shared version)
- **D-05:** The devops `directoryParam` currently lacks `sanitizePath` refine — after consolidation, ALL directory params will have path traversal protection

### Tool Categories
- **D-06:** Add all missing tools to `tool-categories.ts` using these classifications:
  - **read**: list_devops_center_projects, list_devops_center_work_items, check_devops_center_commit_status, detect_devops_center_merge_conflict, run_code_analyzer, list_code_analyzer_rules, describe_code_analyzer_rule, query_code_analyzer_results, get_ast_nodes_to_generate_xpath, get_mobile_lwc_offline_analysis, get_mobile_lwc_offline_guidance, scan_apex_class_for_antipatterns, all 11 native capability tools (create_mobile_lwc_*)
  - **write**: create_devops_center_work_item, checkout_devops_center_work_item, commit_devops_center_work_item, promote_devops_center_work_item, resolve_devops_center_merge_conflict, resolve_devops_center_deployment_failure, update_devops_center_work_item_status, create_devops_center_pull_request, create_custom_rule, enrich_metadata

### SIGTERM Fix
- **D-07:** Fix `process.stdin.on('SIGTERM')` → `process.on('SIGTERM')` in index.ts:165
- **D-08:** Add graceful shutdown logic: call `server.close()`, set a timeout for forced exit (e.g., 5 seconds), ensure telemetry flush completes before process exits

### Claude's Discretion
- Naming convention for the two usernameOrAlias variants in mcp-provider-api
- Whether to also export `useToolingApiParam` from mcp-provider-api (currently only in dx-core)
- Exact timeout duration for graceful shutdown (5-10 seconds reasonable)
- Whether to consolidate the `sanitizePath` function from dx-core `utils.ts` into a separate `params-utils.ts` in mcp-provider-api or keep it alongside params

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Parameter Definitions (current locations)
- `packages/mcp-provider-dx-core/src/shared/params.ts` — Canonical directoryParam with sanitizePath refine
- `packages/mcp-provider-dx-core/src/shared/utils.ts` — sanitizePath implementation
- `packages/mcp-provider-devops/src/shared/params.ts` — Devops copy WITHOUT sanitizePath (the gap)
- `packages/mcp-provider-scale-products/src/shared/params.ts` — Scale copy WITH sanitizePath
- `packages/mcp-provider-scale-products/src/shared/utils.ts` — Duplicate sanitizePath implementation
- `packages/mcp-provider-api/src/index.ts` — Current API exports (target for new exports)

### Tool Categories
- `packages/mcp/src/utils/tool-categories.ts` — Current incomplete tool category map
- `packages/mcp/src/utils/org-permissions.ts` — Where getToolCategory() is consumed

### SIGTERM Bug
- `packages/mcp/src/index.ts` lines 160-168 — Broken SIGTERM handler + working stdin close handler

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `sanitizePath` in dx-core/utils.ts is the canonical implementation — blocks `..`, Unicode ellipsis, URL-encoded traversal, requires absolute paths, blocks Windows drive-relative paths
- `mcp-provider-api` already exports tools, enums, types, services — adding params follows the same pattern

### Established Patterns
- All exports from mcp-provider-api go through `src/index.ts` barrel file
- Each provider's `package.json` already depends on `@salesforce/mcp-provider-api`
- metadata-enrichment already imports from dx-core cross-package (this is the coupling we're fixing)

### Integration Points
- After consolidation, `packages/mcp-provider-api/src/index.ts` needs new exports
- `packages/mcp-provider-api/package.json` needs `zod` as a dependency (currently only in provider packages)
- All tool files that import from local `../shared/params.js` need import path updates

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 02-prerequisites*
*Context gathered: 2026-04-11*
