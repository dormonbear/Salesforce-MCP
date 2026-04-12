# Phase 12: Auto-Cache on Success - Discussion Log

**Date:** 2026-04-12
**Mode:** Auto-select (--auto flag)
**Decisions:** 13 (D-01 through D-13)

## Gray Areas Identified

1. **SOQL parsing approach** — Regex vs AST parser → Auto-selected: Regex (lightweight, no deps, sufficient for flat queries)
2. **Parser scope** — What to parse vs skip → Auto-selected: Flat SELECT/FROM only, gracefully skip complex queries
3. **Parser output shape** — Return type → Auto-selected: `{ objectName, fieldNames } | null`
4. **Parser file location** — Where to put parser → Auto-selected: `src/schema/soql-parser.ts` (pure function, standalone)
5. **Field alias handling** — How to handle SELECT Name n → Auto-selected: Strip aliases, keep field names only
6. **Cache hook location** — Where to intercept → Auto-selected: Inside QueryOrgMcpTool.exec() after success
7. **SchemaService injection** — How to pass SchemaService to QueryOrgMcpTool → Auto-selected: Constructor injection (matches Phase 11 pattern)
8. **Hook error handling** — What if caching fails → Auto-selected: Fire-and-forget, silent catch
9. **Full vs partial merge** — Full describe overwrites partial → Auto-selected: SchemaService.set() already overwrites (no special merge)
10. **Partial vs partial merge** — Multiple SOQL queries add fields → Auto-selected: Union field names at call site before set()
11. **Merge location** — Where merge logic lives → Auto-selected: At hook call site, not in SchemaService

## Auto-Selection Rationale

All gray areas had clear recommended defaults based on:
- Existing patterns (Phase 10 SchemaService API, Phase 11 constructor injection)
- Requirement constraints (ACCH-01 zero API calls, ACCH-02 parser requirements, ACCH-03 merge behavior)
- Scope containment (regex parser sufficient for stated success criteria)

No ambiguous areas required user input.
