---
phase: 15-query-history
plan: 01
type: summary
---

# Phase 15-01 Summary: Query History

## What was built

### QueryHistoryEntry + RingBuffer (query-history-types.ts)
- `QueryHistoryEntry` type: query, objectName, timestamp, fieldCount
- Generic `RingBuffer<T>` class: O(1) push, modulo-index, newest-first toArray()
- Array-based, fixed capacity, auto-overwrites oldest entries

### QueryHistoryService (query-history-service.ts)
- Per-org `Map<string, RingBuffer<QueryHistoryEntry>>` storage
- Default capacity 50, configurable via `SF_QUERY_HISTORY_LIMIT` env var
- `record(org, query, objectName, fieldCount)` and `list(org, {objectName?, limit?})`

### ListQueryHistoryMcpTool (list_query_history.ts)
- `salesforce_list_query_history` tool — GA, DATA toolset, read-only
- Input: usernameOrAlias (required), objectName (optional filter), limit (default 10)
- Output: structuredContent with queries[], totalStored, orgUsername

### Recording Hook (run_soql_query.ts)
- Fire-and-forget recording after successful non-tooling SOQL queries
- Optional 3rd constructor parameter (QueryHistoryService?) — backward compatible
- Silent catch — recording failure never fails a successful query

### Provider Integration (index.ts)
- QueryHistoryService singleton instantiated in DxCoreMcpProvider
- Passed to QueryOrgMcpTool (3rd arg) and ListQueryHistoryMcpTool
- `getQueryHistoryService()` accessor added

### Tool Categories (tool-categories.ts)
- `salesforce_list_query_history: 'read'` prevents readOnlyHint consistency regression

## Test results
- 15 QueryHistoryService + RingBuffer tests
- 6 ListQueryHistoryMcpTool tests
- 4 recording hook tests
- **204 total tests passing**, 0 regressions

## Commits
1. `feat(15-01): implement QueryHistoryService with RingBuffer and per-org storage`
2. `feat(15-01): implement ListQueryHistoryMcpTool for AI agent query reuse`
3. `feat(15-01): wire query history recording hook and provider integration`
