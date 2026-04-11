# Plan 08-02: Structured Output for 6 Core GA Tools — SUMMARY

**Status**: COMPLETE
**Date**: 2026-04-11

## Changes

### Task 1: Query & Org Tools (commit cd99792)
- `run_soql_query.ts`: Added `queryOutputSchema` (totalSize, done, records) + `structuredContent`
- `list_all_orgs.ts`: Added `listOrgsOutputSchema` (orgs array with org metadata) + `structuredContent`
- `get_org_info.ts`: Added `getOrgInfoOutputSchema` (defaultOrg, authorizedOrgs) + `structuredContent`, added `z` import

### Task 2: Test & Permission Tools (commit 0c4e337)
- `run_apex_test.ts`: Added `apexTestOutputSchema` (testRunId, summary, tests) + `structuredContent` on both async and sync paths
- `run_agent_test.ts`: Added `agentTestOutputSchema` (runId, status, startTime, endTime, testCases) + `structuredContent` on both async and sync paths
- `assign_permission_set.ts`: Added `assignPermSetOutputSchema` (permissionSetName, assignedTo) + `structuredContent`

### Cleanup (commit 1417d53)
- Removed unused `textResponse` imports from `list_all_orgs.ts` and `get_org_info.ts`

### Task 3: Schema Validation Tests (commit a1c0658)
- Created `test/unit/structured-output.test.ts` with 20 tests (mocha/chai)
- Tests instantiate each tool, extract `outputSchema` from `getConfig()`, and validate representative data with `z.object()`
- Covers valid data, minimal data, and invalid data rejection for all 6 tools

## Verification
- TypeScript: `tsc --noEmit` passes (only pre-existing TS6310 project reference warning)
- Tests: 30/30 passing (20 new structured output + 10 existing utility tests)
