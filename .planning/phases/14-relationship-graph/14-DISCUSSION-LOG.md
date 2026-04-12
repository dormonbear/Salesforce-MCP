# Phase 14: Relationship Graph — Discussion Log

**Mode:** Auto (all decisions auto-selected with recommended defaults)
**Date:** 2026-04-12

## Gray Areas Identified

1. Edge extraction location and pattern
2. Lookup vs master-detail classification
3. Storage model (per-object vs global graph)
4. Edge sources (fields only vs fields + childRelationships)
5. Extraction trigger timing
6. SchemaService API surface
7. Suggestion format and limit
8. When to surface suggestions
9. SOQL object extraction method
10. Polymorphic relationship handling
11. Null relationshipName handling
12. Integration with describe_object

## Auto-Selected Decisions

[auto] Selected all gray areas: Edge extraction, Type classification, Storage model, Edge sources, Extraction trigger, API surface, Suggestion format, Trigger conditions, Object extraction, Polymorphic handling, Null names, Describe integration

[auto] [Edge extraction] — Q: "Where should edge extraction logic live?" → Selected: "Pure function (extractRelationshipEdges)" (recommended default)
[auto] [Type classification] — Q: "How to distinguish lookup vs master-detail?" → Selected: "cascadeDelete field from ChildRelationship" (recommended default)
[auto] [Storage model] — Q: "How to store relationship edges?" → Selected: "Per-object RelationshipEdgesEntry in existing LRU cache" (recommended default)
[auto] [Edge sources] — Q: "What describe data to extract from?" → Selected: "Both fields.referenceTo and childRelationships" (recommended default)
[auto] [Extraction trigger] — Q: "When to extract edges?" → Selected: "Fire-and-forget after describeAndCache (same as auto-cache hook)" (recommended default)
[auto] [API surface] — Q: "What SchemaService methods to add?" → Selected: "getRelationships() + setRelationships() wrapper methods" (recommended default)
[auto] [Suggestion format] — Q: "How to format join path suggestions?" → Selected: "'Contact.AccountId -> Account (lookup via AccountId)', max 5" (recommended default)
[auto] [Trigger conditions] — Q: "When to show suggestions?" → Selected: "Only on successful queries with cached relationships" (recommended default)
[auto] [Object extraction] — Q: "How to get object name from SOQL?" → Selected: "Reuse parseSoqlFields() from Phase 12" (recommended default)
[auto] [Polymorphic handling] — Q: "How to handle polymorphic lookups?" → Selected: "One edge per target object" (recommended default)
[auto] [Null names] — Q: "What about null relationshipName?" → Selected: "Skip — non-traversable references" (recommended default)
[auto] [Describe integration] — Q: "Surface edges in describe_object?" → Selected: "Yes — add relationships field to curated response" (recommended default)
