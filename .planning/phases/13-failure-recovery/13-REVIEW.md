---
phase: 13-failure-recovery
reviewed: 2025-04-13T02:15:00Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - packages/mcp-provider-dx-core/src/schema/levenshtein.ts
  - packages/mcp-provider-dx-core/src/tools/run_soql_query.ts
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 13: Code Review Report

**Reviewed:** 2025-04-13T02:15:00Z
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Phase 13 adds INVALID_FIELD failure recovery to `run_soql_query` — when a SOQL query fails with an unrecognized field, the tool auto-describes the Salesforce object and returns fuzzy field-name suggestions using Levenshtein distance. Two files were reviewed:

1. **`levenshtein.ts`** (new) — Clean, correct Wagner-Fischer implementation with single-row space optimization and a `findSimilarFields` helper. Algorithm correctness verified by manual trace.
2. **`run_soql_query.ts`** (modified) — Connection hoisted above the query try-catch to make it available in the recovery path. INVALID_FIELD recovery block (lines 163-201) invalidates stale partial cache, calls `describeAndCache` with single-flight coalescing, and returns fuzzy suggestions. Multiple fallthrough points ensure the tool always returns a useful error message.

**High-level assessment:** Solid implementation. No security issues, no correctness bugs. The recovery path is well-structured with defensive fallthrough at every level (regex miss → generic error, describe failure → generic error, non-FullDescribe entry → generic error). The connection hoisting follows the same pattern used in `describe_object.ts`. One type-safety warning on the `fields` extraction, and two minor info items.

## Warnings

### WR-01: Unguarded type assertion on `entry.data.fields`

**File:** `packages/mcp-provider-dx-core/src/tools/run_soql_query.ts:190`
**Issue:** The line `(entry.data.fields as Array<{ name: string }>).map(f => f.name)` asserts `entry.data.fields` is a non-null array without validation. Since `entry.data` is typed as `Record<string, unknown>`, TypeScript provides no compile-time guarantees about `fields`. If the Salesforce describe response is ever malformed or the shape changes, this throws a TypeError that is silently swallowed by the catch on line 197 — masking the root cause and falling through to the generic error with no diagnostic information.

The outer try-catch prevents a crash, so this is not a correctness bug today. But relying on exception handling as implicit null-checking is fragile and makes debugging harder if the Salesforce API response shape ever changes.

**Fix:** Add a defensive guard before the assertion:
```typescript
const rawFields = entry.data.fields;
if (Array.isArray(rawFields)) {
  const allFields = (rawFields as Array<{ name: string }>).map(f => f.name);
  const suggestions = findSimilarFields(invalidField, allFields, 3);
  const recovery = suggestions.length > 0
    ? `Did you mean: ${suggestions.join(', ')}?`
    : 'Use salesforce_describe_object to verify available fields on the target object.';
  return toolError(`Failed to query org: ${sfErr.message}`, { recovery, category: 'user' });
}
```

## Info

### IN-01: Fuzzy threshold grows unbounded with field name length

**File:** `packages/mcp-provider-dx-core/src/schema/levenshtein.ts:54`
**Issue:** The threshold `Math.max(Math.ceil(needle.length * 0.6), 3)` scales linearly with needle length. For long custom field names (e.g., a 40-character `My_Very_Long_Custom_Field_Name_Value__c`), the threshold would be 24, allowing matches that differ in more than half their characters. This could produce noisy, unhelpful suggestions for long field names.

**Fix:** Consider adding an upper cap to keep suggestions relevant:
```typescript
const threshold = Math.min(Math.max(Math.ceil(needle.length * 0.6), 3), 10);
```

### IN-02: Complex inferred type annotation for `connection`

**File:** `packages/mcp-provider-dx-core/src/tools/run_soql_query.ts:100`
**Issue:** The type `Awaited<ReturnType<ReturnType<Services['getOrgService']>['getConnection']>>>` is correct but deeply nested and hard to read at a glance. This is a consequence of hoisting the connection variable above the try-catch (necessary for the recovery path), and the project not exporting a named type for the connection object.

**Fix:** Extract a local type alias at the top of the file or in a shared types module:
```typescript
type OrgConnection = Awaited<ReturnType<ReturnType<Services['getOrgService']>['getConnection']>>;
```
Then use: `let connection: OrgConnection;`

---

_Reviewed: 2025-04-13T02:15:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
