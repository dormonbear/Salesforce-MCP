# Phase 1 Audit — MCP Tool Parameter Classification

**Audited:** 2026-04-14
**Scope:** `packages/mcp-provider-dx-core/src/tools/` (13 tools, in scope for refactor)
**Out of scope:** Other provider packages cataloged for completeness only.

---

## dx-core tools (IN SCOPE)

| Tool | directory schema | usernameOrAlias schema | process.chdir in exec() | Main API call | needs-sfdx-project | directory-schema-action | chdir-disposition |
|------|-----------------|----------------------|------------------------|--------------|-------------------|------------------------|-------------------|
| `get_username` | required | not present (resolves org identity) | yes — `process.chdir(input.directory)` | `orgService.getAllowedOrgs()`, `orgService.getDefaultTargetOrg()` | no | make-optional | remove |
| `run_soql_query` | required | required | yes — `process.chdir(input.directory)` | `connection.query()` / `connection.tooling.query()` | no | make-optional | remove |
| `list_all_orgs` | required | not present (no org parameter) | yes — `process.chdir(input.directory)` | `orgService.getAllowedOrgs()` | no | make-optional | remove |
| `open_org` | required | required | yes — `process.chdir(input.directory)` | `org.getFrontDoorUrl()`, `metadataResolver.getComponentsFromPath()` | no (MetadataResolver reads file from filePath, not project root) | make-optional | remove |
| `assign_permission_set` | required | required | yes — `process.chdir(input.directory)` | `connection.singleRecordQuery()`, `user.assignPermissionSets()` | no | make-optional | remove |
| `resume_tool_operation` | required | required | yes — `process.chdir(input.directory)` | `MetadataApiDeploy`, `scratchOrgResume`, `AgentTester.poll()` | no (all operations use job IDs, no local file reads) | make-optional | remove |
| `run_apex_test` | required | required | yes — `process.chdir(input.directory)` | `TestService`, `testService.runTestAsynchronous()` | no (TestService takes connection, not project path) | make-optional | remove |
| `run_agent_test` | required | required | yes — `process.chdir(input.directory)` | `AgentTester.start()`, `AgentTester.poll()` | no (AgentTester takes connection, no local files) | make-optional | remove |
| `deploy_metadata` | required | required | yes — `process.chdir(input.directory)` | `ComponentSetBuilder.build()`, `SourceTracking.create()`, `SfProject.resolve(input.directory)` | **yes** — calls `SfProject.resolve(input.directory)`, `SourceTracking.create({org, project})` which need project root | keep-required | replace-with-api-arg (already uses `SfProject.resolve(input.directory)` — remove the chdir) |
| `retrieve_metadata` | required | required | yes — `process.chdir(input.directory)` | `SfProject.resolve(input.directory)`, `SourceTracking.create()` | **yes** — calls `SfProject.resolve(input.directory)` | keep-required | replace-with-api-arg (already uses `SfProject.resolve(input.directory)`) |
| `create_scratch_org` | required | devHub (usernameOrAlias) | yes — `process.chdir(input.directory)` | `scratchOrgCreate()`, reads `definitionFile` (JSON path) | **yes** — reads a local definition file via `fs.promises.readFile(input.definitionFile)` and the definitionFile is a relative path by default (`config/project-scratch-def.json`) | keep-required | keep-with-try-finally (fs.readFile uses relative path resolved against cwd; no API alternative) |
| `create_org_snapshot` | required | devHub + sourceOrg | yes — `process.chdir(input.directory)` | `Org.create()`, `devHubConnection.sobject()` | no (pure org API, no local file reads) | make-optional | remove |
| `delete_org` | required | required | yes — `process.chdir(input.directory)` | `Org.delete()`, `AuthRemover.create()` | no (pure org API) | make-optional | remove |

### Summary of classification

**Org-only tools (make-optional, remove chdir):** get_username, run_soql_query, list_all_orgs, open_org, assign_permission_set, resume_tool_operation, run_apex_test, run_agent_test, create_org_snapshot, delete_org  
Count: **10 tools**

**sfdx-project tools (keep-required):** deploy_metadata, retrieve_metadata, create_scratch_org  
Count: **3 tools**

> Note: The plan listed 7 sfdx-project tools (run_apex_test, run_agent_test, deploy_metadata, retrieve_metadata, create_org_snapshot, create_scratch_org, delete_org). After detailed audit:
> - `run_apex_test` — `TestService(connection)` takes only a Connection; no local project files needed. **Reclassified: org-only.**
> - `run_agent_test` — `AgentTester(connection)` takes only a Connection; no local project files. **Reclassified: org-only.**
> - `create_org_snapshot` — reads/writes only Salesforce org APIs. **Reclassified: org-only.**
> - `delete_org` — org API only. **Reclassified: org-only.**
> - `deploy_metadata` — calls `SfProject.resolve(input.directory)` and `SourceTracking.create({org, project})`. **Confirmed: needs sfdx-project.**
> - `retrieve_metadata` — calls `SfProject.resolve(input.directory)`. **Confirmed: needs sfdx-project.**
> - `create_scratch_org` — reads `input.definitionFile` (default `config/project-scratch-def.json`, relative path). **Confirmed: needs sfdx-project (chdir sets CWD for relative definitionFile resolution).**

---

## chdir replacement strategy

| Tool | chdir-justified | API alternative / action |
|------|----------------|--------------------------|
| `get_username` | no | Remove. No local files read. |
| `run_soql_query` | no | Remove. `connection.query()` needs no CWD. |
| `list_all_orgs` | no | Remove. `orgService.getAllowedOrgs()` needs no CWD. |
| `open_org` | no | Remove. `MetadataResolver.getComponentsFromPath(input.filePath)` uses absolute `filePath`, not CWD-relative. |
| `assign_permission_set` | no | Remove. All operations use connection + username strings. |
| `resume_tool_operation` | no | Remove. All operations use job IDs. |
| `run_apex_test` | no | Remove. `TestService(connection)` needs no CWD. |
| `run_agent_test` | no | Remove. `AgentTester(connection)` needs no CWD. |
| `create_org_snapshot` | no | Remove. Pure org API. |
| `delete_org` | no | Remove. Pure org API. |
| `deploy_metadata` | no | Remove. Already passes `SfProject.resolve(input.directory)` explicitly; `ComponentSetBuilder.build({projectDir})` accepts explicit path. Remove redundant chdir. |
| `retrieve_metadata` | no | Remove. Already passes `SfProject.resolve(input.directory)` and `project.getPath()` to `ComponentSetBuilder.build({projectDir})`. Remove redundant chdir. |
| `create_scratch_org` | **yes** | `// chdir-justified: scratchOrgCreate() resolves definitionFile relative to process.cwd(); no API accepts explicit basePath for definitionFile. Wrap in try/finally to restore CWD.` Wrap in: `const originalCwd = process.cwd(); try { process.chdir(input.directory); ... } finally { process.chdir(originalCwd); }` |

---

## Other providers (OUT OF SCOPE, catalog only)

| Package | Tool | File | chdir line | Notes |
|---------|------|------|-----------|-------|
| `mcp-provider-scale-products` | `scan-apex-antipatterns-tool` | `src/tools/scan-apex-antipatterns-tool.ts:140` | `process.chdir(input.directory)` | Not refactored in phase 1. Requires local file scan; future phase to assess API alternative. |
| `mcp-provider-metadata-enrichment` | `enrich_metadata` | `src/tools/enrich_metadata.ts:156` | `process.chdir(input.directory)` | Not refactored in phase 1. |
| `mcp-provider-code-analyzer` | test helpers | `test/actions/describe-rule.test.ts:40,44` | `process.chdir(pathToDirectory)` / `process.chdir(__dirname)` | Test file only. Not a production chdir. |

---

## Decision summary

| Category | Count |
|----------|-------|
| Tools reclassified: `make-optional` (directory) | 10 |
| Tools: `keep-required` (directory) | 3 |
| chdir calls **removed entirely** | 12 |
| chdir calls **wrapped in try/finally** (create_scratch_org) | 1 |
| Other-provider chdir calls flagged for future phase | 2 |
