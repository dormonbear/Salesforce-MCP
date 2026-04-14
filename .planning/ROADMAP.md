# Roadmap — Salesforce MCP Fork

## Milestone: Multi-org hardening

Scope: consolidate multi-org safety improvements after the run-soql-query wrong-org incident (see `.planning/debug/run-soql-query-wrong-org.md`).

### Phase 1: MCP tool parameter hardening

**Goal:** Eliminate the two classes of redundant / unsafe parameter handling surfaced during the wrong-org debug session:

1. **Drop global `target-org` fallback in `get_username` (and any sibling "silently pick a default org" code paths).** All org-requiring tools already mandate `usernameOrAlias`; reading `~/.sf/config.json`'s global `target-org` to seed a suggestion is redundant and was the root cause of the wrong-org bug.
2. **Make `directory` optional for tools that do not need an sfdx-project.** Most tools (SOQL query, describe, list, metadata retrieve for org-side data, etc.) only need `usernameOrAlias`. Only tools that actually require a local sfdx-project (deploy-from-source, local Apex compile, etc.) should keep `directory` required. Also evaluate removing the `process.chdir(input.directory)` pattern — it is a process-level side effect that corrupts state under concurrent calls.

**Goal-backward checks:**

- Build + all tests green (`yarn build && yarn test` at repo root).
- `get_username` no longer reads `~/.sf/config.json` global `target-org`; passes regression tests that assert multi-org scenarios never silently bind to a single org.
- Every tool schema audited: `directory` is `required` only where a sfdx-project is genuinely needed, `optional` elsewhere, with the decision documented per-tool.
- No tool calls `process.chdir()` in `exec()` for tools that don't need sfdx-project context; tools that do, either keep chdir with a justified comment or switch to an API that accepts a `projectPath` argument.
- Removing the fallback surfaces a clear, actionable error when callers omit `usernameOrAlias`, rather than silently routing to the wrong org.

**Depends on:** Completion of run-soql-query-wrong-org debug fix (already landed — `get_username` multi-org listing + `connectionHeader` response header).

**Requirements:**

- REQ-1: Remove global target-org fallback from `get_username.ts::suggestUsername`; cover with regression tests.
- REQ-2: Audit every tool under `packages/mcp-provider-*/src/tools/**` for "silently pick a default org" patterns; clean them up.
- REQ-3: Produce a tool-by-tool classification (`needs-sfdx-project: yes/no`) and update each tool's input schema accordingly.
- REQ-4: Remove or justify every `process.chdir()` call in tool `exec()` paths.
- REQ-5: Update docs (README / tool descriptions) to reflect which tools require `directory`.

**Plans:** 1 plan

Plans:
- [ ] 01-01-PLAN.md — Audit all dx-core tools, kill global target-org fallback, make directory optional where appropriate, eliminate/justify process.chdir, extend connectionHeader to every org-touching tool response.

### Phase 2: (reserved)

(No content yet.)
