---
phase: 06-tool-annotations
plan: 01
subsystem: mcp-provider-dx-core
tags: [tool-annotations, mcp-hints, dx-core]
dependency_graph:
  requires: []
  provides: [complete-4-hint-annotations-dx-core]
  affects: [LLM-client-confirmation-dialogs, agent-decision-quality]
tech_stack:
  added: []
  patterns: [MCP ToolAnnotations, readOnlyHint, destructiveHint, idempotentHint, openWorldHint]
key_files:
  modified:
    - packages/mcp-provider-dx-core/src/tools/run_soql_query.ts
    - packages/mcp-provider-dx-core/src/tools/list_all_orgs.ts
    - packages/mcp-provider-dx-core/src/tools/get_username.ts
    - packages/mcp-provider-dx-core/src/tools/run_apex_test.ts
    - packages/mcp-provider-dx-core/src/tools/run_agent_test.ts
    - packages/mcp-provider-dx-core/src/tools/resume_tool_operation.ts
    - packages/mcp-provider-dx-core/src/tools/retrieve_metadata.ts
    - packages/mcp-provider-dx-core/src/tools/get_org_info.ts
    - packages/mcp-provider-dx-core/src/tools/deploy_metadata.ts
    - packages/mcp-provider-dx-core/src/tools/assign_permission_set.ts
decisions:
  - "retrieve_metadata gets readOnlyHint:true despite writing local files — classification tracks org-side side-effects, not local filesystem writes"
  - "run_apex_test and run_agent_test get openWorldHint:true because they call org APIs; idempotentHint:false because test results vary"
  - "resume_tool_operation gets openWorldHint:true because it polls external org async job status"
  - "assign_permission_set gets idempotentHint:true — assigning the same permission set twice is a no-op"
  - "deploy_metadata gets openWorldHint:true (corrected from false) — deploys to external org network"
metrics:
  duration: ~8 minutes
  completed_date: "2026-04-11"
  tasks_completed: 2
  files_modified: 10
---

# Phase 06 Plan 01: Tool Annotations (dx-core GA Tools) Summary

Complete 4-hint MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`) on all 10 GA tools in `mcp-provider-dx-core`, ensuring LLM clients correctly suppress confirmation dialogs for read-only tools and surface them only for write operations.

## What Changed

Each of the 10 GA tool files in `mcp-provider-dx-core/src/tools/` had its `annotations` block completed with all four required hints. Previously, most tools had only 1-2 hints, missing `idempotentHint` entirely and in some cases missing `readOnlyHint`.

### Read-category tools (8 files) — all get `readOnlyHint: true`

| Tool | destructiveHint | idempotentHint | openWorldHint |
|------|----------------|----------------|---------------|
| run_soql_query | false | true | false |
| list_all_orgs | false | true | false |
| get_username | false | true | false |
| get_org_info | false | true | false |
| run_apex_test | false | false | true |
| run_agent_test | false | false | true |
| resume_tool_operation | false | false | true |
| retrieve_metadata | true | false | true |

### Write-category tools (2 files) — all get `readOnlyHint: false`

| Tool | destructiveHint | idempotentHint | openWorldHint |
|------|----------------|----------------|---------------|
| deploy_metadata | true | false | true |
| assign_permission_set | false | true | true |

## Verification Results

- `idempotentHint` present in all 10 tool files: PASS (10 matches)
- `readOnlyHint: false` only in deploy_metadata and assign_permission_set: PASS (2 matches, correct files only)
- `readOnlyHint: true` in all 8 read-category tools: PASS
- TypeScript compile: pre-existing tsconfig project-reference error unrelated to these changes; no new errors introduced

## Deviations from Plan

### Auto-corrected values

**1. [Rule 1 - Consistency] deploy_metadata openWorldHint corrected from false to true**
- **Found during:** Task 2 review
- **Issue:** The existing annotations block had `openWorldHint: false`, but deploy_metadata clearly calls external org network APIs
- **Fix:** Set `openWorldHint: true` per plan specification
- **Files modified:** `deploy_metadata.ts`
- **Commit:** f4f05ec

## Known Stubs

None — all annotations are static constant values, fully wired.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced. All changes are static metadata annotations.

## Self-Check: PASSED

- `run_soql_query.ts` — idempotentHint present: FOUND
- `list_all_orgs.ts` — idempotentHint present: FOUND
- `get_username.ts` — idempotentHint present: FOUND
- `run_apex_test.ts` — idempotentHint present: FOUND
- `run_agent_test.ts` — idempotentHint present: FOUND
- `resume_tool_operation.ts` — idempotentHint present: FOUND
- `retrieve_metadata.ts` — idempotentHint present: FOUND
- `get_org_info.ts` — idempotentHint present: FOUND
- `deploy_metadata.ts` — readOnlyHint:false, idempotentHint present: FOUND
- `assign_permission_set.ts` — readOnlyHint:false, idempotentHint present: FOUND
- Commit 6168401 (Task 1): FOUND
- Commit f4f05ec (Task 2): FOUND
