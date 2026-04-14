# Phase 15: Query History — Nyquist Validation Strategy

## Test Frequency Analysis

| Requirement | What to test | Min tests | Rationale |
|-------------|-------------|-----------|-----------|
| QHST-01 | Ring buffer: push, overflow, per-org isolation, capacity | 6 | Core data structure with multiple edge cases |
| QHST-02 | Configuration: default 50, env var override, invalid env graceful | 3 | Configuration path with fallback |
| QHST-03 | ListQueryHistoryMcpTool: list all, filter by object, limit, empty | 5 | Tool with multiple query modes |

## Coverage Approach

### Unit Tests (pure service)
- `QueryHistoryService` — ring buffer behavior, per-org isolation, configuration, getHistory()

### Integration Tests (wiring)
- `run_soql_query.ts` — fire-and-forget recording on success
- `ListQueryHistoryMcpTool` — end-to-end tool execution

## Minimum Viable Test Count
**14 tests** across service + tool
