---
phase: 14-relationship-graph
reviewed: 2025-07-14T21:45:00Z
depth: deep
files_reviewed: 5
files_reviewed_list:
  - packages/mcp-provider-dx-core/src/schema/relationship-edges.ts
  - packages/mcp-provider-dx-core/src/schema/schema-service.ts
  - packages/mcp-provider-dx-core/src/tools/describe_object.ts
  - packages/mcp-provider-dx-core/src/tools/run_soql_query.ts
  - packages/mcp-provider-dx-core/src/schema/index.ts
findings:
  critical: 0
  warning: 2
  info: 3
  total: 5
status: issues_found
---

# Phase 14: Code Review Report

**Reviewed:** 2025-07-14T21:45:00Z
**Depth:** deep
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Phase 14 adds relationship graph extraction from Salesforce describe results and surfaces join/lookup hints in SOQL query responses. The implementation spans a clean pure-function extractor (`relationship-edges.ts`), new cache wrappers on `SchemaService`, and wiring in both `describe_object` and `run_soql_query` tools.

Overall quality is good. The pure extraction function is well-structured with clear handling of polymorphic references and null `relationshipName` filtering. Error boundaries are correctly placed — all edge extraction is wrapped in try/catch so it can never fail the primary tool operation (D-05 compliance). The `SchemaEntryType` discriminated union is extended cleanly with `RelationshipEdges`.

Two warnings found: (1) user-supplied object name casing leaks into cached edge data instead of using the canonical name from the describe result, and (2) the SOQL parser is invoked twice on the same query in the success path. Three minor info items around redundant formatting, a magic number, and shared LRU capacity.

No critical issues. No security vulnerabilities.

## Warnings

### WR-01: Edge `from` field uses user-supplied casing instead of canonical object name

**File:** `packages/mcp-provider-dx-core/src/tools/describe_object.ts:207`
**Issue:** `extractRelationshipEdges(input.objectName, ...)` passes the user-provided `input.objectName` as the `objectName` argument. This value becomes the `from` field on every outbound edge. However, the user may pass any casing (e.g., `"account"`, `"ACCOUNT"`), while the Salesforce-canonical name is available at `data.name` (used at line 113 for the curated result). The same pattern exists in `run_soql_query.ts:210` where the regex-captured `objectName` from the error message is used — though that one is more likely to already be canonical since Salesforce emits it.

When the edges are later retrieved in `run_soql_query.ts:155` and rendered as hints, the `from` field carries whatever casing was used at describe-time, producing inconsistent output like `account.AccountId -> Contact` instead of `Account.AccountId -> Contact`.

**Fix:**
```typescript
// describe_object.ts, line 207 — use canonical name from describe result
if (entry.type === SchemaEntryType.FullDescribe) {
  const canonicalName = (entry as FullDescribeEntry).data.name as string;
  const edges = extractRelationshipEdges(canonicalName, (entry as FullDescribeEntry).data);
  relationships = edges;
  if (edges.length > 0) {
    this.schemaService.setRelationships(orgUsername, input.objectName, edges);
  }
}
```

Note: `setRelationships` still takes `input.objectName` for the cache key (it gets lowercased internally), but the edge data itself uses the canonical name.

### WR-02: `parseSoqlFields` called twice on the same query in the success path

**File:** `packages/mcp-provider-dx-core/src/tools/run_soql_query.ts:149`
**Issue:** In the success path for non-tooling queries, `parseSoqlFields(input.query)` is called at line 121 (for auto-cache) and again at line 149 (for relationship suggestions). This duplicates parsing work and creates a maintenance risk — if the parser changes or the query is modified before one of the calls, the two invocations could diverge silently.

**Fix:** Hoist the parse result above both blocks and reuse it:
```typescript
// After the query succeeds, parse once:
const parsed = input.useToolingApi ? null : parseSoqlFields(input.query);

// Auto-cache block (existing, line 119+):
if (parsed) {
  try {
    const orgUsername = connection.getUsername() ?? input.usernameOrAlias;
    // ... existing auto-cache logic using `parsed` ...
  } catch {
    // silent
  }
}

// Relationship suggestions block (existing, line 146+):
if (parsed) {
  try {
    const orgUsername = connection.getUsername() ?? input.usernameOrAlias;
    const edges = this.schemaService.getRelationships(orgUsername, parsed.objectName);
    // ... existing hint logic ...
  } catch {
    // silent
  }
}
```

Note: `connection.getUsername()` is also called twice — the same hoisting pattern applies for `orgUsername`.

## Info

### IN-01: Redundant `via` field in relationship hint format string

**File:** `packages/mcp-provider-dx-core/src/tools/run_soql_query.ts:155`
**Issue:** The hint format `${e.from}.${e.via} -> ${e.to} (${e.type} via ${e.via})` includes the `via` field twice — once as `from.via` and once in the parenthetical. This produces output like:
```
Contact.AccountId -> Account (lookup via AccountId)
```
The `via AccountId` in the parenthetical is redundant since `AccountId` already appears in `Contact.AccountId`.

**Fix:** Simplify to either:
```typescript
`${e.from}.${e.via} -> ${e.to} (${e.type})`
// => Contact.AccountId -> Account (lookup)
```
or:
```typescript
`${e.from} -> ${e.to} (${e.type} via ${e.via})`
// => Contact -> Account (lookup via AccountId)
```

### IN-02: Magic number for max relationship hints

**File:** `packages/mcp-provider-dx-core/src/tools/run_soql_query.ts:154`
**Issue:** The `edges.slice(0, 5)` limit is a hardcoded magic number. If this limit needs to change, it's buried in the middle of a method.

**Fix:** Extract to a named constant:
```typescript
const MAX_RELATIONSHIP_HINTS = 5;
// ...
const hints = edges.slice(0, MAX_RELATIONSHIP_HINTS).map(...)
```

### IN-03: Relationship entries share LRU capacity with describe entries

**File:** `packages/mcp-provider-dx-core/src/schema/schema-service.ts:92-110`
**Issue:** Relationship edge entries are stored in the same per-org LRU cache (max 100 entries) as describe entries, using synthetic keys like `__relationships__account`. Each described object now consumes 2 LRU slots (one for the describe, one for the edges), effectively reducing maximum cached objects from 100 to ~50 before eviction begins. This is a reasonable trade-off for Phase 14 but worth noting for future capacity planning.

**Fix:** No immediate fix needed. If capacity becomes a concern, relationship edges could be stored in a separate lightweight Map (they're derived data, not API results) or the LRU max could be increased.

---

_Reviewed: 2025-07-14T21:45:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: deep_
