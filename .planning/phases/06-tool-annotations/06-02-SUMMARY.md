---
phase: 06-tool-annotations
plan: "02"
subsystem: tool-annotations
tags: [annotations, readOnlyHint, idempotentHint, mobile-web, code-analyzer, devops, scale-products, mcp]
dependency_graph:
  requires: []
  provides: [complete-4-hint-annotations-mobile-web-code-analyzer-devops-scale-products-mcp]
  affects: [mcp-client-confirmation-dialogs, tool-categories-consistency]
tech_stack:
  added: []
  patterns: [mcp-tool-annotations, typescript-readonly-annotations]
key_files:
  created: []
  modified:
    - packages/mcp-provider-mobile-web/src/tools/offline-analysis/get_mobile_lwc_offline_analysis.ts
    - packages/mcp-provider-mobile-web/src/tools/offline-guidance/get_mobile_lwc_offline_guidance.ts
    - packages/mcp-provider-mobile-web/src/tools/native-capabilities/create_mobile_lwc_native_capabilities.ts
    - packages/mcp-provider-code-analyzer/src/tools/run_code_analyzer.ts
    - packages/mcp-provider-code-analyzer/src/tools/list_code_analyzer_rules.ts
    - packages/mcp-provider-code-analyzer/src/tools/describe_code_analyzer_rule.ts
    - packages/mcp-provider-code-analyzer/src/tools/query_code_analyzer_results.ts
    - packages/mcp-provider-code-analyzer/src/tools/generate_xpath_prompt.ts
    - packages/mcp-provider-devops/src/tools/sfDevopsDetectConflict.ts
    - packages/mcp-provider-devops/src/tools/sfDevopsResolveConflict.ts
    - packages/mcp-provider-scale-products/src/tools/scan-apex-antipatterns-tool.ts
    - packages/mcp/src/tools/enable_tools.ts
    - packages/mcp/src/tools/list_tools.ts
decisions:
  - "run_code_analyzer readOnlyHint fixed to true — writes temp results file but does not modify Salesforce org state"
  - "generate_xpath_prompt readOnlyHint fixed to true — temp files are cleaned up automatically"
  - "sfDevopsDetectConflict openWorldHint:true — calls DevOps Center API"
  - "sfDevopsResolveConflict readOnlyHint:false, openWorldHint:true — modifies git state and calls DevOps Center API"
  - "title removed from enable_tools annotations block — title belongs at config root, not inside annotations"
metrics:
  duration: ~15min
  completed: "2026-04-11T10:50:40Z"
  tasks_completed: 3
  files_modified: 13
---

# Phase 06 Plan 02: Tool Annotations (Remaining Packages) Summary

**One-liner:** Complete 4-hint annotation blocks on 13 GA tools across mobile-web, code-analyzer, devops, scale-products, and mcp packages; fix two existing readOnlyHint bugs.

## What Changed

### Task 1: mobile-web GA tools (3 files)

Added `destructiveHint: false`, `idempotentHint: true`, `openWorldHint: false` to:
- `get_mobile_lwc_offline_analysis.ts` — analyzes LWC code locally, no org calls
- `get_mobile_lwc_offline_guidance.ts` — returns static guidance, pure read
- `create_mobile_lwc_native_capabilities.ts` — reads local resource files, returns type definitions (covers all 13 `create_mobile_lwc_*` tool IDs)

Commit: `2813932`

### Task 2: code-analyzer GA tools (5 files) — includes 2 bug fixes

**Bug fixes (readOnlyHint false → true):**
- `run_code_analyzer.ts`: was incorrectly `readOnlyHint: false` — tool writes temp results file but does not modify Salesforce org state; classified as 'read' in tool-categories.ts
- `generate_xpath_prompt.ts`: was incorrectly `readOnlyHint: false` — creates temp files but cleans them up automatically; classified as 'read' in tool-categories.ts

**Annotation completion:**
- `list_code_analyzer_rules.ts`: added `destructiveHint`, `idempotentHint`, `openWorldHint`
- `describe_code_analyzer_rule.ts`: added `destructiveHint`, `idempotentHint`, `openWorldHint`
- `query_code_analyzer_results.ts`: added `destructiveHint`, `idempotentHint`, `openWorldHint`

Commit: `05f6525`

### Task 3: devops, scale-products, and mcp internal tools (5 files)

**devops — annotations added from scratch (were missing entirely):**
- `sfDevopsDetectConflict.ts`: `readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true`
- `sfDevopsResolveConflict.ts`: `readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true`

**scale-products:**
- `scan-apex-antipatterns-tool.ts`: added `destructiveHint`, `idempotentHint`, `openWorldHint`

**mcp internal tools:**
- `enable_tools.ts`: added `destructiveHint`, `idempotentHint`; removed erroneous `title` key from inside annotations block (title belongs at config root)
- `list_tools.ts`: added `destructiveHint`, `idempotentHint`

Commit: `015fc2a`

## Verification Results

### idempotentHint coverage (13/13 tool files):
```
mobile-web/create_mobile_lwc_native_capabilities.ts:110:  idempotentHint: true
mobile-web/get_mobile_lwc_offline_analysis.ts:81:         idempotentHint: true
mobile-web/get_mobile_lwc_offline_guidance.ts:63:         idempotentHint: true
code-analyzer/list_code_analyzer_rules.ts:163:            idempotentHint: true
code-analyzer/query_code_analyzer_results.ts:97:          idempotentHint: true
code-analyzer/run_code_analyzer.ts:91:                    idempotentHint: false
code-analyzer/generate_xpath_prompt.ts:89:                idempotentHint: false
code-analyzer/describe_code_analyzer_rule.ts:73:          idempotentHint: true
devops/sfDevopsDetectConflict.ts:90:                      idempotentHint: true
devops/sfDevopsResolveConflict.ts:93:                     idempotentHint: false
scale-products/scan-apex-antipatterns-tool.ts:136:        idempotentHint: true
mcp/list_tools.ts:54:                                     idempotentHint: true
mcp/enable_tools.ts:61:                                   idempotentHint: true
```

### Bug fixes verified:
- `run_code_analyzer.ts` line 89: `readOnlyHint: true` (was false)
- `generate_xpath_prompt.ts` line 87: `readOnlyHint: true` (was false)

### No `title` inside annotations blocks: confirmed

### No unintended `readOnlyHint: false` in target files: confirmed (only `create_custom_rule.ts` has it, which is out of scope)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing correctness] Removed `title` from enable_tools.ts annotations block**
- **Found during:** Task 3
- **Issue:** `enable_tools.ts` had `title: 'Enable Salesforce MCP tools'` inside the `annotations` block. The MCP `ToolAnnotations` type does not include a `title` field — title belongs at the config root level (where it already existed). Having an unrecognized key in annotations is schema noise.
- **Fix:** Removed the `title` key from inside `annotations`; the `title` at root level line 50 was already correct.
- **Files modified:** `packages/mcp/src/tools/enable_tools.ts`
- **Commit:** `015fc2a`

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries introduced. All changes are annotation metadata only.

## Self-Check: PASSED
