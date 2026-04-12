# Phase 14: Relationship Graph — Nyquist Validation Strategy

## Test Frequency Analysis

| Requirement | What to test | Min tests | Rationale |
|-------------|-------------|-----------|-----------|
| RELG-01 | extractRelationshipEdges: lookup fields, child relationships, polymorphic refs, null names, empty data | 8 | Pure function with multiple extraction paths |
| RELG-02 | SchemaService.getRelationships/setRelationships: store/retrieve, key convention, TTL | 4 | Thin wrappers but key convention must be verified |
| RELG-03 | SOQL response augmentation: suggestions present, format correct, max 5, no-cache silent skip | 5 | Integration point with multiple edge cases |

## Coverage Approach

### Unit Tests (pure function)
- `extractRelationshipEdges` — all paths: outbound lookup, inbound child, master-detail via cascadeDelete, polymorphic (multi-referenceTo), null relationshipName skip, empty fields/childRelationships

### Integration Tests (wiring)
- SchemaService relationship storage wrappers
- describe_object.ts — relationships field in curated output
- run_soql_query.ts — relationship suggestions in SOQL response

## Minimum Viable Test Count
**17 tests** across extraction function + service wrappers + tool integration
