---
phase: 12-auto-cache-on-success
reviewed: 2026-04-12T16:36:27Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - packages/mcp-provider-dx-core/src/schema/soql-parser.ts
  - packages/mcp-provider-dx-core/src/tools/run_soql_query.ts
  - packages/mcp-provider-dx-core/src/tools/describe_object.ts
  - packages/mcp-provider-dx-core/src/index.ts
  - packages/mcp-provider-dx-core/src/schema/index.ts
findings:
  critical: 0
  warning: 1
  info: 3
  total: 4
status: issues_found
---

# Phase 12: Code Review Report

**Reviewed:** 2026-04-12T16:36:27Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Phase 12 adds auto-caching of SOQL field metadata after successful queries (ACCH-01/02/03). The implementation spans a new pure SOQL parser, constructor injection of `SchemaService` into `QueryOrgMcpTool`, a merge-on-cache-hit strategy that never downgrades full entries, and a partial-entry invalidation guard in `DescribeObjectMcpTool`.

**Overall assessment: Solid, well-designed changes.** The architecture cleanly separates concerns — the SOQL parser is a pure function, auto-cache is fire-and-forget with a safety `catch`, and the partial→full upgrade path in describe_object correctly invalidates stale partial entries before calling `describeAndCache`. The one notable gap is a missing type guard in `curateDescribeResult` that relies on an external invariant for safety. Three minor code-quality observations round out the findings.

## Warnings

### WR-01: Missing type guard in `curateDescribeResult` — crash if non-FullDescribe entry is passed

**File:** `packages/mcp-provider-dx-core/src/tools/describe_object.ts:83-84`
**Issue:** `curateDescribeResult` immediately casts `entry` to `FullDescribeEntry` (line 84) without checking `entry.type`. If a `PartialFieldsEntry` or `RelationshipEdgesEntry` is passed, `(entry as FullDescribeEntry).data` evaluates to `undefined`, and line 85 throws `TypeError: Cannot read properties of undefined (reading 'fields')`.

The caller (line 195) protects against this by invalidating partial entries on lines 179-182 before calling `describeAndCache`. This means the entry *should* always be `FullDescribeEntry` in practice. However, the function itself is fragile: it silently accepts a `SchemaEntry` union type and crashes on two of the three variants. A concurrent auto-cache write from `QueryOrgMcpTool` inserting a new `PartialFieldsEntry` between the `invalidate` (line 181) and `describeAndCache` (line 185) — while unlikely with serial MCP tool execution — would trigger this crash.

**Fix:** Add a defensive type guard at the top of `curateDescribeResult`:
```typescript
function curateDescribeResult(entry: SchemaEntry, isCacheHit: boolean): CuratedDescribeResult {
  if (entry.type !== SchemaEntryType.FullDescribe) {
    throw new Error(`curateDescribeResult requires a FullDescribeEntry, got: ${entry.type}`);
  }
  const data = entry.data;
  // ... rest unchanged
```
This converts a confusing `TypeError` into a clear, debuggable error with the actual entry type, and narrows the TypeScript type without `as` casts.

## Info

### IN-01: Duplicate license header in index.ts

**File:** `packages/mcp-provider-dx-core/src/index.ts:1-31`
**Issue:** The Apache 2.0 license header appears twice consecutively (lines 1-15 and lines 16-31). Likely a copy-paste artifact from the modification.
**Fix:** Remove lines 16-31 (the second copy of the license header).

### IN-02: SOQL function expressions pass through parser and are cached as field names

**File:** `packages/mcp-provider-dx-core/src/schema/soql-parser.ts:31-34`
**Issue:** The aggregate bailout checks `COUNT|SUM|AVG|MIN|MAX` but other SOQL functions with parentheses — `FIELDS(ALL)`, `FIELDS(STANDARD)`, `FIELDS(CUSTOM)`, `toLabel(Status)`, `FORMAT(Amount)`, `CALENDAR_MONTH(CreatedDate)` — pass through and are cached as literal field names (e.g., `FIELDS(ALL)` stored in `fieldNames`). Impact is low: partial entries are advisory and get replaced by full describes, and these function-based queries are uncommon in practice.
**Fix (optional):** Add a general parenthesis bail-out or filter:
```typescript
// After the existing bail-outs, add:
if (/\w+\s*\(/.test(rawFields)) return null; // any function call in field list
```
Or filter individual fields: `.filter((f) => f && !f.includes('.') && !f.includes('('))`.

### IN-03: Field names not case-normalized in auto-cache merge

**File:** `packages/mcp-provider-dx-core/src/tools/run_soql_query.ts:117`
**Issue:** SOQL is case-insensitive for field names, so queries `SELECT Id FROM Account` and `SELECT ID FROM Account` produce `'Id'` and `'ID'` respectively. The `Set` dedup on line 117 treats these as distinct, accumulating case-variant duplicates in `fieldNames`. Low impact — partial entries are advisory and eventually replaced by full describes.
**Fix (optional):** Normalize field names to lowercase in the parser:
```typescript
// soql-parser.ts line 47
.map((f) => f.trim().split(/\s+/)[0].toLowerCase())
```

---

_Reviewed: 2026-04-12T16:36:27Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
