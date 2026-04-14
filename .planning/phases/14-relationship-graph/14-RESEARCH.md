# Phase 14: Relationship Graph - Research

**Researched:** 2026-04-13
**Domain:** Salesforce describe metadata → in-memory relationship graph extraction and SOQL response augmentation
**Confidence:** HIGH

## Summary

Phase 14 adds relationship graph extraction from Salesforce describe results and surfaces join/lookup path suggestions in SOQL query responses. The codebase is well-prepared: `RelationshipEdge`, `RelationshipEdgesEntry`, and `SchemaEntryType.RelationshipEdges` already exist in `types.ts` (defined in Phase 10). The `SchemaService` already stores and retrieves `RelationshipEdgesEntry` type data (verified by existing unit tests in `schema-service.test.ts`). The existing `describe_object.ts` curated output already extracts `lookupFields` and `childRelationships` from describe data — the same raw fields needed for edge extraction.

The implementation is a pure additive feature: one new pure function (`extractRelationshipEdges`), two thin SchemaService wrapper methods (`getRelationships`/`setRelationships`), fire-and-forget edge storage after every `describeAndCache`, a `relationships` field on describe_object output, and a `_relationships` section appended to SOQL query responses. No existing public APIs change. All 12 locked decisions (D-01 through D-12) are implementable with the current codebase architecture.

**Primary recommendation:** Implement as a TDD 2-plan phase: Plan 1 covers the pure `extractRelationshipEdges` function + `SchemaService.getRelationships`/`setRelationships` methods with full unit tests; Plan 2 wires edge extraction into `describe_object.ts` and `run_soql_query.ts` with integration tests for the end-to-end flow.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Extract edges in a new pure function `extractRelationshipEdges(objectName, describeData)` — same pattern as `parseSoqlFields()` from Phase 12. Called from `describe_object.ts` after a successful describe, and from `run_soql_query.ts` after auto-cache and recovery describes.
- **D-02:** Classify based on `cascadeDelete` field from ChildRelationship metadata. If `cascadeDelete === true`, it's `master-detail`; otherwise `lookup`.
- **D-03:** Store as a `RelationshipEdgesEntry` in the existing per-org LRU cache under a well-known key pattern `__relationships__{objectName}`. This reuses existing SchemaService infrastructure.
- **D-04:** Extract from BOTH `fields[].referenceTo[]` + `fields[].relationshipName` (outbound) AND `childRelationships[].childSObject` + `childRelationships[].field` (inbound).
- **D-05:** Fire-and-forget after every successful `describeAndCache` call. No separate API call.
- **D-06:** Add two methods to SchemaService: `getRelationships(org, objectName)` → `RelationshipEdge[] | undefined` and `setRelationships(org, objectName, edges)` → void.
- **D-07:** Format as: `"Contact.AccountId -> Account (lookup via AccountId)"`. Show up to 5 relationship suggestions in a dedicated `_relationships` section.
- **D-08:** Only on successful SOQL queries (not on errors). Check if the queried object has relationship edges in cache. If no cached relationships, skip silently.
- **D-09:** Reuse `parseSoqlFields()` from Phase 12 which already extracts `objectName` from SOQL.
- **D-10:** When `referenceTo` has multiple values (polymorphic lookup like `WhoId`), create one edge per target.
- **D-11:** Skip edges where `relationshipName` is null. These are formula fields or other non-traversable references.
- **D-12:** Also surface relationship edges in describe_object output when available. Add a `relationships` field to the curated response.

### Deferred Ideas (OUT OF SCOPE)
- Full graph traversal (multi-hop path finding) — future phase
- Relationship-aware SOQL auto-completion — separate feature

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RELG-01 | Extract `referenceTo[]` and `relationshipName` from describe results to build relationship edges | D-01/D-04: Pure function `extractRelationshipEdges` extracts from both `fields[]` (outbound) and `childRelationships[]` (inbound). D-10/D-11 handle polymorphic and null-relationshipName edge cases. Describe mock data in tests already includes `referenceTo`, `relationshipName`, `childRelationships`, `cascadeDelete`. |
| RELG-02 | Store relationship edges as `{ from, to, via, type: 'lookup' \| 'master-detail' }` in the per-org cache | D-03/D-06: Types already exist in `types.ts`. `SchemaService.get()/set()` already handle `RelationshipEdgesEntry`. Storage under `__relationships__{objectName}` key avoids collision with object describe entries. |
| RELG-03 | When a query touches an object with known relationships, surface join/lookup path suggestions in the response | D-07/D-08/D-09: After successful SOQL, use `parseSoqlFields()` to get object name, call `getRelationships()`, format up to 5 suggestions, append `_relationships` section. Also surface in `describe_object` output per D-12. |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | (project default) | Implementation language | Project-wide standard |
| Mocha | (project default) | Test framework | Used by all existing schema tests |
| Chai | (project default) | Assertion library | Used by all existing schema tests |
| Sinon | (project default) | Stubs/spies | Used by all existing schema tests |
| Zod | (project default) | Output schema validation | Used by describe_object + run_soql_query |
| lru-cache | (project default) | Per-org LRU cache | Already wired into SchemaService |

[VERIFIED: codebase inspection] — all libraries confirmed present in existing code and tests.

### Supporting
No additional libraries needed. This phase is pure TypeScript with no external dependencies beyond what's already installed.

## Architecture Patterns

### Recommended Project Structure
```
packages/mcp-provider-dx-core/src/schema/
├── types.ts                    # RelationshipEdge, RelationshipEdgesEntry (ALREADY EXISTS)
├── schema-service.ts           # Add getRelationships/setRelationships (MODIFY)
├── relationship-edges.ts       # NEW: extractRelationshipEdges pure function
├── soql-parser.ts              # UNCHANGED: parseSoqlFields (reused by D-09)
├── levenshtein.ts              # UNCHANGED
├── disk-persistence.ts         # UNCHANGED
└── index.ts                    # Add barrel export for extractRelationshipEdges (MODIFY)

packages/mcp-provider-dx-core/src/tools/
├── describe_object.ts          # MODIFY: call extractRelationshipEdges after describe, add relationships to output
└── run_soql_query.ts           # MODIFY: append _relationships suggestions on success, extract edges on describe recovery

packages/mcp-provider-dx-core/test/unit/schema/
├── relationship-edges.test.ts  # NEW: pure function unit tests
├── relationship-graph.test.ts  # NEW: integration tests for describe_object + run_soql_query wiring
└── ...existing tests...
```

### Pattern 1: Pure Function Edge Extraction (mirrors parseSoqlFields pattern)
**What:** A standalone pure function that accepts describe data and returns `RelationshipEdge[]`
**When to use:** D-01 mandates this pattern, matching Phase 12's `parseSoqlFields()`
**Example:**
```typescript
// Source: codebase pattern from soql-parser.ts
import { type RelationshipEdge } from './types.js';

export function extractRelationshipEdges(
  objectName: string,
  describeData: Record<string, unknown>,
): RelationshipEdge[] {
  const edges: RelationshipEdge[] = [];
  
  // Outbound: fields[].referenceTo[] + fields[].relationshipName (D-04 outbound)
  const fields = (describeData.fields as Array<Record<string, unknown>>) ?? [];
  for (const field of fields) {
    const referenceTo = field.referenceTo as string[] | undefined;
    const relationshipName = field.relationshipName as string | null;
    
    // D-11: skip null relationshipName
    if (!referenceTo?.length || !relationshipName) continue;
    
    // D-10: one edge per target for polymorphic lookups
    for (const target of referenceTo) {
      edges.push({
        from: objectName,
        to: target,
        via: field.name as string,
        type: 'lookup', // Outbound fields are always lookup type from this object's perspective
      });
    }
  }

  // Inbound: childRelationships[].childSObject + field (D-04 inbound)
  const childRels = (describeData.childRelationships as Array<Record<string, unknown>>) ?? [];
  for (const cr of childRels) {
    const relName = cr.relationshipName as string | null;
    // D-11: skip null relationshipName
    if (!relName) continue;
    
    // D-02: cascadeDelete === true → master-detail, else → lookup
    const edgeType = cr.cascadeDelete === true ? 'master-detail' : 'lookup';
    
    edges.push({
      from: cr.childSObject as string,
      to: objectName,
      via: cr.field as string,
      type: edgeType,
    });
  }

  return edges;
}
```

### Pattern 2: SchemaService Wrapper Methods (D-06 — `__relationships__` key convention)
**What:** Two thin wrappers that encapsulate the `__relationships__` key prefix
**When to use:** D-06 mandates `getRelationships` and `setRelationships` on SchemaService
**Critical detail:** The existing `SchemaService.get()` normalizes objectName to lowercase. The key `__relationships__account` won't collide with `account` because the prefix is distinct.
**Example:**
```typescript
// Source: codebase pattern from schema-service.ts
import { SchemaEntryType, type RelationshipEdge, type RelationshipEdgesEntry } from './types.js';

// Added to SchemaService class:
private static relationshipKey(objectName: string): string {
  return `__relationships__${objectName}`;
}

public getRelationships(orgUsername: string, objectName: string): RelationshipEdge[] | undefined {
  const entry = this.get(orgUsername, SchemaService.relationshipKey(objectName));
  if (entry?.type === SchemaEntryType.RelationshipEdges) {
    return (entry as RelationshipEdgesEntry).edges;
  }
  return undefined;
}

public setRelationships(orgUsername: string, objectName: string, edges: RelationshipEdge[]): void {
  this.set(orgUsername, SchemaService.relationshipKey(objectName), {
    type: SchemaEntryType.RelationshipEdges,
    edges,
    cachedAt: Date.now(),
  } satisfies RelationshipEdgesEntry);
}
```

### Pattern 3: Fire-and-Forget Edge Storage (mirrors auto-cache hook pattern)
**What:** After every successful `describeAndCache`, extract and store edges in a try-catch that never fails the main operation
**When to use:** D-05 mandates fire-and-forget after every describe
**Example:**
```typescript
// Source: pattern from run_soql_query.ts auto-cache hook (lines 118-142)
// In describe_object.ts after const entry = await this.schemaService.describeAndCache(...)
try {
  if (entry.type === SchemaEntryType.FullDescribe) {
    const edges = extractRelationshipEdges(input.objectName, (entry as FullDescribeEntry).data);
    if (edges.length > 0) {
      this.schemaService.setRelationships(orgUsername, input.objectName, edges);
    }
  }
} catch {
  // Silently ignore — edge extraction must never fail the describe (D-05)
}
```

### Pattern 4: SOQL Response Augmentation (D-07/D-08)
**What:** After successful SOQL query, check cache for relationships and append suggestions
**When to use:** D-08 mandates only on success, only with cached relationships
**Example:**
```typescript
// After successful query result in run_soql_query.ts:
let relationshipHints: string[] = [];
try {
  const parsed = parseSoqlFields(input.query);
  if (parsed) {
    const orgUsername = connection.getUsername() ?? input.usernameOrAlias;
    const edges = this.schemaService.getRelationships(orgUsername, parsed.objectName);
    if (edges?.length) {
      // D-07: format as "Contact.AccountId -> Account (lookup via AccountId)", max 5
      relationshipHints = edges.slice(0, 5).map(e =>
        `${e.from}.${e.via} -> ${e.to} (${e.type} via ${e.via})`
      );
    }
  }
} catch { /* silent */ }

// Append to text response if hints exist
const relSection = relationshipHints.length > 0
  ? `\n\n_relationships:\n${relationshipHints.join('\n')}`
  : '';
```

### Anti-Patterns to Avoid
- **Don't make API calls for relationship suggestions:** D-08 is explicit — only use cached edges. Never trigger a describe just to get relationships for a SOQL response.
- **Don't modify the `queryOutputSchema` structured output:** The `_relationships` is informational text appended to the text content, NOT a new field in `structuredContent`. Adding it to the Zod schema would break existing clients. [VERIFIED: D-07 says "dedicated _relationships section appended to the SOQL query response"]
- **Don't store relationships under the same key as the describe entry:** D-03 mandates `__relationships__` prefix to avoid overwriting the `FullDescribeEntry` or `PartialFieldsEntry` for the same object.
- **Don't block on edge extraction:** All edge extraction and storage is fire-and-forget inside try-catch, same as existing auto-cache hook pattern.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| LRU cache with TTL | Custom cache | Existing `SchemaService` with `lru-cache` | Already built, tested, and persisted to disk |
| SOQL object name parsing | Regex parser | Existing `parseSoqlFields()` | Already has 18 tests, handles edge cases |
| Levenshtein distance | Custom impl | Existing `levenshtein.ts` | Already built, tested (not needed for Phase 14 but stays available) |

**Key insight:** Phase 14 adds zero new dependencies. Everything builds on Phase 10-13 infrastructure.

## Common Pitfalls

### Pitfall 1: Key Collision Between Describe Entry and Relationship Entry
**What goes wrong:** If relationships are stored under the same key as the describe entry (e.g., just `account`), storing edges would overwrite the `FullDescribeEntry`.
**Why it happens:** SchemaService.set() uses a single LRU cache per org keyed by object name.
**How to avoid:** D-03's `__relationships__` prefix creates a separate namespace. `SchemaService.get('orgA', '__relationships__account')` never collides with `SchemaService.get('orgA', 'account')`.
**Warning signs:** Tests where `get()` returns a `RelationshipEdgesEntry` when expecting `FullDescribeEntry`.

### Pitfall 2: LRU Eviction of Relationship Entries
**What goes wrong:** Each `__relationships__` entry counts toward the 100-entry LRU limit per org. With many objects, relationship entries compete with describe entries for LRU slots.
**Why it happens:** The LRU cache max is 100 per org. If 50 objects each have a describe entry + relationship entry, that's 100 entries — full.
**How to avoid:** This is an accepted trade-off per D-03's rationale. The LRU eviction will discard least-recently-used entries naturally. For Phase 14 scope, this is fine.
**Warning signs:** Relationship entries being evicted shortly after creation in orgs with many described objects.

### Pitfall 3: Null RelationshipName in childRelationships
**What goes wrong:** The mock data in `describe-object.test.ts` shows `{ relationshipName: null, childSObject: 'Task', field: 'WhatId', cascadeDelete: false }` — some childRelationships have null relationship names.
**Why it happens:** Salesforce includes non-traversable relationships (polymorphic WhatId/WhoId on Task/Event) that have null relationship names.
**How to avoid:** D-11 is explicit: skip edges where relationshipName is null. The pure function must filter these out.
**Warning signs:** Edges with `from: 'Task'`, `to: 'Account'`, `via: 'WhatId'` showing up in suggestions.

### Pitfall 4: Polymorphic Lookups Generating Many Edges
**What goes wrong:** A polymorphic field like `WhoId` on Task references both Contact and Lead. If not handled, either only one target is recorded, or no target is recorded.
**Why it happens:** `referenceTo` is an array, not a single value.
**How to avoid:** D-10 mandates creating one edge per target. For `WhoId -> [Contact, Lead]`, generate two edges. But D-11 also applies — if `relationshipName` is null, skip entirely.
**Warning signs:** Missing edges for polymorphic relationships.

### Pitfall 5: describeObjectOutputSchema Needs Update for D-12
**What goes wrong:** D-12 requires adding a `relationships` field to the curated describe_object response. The `describeObjectOutputSchema` Zod schema must be updated, or `structuredContent` won't validate.
**Why it happens:** The Zod schema is used for output validation in tests (see `structured-output.test.ts`).
**How to avoid:** Add `relationships` as an optional field in the output schema (`.optional()` or with default empty array) so existing tests don't break when no relationships exist.
**Warning signs:** Test failures in `structured-output.test.ts` after adding the field.

### Pitfall 6: Edge Extraction in INVALID_FIELD Recovery Path
**What goes wrong:** When `run_soql_query.ts` does an auto-describe on INVALID_FIELD error (lines 164-199), the describe result should also trigger edge extraction per D-01/D-05.
**Why it happens:** The recovery path calls `describeAndCache` which stores a FullDescribeEntry. Edge extraction must be added there too.
**How to avoid:** Add the same fire-and-forget edge extraction after the recovery `describeAndCache` call.
**Warning signs:** Objects described via the recovery path don't have relationship edges cached.

## Code Examples

### Salesforce Describe Data Structure (from existing test mocks)
```typescript
// Source: [VERIFIED: test/unit/schema/describe-object.test.ts lines 27-40]
const describeData = {
  name: 'Account',
  label: 'Account',
  keyPrefix: '001',
  fields: [
    // Non-reference fields have empty referenceTo and null relationshipName
    { name: 'Id', type: 'id', referenceTo: [], relationshipName: null },
    { name: 'Name', type: 'string', referenceTo: [], relationshipName: null },
    
    // Lookup fields have non-empty referenceTo and non-null relationshipName
    { name: 'OwnerId', type: 'reference', referenceTo: ['User'], relationshipName: 'Owner' },
    { name: 'ParentId', type: 'reference', referenceTo: ['Account'], relationshipName: 'Parent' },
  ],
  childRelationships: [
    // Regular child relationship (lookup) — cascadeDelete: false
    { relationshipName: 'Contacts', childSObject: 'Contact', field: 'AccountId', cascadeDelete: false },
    { relationshipName: 'Opportunities', childSObject: 'Opportunity', field: 'AccountId', cascadeDelete: false },
    
    // Null relationshipName — SKIP per D-11
    { relationshipName: null, childSObject: 'Task', field: 'WhatId', cascadeDelete: false },
  ],
};
```

### Expected Edge Extraction Output
```typescript
// Given the above describeData for Account:
const expectedEdges: RelationshipEdge[] = [
  // Outbound from fields[].referenceTo[]
  { from: 'Account', to: 'User', via: 'OwnerId', type: 'lookup' },
  { from: 'Account', to: 'Account', via: 'ParentId', type: 'lookup' },  // self-referencing
  
  // Inbound from childRelationships[]
  { from: 'Contact', to: 'Account', via: 'AccountId', type: 'lookup' },    // cascadeDelete: false
  { from: 'Opportunity', to: 'Account', via: 'AccountId', type: 'lookup' }, // cascadeDelete: false
  
  // Task/WhatId SKIPPED (relationshipName is null → D-11)
];
```

### Relationship Suggestion Format (D-07)
```typescript
// For the edges above, suggestion strings would be:
const suggestions = [
  'Account.OwnerId -> User (lookup via OwnerId)',
  'Account.ParentId -> Account (lookup via ParentId)',
  'Contact.AccountId -> Account (lookup via AccountId)',
  'Opportunity.AccountId -> Account (lookup via AccountId)',
];
// Limit to 5 per D-07
```

### describe_object Output with Relationships (D-12)
```typescript
// The curated response adds an optional `relationships` field:
const curatedWithRelationships = {
  objectName: 'Account',
  label: 'Account',
  // ...existing fields...
  relationships: [
    { from: 'Account', to: 'User', via: 'OwnerId', type: 'lookup' },
    { from: 'Contact', to: 'Account', via: 'AccountId', type: 'lookup' },
    // ...
  ],
  _meta: { source: 'api', cachedAt: 1234, ageMs: 500, indicator: 'full' },
};
```

### Test Mock for Master-Detail Detection (D-02)
```typescript
// Source: [VERIFIED: cascadeDelete present in describe-object.test.ts mock]
const describeWithMasterDetail = {
  name: 'CustomParent__c',
  fields: [],
  childRelationships: [
    // cascadeDelete: true → master-detail
    { relationshipName: 'Children', childSObject: 'CustomChild__c', field: 'ParentId__c', cascadeDelete: true },
    // cascadeDelete: false → lookup
    { relationshipName: 'Tags', childSObject: 'Tag__c', field: 'ParentId__c', cascadeDelete: false },
  ],
};

// Expected edges:
// { from: 'CustomChild__c', to: 'CustomParent__c', via: 'ParentId__c', type: 'master-detail' }
// { from: 'Tag__c', to: 'CustomParent__c', via: 'ParentId__c', type: 'lookup' }
```

## Existing Codebase Assets Inventory

| Asset | Location | Status | Phase 14 Usage |
|-------|----------|--------|----------------|
| `RelationshipEdge` type | `schema/types.ts:23-28` | EXISTS | Direct use — the edge shape |
| `RelationshipEdgesEntry` type | `schema/types.ts:43-47` | EXISTS | Direct use — cache entry wrapper |
| `SchemaEntryType.RelationshipEdges` | `schema/types.ts:20` | EXISTS | Key for discriminated union |
| `SchemaService.get()/set()` | `schema/schema-service.ts:74,85` | EXISTS | Used by `getRelationships`/`setRelationships` wrappers |
| `SchemaService.describeAndCache()` | `schema/schema-service.ts:97-129` | EXISTS | Hooks for edge extraction after describe |
| `parseSoqlFields()` | `schema/soql-parser.ts:27-53` | EXISTS | Reused for object name extraction in SOQL |
| `curateDescribeResult()` | `tools/describe_object.ts:83-124` | EXISTS | Modify to include `relationships` field |
| `describeObjectOutputSchema` | `tools/describe_object.ts:47-76` | EXISTS | Modify to include optional `relationships` |
| `QueryOrgMcpTool.exec()` auto-cache | `tools/run_soql_query.ts:118-142` | EXISTS | Pattern to follow for edge extraction |
| `QueryOrgMcpTool.exec()` recovery | `tools/run_soql_query.ts:164-199` | EXISTS | Add edge extraction after recovery describe |
| `schema/index.ts` barrel | `schema/index.ts` | EXISTS | Add export for `extractRelationshipEdges` |
| Mock describe data with `cascadeDelete` | test mock at `describe-object.test.ts:27-40` | EXISTS | Reuse pattern for edge extraction tests |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Mocha + Chai + Sinon (via ts-node/esm) |
| Config file | `packages/mcp-provider-dx-core/.mocharc.json` |
| Quick run command | `cd packages/mcp-provider-dx-core && npx mocha "test/unit/schema/relationship-edges.test.ts" --timeout 5000` |
| Full suite command | `cd packages/mcp-provider-dx-core && yarn test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RELG-01 | Extract referenceTo[] and relationshipName into edges | unit | `npx mocha "test/unit/schema/relationship-edges.test.ts" --timeout 5000` | ❌ Wave 0 |
| RELG-01 | Extract from childRelationships[] with cascadeDelete classification | unit | same file | ❌ Wave 0 |
| RELG-01 | Skip null relationshipName (D-11) | unit | same file | ❌ Wave 0 |
| RELG-01 | Handle polymorphic referenceTo (D-10) | unit | same file | ❌ Wave 0 |
| RELG-02 | getRelationships/setRelationships store/retrieve edges | unit | `npx mocha "test/unit/schema/schema-service.test.ts" --timeout 5000` | ✅ (add cases) |
| RELG-02 | __relationships__ key convention doesn't collide with describe entries | unit | same file | ✅ (add cases) |
| RELG-03 | describe_object includes relationships field in output | unit | `npx mocha "test/unit/schema/relationship-graph.test.ts" --timeout 5000` | ❌ Wave 0 |
| RELG-03 | run_soql_query appends _relationships on success | unit | same file | ❌ Wave 0 |
| RELG-03 | No _relationships on error / no cached edges | unit | same file | ❌ Wave 0 |
| RELG-03 | Max 5 suggestions (D-07) | unit | same file | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cd packages/mcp-provider-dx-core && npx mocha "test/unit/schema/relationship-edges.test.ts" "test/unit/schema/relationship-graph.test.ts" --timeout 5000`
- **Per wave merge:** `cd packages/mcp-provider-dx-core && yarn test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/unit/schema/relationship-edges.test.ts` — covers RELG-01 (pure function tests)
- [ ] `test/unit/schema/relationship-graph.test.ts` — covers RELG-03 (integration wiring tests)
- [ ] Add `getRelationships`/`setRelationships` test cases to existing `schema-service.test.ts` — covers RELG-02

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Outbound edges from `fields[].referenceTo[]` are always `lookup` type (not master-detail), because master-detail is only determinable from `childRelationships[].cascadeDelete` on the parent side | Architecture Pattern 1 | Edges may be misclassified as lookup when they should be master-detail. Mitigation: for outbound edges, the field itself doesn't carry cascadeDelete — only childRelationships do. This is consistent with Salesforce API semantics where cascadeDelete lives on ChildRelationship, not Field. [ASSUMED] |
| A2 | The `_relationships` section should be appended to the text content only, not added as a new field in `structuredContent`/`queryOutputSchema` | Anti-Patterns | If wrong, the SOQL output schema needs updating. D-07 says "dedicated _relationships section appended to the SOQL query response" — this reads as text augmentation, not schema change. [ASSUMED] |

**If this table were empty:** Two minor assumptions exist but both have low risk. A1 is consistent with Salesforce API design. A2 follows from D-07's wording.

## Open Questions

1. **Should outbound edges from fields be cross-referenced with childRelationships to detect master-detail?**
   - What we know: D-02 says use `cascadeDelete` from ChildRelationship. Outbound fields don't have this property.
   - What's unclear: If Contact.AccountId is a master-detail, the outbound edge from Contact → Account (extracted from Contact's fields[]) would be classified as `lookup` because there's no cascadeDelete on the field. But the inbound edge from Account's childRelationships[] would correctly say `master-detail`.
   - Recommendation: Accept this asymmetry. The same relationship may have different `type` values depending on which side's describe was extracted. This is fine for Phase 14 — the graph is per-object, not global. When Account is described, its childRelationship for Contact says master-detail. When Contact is described, its field says lookup. Both are useful information.

2. **Where exactly to add `_relationships` in SOQL text response — before or after the JSON result?**
   - What we know: D-07 specifies the format and max 5 suggestions.
   - What's unclear: Whether to append after the existing `SOQL query results:\n\n{JSON}` text, or interleave.
   - Recommendation: Append after the JSON result as a separate section: `SOQL query results:\n\n{JSON}\n\n_relationships:\n{suggestions}`. This keeps the JSON parseable and the hints visible to the LLM.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No relationship awareness in SOQL tool | Phase 14 adds relationship graph | This phase | AI agents get join/lookup hints |
| `cascadeDelete` not extracted in curated output | Still not in curated output (stays in raw describe) | Phase 11 | Edge extraction reads from raw `FullDescribeEntry.data`, not curated output — no impact |

## Sources

### Primary (HIGH confidence)
- `packages/mcp-provider-dx-core/src/schema/types.ts` — verified RelationshipEdge, RelationshipEdgesEntry types exist
- `packages/mcp-provider-dx-core/src/schema/schema-service.ts` — verified get/set API, LRU cache structure
- `packages/mcp-provider-dx-core/src/tools/describe_object.ts` — verified curateDescribeResult, output schema
- `packages/mcp-provider-dx-core/src/tools/run_soql_query.ts` — verified auto-cache hook pattern, recovery path
- `packages/mcp-provider-dx-core/src/schema/soql-parser.ts` — verified parseSoqlFields extracts objectName
- `packages/mcp-provider-dx-core/test/unit/schema/describe-object.test.ts` — verified mock data includes cascadeDelete, referenceTo, relationshipName, childRelationships
- `packages/mcp-provider-dx-core/test/unit/schema/schema-service.test.ts` — verified RelationshipEdgesEntry storage tested
- `packages/mcp-provider-dx-core/test/unit/schema/auto-cache-hook.test.ts` — verified test patterns for fire-and-forget caching
- `packages/mcp-provider-dx-core/test/unit/schema/failure-recovery.test.ts` — verified recovery path patterns
- `.planning/phases/14-relationship-graph/14-CONTEXT.md` — all 12 locked decisions

### Secondary (MEDIUM confidence)
- Salesforce DescribeSObjectResult API structure — `cascadeDelete` on ChildRelationship is the canonical differentiator between lookup and master-detail [ASSUMED based on D-02 rationale and confirmed by test mock data]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies, all existing infrastructure
- Architecture: HIGH — pure additive changes following established patterns (parseSoqlFields, auto-cache hook)
- Pitfalls: HIGH — identified from actual test mocks and codebase inspection (null relationshipName, key collision, LRU limits)

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (stable — internal TypeScript project, no external API changes expected)
