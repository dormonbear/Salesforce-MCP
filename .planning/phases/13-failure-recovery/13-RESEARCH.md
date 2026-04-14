# Phase 13: Failure Recovery - Research

**Researched:** 2026-04-12
**Domain:** SOQL error interception, Levenshtein fuzzy matching, schema auto-describe on failure
**Confidence:** HIGH

## Summary

Phase 13 adds intelligent failure recovery to the SOQL query tool. When a query fails with `INVALID_FIELD`, the system automatically describes the failing object (via `connection.describe()`), fuzzy-matches the invalid field name against actual field names using Levenshtein distance, and returns up to 3 ranked suggestions alongside the original error. The fresh describe result is automatically cached in SchemaService.

All infrastructure needed for this phase already exists: `SchemaService.describeAndCache()` handles single-flight coalescing and caching (Phase 10), `describe_object.ts` shows the exact pattern for calling `connection.describe()` and constructing a `FullDescribeEntry`, and the error handling chain (jsforce → SfError → toolError) is well-established. The only new code is (1) a pure Levenshtein distance function, (2) a `findSimilarFields` helper, and (3) an INVALID_FIELD detection + suggestion block in `run_soql_query.ts`'s catch clause.

**Primary recommendation:** Implement Levenshtein as a standalone pure-function module (`levenshtein.ts`), then add a focused error interception block in the existing catch of `QueryOrgMcpTool.exec()` — roughly 15-25 lines of new logic in the tool, plus ~40 lines for the Levenshtein module.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Detect INVALID_FIELD errors by checking `SfError.name === 'INVALID_FIELD'` or matching the error message pattern `No such column '...' on entity '...'` (Salesforce returns both patterns). The check lives in the existing catch block of `QueryOrgMcpTool.exec()`.
- **D-02:** Extract the invalid field name and object name from the error message using regex: `No such column '(\w+)' on entity '(\w+)'`. If extraction fails, fall back to using the SOQL parser's object name and the full error message without suggestions.
- **D-03:** On INVALID_FIELD detection, call `this.schemaService.describeAndCache()` with the extracted object name. This leverages the existing single-flight coalescing (from Phase 10) to prevent redundant API calls when multiple parallel queries fail on the same object.
- **D-04:** The describe call is `await` (not fire-and-forget) because we need the field names for suggestions. The latency cost is acceptable since the query already failed.
- **D-05:** If the describe also fails (e.g., object doesn't exist), fall back to the original error message without suggestions.
- **D-06:** Implement Levenshtein distance as a pure function in `packages/mcp-provider-dx-core/src/schema/levenshtein.ts`. No external dependencies — inline implementation.
- **D-07:** The fuzzy match function signature: `findSimilarFields(needle: string, fieldNames: string[], maxResults?: number): string[]`. Returns field names sorted by ascending Levenshtein distance, limited to `maxResults` (default 3).
- **D-08:** Use case-insensitive comparison for fuzzy matching (lowercase both the needle and candidate field names for distance calculation, but return original-case field names).
- **D-09:** Filter out results where Levenshtein distance exceeds a threshold (e.g., distance > Math.max(needle.length * 0.6, 3)) to avoid suggesting completely unrelated fields.
- **D-10:** Format the enhanced error response as: original error message + `"\n\nDid you mean: Field1, Field2, Field3?"`. Include up to 3 suggestions. If no close matches found, return the original error with the generic recovery hint.
- **D-11:** Store the fresh describe result in SchemaService as a FullDescribeEntry (already handled by describeAndCache). The requirement FAIL-04 is satisfied automatically.
- **D-12:** New file: `src/schema/levenshtein.ts` — Levenshtein distance + findSimilarFields
- **D-13:** Modify: `src/tools/run_soql_query.ts` — Add INVALID_FIELD detection + auto-describe + suggestion logic in catch block
- **D-14:** No changes needed to describe_object.ts, index.ts, or SchemaService — all infrastructure already exists.

### Agent's Discretion
- Exact Levenshtein implementation variant (standard dynamic programming)
- Whether to include the distance value in the suggestion output
- Exact threshold formula for filtering poor matches

### Deferred Ideas (OUT OF SCOPE)
- MALFORMED_QUERY error recovery (syntax suggestions) → future phase if needed
- Fuzzy matching for object names (not just field names) → Phase 14 or future
- Using fuse.js for ranked scoring → only if Levenshtein proves insufficient
- Caching field suggestions for repeated failures → not needed, describe result is already cached
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FAIL-01 | On `INVALID_FIELD` SOQL error, auto-call `connection.describe()` for the failing object | Error detection via `sfErr.name === 'INVALID_FIELD'` confirmed by jsforce `HttpApiError` chain (sets `name = errorCode`). Describe call uses existing `describeAndCache()` + `connection.describe()` pattern from `describe_object.ts`. |
| FAIL-02 | Fuzzy-match the failing field name against actual field names using Levenshtein distance (no external vector dependencies) | Pure inline Levenshtein DP implementation. Field names extracted from `FullDescribeEntry.data.fields.map(f => f.name)` — pattern verified in `describe_object.ts` line 89. |
| FAIL-03 | Return top 3 field suggestions ranked by similarity alongside the original error message | `findSimilarFields()` returns sorted results limited to maxResults (default 3). Output appended to error message as `"\n\nDid you mean: Field1, Field2, Field3?"`. |
| FAIL-04 | Update schema cache with the fresh describe result from the failure recovery path | Automatically satisfied by `describeAndCache()` — it calls `this.set()` on the result before returning (verified in `schema-service.ts` line 120). |
</phase_requirements>

## Standard Stack

### Core (already in project)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@salesforce/core` | ^8.24.3 | `SfError.wrap`, `Connection.describe()` | Already used throughout; provides error classification and Salesforce API access |
| `@dormon/mcp-provider-api` | workspace | `toolError`, `classifyError` | Project error response format |
| `lru-cache` | (already installed) | SchemaService cache backend | Already used by SchemaService |

### No New Dependencies
This phase requires **zero new npm packages**. Levenshtein is implemented inline per D-06 and the project roadmap decision. [VERIFIED: codebase grep shows no existing fuzzy-match dependencies]

## Architecture Patterns

### Recommended File Structure
```
packages/mcp-provider-dx-core/src/schema/
├── levenshtein.ts        # NEW: levenshtein() + findSimilarFields() — pure functions
├── schema-service.ts     # UNCHANGED: describeAndCache with single-flight
├── soql-parser.ts        # UNCHANGED: used as fallback for object name extraction
├── types.ts              # UNCHANGED: FullDescribeEntry type
├── disk-persistence.ts   # UNCHANGED
└── index.ts              # MODIFIED: re-export findSimilarFields

packages/mcp-provider-dx-core/src/tools/
└── run_soql_query.ts     # MODIFIED: INVALID_FIELD interception in catch block

packages/mcp-provider-dx-core/test/unit/schema/
├── levenshtein.test.ts   # NEW: pure function tests
└── failure-recovery.test.ts  # NEW: integration test for INVALID_FIELD flow
```

### Pattern 1: Error Interception in Catch Block
**What:** Detect specific error types in the existing catch, attempt recovery, and return enhanced error responses.
**When to use:** When a known error class can be programmatically addressed with additional API calls.
**Source:** Existing pattern in `run_soql_query.ts` lines 141-148 (the `'is not supported.'` check) [VERIFIED: codebase]

```typescript
// In the existing catch block of QueryOrgMcpTool.exec(), AFTER SfError.wrap:
catch (error) {
  const sfErr = SfError.wrap(error);

  // INVALID_FIELD recovery — auto-describe + fuzzy match suggestions
  if (sfErr.name === 'INVALID_FIELD' || /No such column '(\w+)' on entity '(\w+)'/i.test(sfErr.message)) {
    // Extract field name and object name from error message
    const match = sfErr.message.match(/No such column '(\w+)' on entity '(\w+)'/i);
    if (match) {
      const [, invalidField, objectName] = match;
      try {
        const orgUsername = connection.getUsername() ?? input.usernameOrAlias;
        const entry = await this.schemaService.describeAndCache(
          orgUsername,
          objectName,
          async () => ({
            type: SchemaEntryType.FullDescribe,
            data: (await connection.describe(objectName)) as unknown as Record<string, unknown>,
            cachedAt: Date.now(),
          } satisfies FullDescribeEntry),
        );
        const allFields = ((entry as FullDescribeEntry).data.fields as Array<{ name: string }>).map(f => f.name);
        const suggestions = findSimilarFields(invalidField, allFields, 3);
        const hint = suggestions.length > 0
          ? `Did you mean: ${suggestions.join(', ')}?`
          : 'Use salesforce_describe_object to verify available fields on the target object.';
        return toolError(`Failed to query org: ${sfErr.message}`, {
          recovery: hint,
          category: 'user',
        });
      } catch {
        // Describe also failed — fall through to generic error
      }
    }
  }
  // ... existing error handling continues
}
```

### Pattern 2: Levenshtein Distance — Standard DP with O(n·m) Space Optimization
**What:** Classic Wagner-Fischer dynamic programming algorithm for edit distance, with optional single-row optimization.
**When to use:** When comparing a single needle against many candidates (field name fuzzy matching).

```typescript
// levenshtein.ts — pure function, no external deps
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Single-row DP optimization: O(min(a,b)) space
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  let curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,      // insertion
        prev[j] + 1,           // deletion
        prev[j - 1] + cost,    // substitution
      );
    }
    [prev, curr] = [curr, prev]; // swap rows
  }
  return prev[b.length];
}
```

### Pattern 3: findSimilarFields — Case-Insensitive Sort + Filter
**What:** Wrapper that applies Levenshtein case-insensitively, filters by distance threshold, sorts by distance, and returns original-case field names.

```typescript
export function findSimilarFields(
  needle: string,
  fieldNames: string[],
  maxResults: number = 3,
): string[] {
  const needleLower = needle.toLowerCase();
  const threshold = Math.max(needle.length * 0.6, 3);

  return fieldNames
    .map(name => ({ name, distance: levenshtein(needleLower, name.toLowerCase()) }))
    .filter(({ distance }) => distance <= threshold)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxResults)
    .map(({ name }) => name);
}
```

### Pattern 4: Connection Scope in Catch Block
**What:** The `connection` variable must be accessible in the catch block for the describe call.
**Critical detail:** In the current code, `connection` is declared inside the try block (line 99). For the INVALID_FIELD handler to call `connection.describe()`, the connection must either be hoisted above the try or re-acquired in the catch. [VERIFIED: `run_soql_query.ts` lines 93-99]

**Recommended approach:** Declare `connection` before the try block or re-acquire it. The simplest approach:
```typescript
// Option A: Move connection outside try
const connection = await this.services.getOrgService().getConnection(input.usernameOrAlias);
try {
  // ...query logic
} catch (error) {
  // connection is accessible here
}

// Option B: Re-acquire in catch (extra call, but simple)
// const connection = await this.services.getOrgService().getConnection(input.usernameOrAlias);
```

Option A is cleaner. The `getConnection()` call itself can throw (e.g., org not found), which should be handled by a wrapping try-catch or an early return guard.

### Anti-Patterns to Avoid
- **Fire-and-forget describe on failure path:** D-04 explicitly requires `await` — we need the field names for suggestions.
- **Custom caching in the catch block:** `describeAndCache()` already handles caching (D-11/FAIL-04). Don't call `schemaService.set()` separately.
- **Case-sensitive comparison:** D-08 requires case-insensitive Levenshtein. Compare `.toLowerCase()` versions but return original-case names.
- **External fuzzy-match library:** D-06 and the v1.3 roadmap decision explicitly forbid external dependencies for this. Inline implementation only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Single-flight describe coalescing | Custom in-flight tracking | `schemaService.describeAndCache()` | Already implements promise-based single-flight with `inFlight` Map (Phase 10) |
| Describe result caching | Manual cache.set() in catch | `describeAndCache()` return flow | It calls `this.set()` internally on line 120 of schema-service.ts |
| Error classification | Custom error type checking | `classifyError(sfErr)` from `@dormon/mcp-provider-api` | Already classifies INVALID_FIELD as 'user' error category |
| Error response formatting | Custom response objects | `toolError()` with recovery hint | Standardized `[USER_ERROR]` / `[RECOVERY]` format |

**Key insight:** Phase 10-12 built all the infrastructure needed. This phase adds ~60 lines of new code: a Levenshtein module and an error interception block. Don't re-implement what exists.

## Common Pitfalls

### Pitfall 1: Connection Variable Scoping
**What goes wrong:** `connection` is declared inside the `try` block (line 99) so it's not accessible in the `catch` block where INVALID_FIELD recovery needs to call `connection.describe()`.
**Why it happens:** The original code didn't need the connection in the catch block.
**How to avoid:** Restructure so `connection` is declared outside the try block, or re-acquire it in the catch block. If moving connection outside try, add a guard for the `!input.usernameOrAlias` early return before the try.
**Warning signs:** TypeScript will catch this at compile time — `connection` is `undefined` in catch scope.

### Pitfall 2: Regex Extraction Failure for Non-Standard Error Messages
**What goes wrong:** Salesforce error messages vary. The regex `No such column '(\w+)' on entity '(\w+)'` may not match all INVALID_FIELD errors. Some may use different quoting or include additional context.
**Why it happens:** Salesforce API error message format is not contractually stable.
**How to avoid:** Use `sfErr.name === 'INVALID_FIELD'` as the primary detection (this is the stable `errorCode`). Only use regex for field/object extraction. If regex fails, fall back to SOQL parser for object name and skip suggestions (D-02).
**Warning signs:** Tests pass with known error formats but fail against real Salesforce errors with different phrasing.

### Pitfall 3: FullDescribeEntry Type Narrowing
**What goes wrong:** `describeAndCache()` returns `SchemaEntry` (union type), but we need `FullDescribeEntry.data.fields`. Without type narrowing, TypeScript won't allow field access.
**Why it happens:** The cache can hold different entry types (full, partial, relationship).
**How to avoid:** Since we're passing a `describeFn` that explicitly constructs a `FullDescribeEntry`, we know the result type. But the cache may already contain a `PartialFieldsEntry` for this object (from auto-cache). However, `describeAndCache()` checks cache first — if a partial entry exists, it'll return that instead of calling describe. Need to either: (a) invalidate the partial entry first (like describe_object.ts does on line 181), or (b) check the returned entry type and only extract fields from FullDescribeEntry.
**Warning signs:** Getting a `PartialFieldsEntry` back from `describeAndCache()` which has `fieldNames: string[]` but not the full `data.fields` array. Partial entries have a limited field list (only previously queried fields), not all fields for fuzzy matching.

### Pitfall 4: Partial Cache Entry Blocks Full Describe
**What goes wrong:** `describeAndCache()` returns a cached `PartialFieldsEntry` (from Phase 12 auto-cache) instead of performing a full describe, because `this.get()` finds the existing entry.
**Why it happens:** `describeAndCache()` line 103-106 returns ANY cached entry, including partial ones. It doesn't distinguish entry types.
**How to avoid:** Before calling `describeAndCache()`, check if the existing entry is partial and invalidate it (same pattern as `describe_object.ts` lines 180-181). This forces a fresh API call.
**Warning signs:** Suggestions are limited to previously-queried fields instead of all fields on the object.

**This is the most critical pitfall for correctness.** The existing `describe_object.ts` already has this pattern:
```typescript
if (cached && cached.type !== SchemaEntryType.FullDescribe) {
  this.schemaService.invalidate(orgUsername, input.objectName);
}
```

### Pitfall 5: Levenshtein Threshold Too Strict or Too Loose
**What goes wrong:** Threshold filters out valid suggestions (too strict) or includes irrelevant ones (too loose).
**Why it happens:** Short field names (e.g., "Id", "Name") have small absolute distances to many other short strings.
**How to avoid:** The threshold `Math.max(needle.length * 0.6, 3)` provides a reasonable floor of 3 edits (good for short names) and scales with longer names. Test with realistic Salesforce field names.
**Warning signs:** "Id" typo'd as "Ix" suggests 50 unrelated fields; or "AccountNaem" gets no suggestions.

## Code Examples

### Complete Levenshtein Module
```typescript
// Source: Standard Wagner-Fischer algorithm, single-row DP optimization
// File: packages/mcp-provider-dx-core/src/schema/levenshtein.ts

/**
 * Compute Levenshtein edit distance between two strings.
 * Uses single-row DP optimization for O(min(a.length, b.length)) space.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure a is the shorter string for space optimization
  if (a.length > b.length) [a, b] = [b, a];

  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  let curr = new Array<number>(a.length + 1);

  for (let j = 1; j <= b.length; j++) {
    curr[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[i] = Math.min(
        curr[i - 1] + 1,      // insertion
        prev[i] + 1,           // deletion
        prev[i - 1] + cost,    // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }
  return prev[a.length];
}

/**
 * Find field names most similar to the needle, ranked by Levenshtein distance.
 * Comparison is case-insensitive; returned names preserve original casing.
 */
export function findSimilarFields(
  needle: string,
  fieldNames: string[],
  maxResults: number = 3,
): string[] {
  const needleLower = needle.toLowerCase();
  const threshold = Math.max(Math.ceil(needle.length * 0.6), 3);

  return fieldNames
    .map(name => ({ name, distance: levenshtein(needleLower, name.toLowerCase()) }))
    .filter(({ distance }) => distance <= threshold)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxResults)
    .map(({ name }) => name);
}
```

### INVALID_FIELD Interception Pattern (in catch block)
```typescript
// Source: Derived from existing describe_object.ts pattern + CONTEXT.md decisions
// Added to the catch block of QueryOrgMcpTool.exec()

// Detect INVALID_FIELD (D-01)
if (sfErr.name === 'INVALID_FIELD' || /No such column '\w+' on entity '\w+'/i.test(sfErr.message)) {
  const fieldMatch = sfErr.message.match(/No such column '(\w+)' on entity '(\w+)'/i);
  if (fieldMatch) {
    const [, invalidField, objectName] = fieldMatch;
    try {
      const orgUsername = connection.getUsername() ?? input.usernameOrAlias;

      // Invalidate partial entry so describeAndCache does a full describe (Pitfall 4)
      const cached = this.schemaService.get(orgUsername, objectName);
      if (cached && cached.type !== SchemaEntryType.FullDescribe) {
        this.schemaService.invalidate(orgUsername, objectName);
      }

      // Auto-describe — single-flight coalesced + cached (FAIL-01, FAIL-04)
      const entry = await this.schemaService.describeAndCache(
        orgUsername,
        objectName,
        async () => ({
          type: SchemaEntryType.FullDescribe,
          data: (await connection.describe(objectName)) as unknown as Record<string, unknown>,
          cachedAt: Date.now(),
        } satisfies FullDescribeEntry),
      );

      // Extract field names and fuzzy match (FAIL-02, FAIL-03)
      if (entry.type === SchemaEntryType.FullDescribe) {
        const allFields = (entry.data.fields as Array<{ name: string }>).map(f => f.name);
        const suggestions = findSimilarFields(invalidField, allFields, 3);
        const recovery = suggestions.length > 0
          ? `Did you mean: ${suggestions.join(', ')}?`
          : 'Use salesforce_describe_object to verify available fields on the target object.';
        return toolError(`Failed to query org: ${sfErr.message}`, { recovery, category: 'user' });
      }
    } catch {
      // Describe failed — fall through to generic error (D-05)
    }
  }
}
```

### Re-exporting from index.ts
```typescript
// Add to packages/mcp-provider-dx-core/src/schema/index.ts
export { levenshtein, findSimilarFields } from './levenshtein.js';
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Return raw Salesforce error | Return error + recovery hints | Phase 7 (ERR-01) | AI agents get actionable guidance |
| Manual describe before querying | Auto-cache on success + auto-describe on failure | Phase 12-13 | Progressive schema knowledge with zero extra API calls on success path |

**Not applicable:**
- External fuzzy match libraries (fuse.js, fastest-levenshtein) — roadmap decision prohibits external deps for this use case [VERIFIED: CONTEXT.md, STATE.md]

## Assumptions Log

> List all claims tagged `[ASSUMED]` in this research. The planner and discuss-phase use this
> section to identify decisions that need user confirmation before execution.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Salesforce INVALID_FIELD error message always follows the pattern `No such column '<name>' on entity '<name>'` for field name extraction | Error Detection | If format varies, regex extraction fails — but fallback to generic error is safe (D-02) |
| A2 | `\w+` in the regex is sufficient to match all Salesforce field API names (including custom fields with `__c` suffix) | Error Detection | `\w+` matches `[a-zA-Z0-9_]` which covers standard and custom field names including `__c`. Double-underscore custom fields like `Namespace__Field__c` are also matched. LOW risk. |

**If this table is empty:** Most claims in this research were verified against the codebase.

## Open Questions

1. **Should the distance value be included in suggestion output?**
   - What we know: D-10 specifies format as `"Did you mean: Field1, Field2, Field3?"` (no distance shown)
   - What's unclear: Whether showing distance (e.g., `"Name (1 edit)"`) helps AI agents make better choices
   - Recommendation: Start without distance values per D-10. Agent's discretion area — can add later if useful.

2. **`\w+` vs more permissive regex for field name extraction**
   - What we know: Standard Salesforce field API names use `[a-zA-Z0-9_]` characters. Custom fields end with `__c`.
   - What's unclear: Whether any edge cases exist (e.g., fields with non-ASCII names in localized orgs)
   - Recommendation: Use `\w+` — it matches all standard API names. If edge cases arise, the fallback to generic error (D-02) handles them safely.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | mocha + chai + sinon (ts-node/esm) |
| Config file | `packages/mcp-provider-dx-core/.mocharc.json` |
| Quick run command | `cd packages/mcp-provider-dx-core && npx mocha "test/unit/schema/levenshtein.test.ts" --timeout 5000` |
| Full suite command | `cd packages/mcp-provider-dx-core && yarn test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FAIL-01 | On INVALID_FIELD error, auto-call describe for failing object | unit | `npx mocha "test/unit/schema/failure-recovery.test.ts" --timeout 5000 --grep "auto-describe"` | ❌ Wave 0 |
| FAIL-02 | Fuzzy-match failing field via Levenshtein distance | unit | `npx mocha "test/unit/schema/levenshtein.test.ts" --timeout 5000` | ❌ Wave 0 |
| FAIL-03 | Return top 3 suggestions ranked by similarity | unit | `npx mocha "test/unit/schema/failure-recovery.test.ts" --timeout 5000 --grep "suggestions"` | ❌ Wave 0 |
| FAIL-04 | Cache fresh describe result from failure path | unit | `npx mocha "test/unit/schema/failure-recovery.test.ts" --timeout 5000 --grep "cache"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cd packages/mcp-provider-dx-core && npx mocha "test/unit/schema/levenshtein.test.ts" "test/unit/schema/failure-recovery.test.ts" --timeout 5000`
- **Per wave merge:** `cd packages/mcp-provider-dx-core && yarn test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/unit/schema/levenshtein.test.ts` — covers FAIL-02 (Levenshtein distance + findSimilarFields)
- [ ] `test/unit/schema/failure-recovery.test.ts` — covers FAIL-01, FAIL-03, FAIL-04 (INVALID_FIELD detection, suggestions, caching)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A — no auth changes |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A — uses existing connection permissions |
| V5 Input Validation | yes | Regex extraction from error messages — bounded, no user-controlled injection vector |
| V6 Cryptography | no | N/A |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Error message information disclosure | Information Disclosure | Error messages already contain field/object names from Salesforce API response — no new exposure. Suggestions only include actual field names the user would discover via describe_object anyway. |
| ReDoS via crafted error message | Tampering | The regex `/No such column '(\w+)' on entity '(\w+)'/i` uses non-backtracking `\w+` — not vulnerable to catastrophic backtracking. |

## Sources

### Primary (HIGH confidence)
- `packages/mcp-provider-dx-core/src/tools/run_soql_query.ts` — Current catch block, connection usage, auto-cache pattern
- `packages/mcp-provider-dx-core/src/schema/schema-service.ts` — `describeAndCache()` implementation with single-flight coalescing
- `packages/mcp-provider-dx-core/src/tools/describe_object.ts` — Pattern for calling `connection.describe()` and constructing `FullDescribeEntry`, partial entry invalidation pattern
- `packages/mcp-provider-dx-core/src/schema/types.ts` — `FullDescribeEntry`, `SchemaEntryType` definitions
- `packages/mcp-provider-api/src/errors.ts` — `toolError()`, `classifyError()` signatures, `INVALID_FIELD` in `USER_ERROR_NAMES`
- `@jsforce/jsforce-node/lib/http-api.js` line 325 — `HttpApiError` sets `this.name = errorCode`, confirming `INVALID_FIELD` propagation
- `@salesforce/core/lib/sfError.js` — `SfError.wrap` preserves `err.name` via `fromBasicError`
- `packages/mcp-provider-dx-core/test/unit/schema/auto-cache-hook.test.ts` — Test patterns (mocha/chai/sinon, mock services, stub connection)

### Secondary (MEDIUM confidence)
- Wagner-Fischer algorithm for Levenshtein distance — well-established computer science algorithm, standard DP implementation [ASSUMED: algorithm correctness, but trivially verifiable]

### Tertiary (LOW confidence)
- Salesforce error message format `No such column '<name>' on entity '<name>'` — based on documented typical format in CONTEXT.md specifics section. Format may vary across API versions. [ASSUMED: A1]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries already in project, zero new deps
- Architecture: HIGH — follows existing patterns from describe_object.ts and auto-cache-hook
- Pitfalls: HIGH — all 5 pitfalls verified against actual codebase (especially Pitfall 4 about partial cache blocking)
- Levenshtein implementation: HIGH — standard algorithm, trivially testable

**Research date:** 2026-04-12
**Valid until:** 2026-05-12 (stable — no moving parts, all dependencies locked)
