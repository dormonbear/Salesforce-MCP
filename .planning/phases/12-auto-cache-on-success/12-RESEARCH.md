# Phase 12: Auto-Cache on Success - Research

**Researched:** 2026-04-12
**Domain:** SOQL parsing, schema cache integration, TypeScript regex
**Confidence:** HIGH

## Summary

Phase 12 adds zero-cost progressive schema enrichment: after every successful SOQL query, the queried object name and field names are extracted from the query string and stored as a `PartialFieldsEntry` in SchemaService. This requires three components: (1) a lightweight regex-based SOQL parser, (2) a post-success hook in `QueryOrgMcpTool.exec()`, and (3) merge logic for partial-to-partial field unions and partial-to-full promotion.

The codebase is well-prepared for this change. Phase 10 already defines the `PartialFieldsEntry` type and SchemaService APIs (`get`, `set`). Phase 11 established the constructor injection pattern for SchemaService in `DescribeObjectMcpTool`. The main implementation work is the SOQL parser (new file) and the hook wiring (modifying `QueryOrgMcpTool` and `DxCoreMcpProvider`).

**Critical finding:** `describeAndCache()` currently returns ANY cached entry as a hit, including `PartialFieldsEntry`. Phase 12 introduces partial entries for the first time, which means `describe_object` will break if a partial entry exists when `describeAndCache()` is called — `curateDescribeResult()` casts to `FullDescribeEntry` and accesses `.data` which is `undefined` on partials. Phase 12 must fix this promotion path to satisfy ACCH-03.

**Primary recommendation:** Implement in three focused waves: (1) SOQL parser with comprehensive unit tests, (2) hook wiring + merge logic in QueryOrgMcpTool, (3) fix the partial→full promotion path in describe_object to handle the new partial entries.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Implement a lightweight regex-based SOQL parser, not a full AST parser. The scope is limited to extracting `SELECT field1, field2 FROM ObjectName` — no need for a grammar library. Regex is sufficient for flat queries and avoids new dependencies.
- **D-02:** The parser extracts: (1) the sObject name from the FROM clause, (2) the field names from the SELECT clause. It returns `{ objectName: string; fieldNames: string[] } | null` — null means the query was too complex to parse safely.
- **D-03:** Gracefully skip (return null) for: subqueries (nested SELECT), aggregate functions (COUNT, SUM, etc.), GROUP BY, TYPEOF, multi-FROM (relationships like `SELECT Contact.Name FROM Account`). These require full AST parsing and are out of scope. No error thrown — silent skip.
- **D-04:** The parser is a pure function in a standalone file: `packages/mcp-provider-dx-core/src/schema/soql-parser.ts`. No class needed — export a single function `parseSoqlFields(query: string): ParsedSoql | null`.
- **D-05:** Parser handles case-insensitivity (SELECT vs select), extra whitespace, and aliases (SELECT Name n FROM Account → field is "Name", not "n"). Field aliases should be stripped.
- **D-06:** On successful SOQL query, call the parser. If parser returns non-null, store as `PartialFieldsEntry` in SchemaService via `schemaService.set(orgUsername, objectName, entry)`. This is zero API calls — we already have the field names from the query itself.
- **D-07:** The hook lives inside `QueryOrgMcpTool.exec()` — after the successful query returns but before the response is built. SchemaService is injected into QueryOrgMcpTool via constructor (same pattern as DescribeObjectMcpTool from Phase 11).
- **D-08:** The hook is fire-and-forget. If parsing fails or cache set throws, silently ignore — never fail a successful query because of caching. Wrap in try/catch with no re-throw.
- **D-09:** When a `PartialFieldsEntry` exists in cache and a `FullDescribeEntry` is later stored for the same object (via `salesforce_describe_object`), the full entry replaces the partial entry entirely. SchemaService.set() already overwrites — no special merge logic needed in SchemaService itself.
- **D-10:** When a `PartialFieldsEntry` exists and another SOQL query adds more fields for the same object, the field lists are merged (union). The new partial entry's `fieldNames` is the union of old and new field names.
- **D-11:** The merge happens at the cache-set call site in the hook, not in SchemaService. Before calling `set()`, check if a PartialFieldsEntry already exists for the same org+object, and if so, merge fieldNames.
- **D-12:** `QueryOrgMcpTool` constructor changes from `(services: Services)` to `(services: Services, schemaService: SchemaService)`.
- **D-13:** Update `DxCoreMcpProvider.provideTools()` to pass `schemaService` to `new QueryOrgMcpTool(services, schemaService)`.

### Agent's Discretion
- Internal naming of helper variables in the hook
- Whether to log cache-set activity to debug console
- Exact regex pattern construction (as long as it passes the test cases)

### Deferred Ideas (OUT OF SCOPE)
- Full AST SOQL parser with subquery support → Phase 14+ if needed
- Caching on failed queries (error recovery uses schema to suggest corrections) → Phase 13
- Tooling API query caching → future if needed (different metadata set)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ACCH-01 | Successful SOQL queries auto-cache the queried object name and field names as a partial schema entry (zero extra API calls) | Hook in QueryOrgMcpTool.exec() using parseSoqlFields() + schemaService.set(); no API calls needed since field names come from SOQL string itself |
| ACCH-02 | SOQL FROM clause and SELECT field list are parsed from the query string on success | New `parseSoqlFields()` pure function with regex extraction; returns null for complex queries |
| ACCH-03 | Partial cache entries are merged with full describe results when both exist (full describe wins on conflict) | Partial→partial merge via fieldNames union at hook call site; partial→full promotion requires fixing describeAndCache to skip partials so describe_object fetches fresh API data |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| mocha | 11.7.2 | Test runner | Already in devDependencies, all existing tests use it [VERIFIED: package.json] |
| chai | ^4.3.10 | Assertions | Already in devDependencies, BDD-style expect assertions [VERIFIED: package.json] |
| sinon | 10.0.0 | Stubs/spies | Already in devDependencies, used for mocking SchemaService and Services [VERIFIED: package.json] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lru-cache | ^11.1.0 | In-memory cache | Already used by SchemaService — no new usage needed [VERIFIED: package.json] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Regex SOQL parser | `soql-parser-js` npm package | Full AST parser, adds external dependency — rejected per D-01 |
| Regex SOQL parser | Manual string splitting | More fragile than regex; regex handles case-insensitivity and whitespace natively |

**No new dependencies needed.** Phase 12 is a code-only change within existing infrastructure.

## Architecture Patterns

### Recommended Project Structure
```
packages/mcp-provider-dx-core/src/schema/
├── soql-parser.ts       # NEW: parseSoqlFields() pure function
├── schema-service.ts    # EXISTING: get(), set() — no changes needed
├── types.ts             # EXISTING: PartialFieldsEntry type already defined
├── disk-persistence.ts  # EXISTING: no changes
└── index.ts             # MODIFY: re-export parseSoqlFields

packages/mcp-provider-dx-core/src/tools/
├── run_soql_query.ts    # MODIFY: add SchemaService injection + auto-cache hook
└── describe_object.ts   # MODIFY: handle partial entries in describeAndCache path

packages/mcp-provider-dx-core/src/
└── index.ts             # MODIFY: pass schemaService to QueryOrgMcpTool

packages/mcp-provider-dx-core/test/unit/schema/
├── soql-parser.test.ts  # NEW: comprehensive parser unit tests
└── auto-cache-hook.test.ts  # NEW: hook integration tests
```

### Pattern 1: Pure Function Parser
**What:** `parseSoqlFields(query: string): ParsedSoql | null` — a standalone pure function with no side effects [VERIFIED: D-04 from CONTEXT.md]
**When to use:** Every successful SOQL query result in QueryOrgMcpTool.exec()
**Example:**
```typescript
// Source: CONTEXT.md D-02, D-04
export type ParsedSoql = {
  objectName: string;
  fieldNames: string[];
};

export function parseSoqlFields(query: string): ParsedSoql | null {
  // Return null for complex queries (subqueries, aggregates, GROUP BY, TYPEOF)
  // Extract SELECT fields and FROM object for flat queries
}
```

### Pattern 2: Constructor Injection (SchemaService into Tools)
**What:** SchemaService passed as constructor parameter alongside Services [VERIFIED: describe_object.ts line 127-130]
**When to use:** Any tool that needs cache access
**Example:**
```typescript
// Source: describe_object.ts (existing Phase 11 pattern)
export class QueryOrgMcpTool extends McpTool<InputArgsShape, OutputArgsShape> {
  public constructor(
    private readonly services: Services,
    private readonly schemaService: SchemaService,
  ) {
    super();
  }
  // ...
}
```

### Pattern 3: Fire-and-Forget Hook
**What:** Auto-cache logic wrapped in try/catch with no re-throw — never fails a successful query [VERIFIED: D-08 from CONTEXT.md]
**When to use:** Post-success processing that is non-critical
**Example:**
```typescript
// Source: CONTEXT.md D-08
// Inside exec(), after successful query, before return:
try {
  const parsed = parseSoqlFields(input.query);
  if (parsed) {
    // merge + set partial entry
  }
} catch {
  // Silently ignore — caching failure must never fail the query
}
```

### Pattern 4: Partial Field Union at Call Site
**What:** Before storing a partial entry, check if one already exists and merge fieldNames [VERIFIED: D-10, D-11 from CONTEXT.md]
**When to use:** Every auto-cache set
**Example:**
```typescript
// Source: CONTEXT.md D-10, D-11
const existing = this.schemaService.get(orgUsername, parsed.objectName);
let fieldNames = parsed.fieldNames;

if (existing?.type === SchemaEntryType.PartialFields) {
  // Union of old and new field names
  fieldNames = [...new Set([...existing.fieldNames, ...fieldNames])];
}

this.schemaService.set(orgUsername, parsed.objectName, {
  type: SchemaEntryType.PartialFields,
  objectName: parsed.objectName,
  fieldNames,
  cachedAt: Date.now(),
});
```

### Anti-Patterns to Avoid
- **Modifying SchemaService for merge logic:** D-11 specifies merge happens at the hook call site, not inside SchemaService. Don't add merge methods to SchemaService.
- **Throwing from the auto-cache hook:** D-08 requires fire-and-forget. Any exception in parse or cache-set must be swallowed.
- **Full SOQL parsing:** D-01/D-03 explicitly reject full AST parsing. Return null for anything complex.
- **Overwriting FullDescribeEntry with PartialFieldsEntry:** If a full describe exists for an object, the auto-cache hook should NOT downgrade it to partial. Check entry type before set.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SOQL AST parsing | Full grammar parser | Simple regex extraction | D-01: regex sufficient for flat SELECT/FROM; complex queries return null |
| Set union (field merge) | Custom dedup loop | `[...new Set([...a, ...b])]` | JS Set handles deduplication natively; readable one-liner |
| Cache eviction/TTL | Custom expiry logic | Existing LRUCache in SchemaService | SchemaService already handles TTL and LRU eviction via `lru-cache` |

**Key insight:** The parser is intentionally limited. Complex SOQL (subqueries, aggregates) is out of scope — the parser returns null and the hook skips caching. This is a feature, not a bug.

## Common Pitfalls

### Pitfall 1: describeAndCache Returns Partial Entries as Cache Hits
**What goes wrong:** `describeAndCache()` (schema-service.ts:102-106) returns ANY cached entry including `PartialFieldsEntry`. When `describe_object` later calls `describeAndCache()`, it gets the partial entry back. `curateDescribeResult()` casts to `FullDescribeEntry` and accesses `.data` which is `undefined` on `PartialFieldsEntry` — causing a runtime crash. [VERIFIED: schema-service.ts line 103-104, describe_object.ts line 83-84]
**Why it happens:** Before Phase 12, no `PartialFieldsEntry` instances ever existed in the cache, so `describeAndCache()` only ever encountered `FullDescribeEntry` instances. Phase 12 introduces partial entries for the first time.
**How to avoid:** In `describe_object.ts`, before calling `describeAndCache()`, check if the cached entry is a `PartialFieldsEntry` and invalidate it so `describeAndCache()` proceeds to call the API. The describe_object test "should treat partial cache entries as cache miss" already documents the expected behavior (test/unit/schema/describe-object.test.ts:170-183). [VERIFIED: describe_object.test.ts line 170]
**Warning signs:** `TypeError: Cannot read properties of undefined (reading 'fields')` when describe_object is called after a SOQL query has been auto-cached.

### Pitfall 2: Overwriting Full Describe with Partial Entry
**What goes wrong:** If `describe_object` caches a `FullDescribeEntry` and then a SOQL query auto-caches a `PartialFieldsEntry` for the same object, the full entry is lost — `set()` overwrites unconditionally.
**Why it happens:** `SchemaService.set()` doesn't distinguish entry types on overwrite.
**How to avoid:** In the auto-cache hook, check the existing entry type before setting. If a `FullDescribeEntry` already exists, skip the partial write entirely — the full describe already has all field information and more.
**Warning signs:** describe_object returns stale/partial data after a successful SOQL query on the same object.

### Pitfall 3: Regex Captures Relationship Fields as Simple Fields
**What goes wrong:** `SELECT Account.Name, Id FROM Contact` — regex captures "Account.Name" as a field name. But "Account.Name" is a relationship traversal, not a field on Contact.
**Why it happens:** Naive regex doesn't distinguish dotted relationship paths from simple field names.
**How to avoid:** Per D-03 and the CONTEXT specifics section, filter out dotted field names (containing `.`) from the extracted field list. The CONTEXT specifies: extract "Id" and "Name" but skip "Account.Name" for `SELECT Id, Name, Account.Name FROM Contact`.
**Warning signs:** `PartialFieldsEntry.fieldNames` contains dotted names like "Account.Name" which aren't real fields on the FROM object.

### Pitfall 4: Alias Captured Instead of Field Name
**What goes wrong:** `SELECT Name n, Industry i FROM Account` — regex captures "n" and "i" instead of "Name" and "Industry".
**Why it happens:** SOQL allows field aliases. A naive comma-split approach captures the alias.
**How to avoid:** Per D-05, strip aliases by taking only the first token of each comma-separated field expression. `"Name n"` → field is `"Name"`, `"Industry i"` → field is `"Industry"`.
**Warning signs:** Single-character field names appearing in cache entries.

### Pitfall 5: Case Sensitivity in Object Names
**What goes wrong:** SOQL `FROM account` vs cache lookup for `Account` — miss due to case difference.
**Why it happens:** SOQL is case-insensitive but JavaScript string comparison isn't.
**How to avoid:** SchemaService already normalizes object names to lowercase via `objectName.toLowerCase()` in both `get()` and `set()` (schema-service.ts:79, 87). The parser output doesn't need normalization — SchemaService handles it. BUT: store the original-case objectName in `PartialFieldsEntry.objectName` for display purposes (matching existing PartialFieldsEntry type). [VERIFIED: schema-service.ts line 79, 87]
**Warning signs:** Cache misses that should be hits.

### Pitfall 6: Tooling API Queries Should NOT Be Cached
**What goes wrong:** Queries against tooling API (`connection.tooling.query()`) use different metadata objects (ApexClass, ApexTrigger, etc.) that aren't standard sObjects. Caching them as schema entries creates false field information.
**Why it happens:** `QueryOrgMcpTool.exec()` supports `useToolingApi` parameter. The auto-cache hook doesn't distinguish regular vs tooling queries.
**How to avoid:** Check `input.useToolingApi` in the hook — if true, skip auto-caching entirely. Tooling API objects have different field sets and shouldn't pollute the standard schema cache. This aligns with the deferred idea "Tooling API query caching → future if needed (different metadata set)". [VERIFIED: CONTEXT.md deferred ideas]
**Warning signs:** ApexClass, ApexTrigger, etc. appearing as cached sObjects with wrong field lists.

## Code Examples

Verified patterns from the existing codebase:

### Constructor Injection Pattern (from Phase 11)
```typescript
// Source: describe_object.ts lines 127-130 [VERIFIED]
export class DescribeObjectMcpTool extends McpTool<InputArgsShape, OutputArgsShape> {
  public constructor(
    private readonly services: Services,
    private readonly schemaService: SchemaService,
  ) {
    super();
  }
```

### Provider Wiring Pattern (from Phase 11)
```typescript
// Source: index.ts line 114 [VERIFIED]
new DescribeObjectMcpTool(services, schemaService),
```

### SchemaService.set() for Partial Entry
```typescript
// Source: types.ts lines 36-41, schema-service.ts line 85-89 [VERIFIED]
schemaService.set(orgUsername, objectName, {
  type: SchemaEntryType.PartialFields,
  objectName: objectName,
  fieldNames: ['Id', 'Name', 'Industry'],
  cachedAt: Date.now(),
} satisfies PartialFieldsEntry);
```

### Getting orgUsername from Connection (from describe_object)
```typescript
// Source: describe_object.ts line 172-173 [VERIFIED]
const connection = await this.services.getOrgService().getConnection(input.usernameOrAlias);
const orgUsername = connection.getUsername() ?? input.usernameOrAlias;
```

### Test Pattern: Mocking Services and SchemaService
```typescript
// Source: describe-object.test.ts lines 57-69 [VERIFIED]
function createMockServices(): { services: Services; connectionStub: sinon.SinonStub } {
  const connectionStub = sinon.stub().resolves(mockResult);
  const mockConnection = {
    describe: connectionStub,
    getUsername: sinon.stub().returns('user@test.org'),
  };
  const services = {
    getOrgService: () => ({
      getConnection: sinon.stub().resolves(mockConnection),
    }),
  } as unknown as Services;
  return { services, connectionStub };
}
```

## SOQL Regex Research

### Regex Strategy for Flat SELECT...FROM

The parser needs to handle these SOQL patterns:

**Valid (should parse):**
| Query | Expected Output |
|-------|----------------|
| `SELECT Id, Name FROM Account` | `{ objectName: 'Account', fieldNames: ['Id', 'Name'] }` |
| `select id, name from account` | `{ objectName: 'account', fieldNames: ['id', 'name'] }` |
| `SELECT  Id ,  Name  FROM  Account  WHERE Name = 'Test'` | `{ objectName: 'Account', fieldNames: ['Id', 'Name'] }` |
| `SELECT Name n, Industry i FROM Account` | `{ objectName: 'Account', fieldNames: ['Name', 'Industry'] }` |
| `SELECT Id FROM Account LIMIT 10` | `{ objectName: 'Account', fieldNames: ['Id'] }` |
| `SELECT Id, Name FROM Custom_Object__c` | `{ objectName: 'Custom_Object__c', fieldNames: ['Id', 'Name'] }` |

**Should skip (return null):**
| Query | Reason |
|-------|--------|
| `SELECT COUNT() FROM Account` | Aggregate function |
| `SELECT Id, (SELECT Id FROM Contacts) FROM Account` | Subquery |
| `SELECT Id FROM Account GROUP BY Industry` | GROUP BY |
| `SELECT TYPEOF What WHEN Account THEN Name END FROM Event` | TYPEOF |
| `SELECT Account.Name FROM Contact` | Relationship traversal only (no simple fields after filtering) |

**Regex approach (agent's discretion per CONTEXT):** [ASSUMED]
```typescript
// Step 1: Bail-out checks (quick string detection before regex)
// - Contains nested SELECT → null (subquery)
// - Contains COUNT(, SUM(, AVG(, MIN(, MAX( → null (aggregate)
// - Contains GROUP BY → null
// - Contains TYPEOF → null

// Step 2: Extract SELECT...FROM via case-insensitive regex
// Pattern: /SELECT\s+(.*?)\s+FROM\s+(\w+)/i
// Captures: group 1 = field list, group 2 = object name

// Step 3: Parse field list
// Split on commas, trim whitespace, take first token (strip alias)
// Filter out dotted names (relationship traversals like Account.Name)
```

**Edge cases to test:**
- WHERE clause contains string literals with SELECT/FROM keywords: `SELECT Id FROM Account WHERE Name = 'SELECT FROM'` [ASSUMED]
- Field names with underscores: `Custom_Field__c` [VERIFIED: standard SOQL]
- Multiple spaces and tabs between tokens [VERIFIED: D-05]
- Trailing semicolons or whitespace [ASSUMED]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No schema caching | Phase 10 added SchemaService with LRU + disk persistence | Phase 10 (v1.3) | Infrastructure ready for partial entries |
| No field awareness from queries | Phase 12 adds auto-cache from successful queries | Phase 12 (this phase) | Progressive schema enrichment with zero API cost |

## Assumptions Log

> List all claims tagged `[ASSUMED]` in this research. The planner and discuss-phase use this
> section to identify decisions that need user confirmation before execution.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Regex bail-out approach: check for subquery/aggregate/GROUP BY/TYPEOF via simple string contains before regex extraction | SOQL Regex Research | Low — approach is sound; exact implementation is agent's discretion per CONTEXT |
| A2 | WHERE clause string literals containing SOQL keywords (SELECT/FROM) need special handling | SOQL Regex Research | Medium — could cause false bail-outs or incorrect extraction if query contains `'SELECT'` in a string literal |
| A3 | Trailing semicolons should be handled by the parser | SOQL Regex Research | Low — SOQL through jsforce API typically doesn't include semicolons |

**If this table is empty:** N/A — three assumed items listed above.

## Open Questions

1. **String literals in WHERE clause**
   - What we know: `SELECT Id FROM Account WHERE Name = 'SELECT FROM'` has SOQL keywords inside a string literal
   - What's unclear: Should the bail-out checks be aware of string literals? A naive `query.includes('SELECT')` after the first SELECT would false-positive on this
   - Recommendation: Use the regex extraction approach (match only the structure between first SELECT and first FROM), not string-contains for the bail-out. For subquery detection, check for `(SELECT` specifically (open paren + SELECT), which won't appear in string literals in practice. Risk is LOW — this is an edge case unlikely in real AI-generated SOQL.

2. **Should Tooling API queries be auto-cached?**
   - What we know: CONTEXT defers "Tooling API query caching" to future. `useToolingApi` flag exists on QueryOrgMcpTool input.
   - What's unclear: The CONTEXT doesn't explicitly say "skip tooling API queries in the auto-cache hook"
   - Recommendation: Skip tooling API queries in the hook (check `input.useToolingApi`). Tooling objects (ApexClass, etc.) have different metadata than standard sObjects. Caching them would pollute the schema cache. This aligns with the deferred idea.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | mocha 11.7.2 + chai ^4.3.10 + sinon 10.0.0 |
| Config file | `.mocharc.json` (ESM loader via ts-node) |
| Quick run command | `cd packages/mcp-provider-dx-core && npx mocha "test/unit/schema/soql-parser.test.ts" --timeout 5000 --node-option=loader=ts-node/esm` |
| Full suite command | `cd packages/mcp-provider-dx-core && yarn test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ACCH-01 | Successful SOQL query auto-caches object+fields as partial entry | unit | `npx mocha "test/unit/schema/auto-cache-hook.test.ts" --timeout 5000 --node-option=loader=ts-node/esm` | ❌ Wave 0 |
| ACCH-02 | Parser extracts FROM object and SELECT fields from flat queries | unit | `npx mocha "test/unit/schema/soql-parser.test.ts" --timeout 5000 --node-option=loader=ts-node/esm` | ❌ Wave 0 |
| ACCH-02 | Parser returns null for complex queries (subquery, GROUP BY, TYPEOF) | unit | `npx mocha "test/unit/schema/soql-parser.test.ts" --timeout 5000 --node-option=loader=ts-node/esm` | ❌ Wave 0 |
| ACCH-03 | Partial entries merged with full describe (full wins on conflict) | unit | `npx mocha "test/unit/schema/auto-cache-hook.test.ts" --timeout 5000 --node-option=loader=ts-node/esm` | ❌ Wave 0 |
| ACCH-03 | describe_object handles existing partial entry correctly | unit | `npx mocha "test/unit/schema/describe-object.test.ts" --timeout 5000 --node-option=loader=ts-node/esm` | ✅ (test exists but relies on stubs) |

### Sampling Rate
- **Per task commit:** `cd packages/mcp-provider-dx-core && npx mocha "test/unit/schema/*.test.ts" --timeout 5000 --node-option=loader=ts-node/esm`
- **Per wave merge:** `cd packages/mcp-provider-dx-core && yarn test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/unit/schema/soql-parser.test.ts` — covers ACCH-02 (parser extraction + graceful skip)
- [ ] `test/unit/schema/auto-cache-hook.test.ts` — covers ACCH-01 (auto-cache on success), ACCH-03 (merge logic)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A — no auth changes |
| V3 Session Management | no | N/A — no session changes |
| V4 Access Control | no | N/A — cache uses existing org isolation |
| V5 Input Validation | yes | Regex parser with bail-out for complex/malicious input; return null on parse failure |
| V6 Cryptography | no | N/A — no crypto |

### Known Threat Patterns for This Phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| ReDoS via crafted SOQL query | Denial of Service | Keep regex simple and non-backtracking; bail out early on complex input; use lazy quantifiers carefully |
| Cache poisoning via crafted field names | Tampering | Field names extracted from user SOQL but stored in per-org isolated LRU cache with TTL expiry; no elevation of privilege possible |

## Sources

### Primary (HIGH confidence)
- `packages/mcp-provider-dx-core/src/schema/types.ts` — PartialFieldsEntry type definition (lines 36-41)
- `packages/mcp-provider-dx-core/src/schema/schema-service.ts` — get/set/describeAndCache implementation (full file)
- `packages/mcp-provider-dx-core/src/tools/run_soql_query.ts` — Current QueryOrgMcpTool implementation (full file)
- `packages/mcp-provider-dx-core/src/tools/describe_object.ts` — DescribeObjectMcpTool with SchemaService injection pattern
- `packages/mcp-provider-dx-core/src/index.ts` — DxCoreMcpProvider.provideTools() wiring
- `packages/mcp-provider-dx-core/test/unit/schema/describe-object.test.ts` — Test patterns and mock helpers
- `packages/mcp-provider-dx-core/test/unit/schema/schema-service.test.ts` — SchemaService test patterns
- `.planning/phases/12-auto-cache-on-success/12-CONTEXT.md` — All 13 locked decisions

### Secondary (MEDIUM confidence)
- `@salesforce/core` Connection.getUsername() signature — verified via `connection.d.ts:120` returns `Optional<string>`
- `packages/mcp-provider-dx-core/package.json` — dependency versions and test scripts

### Tertiary (LOW confidence)
- None — all findings verified against codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; all libraries verified in package.json
- Architecture: HIGH — patterns directly copied from Phase 11 (describe_object.ts)
- Pitfalls: HIGH — critical describeAndCache bug identified by reading actual source code
- SOQL regex: MEDIUM — regex approach is sound but edge cases (string literals) are assumptions

**Research date:** 2026-04-12
**Valid until:** 2026-05-12 (stable; no external dependency changes expected)
