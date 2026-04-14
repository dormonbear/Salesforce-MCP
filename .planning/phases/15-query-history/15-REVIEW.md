---
phase: 15-query-history
reviewed: 2025-01-27T19:45:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - packages/mcp-provider-dx-core/src/schema/query-history-types.ts
  - packages/mcp-provider-dx-core/src/schema/query-history-service.ts
  - packages/mcp-provider-dx-core/src/tools/list_query_history.ts
  - packages/mcp-provider-dx-core/src/tools/run_soql_query.ts
  - packages/mcp-provider-dx-core/src/index.ts
  - packages/mcp-provider-dx-core/src/schema/index.ts
  - packages/mcp/src/utils/tool-categories.ts
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
status: issues_found
---

# Phase 15: Code Review Report

**Reviewed:** 2025-01-27T19:45:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Phase 15 adds per-org in-memory query history via a ring buffer, a new `salesforce_list_query_history` MCP tool, and a fire-and-forget recording hook in the existing `run_soql_query` tool. The implementation is clean, well-structured, and follows the established project patterns closely.

**Key positives:**
- The fire-and-forget recording in `run_soql_query.ts` correctly wraps all history logic in try/catch to satisfy the design invariant "recording must never fail a successful query."
- The RingBuffer `toArray()` logic is correct — I traced through multiple push/wrap scenarios and the modular arithmetic is sound.
- Barrel exports, tool-categories registration, and provider wiring are all consistent with existing patterns.
- No security concerns: no user input reaches shell commands, no hardcoded secrets, no injection vectors, in-memory-only storage.

**One warning** found regarding missing input validation on the publicly exported `RingBuffer` class, which could produce `NaN` state if instantiated with `capacity=0`. The production code path is protected, but the public API is not.

## Warnings

### WR-01: RingBuffer allows capacity=0, causing NaN writeIndex

**File:** `packages/mcp-provider-dx-core/src/schema/query-history-types.ts:29-36`
**Issue:** `RingBuffer` is a publicly exported class with no guard against `capacity <= 0`. When `capacity` is `0`, the modulo on line 35 (`(this.writeIndex + 1) % this.capacity`) evaluates to `NaN`, silently corrupting `writeIndex` for all subsequent operations. The buffer appears to work (count never increments because `0 < 0` is false, toArray returns `[]`) but internal state is broken.

The `QueryHistoryService` constructor protects against this for the **environment variable** path (line 29: `parsed > 0`), but the **programmatic** path uses `limit ?? DEFAULT_LIMIT` (line 31), where `??` passes through `0` because it only coalesces `null`/`undefined`. So `new QueryHistoryService(0)` creates a `RingBuffer(0)`.

In **production**, `index.ts` calls `new QueryHistoryService()` with no args (→ 50), so this is not reachable. However, the class is exported and could be misused by consumers or tests.

**Fix:** Add a capacity guard in the RingBuffer constructor:

```typescript
public constructor(private readonly capacity: number) {
  if (capacity < 1) {
    throw new Error('RingBuffer capacity must be at least 1');
  }
  this.buffer = new Array<T | undefined>(capacity).fill(undefined);
}
```

And optionally tighten the service constructor:

```typescript
// In QueryHistoryService constructor, change:
this.limit = limit ?? DEFAULT_LIMIT;
// To:
this.limit = (limit !== undefined && limit > 0) ? limit : DEFAULT_LIMIT;
```

## Info

### IN-01: Duplicate license header in index.ts (pre-existing)

**File:** `packages/mcp-provider-dx-core/src/index.ts:1-31`
**Issue:** The file contains two consecutive identical Apache 2.0 license headers (lines 1–15 and lines 17–31). This pre-dates Phase 15 and is not caused by these changes.
**Fix:** Remove the duplicate block (lines 17–31) in a future cleanup pass.

### IN-02: Triple parseSoqlFields call in run_soql_query success path

**File:** `packages/mcp-provider-dx-core/src/tools/run_soql_query.ts:122,150,168`
**Issue:** On a successful non-tooling-API query, `parseSoqlFields(input.query)` is called three times with the same input: once for schema auto-caching (line 122), once for relationship suggestions (line 150), and once for history recording (line 168). Each invocation re-parses the identical SOQL string.

This is intentional — each block is designed to be self-contained and independently failable per the fire-and-forget pattern (D-08). Hoisting the parsed result would create coupling between blocks, so the trade-off is reasonable. Noting for awareness only.

**Fix:** No change needed unless profiling shows regex parsing is a bottleneck. If consolidation is desired, parse once before the three blocks and pass the result into each try/catch.

### IN-03: totalStored computed via redundant list call

**File:** `packages/mcp-provider-dx-core/src/tools/list_query_history.ts:104`
**Issue:** `totalStored` is computed as `this.queryHistoryService.list(orgUsername).length`, which calls `buffer.toArray()` to create a full array just to read its length. The service doesn't expose a `count(orgUsername)` method, so this is currently the only way to get the total. Not a bug — just an unnecessary intermediate array allocation.

**Fix:** Add a `count(orgUsername: string): number` method to `QueryHistoryService`:

```typescript
public count(orgUsername: string): number {
  return this.orgBuffers.get(orgUsername)?.size ?? 0;
}
```

Then in the tool: `const totalStored = this.queryHistoryService.count(orgUsername);`

---

_Reviewed: 2025-01-27T19:45:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
