---
plan: "07-02"
status: complete
started: "2026-04-11"
completed: "2026-04-11"
commits: ["dd0fd98", "17d9c23"]
---

# Plan 07-02 Summary: Migrate 10 Tools to toolError()

## What Was Done

Migrated all 10 top-used GA tools from generic `textResponse(msg, true)` error handling to structured `toolError()` calls with domain-specific recovery hints.

## Tools Migrated

1. run_soql_query — SOQL syntax + tooling API toggle hints
2. deploy_metadata — timeout resume + metadata validation hints
3. retrieve_metadata — timeout + source verification hints
4. get_username — org authorization hints
5. list_all_orgs — auth re-authentication hints
6. run_apex_test — test class verification hints
7. assign_permission_set — permission set name verification hints
8. get_org_info — org authorization hints
9. resume_tool_operation — operation ID validation hints (4 catch blocks)
10. run_agent_test — agent API name verification hints

## Key Details

- All catch blocks now use toolError() with [USER_ERROR]/[SYSTEM_ERROR] classification
- SfError.actions extracted as primary recovery source with tool-specific fallbacks
- Existing conditional logic preserved (SOQL tooling API toggle, deploy timeout resume)
- No catch block returns raw textResponse errors anymore
- resume_tool_operation inner functions changed return type from ToolTextResponse to CallToolResult
- Built mcp-provider-api dist and synced to dx-core node_modules (nohoist workspace)

## Verification

All existing tests pass with no regressions.
