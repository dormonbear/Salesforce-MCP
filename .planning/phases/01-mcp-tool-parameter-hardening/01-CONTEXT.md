# Phase 1: MCP tool parameter hardening — Context

**Gathered:** 2026-04-14
**Status:** Ready for planning
**Source:** User-provided requirements after wrong-org debug session

<domain>
## Phase Boundary

This phase consolidates two classes of parameter-design fixes in the Salesforce MCP fork, surfaced during the `run-soql-query-wrong-org` debug session (see `.planning/debug/run-soql-query-wrong-org.md`):

1. Eliminate every "silently pick a default org" code path (`~/.sf/config.json` global `target-org`, `allowedOrgs[0]`, cached first-match, etc.) — all org-requiring tools already mandate `usernameOrAlias` as a schema-required input, so fallbacks are pure footguns.
2. Reclassify the `directory` parameter across all MCP tools: required only for tools that genuinely need a local sfdx-project (deploy-from-source, local Apex compile, metadata retrieve-to-disk, etc.); optional/removed for tools that only talk to the org (SOQL, describe, record CRUD, list limits, etc.). Additionally, assess whether `process.chdir(input.directory)` can be replaced with an API that accepts a project path, because `chdir` is a process-level side effect that corrupts state under concurrent MCP calls.

**Out of scope:** Multi-org permission / elicitation approval flow (separate milestone), MCP server startup config format changes, new tool surfaces.
</domain>

<decisions>
## Implementation Decisions

### Locked (from user)
- The previous bug fix (commit adding `connectionHeader` + `get_username` multi-org listing) stays as-is. This phase builds on top of it, does not revert it.
- All org-requiring tools must keep `usernameOrAlias` schema-required. We do **not** relax it.
- `get_username::suggestUsername` must stop reading `~/.sf/config.json` global `target-org`. The only signal it should use is the MCP server's `allowedOrgs` list (and user-provided context, if any).
- If a caller omits `usernameOrAlias`, the tool must return a clear actionable error (listing allowed orgs) instead of silently routing.
- `directory` is required only for tools that actually need sfdx-project context. Other tools make it optional or remove it.
- `process.chdir()` in tool `exec()` paths is to be eliminated where possible. If an sf API requires a project path, pass it explicitly rather than mutating global process state.
- Follow project conventions: TDD (per user preference in memory), English code/comments, Chinese responses, conventional commits, no author attribution.

### Claude's Discretion
- Exact tool-by-tool classification of `needs-sfdx-project: yes/no` — the planner must audit every tool under `packages/mcp-provider-*/src/tools/**` and propose a classification table, then codify.
- Mechanism for "clear actionable error": may be a shared helper (e.g., `requireUsernameOrAlias(allowed)`), or per-tool. Planner decides.
- Whether to refactor the `services.getConnection` / `getAllAllowedOrgs` signature to push org resolution into a single choke point.
- Whether to introduce a thin wrapper type (e.g., `ToolContext`) that carries `usernameOrAlias + optional directory` so the pattern is uniform.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Incident context
- `.planning/debug/run-soql-query-wrong-org.md` — full scientific-method debug trail; root cause analysis; what was already fixed.

### Code to audit
- `packages/mcp-provider-dx-core/src/tools/` — all DX-core tools (run_soql_query, get_username, and siblings).
- `packages/mcp-provider-*/src/tools/` — every provider package that exposes tools.
- `packages/mcp/src/utils/auth.ts` — `getConnection`, `findOrgByUsernameOrAlias`, `getAllAllowedOrgs`.
- `packages/mcp/src/services.ts` — service surface consumed by tools.
- `packages/mcp/src/utils/cache.ts` — `Cache.safeGet('allowedOrgs')` behavior.
- `packages/mcp-provider-dx-core/src/shared/utils.ts` — `connectionHeader` helper added in the bug-fix commit.
- `packages/mcp-provider-dx-core/src/tools/get_username.ts` — the file where global target-org fallback was (partially) mitigated in the previous fix.

### Tests
- `packages/mcp-provider-dx-core/test/unit/get_username.test.ts` — existing bug regression tests; extend.
- `packages/mcp-provider-dx-core/test/unit/utils.test.ts` — `connectionHeader` tests; extend.
- `packages/mcp-provider-dx-core/test/e2e/run_soql_query.test.ts` — existing e2e; extend.

### Project-level
- `./CLAUDE.md` / `./README.md` — repo conventions.
- Root `package.json` workspaces + `tsconfig*.json` — build layout (monorepo with `pnpm`/`yarn` — planner must detect which).
</canonical_refs>

<specifics>
## Specific Ideas

- The previously shipped `connectionHeader(connection)` (returns `"Connected to: <username> @ <instanceUrl> (orgId: <orgId>)"`) is the model for how every org-touching tool should echo back identity. Extend it to all org-requiring tools in this phase so the user/AI can always verify routing.
- Candidate tools likely NOT needing sfdx-project: `run_soql_query`, `run_apex_tests` (org-side), `describe_object`, `list_records`, `create_record`, `update_record`, `get_record`, `delete_record`, `run_apex_anonymous` (org-side), `get_limits`, `get_username`, `list_orgs`. Planner must verify.
- Candidate tools that DO need sfdx-project: `deploy_metadata`, `retrieve_metadata` (when target is disk), `compile_apex` (when reading local classes). Planner must verify.
- If a tool needs `directory` only to locate `.forceignore` or `sfdx-project.json`, check whether the `@salesforce/source-deploy-retrieve` or `@salesforce/core` APIs accept an explicit path arg — that avoids `chdir`.
- Error message pattern when `usernameOrAlias` missing or not allowed:
  ```
  Missing required parameter `usernameOrAlias`. Allowed orgs for this server: OMNI_Admin, OMNI_Staging, SFOA_Live.
  Ask the user which org to target.
  ```
</specifics>

<deferred>
## Deferred Ideas

- Elicitation-approval flow for writes against Production orgs (separate milestone, already in memory).
- Formalizing a `ToolContext` DI surface across all providers (consider after this phase if the pattern emerges naturally).
- Rewriting `services.getConnection` to cache `Connection` objects per org (perf optimization, not correctness).
</deferred>

---

*Phase: 01-mcp-tool-parameter-hardening*
*Context gathered: 2026-04-14 via orchestrator from user request + debug session artifacts*
