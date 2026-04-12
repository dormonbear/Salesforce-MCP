# Phase 12: Auto-Cache on Success - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

After a successful SOQL query via `run_soql_query`, extract the object name and field names from the SOQL string and store them in SchemaService as a `PartialFieldsEntry`. This is a post-success hook — no new tool, no new MCP endpoint. The parser handles flat SELECT…FROM queries and gracefully skips complex constructs. Merge logic handles promotion from partial to full entries when `salesforce_describe_object` is later called on the same object.

</domain>

<decisions>
## Implementation Decisions

### SOQL Parser
- **D-01:** Implement a lightweight regex-based SOQL parser, not a full AST parser. The scope is limited to extracting `SELECT field1, field2 FROM ObjectName` — no need for a grammar library. Regex is sufficient for flat queries and avoids new dependencies.
- **D-02:** The parser extracts: (1) the sObject name from the FROM clause, (2) the field names from the SELECT clause. It returns `{ objectName: string; fieldNames: string[] } | null` — null means the query was too complex to parse safely.
- **D-03:** Gracefully skip (return null) for: subqueries (nested SELECT), aggregate functions (COUNT, SUM, etc.), GROUP BY, TYPEOF, multi-FROM (relationships like `SELECT Contact.Name FROM Account`). These require full AST parsing and are out of scope. No error thrown — silent skip.
- **D-04:** The parser is a pure function in a standalone file: `packages/mcp-provider-dx-core/src/schema/soql-parser.ts`. No class needed — export a single function `parseSoqlFields(query: string): ParsedSoql | null`.
- **D-05:** Parser handles case-insensitivity (SELECT vs select), extra whitespace, and aliases (SELECT Name n FROM Account → field is "Name", not "n"). Field aliases should be stripped.

### Cache Integration
- **D-06:** On successful SOQL query, call the parser. If parser returns non-null, store as `PartialFieldsEntry` in SchemaService via `schemaService.set(orgUsername, objectName, entry)`. This is zero API calls — we already have the field names from the query itself.
- **D-07:** The hook lives inside `QueryOrgMcpTool.exec()` — after the successful query returns but before the response is built. SchemaService is injected into QueryOrgMcpTool via constructor (same pattern as DescribeObjectMcpTool from Phase 11).
- **D-08:** The hook is fire-and-forget. If parsing fails or cache set throws, silently ignore — never fail a successful query because of caching. Wrap in try/catch with no re-throw.

### Merge / Promotion Logic
- **D-09:** When a `PartialFieldsEntry` exists in cache and a `FullDescribeEntry` is later stored for the same object (via `salesforce_describe_object`), the full entry replaces the partial entry entirely. SchemaService.set() already overwrites — no special merge logic needed in SchemaService itself.
- **D-10:** When a `PartialFieldsEntry` exists and another SOQL query adds more fields for the same object, the field lists are merged (union). The new partial entry's `fieldNames` is the union of old and new field names.
- **D-11:** The merge happens at the cache-set call site in the hook, not in SchemaService. Before calling `set()`, check if a PartialFieldsEntry already exists for the same org+object, and if so, merge fieldNames.

### QueryOrgMcpTool Modification
- **D-12:** `QueryOrgMcpTool` constructor changes from `(services: Services)` to `(services: Services, schemaService: SchemaService)`. This matches the Phase 11 pattern for DescribeObjectMcpTool.
- **D-13:** Update `DxCoreMcpProvider.provideTools()` to pass `schemaService` to `new QueryOrgMcpTool(services, schemaService)`.

### Agent's Discretion
- Internal naming of helper variables in the hook
- Whether to log cache-set activity to debug console
- Exact regex pattern construction (as long as it passes the test cases)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Schema Infrastructure (Phase 10)
- `packages/mcp-provider-dx-core/src/schema/schema-service.ts` — SchemaService.get(), set(), describeAndCache()
- `packages/mcp-provider-dx-core/src/schema/types.ts` — PartialFieldsEntry type definition

### Tool Pattern (Phase 11)
- `packages/mcp-provider-dx-core/src/tools/describe_object.ts` — SchemaService injection pattern via constructor
- `packages/mcp-provider-dx-core/src/tools/run_soql_query.ts` — The tool being modified (current exec() flow)

### Provider Wiring
- `packages/mcp-provider-dx-core/src/index.ts` — DxCoreMcpProvider.provideTools() where SchemaService is created and passed

</canonical_refs>

<specifics>
## Specific Ideas

- The SOQL regex pattern should handle: `SELECT Id, Name, Account.Name FROM Contact WHERE ...` → extract "Contact" as objectName and ["Id", "Name"] as fieldNames (skip "Account.Name" as a relationship field)
- PartialFieldsEntry already has `objectName: string; fieldNames: string[]; cachedAt: number` — this is the exact shape needed
- The parser function should be thoroughly unit-tested with edge cases (quoted strings in WHERE, aliases, LIMIT, ORDER BY)

</specifics>

<deferred>
## Deferred Ideas

- Full AST SOQL parser with subquery support → Phase 14+ if needed
- Caching on failed queries (error recovery uses schema to suggest corrections) → Phase 13
- Tooling API query caching → future if needed (different metadata set)

</deferred>

---

*Phase: 12-auto-cache-on-success*
*Context gathered: 2026-04-12 via auto-select*
