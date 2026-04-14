# Phase 11: Schema Discovery Tool - Research

**Researched:** 2026-04-12
**Domain:** MCP tool implementation, Salesforce metadata describe API, schema cache integration
**Confidence:** HIGH

## Summary

Phase 11 implements `salesforce_describe_object` as a new MCP tool in the dx-core provider that returns curated schema metadata for any Salesforce sObject. The tool follows the established `McpTool` pattern exactly, integrating with the Phase 10 `SchemaService` for cache-first behavior. All foundational infrastructure (SchemaService, disk persistence, single-flight coalescing) is already in place — this phase only needs to build the tool itself, its Zod schemas, and wire it into the provider.

The codebase patterns are extremely well-established. There are 14 existing tools in `packages/mcp-provider-dx-core/src/tools/` that provide clear templates. The `run_soql_query.ts` tool already references `salesforce_describe_object` in its error recovery messages, and `tool-categories.ts` already has the placeholder entry. The jsforce `Connection.describe(type)` API returns a `DescribeSObjectResult` with fields, childRelationships, keyPrefix, and other metadata that must be curated down to an AI-friendly subset.

**Primary recommendation:** Build a single new tool file following the `QueryOrgMcpTool` pattern, with a constructor that accepts `(services: Services, schemaService: SchemaService)`, and wire it in `DxCoreMcpProvider.provideTools()` where SchemaService is already instantiated.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Return a curated summary, not the raw `DescribeSObjectResult`. Extract: fields (name, label, type, filterable, updateable, nillable), childRelationships (name, childSObject, field), lookupFields (from field.referenceTo), record key prefix, object label, and object API name.
- **D-02:** Response includes a `_meta` object with `source: 'cache' | 'api'`, `cachedAt: number`, `ageMs: number`, and `indicator: 'full' | 'partial'` to satisfy DISC-05.
- **D-03:** On tool invocation, check SchemaService cache first. If FullDescribe entry exists within TTL, return with `_meta.source: 'cache'`. Otherwise call `Connection.describe(objectName)` via `describeAndCache()`.
- **D-04:** Store describe results as `FullDescribeEntry` (type: 'full-describe') in SchemaService. Raw DescribeSObjectResult in cache, curated subset in tool response.
- **D-05:** Tool name: `salesforce_describe_object`. Follows `salesforce_` prefix convention.
- **D-06:** Tool description recommends (not forces) describing unfamiliar objects before querying.
- **D-07:** Tool classified as `read` in tool-categories.ts (already registered as placeholder).
- **D-08:** Tool has Zod output schema for structured output (follows run_soql_query, run_apex_test pattern).
- **D-09:** SchemaService passed from `DxCoreMcpProvider.provideTools()` to tool constructor. Constructor: `(services: Services, schemaService: SchemaService)`.
- **D-10:** Tool uses `services.getOrgService().getConnection(usernameOrAlias)` for Connection, then `connection.describe(objectName)`.
- **D-11:** Required parameter: `objectName` (string) — sObject API name.
- **D-12:** Optional parameter: `usernameOrAlias` — reuse `usernameOrAliasParam` from shared params.

### Agent's Discretion
- Internal file structure within tools/ directory
- Exact formatting of the curated response fields
- Whether to include field count summary in response
- Test structure and mocking approach

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DISC-04 | `salesforce_describe_object` tool returns object fields (name, label, type, filterable, updateable), relationships, and record key prefix | Tool implementation with curated field extraction from `DescribeSObjectResult`. jsforce Field type verified to contain all required properties. |
| DISC-05 | `describe_object` checks cache first; on cache hit returns cached data with source metadata (`cache`/`api`, age, full/partial indicator) | `SchemaService.get()` for cache check, `describeAndCache()` for cache-first + single-flight. `_meta` object in response carries source/age/indicator. |
| DISC-06 | Tool description recommends (not forces) AI to describe unfamiliar objects before querying | Tool description text in `getConfig()` — exact wording locked in D-06. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@dormon/mcp-provider-api` | workspace | McpTool base class, Services, toolError, classifyError | Project's own API package — all tools extend McpTool [VERIFIED: codebase] |
| `@salesforce/core` | workspace | SfError, Connection type (provides `describe()` method) | Salesforce SDK — Connection.describe(type) returns DescribeSObjectResult [VERIFIED: codebase] |
| `@jsforce/jsforce-node` | workspace | DescribeSObjectResult, Field, ChildRelationship type definitions | Underlying jsforce types used by @salesforce/core Connection [VERIFIED: codebase typedefs] |
| `zod` | workspace | Input/output schema validation | Already used by all tools for schema definition [VERIFIED: codebase] |
| `@modelcontextprotocol/sdk` | workspace | CallToolResult type | MCP protocol types for tool responses [VERIFIED: codebase] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `SchemaService` | Phase 10 | Cache-first describe with single-flight coalescing | Core cache integration — `describeAndCache()` method [VERIFIED: codebase] |
| `lru-cache` | workspace (transitive) | Underlying cache implementation in SchemaService | Already used by SchemaService internally [VERIFIED: codebase] |

### Alternatives Considered
None — all decisions are locked. The stack is fully prescribed by existing codebase patterns.

**No additional installation needed.** All dependencies are already workspace packages.

## Architecture Patterns

### Recommended Project Structure
```
packages/mcp-provider-dx-core/src/
├── tools/
│   ├── describe_object.ts          # NEW: salesforce_describe_object tool
│   ├── run_soql_query.ts           # Reference pattern (existing)
│   └── [13 other existing tools]
├── schema/
│   ├── schema-service.ts           # Phase 10 (existing)
│   ├── types.ts                    # Phase 10 (existing)
│   ├── disk-persistence.ts         # Phase 10 (existing)
│   └── index.ts                    # Phase 10 barrel exports (existing)
├── shared/
│   ├── params.ts                   # usernameOrAliasParam (existing)
│   └── utils.ts                    # textResponse (existing)
└── index.ts                        # DxCoreMcpProvider — wire new tool here
```

### Pattern 1: McpTool Implementation (from run_soql_query.ts)
**What:** Every tool extends `McpTool<InputArgsShape, OutputArgsShape>` and implements 5 abstract methods
**When to use:** Always — this is the only tool pattern in the project
**Example:**
```typescript
// Source: packages/mcp-provider-dx-core/src/tools/run_soql_query.ts (verified)
export class DescribeObjectMcpTool extends McpTool<InputArgsShape, OutputArgsShape> {
  public constructor(
    private readonly services: Services,
    private readonly schemaService: SchemaService,  // NEW: additional dependency per D-09
  ) {
    super();
  }

  public getReleaseState(): ReleaseState { return ReleaseState.GA; }
  public getToolsets(): Toolset[] { return [Toolset.DATA]; }
  public getName(): string { return 'salesforce_describe_object'; }
  public getConfig(): McpToolConfig<InputArgsShape, OutputArgsShape> { /* ... */ }
  public async exec(input: InputArgs): Promise<CallToolResult> { /* ... */ }
}
```

### Pattern 2: Structured Output with `structuredContent`
**What:** Tools with Zod output schemas return both `content` (text for display) and `structuredContent` (typed data for programmatic consumption)
**When to use:** When a tool has an `outputSchema` — per D-08 this tool requires one
**Example:**
```typescript
// Source: packages/mcp-provider-dx-core/src/tools/run_soql_query.ts:98-102 (verified)
return {
  content: [{ type: 'text' as const, text: `Schema for ${objectName}:\n\n${JSON.stringify(curated, null, 2)}` }],
  structuredContent: curated,  // Must conform to outputSchema
};
```

### Pattern 3: Cache-First with describeAndCache
**What:** SchemaService.describeAndCache() wraps the API call with cache-check + single-flight coalescing
**When to use:** For the core describe flow — per D-03
**Example:**
```typescript
// Source: packages/mcp-provider-dx-core/src/schema/schema-service.ts:97-129 (verified)
const entry = await this.schemaService.describeAndCache(
  orgUsername,
  objectName,
  async () => {
    const result = await connection.describe(objectName);
    return {
      type: SchemaEntryType.FullDescribe,
      data: result as unknown as Record<string, unknown>,
      cachedAt: Date.now(),
    } satisfies FullDescribeEntry;
  },
);
```

### Pattern 4: Error Handling with toolError + classifyError
**What:** Catch SfError, classify it, return structured error with recovery guidance
**When to use:** Always in the catch block of `exec()`
**Example:**
```typescript
// Source: packages/mcp-provider-dx-core/src/tools/run_soql_query.ts:103-124 (verified)
catch (error) {
  const sfErr = SfError.wrap(error);
  return toolError(`Failed to describe object: ${sfErr.message}`, {
    recovery: 'Verify the object API name is correct (e.g., "Account", "Contact", "Custom__c").',
    category: classifyError(sfErr),
  });
}
```

### Pattern 5: Provider Wiring with Additional Constructor Arg
**What:** DxCoreMcpProvider.provideTools() already creates SchemaService — pass it as second arg to the new tool
**When to use:** One-time wiring change in index.ts
**Example:**
```typescript
// Source: packages/mcp-provider-dx-core/src/index.ts:80-113 (verified, then extended)
// In provideTools(), after SchemaService creation:
return [
  // ... existing tools ...
  new DescribeObjectMcpTool(services, schemaService),  // NEW
];
```

### Anti-Patterns to Avoid
- **Returning raw DescribeSObjectResult:** The raw API response includes 60+ fields per Field object, actionOverrides, layout info, etc. This would blow up AI context windows. Always return the curated subset per D-01.
- **Modifying the Services interface:** Per D-09 and canonical refs, SchemaService stays dx-core internal. Never add it to the shared Services interface in mcp-provider-api.
- **Direct cache manipulation:** Use `schemaService.describeAndCache()` instead of manual `get()`/`set()` calls. The method handles cache-check + single-flight coalescing atomically.
- **Forgetting `_meta` on cache hits:** Both cache and API paths must include the `_meta` object. The difference is only `source: 'cache'` vs `source: 'api'`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cache-first describe | Custom cache check + API call | `SchemaService.describeAndCache()` | Already handles cache-first + single-flight + storage [VERIFIED: codebase] |
| Error classification | Custom error categorization | `classifyError()` from mcp-provider-api | Handles known Salesforce error names/patterns [VERIFIED: codebase] |
| Error response formatting | Custom error JSON | `toolError()` from mcp-provider-api | Consistent `[USER_ERROR]`/`[SYSTEM_ERROR]` prefix + recovery [VERIFIED: codebase] |
| Input parameter schemas | Custom Zod param | `usernameOrAliasParam` from shared/params.ts | Includes agent instructions for alias resolution [VERIFIED: codebase] |
| Connection acquisition | Manual org lookup | `services.getOrgService().getConnection()` | Handles auth, caching, validation [VERIFIED: codebase] |

**Key insight:** Almost everything this tool needs already exists. The only new code is: (1) the tool class itself, (2) the Zod output schema, (3) the curate-from-raw function, and (4) the wiring in provideTools().

## Common Pitfalls

### Pitfall 1: Cache Hit Detection Logic
**What goes wrong:** `describeAndCache()` returns a `SchemaEntry` whether from cache or API, with no built-in way to distinguish the source.
**Why it happens:** The `describeAndCache()` method is transparent about caching — it just returns the entry.
**How to avoid:** Check the cache with `schemaService.get()` BEFORE calling `describeAndCache()`. If `get()` returns a result, it's a cache hit. If `get()` returns undefined, the subsequent `describeAndCache()` call will fetch from API.
**Warning signs:** `_meta.source` always says 'api' — means the cache check was skipped.

### Pitfall 2: DescribeSObjectResult Type Casting
**What goes wrong:** The jsforce `DescribeSObjectResult` is typed as a concrete type, but `FullDescribeEntry.data` is `Record<string, unknown>`. Casting incorrectly loses type safety during curation.
**Why it happens:** Phase 10 typed `data` as `Record<string, unknown>` to avoid coupling the cache to jsforce types.
**How to avoid:** Cast `result as unknown as Record<string, unknown>` when storing. When curating, cast back or use safe property access with type guards. The jsforce Field type has 50+ properties — only extract the 6 needed (name, label, type, filterable, updateable, nillable).
**Warning signs:** Runtime errors on missing properties, or TypeScript `any` leaking into the curated output.

### Pitfall 3: Missing usernameOrAlias Guard
**What goes wrong:** `getConnection()` throws if called with undefined/empty username.
**Why it happens:** `usernameOrAlias` is a string param (not optional in Zod, but could be empty).
**How to avoid:** Follow the exact pattern from `run_soql_query.ts:88-92` — check `if (!input.usernameOrAlias)` and return a helpful error pointing to `#get_username`.
**Warning signs:** Unhandled SfError from getConnection with cryptic message.

### Pitfall 4: Object Name Case Sensitivity
**What goes wrong:** User passes "account" but Salesforce API wants "Account". Cache stores lowercase keys (SchemaService normalizes), but `connection.describe()` may fail on wrong case.
**Why it happens:** SchemaService normalizes to lowercase for cache keys, but jsforce doesn't normalize.
**How to avoid:** Pass the original user-provided objectName to `connection.describe()` (Salesforce API is case-insensitive for standard objects). SchemaService handles normalization internally. Document that custom object names should match API name exactly.
**Warning signs:** Cache misses for objects that should be cached.

### Pitfall 5: `_meta.ageMs` Calculation
**What goes wrong:** `ageMs` is calculated but `cachedAt` is stale or set at the wrong time.
**Why it happens:** `cachedAt` is set when the entry is created (in the `describeFn` callback), not when it's returned.
**How to avoid:** Calculate `ageMs = Date.now() - entry.cachedAt` at response time, not at cache time. For API-fresh results, `ageMs` will be near 0.
**Warning signs:** `ageMs` shows 0 for cache hits or very large numbers for fresh API calls.

### Pitfall 6: Partial Cache Entry Returned as Full
**What goes wrong:** SchemaService can store `PartialFieldsEntry` (from Phase 12 auto-cache), but the tool assumes it always gets a `FullDescribeEntry`.
**Why it happens:** `schemaService.get()` returns `SchemaEntry` which is a union type.
**How to avoid:** When checking cache, verify `entry.type === SchemaEntryType.FullDescribe`. If the cached entry is `PartialFields`, treat it as a cache miss for this tool's purposes and call the API. Set `_meta.indicator` based on entry type.
**Warning signs:** Tool returns incomplete data from a partial cache entry.

## Code Examples

### Complete Tool Input Schema
```typescript
// Follows run_soql_query.ts pattern [VERIFIED: codebase]
import { z } from 'zod';
import { usernameOrAliasParam } from '../shared/params.js';

export const describeObjectParamsSchema = z.object({
  objectName: z.string().describe(
    'The API name of the Salesforce sObject to describe (e.g., "Account", "Contact", "Custom_Object__c")'
  ),
  usernameOrAlias: usernameOrAliasParam,
});
```

### Complete Zod Output Schema
```typescript
// Curated schema per D-01, with _meta per D-02
const describeObjectOutputSchema = z.object({
  objectName: z.string(),
  label: z.string(),
  keyPrefix: z.string().nullable(),
  fields: z.array(z.object({
    name: z.string(),
    label: z.string(),
    type: z.string(),
    filterable: z.boolean(),
    updateable: z.boolean(),
    nillable: z.boolean(),
  })),
  childRelationships: z.array(z.object({
    relationshipName: z.string().nullable(),
    childSObject: z.string(),
    field: z.string(),
  })),
  lookupFields: z.array(z.object({
    fieldName: z.string(),
    referenceTo: z.array(z.string()),
    relationshipName: z.string().nullable(),
  })),
  _meta: z.object({
    source: z.enum(['cache', 'api']),
    cachedAt: z.number(),
    ageMs: z.number(),
    indicator: z.enum(['full', 'partial']),
  }),
});
```

### Cache-First Execution Flow
```typescript
// Core exec() flow combining Pitfall 1 (cache detection) + Pattern 3 (describeAndCache)
public async exec(input: InputArgs): Promise<CallToolResult> {
  if (!input.usernameOrAlias) {
    return textResponse(
      'The usernameOrAlias parameter is required. If the user did not specify one, use the #get_username tool.',
      true,
    );
  }

  try {
    const connection = await this.services.getOrgService().getConnection(input.usernameOrAlias);
    const orgUsername = connection.getUsername() ?? input.usernameOrAlias;

    // Check cache first to determine source metadata
    const cached = this.schemaService.get(orgUsername, input.objectName);
    const isCacheHit = cached !== undefined && cached.type === SchemaEntryType.FullDescribe;

    // describeAndCache handles cache-first + single-flight
    const entry = await this.schemaService.describeAndCache(
      orgUsername,
      input.objectName,
      async () => ({
        type: SchemaEntryType.FullDescribe,
        data: (await connection.describe(input.objectName)) as unknown as Record<string, unknown>,
        cachedAt: Date.now(),
      } satisfies FullDescribeEntry),
    );

    // Curate response from raw DescribeSObjectResult
    const curated = curateDescribeResult(entry, isCacheHit);
    
    return {
      content: [{ type: 'text' as const, text: formatTextResponse(curated) }],
      structuredContent: curated,
    };
  } catch (error) {
    const sfErr = SfError.wrap(error);
    return toolError(`Failed to describe object "${input.objectName}": ${sfErr.message}`, {
      recovery: 'Verify the object API name is correct (e.g., "Account", "Contact", "Custom_Object__c"). Standard objects use PascalCase; custom objects end with "__c".',
      category: classifyError(sfErr),
    });
  }
}
```

### Curation Function (Extract from Raw DescribeSObjectResult)
```typescript
// Source: jsforce DescribeSObjectResult type [VERIFIED: node_modules/@jsforce/jsforce-node/lib/types/common.d.ts]
// Field type has: name, label, type, filterable, updateable, nillable, referenceTo, relationshipName (+ ~45 others)
// ChildRelationship type has: relationshipName, childSObject, field, cascadeDelete, etc.

function curateDescribeResult(entry: SchemaEntry, isCacheHit: boolean): CuratedDescribeResult {
  const data = (entry as FullDescribeEntry).data;
  const fields = (data.fields as Array<Record<string, unknown>>) ?? [];
  const childRels = (data.childRelationships as Array<Record<string, unknown>>) ?? [];

  return {
    objectName: data.name as string,
    label: data.label as string,
    keyPrefix: (data.keyPrefix as string) ?? null,
    fields: fields.map(f => ({
      name: f.name as string,
      label: f.label as string,
      type: f.type as string,
      filterable: f.filterable as boolean,
      updateable: f.updateable as boolean,
      nillable: f.nillable as boolean,
    })),
    childRelationships: childRels.map(cr => ({
      relationshipName: (cr.relationshipName as string) ?? null,
      childSObject: cr.childSObject as string,
      field: cr.field as string,
    })),
    lookupFields: fields
      .filter(f => Array.isArray(f.referenceTo) && (f.referenceTo as string[]).length > 0)
      .map(f => ({
        fieldName: f.name as string,
        referenceTo: f.referenceTo as string[],
        relationshipName: (f.relationshipName as string) ?? null,
      })),
    _meta: {
      source: isCacheHit ? 'cache' as const : 'api' as const,
      cachedAt: entry.cachedAt,
      ageMs: Date.now() - entry.cachedAt,
      indicator: 'full' as const,
    },
  };
}
```

### Provider Wiring (index.ts change)
```typescript
// Source: packages/mcp-provider-dx-core/src/index.ts:97-113 (verified)
// Add import at top:
import { DescribeObjectMcpTool } from './tools/describe_object.js';

// In provideTools() return array, add:
new DescribeObjectMcpTool(services, schemaService),
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No schema discovery | Phase 11 adds `salesforce_describe_object` | v1.3 | AI agents can inspect schema before writing SOQL |
| Raw API responses | Curated field subset | D-01 decision | Reduces context window consumption |
| No cache transparency | `_meta` object on every response | D-02 decision | AI agents see cache status |

**Existing references:**
- `run_soql_query.ts:117` already references `salesforce_describe_object` in error recovery: "Use salesforce_describe_object to verify available fields" [VERIFIED: codebase]
- `tool-categories.ts:8` already has `salesforce_describe_object: 'read'` placeholder [VERIFIED: codebase]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `connection.getUsername()` returns the canonical username needed for SchemaService org key | Code Examples | If it returns alias instead, cache keys won't match. Fallback to `input.usernameOrAlias` mitigates. |
| A2 | jsforce `connection.describe()` is case-insensitive for standard object names | Pitfall 4 | If case-sensitive, tool should normalize input or document requirement. Low risk — Salesforce REST API is known case-insensitive. |
| A3 | Tool should use `Toolset.DATA` (same as run_soql_query) | Architecture Patterns | If schema tools need a separate toolset, it would affect tool grouping. Low impact — easily changed. |

**If this table is empty:** N/A — three low-risk assumptions identified above.

## Open Questions

1. **`connection.getUsername()` return value**
   - What we know: SchemaService keys on canonical username (per STATE.md decision). Connection objects come from `getOrgService().getConnection()`.
   - What's unclear: Whether `getUsername()` returns the canonical username or might return undefined/alias.
   - Recommendation: Use `connection.getUsername() ?? input.usernameOrAlias` as fallback. If `getUsername()` returns undefined, the cache will still work but won't be canonical. Acceptable for Phase 11.

2. **Field count summary in response**
   - What we know: D-01 specifies the fields to extract. Agent's discretion includes "whether to include field count summary."
   - What's unclear: Whether a `fieldCount` / `relationshipCount` / `lookupCount` would be useful for AI context.
   - Recommendation: Include counts as top-level properties. They cost almost nothing and help AI agents decide whether to paginate or filter.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Mocha + Chai + Sinon (with nyc coverage) |
| Config file | `packages/mcp-provider-dx-core/.mocharc.json` |
| Quick run command | `cd packages/mcp-provider-dx-core && npx mocha "test/unit/schema/describe-object*.test.ts"` |
| Full suite command | `cd packages/mcp-provider-dx-core && yarn test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DISC-04 | Tool returns field metadata, relationships, key prefix | unit | `npx mocha "test/unit/schema/describe-object.test.ts" --grep "curated fields"` | ❌ Wave 0 |
| DISC-04 | Tool handles invalid object name with recovery guidance | unit | `npx mocha "test/unit/schema/describe-object.test.ts" --grep "error handling"` | ❌ Wave 0 |
| DISC-05 | Cache hit returns _meta with source='cache', age, indicator | unit | `npx mocha "test/unit/schema/describe-object.test.ts" --grep "cache hit"` | ❌ Wave 0 |
| DISC-05 | Cache miss calls API and returns _meta with source='api' | unit | `npx mocha "test/unit/schema/describe-object.test.ts" --grep "cache miss"` | ❌ Wave 0 |
| DISC-06 | Tool description contains recommendation text | unit | `npx mocha "test/unit/schema/describe-object.test.ts" --grep "description"` | ❌ Wave 0 |
| ALL | Output schema validates curated result | unit | `npx mocha "test/unit/schema/describe-object.test.ts" --grep "output schema"` | ❌ Wave 0 |
| ALL | Tool registered in provideTools with correct name | unit | Existing `test/e2e/tool-registration.test.ts` can verify | ✅ Existing (extend) |

### Sampling Rate
- **Per task commit:** `cd packages/mcp-provider-dx-core && npx mocha "test/unit/schema/describe-object*.test.ts"`
- **Per wave merge:** `cd packages/mcp-provider-dx-core && yarn test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/unit/schema/describe-object.test.ts` — covers DISC-04, DISC-05, DISC-06
- [ ] Mock fixtures for DescribeSObjectResult (Account with 30+ fields, childRelationships, lookups)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A — connection auth handled by OrgService |
| V3 Session Management | no | N/A — session handled by @salesforce/core |
| V4 Access Control | yes | Permission check via PermissionService (tool-categories.ts classifies as 'read') |
| V5 Input Validation | yes | Zod schema validates objectName (string), usernameOrAlias (string with sanitizePath pattern) |
| V6 Cryptography | no | N/A — no crypto operations |

### Known Threat Patterns for Salesforce MCP Tools

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Object name injection (e.g., SOSL/SOQL in objectName) | Tampering | `connection.describe()` takes a plain sObject name — not a query. Salesforce API rejects invalid names. |
| Unauthorized org access | Elevation | PermissionService.canExecuteCategory() checks org-level permissions before tool execution |
| Cache poisoning via concurrent requests | Tampering | Single-flight coalescing ensures only one API call per org+object — all waiters get same result |

## Sources

### Primary (HIGH confidence)
- `packages/mcp-provider-dx-core/src/tools/run_soql_query.ts` — Reference McpTool implementation pattern
- `packages/mcp-provider-dx-core/src/tools/run_apex_test.ts` — Reference structured output pattern
- `packages/mcp-provider-dx-core/src/schema/schema-service.ts` — SchemaService API (get, set, describeAndCache)
- `packages/mcp-provider-dx-core/src/schema/types.ts` — FullDescribeEntry, SchemaEntry types
- `packages/mcp-provider-dx-core/src/index.ts` — DxCoreMcpProvider.provideTools() wiring
- `packages/mcp-provider-api/src/tools.ts` — McpTool abstract class
- `packages/mcp-provider-api/src/errors.ts` — toolError, classifyError utilities
- `packages/mcp/src/utils/tool-categories.ts` — Existing placeholder entry
- `node_modules/@jsforce/jsforce-node/lib/types/common.d.ts` — DescribeSObjectResult, Field, ChildRelationship types
- `node_modules/@jsforce/jsforce-node/lib/connection.d.ts` — `describe(type: string): Promise<DescribeSObjectResult>`

### Secondary (MEDIUM confidence)
- `packages/mcp-provider-dx-core/test/unit/schema/schema-service.test.ts` — Test patterns with Mocha+Chai+Sinon
- `packages/mcp-provider-dx-core/test/unit/structured-output.test.ts` — Output schema validation test patterns

### Tertiary (LOW confidence)
- None — all findings verified against codebase.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all dependencies are existing workspace packages, verified in codebase
- Architecture: HIGH — follows 14 existing tool implementations exactly, with one minor extension (SchemaService constructor arg)
- Pitfalls: HIGH — identified from direct code analysis, particularly cache hit detection and type casting
- Test patterns: HIGH — verified from existing test files using same framework

**Research date:** 2026-04-12
**Valid until:** 2026-05-12 (stable — internal codebase patterns, not external API)
