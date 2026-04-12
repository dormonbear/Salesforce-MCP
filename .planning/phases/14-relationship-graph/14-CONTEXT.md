# Phase 14: Relationship Graph — Context

## Phase Goal
The schema cache builds an object relationship graph from describe results and surfaces join/lookup path suggestions when queries touch related objects.

## Requirements
- **RELG-01**: Extract `referenceTo[]` and `relationshipName` from describe results to build relationship edges
- **RELG-02**: Store relationship edges as `{ from, to, via, type: 'lookup' | 'master-detail' }` in the per-org cache
- **RELG-03**: When a query touches an object with known relationships, surface join/lookup path suggestions in the response

## Decisions

### D-01: Where to extract relationship edges
**Decision:** Extract edges in a new pure function `extractRelationshipEdges(objectName, describeData)` — same pattern as `parseSoqlFields()` from Phase 12. Called from `describe_object.ts` after a successful describe, and from `run_soql_query.ts` after auto-cache and recovery describes.
**Rationale:** Pure function is testable in isolation, follows established Phase 12 pattern.

### D-02: Edge type classification (lookup vs master-detail)
**Decision:** Classify based on `cascadeDelete` field from ChildRelationship metadata. If `cascadeDelete === true`, it's `master-detail`; otherwise `lookup`. This is how Salesforce semantically distinguishes the two.
**Rationale:** The Salesforce API's ChildRelationship objects include `cascadeDelete` which is the canonical differentiator.

### D-03: Storage location for relationship edges
**Decision:** Store as a `RelationshipEdgesEntry` in the existing per-org LRU cache under a well-known key pattern `__relationships__{objectName}`. This reuses existing SchemaService infrastructure (TTL, persistence, eviction).
**Rationale:** Types already exist (`RelationshipEdge`, `RelationshipEdgesEntry` in types.ts). Storing per-object rather than a single global graph avoids invalidation complexity.

### D-04: Edge extraction source — fields vs childRelationships
**Decision:** Extract from BOTH:
- `fields[].referenceTo[]` + `fields[].relationshipName` → outbound lookup edges (FROM this object TO referenced objects)
- `childRelationships[].childSObject` + `childRelationships[].field` → inbound edges (FROM child TO this object)
**Rationale:** RELG-01 explicitly mentions `referenceTo[]` and `relationshipName`. Including childRelationships gives bidirectional graph.

### D-05: When to call edge extraction
**Decision:** Fire-and-forget after every successful `describeAndCache` call (same pattern as auto-cache hook in Phase 12). Extract edges and store them in the schema cache. No separate API call needed — edges come from the describe result itself.
**Rationale:** Zero additional API overhead. The describe data already contains all relationship metadata.

### D-06: SchemaService API additions
**Decision:** Add two methods to SchemaService:
1. `getRelationships(org, objectName)` → `RelationshipEdge[] | undefined` — retrieves stored edges for an object
2. `setRelationships(org, objectName, edges)` → void — stores edges entry
These are thin wrappers around `get()`/`set()` with the `__relationships__` key convention.
**Rationale:** Encapsulates the key convention, keeps consuming code clean.

### D-07: Join/lookup path suggestion format
**Decision:** Format as: `"Contact.AccountId -> Account (lookup via AccountId)"`. Show up to 5 relationship suggestions in a dedicated `_relationships` section appended to the SOQL query response.
**Rationale:** Matches the success criteria format. 5 is enough to be helpful without overwhelming.

### D-08: When to surface relationship suggestions
**Decision:** Only on successful SOQL queries (not on errors). After a successful query, check if the queried object has relationship edges in cache. If yes, append suggestions to the response. If no cached relationships, skip silently.
**Rationale:** RELG-03 says "when a query touches an object with known relationships". Known = already cached. No describe call just for suggestions.

### D-09: Object name extraction from SOQL for suggestions
**Decision:** Reuse `parseSoqlFields()` from Phase 12 which already extracts `objectName` from SOQL. No additional parsing needed.
**Rationale:** Function already exists and is battle-tested with 18 tests.

### D-10: Polymorphic relationships handling
**Decision:** When `referenceTo` has multiple values (polymorphic lookup like `WhoId`), create one edge per target. E.g., `WhoId -> Contact` and `WhoId -> Lead`.
**Rationale:** Each is a valid relationship path the AI agent might want to explore.

### D-11: Null relationshipName handling
**Decision:** Skip edges where `relationshipName` is null. These are formula fields or other non-traversable references.
**Rationale:** Null relationship names can't be used in SOQL relationship queries, so suggesting them would be misleading.

### D-12: Integration with describe_object response
**Decision:** Also surface relationship edges in describe_object output when available. Add a `relationships` field to the curated response showing the extracted edges.
**Rationale:** When an agent describes an object, knowing its relationships is immediately useful for planning queries.

## Codebase Assets
- `types.ts` — `RelationshipEdge`, `RelationshipEdgesEntry`, `SchemaEntryType.RelationshipEdges` already defined
- `schema-service.ts` — `get()` / `set()` with per-org LRU cache, `describeAndCache()` with single-flight
- `describe_object.ts` — `curateDescribeResult()` already extracts `lookupFields` and `childRelationships`
- `run_soql_query.ts` — auto-cache hook and INVALID_FIELD recovery already call describeAndCache
- `soql-parser.ts` — `parseSoqlFields()` extracts objectName from SOQL
- `schema/index.ts` — barrel exports including RelationshipEdge types

## Deferred Ideas
- Full graph traversal (multi-hop path finding) — future phase
- Relationship-aware SOQL auto-completion — separate feature
