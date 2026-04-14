---
phase: 01-mcp-tool-parameter-hardening
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/mcp-provider-dx-core/src/tools/get_username.ts
  - packages/mcp-provider-dx-core/src/tools/run_soql_query.ts
  - packages/mcp-provider-dx-core/src/tools/run_apex_test.ts
  - packages/mcp-provider-dx-core/src/tools/run_agent_test.ts
  - packages/mcp-provider-dx-core/src/tools/assign_permission_set.ts
  - packages/mcp-provider-dx-core/src/tools/list_all_orgs.ts
  - packages/mcp-provider-dx-core/src/tools/open_org.ts
  - packages/mcp-provider-dx-core/src/tools/create_org_snapshot.ts
  - packages/mcp-provider-dx-core/src/tools/create_scratch_org.ts
  - packages/mcp-provider-dx-core/src/tools/delete_org.ts
  - packages/mcp-provider-dx-core/src/tools/deploy_metadata.ts
  - packages/mcp-provider-dx-core/src/tools/retrieve_metadata.ts
  - packages/mcp-provider-dx-core/src/tools/resume_tool_operation.ts
  - packages/mcp-provider-dx-core/src/shared/utils.ts
  - packages/mcp-provider-dx-core/test/unit/get_username.test.ts
  - packages/mcp-provider-dx-core/test/unit/utils.test.ts
  - packages/mcp-provider-dx-core/test/e2e/run_soql_query.test.ts
  - .planning/phases/01-mcp-tool-parameter-hardening/AUDIT.md
  - README.md
autonomous: true
requirements:
  - REQ-1
  - REQ-2
  - REQ-3
  - REQ-4
  - REQ-5

must_haves:
  truths:
    - "get_username no longer reads ~/.sf/config.json global target-org; multi-org scenarios always return the full allowed-orgs list with suggestedUsername=undefined."
    - "Every org-touching tool returns a clear, actionable error listing allowed orgs when usernameOrAlias is missing or not in allowedOrgs — no silent default."
    - "Tools that only talk to the org (run_soql_query, get_username, list_all_orgs, open_org, assign_permission_set, resume_tool_operation) accept directory as optional; omitting it still succeeds."
    - "Tools that genuinely need a local sfdx-project (deploy_metadata, retrieve_metadata, run_apex_test, run_agent_test, create_scratch_org, create_org_snapshot, delete_org) keep directory required with documented justification."
    - "No org-only tool calls process.chdir(input.directory) in its exec() path; project-path-requiring tools either pass projectDir via API or wrap chdir in a process.cwd()-restoring try/finally with a justifying comment + AUDIT.md entry."
    - "connectionHeader(connection) prepends every org-touching tool response so callers can verify the connected identity."
    - "README + per-tool description strings state which tools require directory and explain how org routing works (no implicit default)."
  artifacts:
    - path: ".planning/phases/01-mcp-tool-parameter-hardening/AUDIT.md"
      provides: "Tool-by-tool classification table (needs-sfdx-project yes/no, chdir disposition, directory schema disposition, file path, justification)"
      contains: "needs-sfdx-project"
    - path: "packages/mcp-provider-dx-core/src/shared/utils.ts"
      provides: "requireUsernameOrAlias(allowed, provided) + formatAllowedOrgsError + existing connectionHeader"
      exports: ["requireUsernameOrAlias", "formatAllowedOrgsError", "connectionHeader"]
    - path: "packages/mcp-provider-dx-core/test/unit/utils.test.ts"
      provides: "Unit tests for requireUsernameOrAlias + formatAllowedOrgsError + connectionHeader (existing)"
      contains: "requireUsernameOrAlias"
    - path: "packages/mcp-provider-dx-core/test/unit/get_username.test.ts"
      provides: "Regression: suggestUsername never reads global target-org; multi-org always returns list"
      contains: "does not read .sf/config.json"
  key_links:
    - from: "every org-touching tool exec()"
      to: "requireUsernameOrAlias(allowedOrgs, input.usernameOrAlias)"
      via: "direct call before services.getConnection"
      pattern: "requireUsernameOrAlias\\("
    - from: "every org-touching tool response"
      to: "connectionHeader(connection)"
      via: "string prefix in the tool's textual response"
      pattern: "connectionHeader\\("
    - from: "get_username.suggestUsername"
      to: "allowedOrgs list only (no ConfigAggregator global target-org)"
      via: "removed ConfigAggregator.getPropertyValue('target-org') call for selection logic"
      pattern: "suggestUsername"
---

<objective>
Harden every MCP tool's parameter handling so that (a) no code path silently picks a default org from the global `~/.sf/config.json` or any cached first-match, and (b) `directory` is required only for tools that genuinely need a local sfdx-project. Extend `connectionHeader` to every org-touching response. Preserve the already-shipped `get_username` multi-org listing + `connectionHeader` helper.

Purpose: Close the root cause discovered in `.planning/debug/run-soql-query-wrong-org.md` at the schema + helper level so the wrong-org class of bugs cannot recur.

Output: audited + refactored tools under `packages/mcp-provider-dx-core/src/tools/`, a shared `requireUsernameOrAlias` helper, new/updated tests, `AUDIT.md` classification, README updates, all commits atomic and conventional.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/ROADMAP.md
@.planning/phases/01-mcp-tool-parameter-hardening/01-CONTEXT.md
@.planning/debug/run-soql-query-wrong-org.md

@packages/mcp-provider-dx-core/src/tools/get_username.ts
@packages/mcp-provider-dx-core/src/tools/run_soql_query.ts
@packages/mcp-provider-dx-core/src/shared/utils.ts
@packages/mcp-provider-dx-core/test/unit/get_username.test.ts
@packages/mcp/src/utils/auth.ts
@packages/mcp/src/services.ts
@packages/mcp/src/utils/cache.ts
@README.md

<package_manager>
Root `package.json` uses yarn workspaces (`yarn workspaces run ...`); both `yarn.lock` and `package-lock.json` exist. Project scripts invoke yarn. Use `yarn build` + `yarn test` (workspace-scoped: `yarn workspace @salesforce/mcp-provider-dx-core test`). ROADMAP text mentions `pnpm build && pnpm test`; treat that as equivalent phrasing — executor runs `yarn build && yarn test`.
</package_manager>

<in_scope_tools>
Only `packages/mcp-provider-dx-core/src/tools/**` is org-routing-sensitive. Other providers (code-analyzer, devops, mobile-web, metadata-enrichment, scale-products) are NOT org-routing tools per CONTEXT.md scope; they are excluded from this phase's `requireUsernameOrAlias` + `connectionHeader` rollout. Their `process.chdir` usage is still listed in `AUDIT.md` for completeness but only dx-core tools get refactored in this phase.

dx-core tools in scope (13):
- get_username, run_soql_query, run_apex_test, run_agent_test, assign_permission_set, list_all_orgs, open_org, create_org_snapshot, create_scratch_org, delete_org, deploy_metadata, retrieve_metadata, resume_tool_operation
</in_scope_tools>

<interfaces>
From `packages/mcp-provider-dx-core/src/shared/utils.ts` (existing):
```typescript
export function connectionHeader(connection: Connection): string; // "Connected to: <username> @ <instanceUrl> (orgId: <orgId>)"
```

New exports to add in T05:
```typescript
export class MissingUsernameOrAliasError extends Error {
  constructor(public readonly allowedOrgs: string[]);
}
// Throws MissingUsernameOrAliasError if provided is empty OR not in allowed.
export function requireUsernameOrAlias(allowed: string[], provided: string | undefined): string;
// Formats the user-facing message that MissingUsernameOrAliasError carries.
export function formatAllowedOrgsError(allowedOrgs: string[]): string;
```

From `packages/mcp/src/utils/auth.ts`:
- `getAllAllowedOrgs(cache): Promise<Set<string>>`
- `findOrgByUsernameOrAlias(orgs, usernameOrAlias): OrgAuthorization | undefined`
- `getConnection(usernameOrAlias, ...): Promise<Connection>`
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>T01: Audit — enumerate all tools, classify needs-sfdx-project, catalog chdir usage</name>
  <files>.planning/phases/01-mcp-tool-parameter-hardening/AUDIT.md</files>
  <action>
Read every file under `packages/mcp-provider-dx-core/src/tools/*.ts` and every file under `packages/mcp-provider-*/src/tools/**/*.ts`. For each tool record: (1) schema excerpt for `directory` + `usernameOrAlias`, (2) whether `process.chdir(input.directory)` is called in `exec()`, (3) the actual sfdx/API call made (e.g. `Connection.query`, `ComponentSetBuilder.fromSource`, `AuthInfo.listAllAuthorizations`), (4) verdict `needs-sfdx-project: yes|no|unclear` with one-line justification, (5) `directory-schema-action: keep-required | make-optional | remove`, (6) `chdir-disposition: remove | keep-with-try-finally | replace-with-api-arg`.

Write the table to `.planning/phases/01-mcp-tool-parameter-hardening/AUDIT.md` with sections:
- `## dx-core tools (IN SCOPE)` — 13 tools listed in `<in_scope_tools>`
- `## Other providers (OUT OF SCOPE, catalog only)` — chdir usage flagged for future phase, no refactor
- `## chdir replacement strategy` — for each dx-core tool needing sfdx-project, document the API alternative (e.g. `ComponentSetBuilder.fromSource({ projectDir })`, `SfProject.resolve(path)`) or mark `unavoidable` with reasoning
- `## Decision summary` — counts: N tools `make-optional`, M tools `keep-required`, K chdir calls removed, J wrapped in try/finally

Use grep + Read; do NOT modify tool source yet. This task is read-only discovery and gates T06+.
  </action>
  <verify>
    <automated>test -f .planning/phases/01-mcp-tool-parameter-hardening/AUDIT.md && grep -q "needs-sfdx-project" .planning/phases/01-mcp-tool-parameter-hardening/AUDIT.md && grep -q "Decision summary" .planning/phases/01-mcp-tool-parameter-hardening/AUDIT.md</automated>
  </verify>
  <done>AUDIT.md exists with all 13 dx-core tools classified, chdir disposition per tool, and a Decision summary that downstream tasks can cite.</done>
</task>

<task type="auto" tdd="true">
  <name>T02: Test (RED) — assert get_username never reads global target-org</name>
  <files>packages/mcp-provider-dx-core/test/unit/get_username.test.ts</files>
  <behavior>
    - Test: "suggestUsername does NOT call ConfigAggregator for 'target-org'" — spy/mock rejects if invoked with `target-org` as selection input.
    - Test: multi-org case — given `allowedOrgs=['A','B','C']`, result has `suggestedUsername === undefined` and `reasoning` contains all three aliases, regardless of `~/.sf/config.json` content.
    - Test: single-org case — given `allowedOrgs=['A']`, result binds to A (still valid behavior; fallback is only prohibited when choice is ambiguous).
    - Test: zero-org case — returns an actionable error naming zero allowed orgs.
    - Keep existing 4 regression tests passing.
  </behavior>
  <action>
Extend `packages/mcp-provider-dx-core/test/unit/get_username.test.ts`. Add the four cases above. Use vitest. Tests MUST fail today because current `suggestUsername` still touches `ConfigAggregator.getPropertyValue('target-org')` even in multi-org branches (confirm by running the test before T03). Run with `--run` flag (per user rule).
  </action>
  <verify>
    <automated>cd packages/mcp-provider-dx-core && yarn test --run test/unit/get_username.test.ts 2>&1 | grep -E "(FAIL|failing)" | head -5</automated>
  </verify>
  <done>Four new tests fail for the right reason (ConfigAggregator spy invoked OR suggestedUsername bound to a config-derived org). Commit: `test(01): add failing tests for get_username no-global-fallback invariant`</done>
</task>

<task type="auto" tdd="true">
  <name>T03: Impl (GREEN) — remove global target-org read from suggestUsername</name>
  <files>packages/mcp-provider-dx-core/src/tools/get_username.ts</files>
  <behavior>
    - `suggestUsername` never reads `~/.sf/config.json` / `ConfigAggregator` for the `target-org` property.
    - Multi-org branch returns `{suggestedUsername: undefined, reasoning: <list of all allowed orgs>}` (already present from prior fix) — just delete the now-dead config read.
    - Single-org branch: binds to the single allowed org with reasoning `"only one allowed org"` (no config read).
    - Zero-org branch: returns error text via shared helper (T05 will add `formatAllowedOrgsError`; for T03, hand-write inline and refactor in T05).
  </behavior>
  <action>
In `packages/mcp-provider-dx-core/src/tools/get_username.ts`:
1. Remove any `ConfigAggregator` / `target-org` read inside `suggestUsername`.
2. Keep the multi-org listing (added by prior fix) — just the input signal changes (now purely `allowedOrgs`).
3. Preserve the response text that instructs AI to ask the user when `suggestedUsername === undefined`.
4. Do NOT change the tool's schema (still no `directory` tightening here; that comes in T07).
Run T02 tests — MUST go green. Run full dx-core unit suite — 0 regressions.
  </action>
  <verify>
    <automated>cd packages/mcp-provider-dx-core && yarn test --run test/unit/get_username.test.ts</automated>
  </verify>
  <done>All tests in `get_username.test.ts` pass; grep `ConfigAggregator.*target-org` in `get_username.ts` returns 0 matches in `suggestUsername`. Commit: `fix(01): drop global target-org fallback from get_username suggestUsername (REQ-1)`</done>
</task>

<task type="auto" tdd="true">
  <name>T04: Test (RED) — shared helper requireUsernameOrAlias + formatAllowedOrgsError</name>
  <files>packages/mcp-provider-dx-core/test/unit/utils.test.ts</files>
  <behavior>
    - `requireUsernameOrAlias([], undefined)` throws `MissingUsernameOrAliasError`; message contains "No allowed orgs configured".
    - `requireUsernameOrAlias(['A','B'], undefined)` throws; message lists `A, B` and includes the "Ask the user which org to target" instruction.
    - `requireUsernameOrAlias(['A','B'], 'C')` throws; message says `C` not in allowed list.
    - `requireUsernameOrAlias(['A','B'], 'A')` returns `'A'`.
    - `formatAllowedOrgsError(['A','B','C'])` returns a single string: `"Missing or invalid usernameOrAlias. Allowed orgs for this server: A, B, C. Ask the user which org to target."`
    - `connectionHeader` existing tests still pass.
  </behavior>
  <action>
Add test cases to `packages/mcp-provider-dx-core/test/unit/utils.test.ts`. Import from `../../src/shared/utils` (functions don't exist yet → RED).
  </action>
  <verify>
    <automated>cd packages/mcp-provider-dx-core && yarn test --run test/unit/utils.test.ts 2>&1 | grep -E "(FAIL|failing)" | head -5</automated>
  </verify>
  <done>New test cases fail with "not a function" / "does not exist". Commit: `test(01): add failing tests for requireUsernameOrAlias helper`</done>
</task>

<task type="auto" tdd="true">
  <name>T05: Impl (GREEN) — shared helper requireUsernameOrAlias + refactor get_username zero-org branch</name>
  <files>
    packages/mcp-provider-dx-core/src/shared/utils.ts
    packages/mcp-provider-dx-core/src/tools/get_username.ts
  </files>
  <behavior>
    - Export `MissingUsernameOrAliasError`, `requireUsernameOrAlias`, `formatAllowedOrgsError` from `shared/utils.ts`.
    - `requireUsernameOrAlias` signature: `(allowed: string[], provided: string | undefined) => string`.
    - T04 tests go green; T02/T03 tests still green.
    - `get_username.ts` zero-org branch now calls `formatAllowedOrgsError([])`.
  </behavior>
  <action>
1. Add helper implementation in `packages/mcp-provider-dx-core/src/shared/utils.ts`. Keep the existing `connectionHeader` export intact.
2. Refactor `get_username.ts` zero-org branch to use `formatAllowedOrgsError`.
3. Do NOT wire the helper into other tools yet — T07/T09 do that per-tool with its own test.
  </action>
  <verify>
    <automated>cd packages/mcp-provider-dx-core && yarn test --run</automated>
  </verify>
  <done>All dx-core unit tests pass; grep confirms 3 new exports in `shared/utils.ts`. Commit: `feat(01): add requireUsernameOrAlias shared helper for org-touching tools`</done>
</task>

<task type="auto" tdd="true">
  <name>T06: Test (RED) — per-tool "missing usernameOrAlias → actionable error" + "directory optional where applicable"</name>
  <files>
    packages/mcp-provider-dx-core/test/unit/run_soql_query.test.ts
    packages/mcp-provider-dx-core/test/unit/list_all_orgs.test.ts
    packages/mcp-provider-dx-core/test/unit/open_org.test.ts
    packages/mcp-provider-dx-core/test/unit/assign_permission_set.test.ts
    packages/mcp-provider-dx-core/test/unit/resume_tool_operation.test.ts
  </files>
  <behavior>
    For each org-only tool (those classified `make-optional` in AUDIT.md, expected set: run_soql_query, list_all_orgs, open_org, assign_permission_set, resume_tool_operation):
    - Test A: omit `usernameOrAlias` → tool returns error text containing `"Allowed orgs"` and all allowed org aliases.
    - Test B: omit `directory` but provide valid `usernameOrAlias` → tool succeeds (mocked `getConnection`) and response begins with `connectionHeader(...)`.
    - Test C: provide `usernameOrAlias` NOT in allowedOrgs → actionable error.
    Create test files that don't yet exist (most of these are new unit tests). For tools whose shape requires deeper mocks (e.g. `@salesforce/source-*`), stick to schema-level + helper-level assertions; don't simulate full sf runtime.
  </behavior>
  <action>
Create five new vitest files with the three test cases each. Mock `services.getConnection` and `getAllAllowedOrgs` via `vi.mock`. Tests MUST fail today because tools don't yet call `requireUsernameOrAlias` and still require `directory`.
  </action>
  <verify>
    <automated>cd packages/mcp-provider-dx-core && yarn test --run test/unit/run_soql_query.test.ts test/unit/list_all_orgs.test.ts test/unit/open_org.test.ts test/unit/assign_permission_set.test.ts test/unit/resume_tool_operation.test.ts 2>&1 | grep -E "(FAIL|failing)" | head -10</automated>
  </verify>
  <done>15 new tests (5 tools × 3 cases) all fail for the right reason. Commit: `test(01): add RED tests for org-only tools missing usernameOrAlias + optional directory`</done>
</task>

<task type="auto" tdd="true">
  <name>T07: Impl (GREEN) — wire requireUsernameOrAlias + optional directory for org-only tools</name>
  <files>
    packages/mcp-provider-dx-core/src/tools/run_soql_query.ts
    packages/mcp-provider-dx-core/src/tools/list_all_orgs.ts
    packages/mcp-provider-dx-core/src/tools/open_org.ts
    packages/mcp-provider-dx-core/src/tools/assign_permission_set.ts
    packages/mcp-provider-dx-core/src/tools/resume_tool_operation.ts
  </files>
  <behavior>
    For each of the five tools listed above:
    - Schema: `directory` becomes optional (`z.string().optional()` or equivalent; exact pattern determined by reading existing schema).
    - `exec()`: call `requireUsernameOrAlias(allowedOrgs, input.usernameOrAlias)` before `getConnection`. On throw, return the error text to the MCP response (do NOT leak stack traces; match the established tool error-response shape).
    - `exec()`: remove `process.chdir(input.directory)` entirely. If the tool currently does any other directory-dependent work (e.g. reading a local file), audit per AUDIT.md — expected: none of these five tools have real project-local work.
    - Response: prepend `connectionHeader(connection)` to the textual output (one line, then blank line, then existing content).
  </behavior>
  <action>
Implement per-tool. Keep file diffs minimal. Preserve tool descriptions in the schema (adjust wording: "directory — OPTIONAL, used only for fallback project context; most callers should omit it" or similar concise phrasing). T06 tests MUST go green. Run full dx-core suite — 0 regressions.
  </action>
  <verify>
    <automated>cd packages/mcp-provider-dx-core && yarn test --run</automated>
  </verify>
  <done>All T06 tests pass. Grep confirms: 0 `process.chdir` remaining in those 5 files; 5 new `requireUsernameOrAlias(` calls; 5 new `connectionHeader(` calls in response paths. Commit: `refactor(01): make directory optional and remove chdir from org-only dx-core tools (REQ-2, REQ-3, REQ-4)`</done>
</task>

<task type="auto" tdd="true">
  <name>T08: Test (RED) — project-path-required tools use API arg, not process.chdir; missing-usernameOrAlias still actionable</name>
  <files>
    packages/mcp-provider-dx-core/test/unit/run_apex_test.test.ts
    packages/mcp-provider-dx-core/test/unit/run_agent_test.test.ts
    packages/mcp-provider-dx-core/test/unit/deploy_metadata.test.ts
    packages/mcp-provider-dx-core/test/unit/retrieve_metadata.test.ts
    packages/mcp-provider-dx-core/test/unit/create_org_snapshot.test.ts
    packages/mcp-provider-dx-core/test/unit/create_scratch_org.test.ts
    packages/mcp-provider-dx-core/test/unit/delete_org.test.ts
  </files>
  <behavior>
    For each sfdx-project-requiring tool (7 tools per AUDIT.md: run_apex_test, run_agent_test, deploy_metadata, retrieve_metadata, create_org_snapshot, create_scratch_org, delete_org):
    - Test A: omit `usernameOrAlias` → actionable error listing allowed orgs.
    - Test B: exec() should not leave `process.cwd()` changed after return (whether success or throw) — assert `process.cwd() === originalCwd` after exec().
    - Test C: response (on success) begins with `connectionHeader(...)`.
    - `directory` remains required — test that omitting it fails schema validation (keep existing behavior; this is the "required tools" contract).
  </behavior>
  <action>
Create seven new vitest files. Use `vi.spyOn(process, 'chdir')` to detect calls; in GREEN phase, implementation either (a) doesn't call `chdir` at all (preferred — passes `projectDir` via API), or (b) wraps `chdir` in `try { process.chdir(dir); ... } finally { process.chdir(original); }` with a serialization guard. Tests assert post-condition, not mechanism.
  </action>
  <verify>
<automated>cd packages/mcp-provider-dx-core && yarn test --run 2>&1 | grep -E "(FAIL|failing)" | head -10</automated>
  </verify>
  <done>21 new tests (7 tools x 3 cases) all fail. Commit: `test(01): add RED tests for sfdx-project tools — no cwd leak + actionable missing-org error`</done>
</task>

<task type="auto" tdd="true">
  <name>T09: Impl (GREEN) — wire requireUsernameOrAlias + connectionHeader + chdir disposition for sfdx-project tools</name>
  <files>
    packages/mcp-provider-dx-core/src/tools/run_apex_test.ts
    packages/mcp-provider-dx-core/src/tools/run_agent_test.ts
    packages/mcp-provider-dx-core/src/tools/deploy_metadata.ts
    packages/mcp-provider-dx-core/src/tools/retrieve_metadata.ts
    packages/mcp-provider-dx-core/src/tools/create_org_snapshot.ts
    packages/mcp-provider-dx-core/src/tools/create_scratch_org.ts
    packages/mcp-provider-dx-core/src/tools/delete_org.ts
  </files>
  <behavior>
    For each of these 7 tools:
    - exec() calls `requireUsernameOrAlias(allowedOrgs, input.usernameOrAlias)` before `getConnection`.
    - Response prepends `connectionHeader(connection)`.
    - `process.chdir(input.directory)` is either (preferred) removed and replaced with an API call that accepts `projectDir` / `projectPath` (per AUDIT.md strategy column), OR wrapped in `const originalCwd = process.cwd(); try { process.chdir(input.directory); ... } finally { process.chdir(originalCwd); }` with a // justification comment citing the sf API that has no path-arg alternative.
    - Any remaining chdir has a referenced justification entry in AUDIT.md.
    - Schema for `directory` stays required; description updated to "required — must point to an sfdx-project root".
  </behavior>
  <action>
Per AUDIT.md strategy column, implement each tool. For tools where the underlying sf API accepts a path argument (most `@salesforce/source-deploy-retrieve` + `@salesforce/core` APIs do — verify via Context7 / source), remove chdir. Otherwise wrap. Run T08 tests → GREEN; run whole dx-core suite → 0 regressions.
  </action>
  <verify>
    <automated>cd packages/mcp-provider-dx-core && yarn test --run</automated>
  </verify>
  <done>All T08 tests pass. Grep of remaining `process.chdir(input.directory)` in dx-core tools either returns 0 matches, or every remaining match is adjacent to a `// chdir-justified:` comment referencing AUDIT.md. Commit: `refactor(01): route sfdx-project tools through requireUsernameOrAlias and isolate chdir (REQ-2, REQ-4)`</done>
</task>

<task type="auto" tdd="true">
  <name>T10: Test + Impl — e2e assertion that run_soql_query response always begins with connectionHeader</name>
  <files>
    packages/mcp-provider-dx-core/test/e2e/run_soql_query.test.ts
  </files>
  <behavior>
    Extend existing e2e: assert that a successful SOQL query's response text starts with the literal prefix `Connected to: ` and contains the connected org's `instanceUrl` + `orgId`. This is a belt-and-suspenders check on top of T06/T07.
  </behavior>
  <action>
Add one test case. No production code change expected — T07 already added connectionHeader. If this test reveals a gap (e.g. an error path that skips connectionHeader), fix the tool and add a small commit on top.
  </action>
  <verify>
    <automated>cd packages/mcp-provider-dx-core && yarn test --run test/e2e/run_soql_query.test.ts</automated>
  </verify>
  <done>e2e asserts header prefix. Commit: `test(01): e2e — run_soql_query response echoes connectionHeader`</done>
</task>

<task type="auto">
  <name>T11: Docs — README + per-tool description strings</name>
  <files>
    README.md
    packages/mcp-provider-dx-core/src/tools/run_soql_query.ts
    packages/mcp-provider-dx-core/src/tools/get_username.ts
    packages/mcp-provider-dx-core/src/tools/list_all_orgs.ts
    packages/mcp-provider-dx-core/src/tools/open_org.ts
    packages/mcp-provider-dx-core/src/tools/assign_permission_set.ts
    packages/mcp-provider-dx-core/src/tools/resume_tool_operation.ts
    packages/mcp-provider-dx-core/src/tools/run_apex_test.ts
    packages/mcp-provider-dx-core/src/tools/run_agent_test.ts
    packages/mcp-provider-dx-core/src/tools/deploy_metadata.ts
    packages/mcp-provider-dx-core/src/tools/retrieve_metadata.ts
    packages/mcp-provider-dx-core/src/tools/create_org_snapshot.ts
    packages/mcp-provider-dx-core/src/tools/create_scratch_org.ts
    packages/mcp-provider-dx-core/src/tools/delete_org.ts
  </files>
  <action>
1. README.md: add a short section titled "Org routing (multi-org safety)" right after the existing "Installation" / "Configuration" section. Content:
   - `usernameOrAlias` is mandatory on every org-touching tool.
   - The server never infers target org from `~/.sf/config.json` global `target-org`.
   - When omitted, tools return an error listing allowed orgs; callers (including AI) must ask the user.
   - Table: which tools require `directory` (sfdx-project) vs which make it optional. Source the table from AUDIT.md.
2. Per-tool: tighten each tool's `description` schema string so it matches the new reality. No functional change.
  </action>
  <verify>
    <automated>grep -q "Org routing" README.md && grep -q "usernameOrAlias" README.md</automated>
  </verify>
  <done>README has the new section; per-tool descriptions describe the `directory` contract accurately. Commit: `docs(01): document org routing and directory contract across tools (REQ-5)`</done>
</task>

<task type="auto">
  <name>T12: Full-repo build + test + grep sweep</name>
  <files></files>
  <action>
1. Run `yarn build` at the repo root.
2. Run `yarn test` at the repo root (triggers every workspace's test script).
3. Run these grep sweeps and paste results into the task summary:
   - `grep -rn "process.chdir" packages/mcp-provider-dx-core/src/tools/` — every hit must have a nearby `// chdir-justified:` comment.
   - `grep -rn "ConfigAggregator.*target-org" packages/mcp-provider-dx-core/src/tools/` — must return zero matches.
   - `grep -rn "connectionHeader(" packages/mcp-provider-dx-core/src/tools/` — must show >= 13 tool call sites (every dx-core tool).
   - `grep -rn "requireUsernameOrAlias(" packages/mcp-provider-dx-core/src/tools/` — must show >= 13 tool call sites.
4. If any sweep fails, open a follow-up task inside this plan rather than amending prior commits.
  </action>
  <verify>
    <automated>cd /Users/dormonzhou/Projects/Salesforce-MCP && yarn build && yarn test</automated>
  </verify>
  <done>Build green, all tests green, grep sweeps pass. No additional commit unless a sweep-induced fix is needed; then: `fix(01): <specific>`.</done>
</task>

</tasks>

<waves>
Sequential chain with TDD pairs grouped. Executed by a single Claude instance; "parallelism" is expressed as independent diff regions, not concurrent processes.

- **Wave 1 (gates everything):** T01 (audit).
- **Wave 2 (TDD pair — get_username):** T02 → T03.
- **Wave 3 (TDD pair — shared helper):** T04 → T05.
- **Wave 4 (TDD pair — org-only tools):** T06 → T07. Depends on T05.
- **Wave 5 (TDD pair — sfdx-project tools):** T08 → T09. Depends on T05 and T01.
- **Wave 6:** T10 (e2e). Depends on T07.
- **Wave 7:** T11 (docs). Depends on T01, T07, T09.
- **Wave 8:** T12 (final verification). Depends on everything.

Strict ordering that MUST be preserved: T01 → T05 → {T07, T09} → T11 → T12.
</waves>

<goal_backward_verification>
Mapping ROADMAP Phase-1 goal-backward checks to tasks:

| Goal-backward check | Satisfying tasks |
|--|--|
| `yarn build && yarn test` green | T12 |
| `get_username` no longer reads `~/.sf/config.json` global `target-org`; multi-org regression tests pass | T02 + T03 |
| Every tool schema audited; `directory` required only where needed; decision documented per-tool | T01 (AUDIT.md) + T07 (flip org-only) + T09 (keep required tools as-is) + T11 (docs) |
| No `process.chdir()` in exec() for tools that don't need sfdx-project; the rest use API or justify | T07 (removes chdir from 5 org-only tools) + T09 (removes / isolates chdir for 7 project tools) + AUDIT.md justification column |
| Removing the fallback surfaces a clear actionable error | T04 + T05 (shared helper) + T06 + T08 (per-tool regression tests) |

REQ mapping:
- REQ-1 → T02, T03
- REQ-2 → T01, T06, T07, T08, T09
- REQ-3 → T01, T07, T09
- REQ-4 → T07, T09
- REQ-5 → T11
</goal_backward_verification>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| MCP client (AI assistant) → MCP server tool `exec()` | Untrusted tool inputs (`usernameOrAlias`, `directory`) cross here. AI may hallucinate or propagate a stale alias. |
| MCP server tool → local filesystem (`~/.sf/config.json`, sfdx-project root) | Tool reads local config; global defaults are NOT trustworthy for routing decisions. |
| MCP server tool → Salesforce org (via `Connection`) | Every org-touching request must route to the caller-specified org, never to a default. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-01-01 | Spoofing | AI picks wrong `usernameOrAlias` after reading global `target-org` via `get_username` | mitigate | T03 — remove ConfigAggregator `target-org` read in suggestUsername; T07 + T09 — `connectionHeader` prefix forces observable identity echo. |
| T-01-02 | Tampering | Concurrent MCP calls corrupt each other's `process.cwd()` via `process.chdir` | mitigate | T07 removes chdir from org-only tools; T09 removes or serializes chdir in sfdx-project tools (try/finally restore). |
| T-01-03 | Information Disclosure | Query against wrong org returns data the caller must not see (cross-tenant leakage) | mitigate | T04 + T05 `requireUsernameOrAlias` rejects unknown alias before `getConnection`; allowlist enforced. |
| T-01-04 | Elevation of Privilege | Silent fallback routes a write (`assign_permission_set`, `deploy_metadata`) to Prod when caller meant Staging | mitigate | T07 + T09 force explicit `usernameOrAlias` — silent default is now impossible on write-capable tools. |
| T-01-05 | Repudiation | Response doesn't identify which org served the data; caller cannot audit | mitigate | T07 + T09 + T10 — `connectionHeader` on every response records username + instanceUrl + orgId. |
| T-01-06 | Denial of Service | `process.chdir` race under concurrent MCP load breaks subsequent calls | mitigate | T07 + T09 — remove chdir or wrap with cwd restoration. |
| T-01-07 | Information Disclosure | Error messages leak full config paths / stack traces | accept | Error text is templated by `formatAllowedOrgsError` (T05); existing tool error-handling sanitizes. Low risk on a local MCP. |
</threat_model>

<risks>
- **Concurrent chdir races.** Removing chdir is preferred; where unavoidable we wrap in try/finally. If two requests still race between `process.chdir` and the first sf API call, T01 must confirm whether the dx-core runtime serializes tool invocations. If not, T09 adds a mutex around the chdir region.
- **Breaking callers that relied on the global target-org default.** By design. Replacement UX is the actionable-error listing allowed orgs. Documented in README (T11) and phase SUMMARY.
- **Test flakiness from removed implicit defaults.** Existing tests relying on `~/.sf/config.json` will start failing; T01 flags them; T02/T06/T08 fix explicitly. No blanket skips.
- **API-argument availability for sfdx-project tools.** Assumption: `ComponentSetBuilder.fromSource({ projectDir })`, `SfProject.resolve(path)`, `TestService({ connection, projectDir })` accept explicit paths. T01 verifies via Context7 + package source. If any tool has no path-arg API, chdir stays with a justification — not a blocker.
- **Grep false negatives.** T12 sweep uses literal substrings; unusual variations (e.g. `process["chdir"]`) could slip through. If needed, T01 adds an AST-aware scan.
</risks>

<rollback>
- **Atomic commits** mean `git revert <hash>` per task. Commit messages all carry the `(01)` scope.
- **Foundational tasks** (reverting these forces reverting downstream):
  - T05 (shared helper) — revert forces revert of T07, T09, T10, T11, T12.
  - T01 (AUDIT) — not foundational for code but downstream references it; reverting loses the audit trail.
- **Safe partial rollback:** T11 (docs), T10 (e2e). T07 and T09 can be reverted independently if one tool set destabilizes.
- **Not reverted under any rollback:** The already-shipped `get_username` multi-org listing + `connectionHeader` helper (they predate this phase and are stable per CONTEXT.md locked decisions).
</rollback>

<verification>
- `yarn build` at repo root exits 0.
- `yarn test` at repo root exits 0.
- `.planning/phases/01-mcp-tool-parameter-hardening/AUDIT.md` exists and classifies all 13 dx-core tools.
- `grep -rn "ConfigAggregator.*target-org" packages/mcp-provider-dx-core/src/tools/` → 0 matches.
- `grep -rn "process.chdir" packages/mcp-provider-dx-core/src/tools/` → every match paired with `// chdir-justified:` comment referencing AUDIT.md.
- `grep -rn "requireUsernameOrAlias(" packages/mcp-provider-dx-core/src/tools/` → ≥ 13 matches (one per org-touching tool).
- `grep -rn "connectionHeader(" packages/mcp-provider-dx-core/src/tools/` → ≥ 13 matches.
- README.md has "Org routing (multi-org safety)" section.
- Each task produced exactly one commit with the prescribed conventional-commit type prefix.
</verification>

<success_criteria>
- All ROADMAP Phase 1 goal-backward checks pass (see mapping table above).
- All five REQs (REQ-1..REQ-5) each have at least one task closing them.
- No silent org-routing code path remains in `packages/mcp-provider-dx-core/src/tools/`.
- `connectionHeader` is prepended to every dx-core tool response.
- `directory` classification is codified in schemas AND documented in both AUDIT.md and README.
- Previously shipped multi-org fix + existing regression tests remain intact.
</success_criteria>

<output>
After completion, create `.planning/phases/01-mcp-tool-parameter-hardening/01-01-SUMMARY.md` documenting: tasks completed, commit hashes per task, AUDIT.md headline counts (N optional / M required / K chdir removed / J chdir wrapped), test deltas, any deviations from the plan and the reasons.
</output>
