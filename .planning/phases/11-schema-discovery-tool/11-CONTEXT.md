# Phase 11: Schema Discovery Tool - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Implement `salesforce_describe_object` as a new MCP tool in dx-core that returns curated schema metadata for any Salesforce sObject, using SchemaService for cache-first behavior. This phase delivers the tool, its cache integration, and its tool description — nothing else. Auto-cache on SOQL success (Phase 12) and failure recovery (Phase 13) are out of scope.

</domain>

<decisions>
## Implementation Decisions

### Response Format
- **D-01:** Return a curated summary, not the raw `DescribeSObjectResult`. The raw API response is too large and verbose for AI context windows. Extract: fields (name, label, type, filterable, updateable, nillable), childRelationships (name, childSObject, field), lookupFields (from field.referenceTo), record key prefix, object label, and object API name.
- **D-02:** Response includes a `_meta` object with `source: 'cache' | 'api'`, `cachedAt: number`, `ageMs: number`, and `indicator: 'full' | 'partial'` to satisfy DISC-05 cache hit transparency requirement.

### Cache Integration
- **D-03:** On tool invocation, check SchemaService cache first. If a FullDescribe entry exists and is within TTL, return it with `_meta.source: 'cache'`. Otherwise call `Connection.describe(objectName)` via `describeAndCache()` (single-flight coalescing from Phase 10).
- **D-04:** Store describe results as `FullDescribeEntry` (type: 'full-describe') in SchemaService. The raw DescribeSObjectResult data is stored in cache, but the tool response is the curated subset.

### Tool Registration
- **D-05:** Tool name: `salesforce_describe_object`. Follows existing naming convention (`salesforce_` prefix).
- **D-06:** Tool description text recommends (not forces) describing unfamiliar objects before querying: "Retrieve schema metadata for a Salesforce object. Recommended before writing SOQL queries against unfamiliar objects to verify available fields and relationships." This satisfies DISC-06.
- **D-07:** Tool is classified as `read` in tool-categories.ts (already registered as placeholder).
- **D-08:** Tool has a Zod output schema for structured output (follows pattern from run_soql_query, run_apex_test).

### SchemaService Injection
- **D-09:** SchemaService is passed from `DxCoreMcpProvider.provideTools()` to the tool's constructor. The tool constructor takes `(services: Services, schemaService: SchemaService)`. This keeps SchemaService dx-core internal (per Phase 10 D-01) without modifying the shared Services interface.
- **D-10:** The tool uses `services.getOrgService().getConnection(usernameOrAlias)` to get a Connection, then `connection.describe(objectName)` for the API call.

### Input Parameters
- **D-11:** Required parameter: `objectName` (string) — the API name of the sObject to describe (e.g., "Account", "Contact", "Custom_Object__c").
- **D-12:** Optional parameter: `usernameOrAlias` — standard org targeting param (reuse `usernameOrAliasParam` from shared params).

### Agent's Discretion
- Internal file structure within tools/ directory
- Exact formatting of the curated response fields
- Whether to include field count summary in response
- Test structure and mocking approach

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### SchemaService (Phase 10 output)
- `packages/mcp-provider-dx-core/src/schema/schema-service.ts` — SchemaService class with get/set/describeAndCache/loadFromDisk/shutdown
- `packages/mcp-provider-dx-core/src/schema/types.ts` — SchemaEntry union type (FullDescribe, PartialFields, RelationshipEdges)
- `packages/mcp-provider-dx-core/src/schema/index.ts` — Barrel exports

### Tool Registration Pattern
- `packages/mcp-provider-dx-core/src/index.ts` — DxCoreMcpProvider.provideTools() — where SchemaService is created and tools are instantiated
- `packages/mcp-provider-dx-core/src/tools/run_soql_query.ts` — Reference tool implementation (McpTool pattern, Zod schemas, error handling)
- `packages/mcp-provider-api/src/services.ts` — Services interface (DO NOT modify — SchemaService stays dx-core internal)

### Tool Categories
- `packages/mcp/src/utils/tool-categories.ts` — Already has `salesforce_describe_object: 'read'` placeholder

### Error Recovery Reference
- `packages/mcp-provider-dx-core/src/tools/run_soql_query.ts:117` — Already references `salesforce_describe_object` in SOQL error messages

### Prior Context
- `.planning/phases/10-schema-cache-foundation/10-CONTEXT.md` — Phase 10 decisions (D-01 through D-15)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `SchemaService.describeAndCache(orgUsername, objectName, describeFn)` — Wraps describe call with cache-first + single-flight coalescing
- `usernameOrAliasParam` — Standard Zod param for org targeting
- `textResponse()` — Utility for formatting tool responses
- `classifyError()` — Error classification utility from mcp-provider-api
- `McpTool<InputShape, OutputShape>` — Base class for all tools with structured input/output

### Established Patterns
- Tools extend `McpTool`, implement `getConfig()` (returns name, description, schema, toolset, release state) and `execute()` (returns CallToolResult)
- Constructor receives `Services`, tools use `services.getOrgService().getConnection()` for Salesforce API access
- Error handling: catch SfError, classify with `classifyError()`, return `toolError()` response
- Output schemas defined with Zod for structured responses

### Integration Points
- `DxCoreMcpProvider.provideTools()` — Tool instantiation point; SchemaService already available here
- `tool-categories.ts` — Already has placeholder entry for describe_object
- `run_soql_query.ts` error message — Already references `salesforce_describe_object` for error recovery

</code_context>

<specifics>
## Specific Ideas

No specific requirements — open to standard approaches.

The tool should follow the established McpTool pattern exactly. Connection.describe() returns a DescribeSObjectResult which should be curated into a developer-friendly summary focused on what AI agents need: field metadata for writing queries, relationships for joins, and key prefix for record identification.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 11-schema-discovery-tool*
*Context gathered: 2026-04-12*
