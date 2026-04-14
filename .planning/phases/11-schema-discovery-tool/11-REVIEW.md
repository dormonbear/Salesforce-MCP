---
phase: 11
status: findings
depth: standard
files_reviewed: 3
files_reviewed_list:
  - packages/mcp-provider-dx-core/src/tools/describe_object.ts
  - packages/mcp-provider-dx-core/src/index.ts
  - packages/mcp-provider-dx-core/test/unit/schema/describe-object.test.ts
findings: 5
blockers: 0
warnings: 3
info: 2
---

# Phase 11: Code Review Report

**Reviewed:** 2026-04-12T16:03:12Z
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found

## Summary

Phase 11 implements `salesforce_describe_object`, a new MCP tool that returns curated Salesforce object schema metadata using the Phase 10 SchemaService for cache-first behavior. The implementation follows established tool patterns well (Zod schemas, error handling with `toolError`/`classifyError`, `McpTool` extension). Tests cover the key requirement triples (DISC-04/05/06) with 11 passing tests.

Three warnings were found: a latent crash when non-FullDescribe entries exist in the cache (will trigger when Phase 12 adds partial entries), a TOCTOU race in cache-hit detection that can misreport `_meta.source`, and missing minimum-length validation on `objectName`. Two info items cover type narrowness and a pre-existing duplicate license header.

## Warnings

### WR-01: `curateDescribeResult` crashes on non-FullDescribe cache entries

**File:** `packages/mcp-provider-dx-core/src/tools/describe_object.ts:83-84`
**Issue:** `curateDescribeResult` accepts `SchemaEntry` (the union of `FullDescribeEntry | PartialFieldsEntry | RelationshipEdgesEntry`) but immediately casts to `FullDescribeEntry` and accesses `.data` (line 84). If `SchemaService.describeAndCache()` returns a cached `PartialFieldsEntry` (which has no `.data` property), the function will throw a runtime error when accessing `data.fields`.

This is a latent bug: currently no code path stores `PartialFieldsEntry` values, but Phase 12 (auto-cache on SOQL success) is planned to do exactly that. When that happens, the LRU cache stores all entry types under the same `(orgUsername, objectName.toLowerCase())` key. If a `PartialFieldsEntry` occupies that key, `describeAndCache()` line 103-105 finds it truthy and returns it immediately — the describe tool then crashes in `curateDescribeResult`.

**Fix:** Either narrow the function signature or add a type guard:

```typescript
// Option A: Narrow parameter type (preferred — push type safety to caller)
function curateDescribeResult(entry: FullDescribeEntry, isCacheHit: boolean): CuratedDescribeResult {
  const data = entry.data;
  // ...
}

// Option B: Add runtime type guard in the tool's exec method
const entry = await this.schemaService.describeAndCache(/* ... */);
if (entry.type !== SchemaEntryType.FullDescribe) {
  // Invalidate non-full entry and retry with API call
  this.schemaService.invalidate(orgUsername, input.objectName);
  const freshEntry = await this.schemaService.describeAndCache(orgUsername, input.objectName, describeFn);
  // ...
}
```

Option B is more robust because it also handles the runtime scenario where `describeAndCache` returns a cached non-FullDescribe entry.

---

### WR-02: TOCTOU race condition in cache-hit detection

**File:** `packages/mcp-provider-dx-core/src/tools/describe_object.ts:176-190`
**Issue:** The tool reads cache state at line 176 to determine `isCacheHit`, then calls `describeAndCache()` at line 180 which performs its own independent cache check. Between these two reads, the cache state can change:

- **False negative:** Tool's `get()` returns `undefined` (miss), but by the time `describeAndCache()` runs, another concurrent request has cached the entry. `describeAndCache` returns the cached entry, but `_meta.source` reports `'api'` instead of `'cache'`.
- **False positive (with WR-01 fix applied):** Tool's `get()` returns a `FullDescribeEntry` (hit), but the entry is evicted by the time `describeAndCache()` runs. `describeAndCache` calls the API, but `_meta.source` reports `'cache'` instead of `'api'`.

The practical impact is limited (metadata misreport, not data corruption), but it violates DISC-05's "accurate" cache transparency requirement.

**Fix:** Determine cache-hit status from the `describeAndCache` return value rather than a separate pre-check:

```typescript
// Remove the separate get() call. Instead, check the entry's cachedAt
// against a timestamp captured before the call:
const beforeCall = Date.now();
const entry = await this.schemaService.describeAndCache(
  orgUsername,
  input.objectName,
  async () => ({ /* ... */ }),
);

// If entry was cached before we called, it's a cache hit
const isCacheHit = entry.cachedAt < beforeCall;
const curated = curateDescribeResult(entry, isCacheHit);
```

This eliminates the TOCTOU by deriving `isCacheHit` from the returned entry's timestamp.

---

### WR-03: Missing minimum-length validation on `objectName`

**File:** `packages/mcp-provider-dx-core/src/tools/describe_object.ts:41`
**Issue:** `objectName` is defined as `z.string()` with no minimum length constraint. An empty string `""` passes Zod validation but causes a pointless (and confusingly-errored) API call to `connection.describe("")`. Compare with the explicit empty-check for `usernameOrAlias` at line 164 — `objectName` lacks equivalent protection.

**Fix:** Add `.min(1)` to the Zod schema:

```typescript
objectName: z.string().min(1).describe(
  'The API name of the Salesforce sObject to describe (e.g., "Account", "Contact", "Custom_Object__c")'
),
```

Optionally, add a regex for valid Salesforce API names for defense-in-depth:
```typescript
objectName: z.string().min(1).regex(/^[a-zA-Z]\w*(__[a-zA-Z]+)?$/).describe(/* ... */),
```

## Info

### IN-01: `curateDescribeResult` parameter type is broader than necessary

**File:** `packages/mcp-provider-dx-core/src/tools/describe_object.ts:83`
**Issue:** The function signature accepts `SchemaEntry` (a union type) but only works correctly with `FullDescribeEntry`. The `as FullDescribeEntry` cast at line 84 bypasses TypeScript's type checking. Narrowing the parameter type to `FullDescribeEntry` would catch misuse at compile time rather than runtime. (This is the type-level aspect of WR-01.)

**Fix:** Change the signature to accept `FullDescribeEntry` directly:
```typescript
function curateDescribeResult(entry: FullDescribeEntry, isCacheHit: boolean): CuratedDescribeResult {
```

---

### IN-02: Duplicate license header in index.ts

**File:** `packages/mcp-provider-dx-core/src/index.ts:1-31`
**Issue:** The file contains two identical Apache 2.0 license headers stacked on lines 1-15 and 17-31. This appears to be pre-existing (the phase only added the import and instantiation), but since the file is in review scope, flagging for cleanup.

**Fix:** Remove the duplicate license block (lines 17-31).

---

_Reviewed: 2026-04-12T16:03:12Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
