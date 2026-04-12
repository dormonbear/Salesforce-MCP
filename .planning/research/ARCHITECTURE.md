# Architecture Research

**Domain:** Salesforce MCP Server — v1.3 Smart Schema Cache
**Researched:** 2026-04-12
**Confidence:** HIGH (based on direct codebase inspection; all integration points verified against actual source)

---

## Existing Architecture Baseline (post-v1.2)

```
index.ts (CLI entry — McpServerCommand)
  └─ resolveSymbolicOrgs() → Cache.safeSet('allowedOrgs', ...)
  └─ new SfMcpServer(serverInfo, options)
       └─ registerTool(name, config, cb) — middleware chain:
            1. Permission check (targetOrg)
            2. Rate limit check
            3. Serialized dispatch (lwc-experts Mutex)
            4. await cb(args, extra)    ← McpTool.exec()
            5. Telemetry emit
  └─ new Services({ telemetry, dataDir, startupFlags, orgPermissions, authorizedOrgs })
       └─ getOrgService()       — delegates to auth.ts + Cache
       └─ getTelemetryService() — TelemetryService impl
       └─ getConfigService()    — dataDir + startupFlags
       └─ getPermissionService()— org-permissions.ts
  └─ registerToolsets(...)
       └─ MCP_PROVIDER_REGISTRY → McpProvider[]
            └─ DxCoreMcpProvider.provideTools(services) → McpTool[]
                 └─ QueryOrgMcpTool (run_soql_query)
                 └─ ... 13 other tools
```

**Existing `Cache` class** (`packages/mcp/src/utils/cache.ts`):
- Singleton `Map` keyed by `CacheContents` type (`allowedOrgs: Set<string>`, `tools: ToolInfo[]`)
- Thread-safe via `Mutex` for `safeGet/safeSet/safeUpdate`
- Typed: extending it requires modifying `CacheContents` type — this is intentional

**Key constraint for v1.3:** `Cache` is in `packages/mcp` (server package). Tool implementations live in `packages/mcp-provider-dx-core`. Tools access state only via `Services`. Therefore, any new schema cache capability tools need must be exposed as a new service method on the `Services` interface in `mcp-provider-api`.

---

## System Overview: v1.3 Additions

```
┌─────────────────────────────────────────────────────────────────────┐
│                    packages/mcp (server layer)                       │
│                                                                      │
│  SfMcpServer                    Services                             │
│  └─ registerTool() middleware   └─ getOrgService()                   │
│       (unchanged)               └─ getTelemetryService()             │
│                                 └─ getConfigService()                │
│                                 └─ getPermissionService()            │
│                                 └─ getSchemaService()  [NEW]         │
│                                      │                               │
│  Cache (extended)                    │                               │
│  └─ allowedOrgs: Set<string>         │                               │
│  └─ tools: ToolInfo[]                │                               │
│  └─ schemaCache: OrgSchemaStore [NEW]│                               │
│       └─ Map<orgId, SchemaCache>  ◄──┘                               │
│            └─ objects: Map<sObjectType, DescribeSObjectResult>       │
│            └─ graph: RelationshipGraph                               │
│            └─ queryHistory: QueryHistoryEntry[]                      │
├─────────────────────────────────────────────────────────────────────┤
│              packages/mcp-provider-api (contract layer)              │
│                                                                      │
│  Services interface — add SchemaService                  [NEW]       │
│  SchemaService interface                                 [NEW]       │
│    getObjectSchema(org, sObjectType)                                 │
│    cacheFromQuery(org, soql, result)                                 │
│    describeAndCache(org, sObjectType, connection)                    │
│    suggestFields(org, sObjectType, badField) → string[]              │
│    getRelationships(org, sObjectType) → RelationshipEdge[]           │
│    addQueryHistory(org, entry)                                       │
│    getQueryHistory(org) → QueryHistoryEntry[]                        │
│  Types: SObjectSchema, RelationshipGraph, QueryHistoryEntry  [NEW]   │
├─────────────────────────────────────────────────────────────────────┤
│         packages/mcp-provider-dx-core (tool layer)                   │
│                                                                      │
│  run_soql_query.ts                    [MODIFIED]                     │
│    success path → cacheFromQuery()                                   │
│    failure path → describeAndCache() + suggestFields()               │
│                                                                      │
│  describe_object.ts (new tool)        [NEW]                          │
│    calls connection.describe(sObjectType)                            │
│    stores result via describeAndCache()                              │
│                                                                      │
│  soql_query_history.ts (new tool)     [NEW]                          │
│    calls getQueryHistory()                                           │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Component Responsibilities

| Component | Package | Responsibility | New / Modified |
|-----------|---------|----------------|----------------|
| `SchemaService` interface | `mcp-provider-api` | Contract for all schema operations | NEW |
| `SchemaCache` types | `mcp-provider-api` | `SObjectSchema`, `RelationshipGraph`, `QueryHistoryEntry` | NEW |
| `Services` interface | `mcp-provider-api` | Add `getSchemaService(): SchemaService` | MODIFIED |
| `OrgSchemaStore` | `packages/mcp/src/utils/schema-cache.ts` | Per-org Map of described objects + graph + query history | NEW |
| `SchemaServiceImpl` | `packages/mcp/src/schema-service.ts` | Implements `SchemaService`; owns `OrgSchemaStore`; calls `connection.describe()` | NEW |
| `SoqlParser` | `packages/mcp/src/utils/soql-parser.ts` | Extracts object/field names from a SOQL string | NEW |
| `FuzzyMatcher` | `packages/mcp/src/utils/fuzzy-matcher.ts` | Edit-distance field name suggestions | NEW |
| `Cache` (extended) | `packages/mcp/src/utils/cache.ts` | Add `schemaCache` key to `CacheContents` | MODIFIED |
| `Services` class | `packages/mcp/src/services.ts` | Instantiate and expose `SchemaServiceImpl` | MODIFIED |
| `run_soql_query` | `mcp-provider-dx-core` | Hook success/failure to `SchemaService` | MODIFIED |
| `describe_object` (new tool) | `mcp-provider-dx-core` | Call `connection.describe()` + populate cache | NEW |
| `soql_query_history` (new tool) | `mcp-provider-dx-core` | Read query history from `SchemaService` | NEW |

---

## Recommended Project Structure

New files only (existing structure unchanged):

```
packages/
├── mcp-provider-api/src/
│   ├── schema.ts              # SchemaService interface + all schema types
│   └── index.ts               # export SchemaService + types (MODIFIED)
│
├── mcp/src/
│   ├── utils/
│   │   ├── schema-cache.ts    # OrgSchemaStore data structure
│   │   ├── soql-parser.ts     # SOQL → {objects, fields} extractor
│   │   └── fuzzy-matcher.ts   # edit-distance field name suggestion
│   ├── schema-service.ts      # SchemaServiceImpl (implements SchemaService)
│   └── services.ts            # MODIFIED: instantiate SchemaServiceImpl
│
└── mcp-provider-dx-core/src/
    └── tools/
        ├── run_soql_query.ts  # MODIFIED: hook success + failure paths
        ├── describe_object.ts # NEW tool: salesforce_describe_object
        └── soql_query_history.ts  # NEW tool: salesforce_query_history
```

**Structure rationale:**

- **`schema.ts` in `mcp-provider-api`:** Tool packages import only from `mcp-provider-api`. Putting the `SchemaService` interface there means `mcp-provider-dx-core` never takes a direct dependency on `packages/mcp`.
- **`schema-service.ts` in `packages/mcp`:** This is the only package that can hold the singleton `Cache`. The implementation class stays here; the interface is in `mcp-provider-api`.
- **`utils/schema-cache.ts` separate from `schema-service.ts`:** Data structure and service logic stay separate. `schema-cache.ts` is a plain data container (no async, no connection calls); `schema-service.ts` orchestrates it.
- **`utils/soql-parser.ts` and `utils/fuzzy-matcher.ts` as independent utils:** Both are pure functions with no external deps. Easy to unit test in isolation. If a third-party SOQL parser is later adopted (e.g. `soql-parser-js`), only `soql-parser.ts` changes.

---

## Architectural Patterns

### Pattern 1: Service Interface in `mcp-provider-api`, Implementation in `packages/mcp`

**What:** Define the `SchemaService` interface in `mcp-provider-api` alongside the existing `OrgService`, `TelemetryService`, etc. Implement it in `packages/mcp/src/schema-service.ts` as `SchemaServiceImpl`. Expose via `Services.getSchemaService()`.

**When to use:** Any capability that tools need access to but that holds state that must live in the server singleton.

**Why this is the right pattern here:** Tools in `mcp-provider-dx-core` already get all services via the `Services` injection. Adding `getSchemaService()` is consistent with how `getOrgService()`, `getTelemetryService()`, etc. work. It avoids direct imports from `packages/mcp` in tool packages, maintaining the unidirectional dependency: `mcp-provider-dx-core` → `mcp-provider-api` ← `packages/mcp`.

```typescript
// mcp-provider-api/src/schema.ts
export interface SchemaService {
  getObjectSchema(orgId: string, sObjectType: string): SObjectSchema | undefined;
  describeAndCache(orgId: string, sObjectType: string, connection: Connection): Promise<SObjectSchema>;
  cacheFromSuccessfulQuery(orgId: string, soql: string, records: Record<string, unknown>[]): void;
  suggestFields(orgId: string, sObjectType: string, badFieldName: string): string[];
  getRelationships(orgId: string, sObjectType: string): RelationshipEdge[];
  addQueryHistory(orgId: string, entry: QueryHistoryEntry): void;
  getQueryHistory(orgId: string, limit?: number): QueryHistoryEntry[];
}
```

---

### Pattern 2: Per-Org Cache Isolation via `orgId` Key

**What:** All schema data is stored in a `Map<string, OrgSchemaBucket>` keyed by the resolved org username (same identifier used throughout the codebase). Each bucket holds that org's described objects, relationship graph, and query history independently.

**When to use:** Any data that must not bleed between org contexts.

**Why `orgId` (username) not `usernameOrAlias`:** `run_soql_query` receives `usernameOrAlias` from the user. The middleware in `SfMcpServer.registerTool()` injects it as `args.usernameOrAlias` (line 201 of `sf-mcp-server.ts`). At the tool level, this value has already been validated as an authorized org. Use this value directly as the cache partition key. No secondary resolution needed.

```typescript
// packages/mcp/src/utils/schema-cache.ts
export type OrgSchemaBucket = {
  objects: Map<string, SObjectSchema>;    // key: lowercase sObjectType
  queryHistory: QueryHistoryEntry[];
};

export class OrgSchemaStore {
  private readonly buckets = new Map<string, OrgSchemaBucket>();

  getOrCreate(orgId: string): OrgSchemaBucket {
    if (!this.buckets.has(orgId)) {
      this.buckets.set(orgId, { objects: new Map(), queryHistory: [] });
    }
    return this.buckets.get(orgId)!;
  }
}
```

**Relationship graph storage:** Relationships are derivable from the `DescribeSObjectResult.fields` (each field with `type === 'reference'` has `referenceTo[]`). The graph does not need its own storage slot — `getRelationships(orgId, sObjectType)` computes them on-demand from the already-cached `SObjectSchema`. This avoids a separate graph update step.

---

### Pattern 3: Intercept run_soql_query at the Tool Level (not Middleware)

**What:** `run_soql_query.exec()` branches on success vs failure and calls `SchemaService` accordingly. No changes to `SfMcpServer` middleware.

**When to use:** Any Salesforce-domain-specific enrichment that depends on the query content and result.

**Why NOT in middleware:** `SfMcpServer.registerTool()` middleware is org-agnostic and domain-agnostic. It handles auth, rate limiting, telemetry — concerns that apply uniformly to all 49+ tools. Schema caching is specific to SOQL queries. Adding it to the middleware would require the middleware to inspect tool names and parse SOQL, which violates its purpose.

**Success path:**

```typescript
// run_soql_query.ts exec() — success branch
const result = await connection.query(input.query);
// Best-effort: extract field presence from records (no describe call needed)
this.services.getSchemaService().cacheFromSuccessfulQuery(
  input.usernameOrAlias,
  input.query,
  result.records
);
```

`cacheFromSuccessfulQuery` uses the SOQL parser to extract the sObjectType from the `FROM` clause, then infers field names from the returned record keys. This populates the cache without an extra network call on the happy path.

**Failure path:**

```typescript
// run_soql_query.ts exec() — catch block (INVALID_FIELD / MALFORMED_QUERY)
const sfErr = SfError.wrap(error);
if (isFieldError(sfErr)) {
  const { sObjectType, badField } = extractFromError(sfErr, input.query);
  if (sObjectType) {
    await this.services.getSchemaService().describeAndCache(
      input.usernameOrAlias, sObjectType, connection
    );
    const suggestions = this.services.getSchemaService().suggestFields(
      input.usernameOrAlias, sObjectType, badField
    );
    return toolError(sfErr.message, {
      recovery: suggestions.length > 0
        ? `Did you mean: ${suggestions.join(', ')}? Use salesforce_describe_object to list all fields.`
        : 'Use salesforce_describe_object to list available fields.',
      category: 'user',
    });
  }
}
```

This is additive — the existing `toolError` return is preserved. The describe call is a best-effort enhancement: if it fails, the original error is returned unchanged.

---

### Pattern 4: SOQL Parsing — Simple Over Complete

**What:** `soql-parser.ts` extracts only what the schema cache needs: the primary `FROM` sObjectType and the list of field names in the `SELECT` clause. Not a full SOQL AST.

**When to use:** Any time a SOQL string needs to be inspected for caching purposes.

**Why not a full parser library:** The use case is narrow. We need the `FROM` object name and optionally `SELECT` field names. A regex/split approach handles 95% of real queries. Introducing an npm SOQL parser adds a dependency, parse-edge-cases, and maintenance burden. If parsing fails, the schema service degrades gracefully (skips caching, no error surfaced to user).

```typescript
// packages/mcp/src/utils/soql-parser.ts
export type SoqlInfo = {
  sObjectType: string | null;
  fields: string[];
};

export function parseSoql(soql: string): SoqlInfo {
  // Case-insensitive FROM extraction
  const fromMatch = soql.match(/\bFROM\s+(\w+)/i);
  const sObjectType = fromMatch?.[1] ?? null;

  // SELECT field list (stop at FROM)
  const selectMatch = soql.match(/SELECT\s+(.*?)\s+FROM\b/is);
  const fields = selectMatch
    ? selectMatch[1].split(',').map(f => f.trim().split('.').pop()!.toLowerCase())
    : [];

  return { sObjectType, fields };
}
```

**Limitation:** Relationship queries (`Account.Name` style) extract only the terminal field name. Subqueries are ignored. This is intentional — the cache benefits from partial info rather than needing complete accuracy.

---

### Pattern 5: Fuzzy Matching — Levenshtein Distance, No External Dep

**What:** `FuzzyMatcher.suggest(candidates, input, maxResults)` returns the closest field names from the cached schema by edit distance. Implemented as a standalone pure function.

**When to use:** SOQL failure path when `INVALID_FIELD` error is returned and the offending field name is extractable.

**Why Levenshtein, no library:** The candidate set is the field list from one sObject — typically 50-200 fields. An O(n * m * k) Levenshtein scan where n=200 fields, m=k≈20 chars is microseconds. No package needed. The field name to match comes from the error message or SOQL parser — it is a short string.

**Maximum suggestions returned:** 3. More than 3 suggestions is noise in a recovery message.

---

## Data Flow

### Flow 1: Successful SOQL Query (new caching side-effect)

```
run_soql_query.exec(input)
  └─ connection.query(input.query)             ← @salesforce/core
       └─ success: QueryResult { records }
  └─ schemaService.cacheFromSuccessfulQuery(org, soql, records)
       └─ soqlParser.parseSoql(soql) → { sObjectType, fields }
       └─ orgSchemaStore.getOrCreate(org)
            └─ bucket.objects.set(sObjectType, partialSchema(fields))
       └─ (best-effort: no await, no throw)
  └─ schemaService.addQueryHistory(org, { soql, timestamp, success: true })
  └─ return { content, structuredContent }
```

### Flow 2: Failed SOQL Query (new auto-describe path)

```
run_soql_query.exec(input)
  └─ connection.query(input.query)             ← @salesforce/core
       └─ throws SfError (INVALID_FIELD / MALFORMED_QUERY)
  └─ catch(error):
       └─ sfErr = SfError.wrap(error)
       └─ isFieldError(sfErr)?
            └─ YES:
                 └─ extractFromError(sfErr, soql) → { sObjectType, badField }
                 └─ schemaService.describeAndCache(org, sObjectType, connection)
                      └─ connection.describe(sObjectType)  ← @salesforce/core
                      └─ orgSchemaStore stores DescribeSObjectResult
                 └─ schemaService.suggestFields(org, sObjectType, badField)
                      └─ fuzzyMatcher.suggest(cachedFields, badField, 3)
                 └─ toolError(sfErr.message, { recovery: suggestionsText })
            └─ NO: existing error handling (unchanged)
  └─ schemaService.addQueryHistory(org, { soql, timestamp, success: false, error: sfErr.message })
```

### Flow 3: describe_object tool (explicit cache population)

```
describe_object.exec({ usernameOrAlias, sObjectType })
  └─ connection = services.getOrgService().getConnection(usernameOrAlias)
  └─ schemaService.describeAndCache(usernameOrAlias, sObjectType, connection)
       └─ connection.describe(sObjectType)    ← @salesforce/core
       └─ orgSchemaStore.getOrCreate(org)
            └─ bucket.objects.set(sObjectType, fullSchema)
  └─ return { content: [fieldListText], structuredContent: describedFields }
```

### Flow 4: Cache Warm-Up at Startup (optional, deferred)

Startup-time pre-warming is out of scope for v1.3. The cache fills lazily from tool calls. Pre-warming would require iterating all allowed orgs and calling `describe()` for common objects — a network-intensive startup path that is deferred to a future milestone.

---

## Integration Points

### New vs Modified: Explicit Inventory

**NEW files (create from scratch):**

| File | Package | Purpose |
|------|---------|---------|
| `src/schema.ts` | `mcp-provider-api` | `SchemaService` interface + `SObjectSchema`, `RelationshipEdge`, `QueryHistoryEntry` types |
| `src/utils/schema-cache.ts` | `packages/mcp` | `OrgSchemaStore`, `OrgSchemaBucket` data structures |
| `src/utils/soql-parser.ts` | `packages/mcp` | `parseSoql()` — extract sObjectType and fields from SOQL string |
| `src/utils/fuzzy-matcher.ts` | `packages/mcp` | `suggestFields()` — Levenshtein-based field name suggestions |
| `src/schema-service.ts` | `packages/mcp` | `SchemaServiceImpl` implementing `SchemaService` |
| `src/tools/describe_object.ts` | `mcp-provider-dx-core` | `DescribeObjectMcpTool` — `salesforce_describe_object` |
| `src/tools/soql_query_history.ts` | `mcp-provider-dx-core` | `QueryHistoryMcpTool` — `salesforce_query_history` |

**MODIFIED files (targeted changes to existing files):**

| File | Package | What Changes |
|------|---------|-------------|
| `src/index.ts` | `mcp-provider-api` | Export `SchemaService` and related types from `schema.ts` |
| `src/services.ts` | `mcp-provider-api` | Add `getSchemaService(): SchemaService` to `Services` interface |
| `src/utils/cache.ts` | `packages/mcp` | Add `schemaStore: OrgSchemaStore` to `CacheContents` type and `initialize()` |
| `src/services.ts` | `packages/mcp` | Instantiate `SchemaServiceImpl`; expose via `getSchemaService()` |
| `src/tools/run_soql_query.ts` | `mcp-provider-dx-core` | Add success-path caching + failure-path auto-describe + suggestions |
| `src/index.ts` | `mcp-provider-dx-core` | Register `DescribeObjectMcpTool` and `QueryHistoryMcpTool` in `provideTools()` |
| `src/utils/tool-categories.ts` | `packages/mcp` | Register `salesforce_describe_object` and `salesforce_query_history` as `'read'` tools |

**UNCHANGED (confirmed by analysis):**

- `SfMcpServer` — no changes to middleware; schema logic stays in tools
- `registry-utils.ts` — no new registration mechanisms needed (new tools auto-register via `DxCoreMcpProvider.provideTools()`)
- `index.ts` (server entry) — no new capabilities needed for schema cache features
- All other tool files — untouched

---

## Dependency Direction

```
mcp-provider-dx-core
        │
        ▼ imports
mcp-provider-api     ← SchemaService interface lives here
        ▲ implements
        │
packages/mcp         ← SchemaServiceImpl, OrgSchemaStore, utils live here
```

This is the same direction as today. No circular dependencies introduced.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Putting Schema Cache Logic in Middleware

**What people do:** Add describe/caching logic to `SfMcpServer.registerTool()` wrappedCb, checking `if (name === 'run_soql_query')`.

**Why it's wrong:** The middleware is tool-name-agnostic by design. Domain logic that inspects tool names belongs in the tool, not the middleware. This also makes the middleware harder to test and reason about.

**Do this instead:** Keep schema enrichment in `run_soql_query.exec()`. The middleware calls `exec()` — the tool owns its own enrichment logic.

---

### Anti-Pattern 2: Importing from `packages/mcp` in Tool Packages

**What people do:** Import `SchemaServiceImpl` or `OrgSchemaStore` directly in `mcp-provider-dx-core/src/tools/run_soql_query.ts`.

**Why it's wrong:** Creates a circular dependency (`dx-core` → `mcp` → `dx-core` is the current registry chain). Also breaks the provider abstraction — providers must be usable without the specific server package.

**Do this instead:** Import only from `mcp-provider-api`. All schema types and the `SchemaService` interface live there. The implementation is injected via `Services`.

---

### Anti-Pattern 3: Describing on Every Failed Query

**What people do:** Call `connection.describe(sObjectType)` for every SOQL error regardless of error type.

**Why it's wrong:** Many SOQL failures are syntax errors (missing `WHERE` keyword, malformed expressions) where describing the object provides no help and wastes a network round-trip. The error message payload to the LLM is also longer.

**Do this instead:** Describe only on `INVALID_FIELD` errors (Salesforce error code). Parse the error message to extract the bad field name first. If the error is `MALFORMED_QUERY`, return the original error unchanged.

---

### Anti-Pattern 4: Blocking the Success Path on Caching

**What people do:** `await schemaService.cacheFromSuccessfulQuery(...)` in the success path, surfacing cache errors to the caller.

**Why it's wrong:** The query succeeded. Cache population is a side-effect enhancement — if it fails (malformed SOQL that still executed, unusual field types, internal error), the user should receive their query results unchanged.

**Do this instead:** Wrap the caching call in a try/catch that discards errors silently. Never let cache population fail a successful query result.

---

### Anti-Pattern 5: Adding a `Mutex` to `OrgSchemaStore`

**What people do:** Protect `OrgSchemaStore` reads/writes with a `Mutex` for thread safety.

**Why it's wrong (for this use case):** The server runs on Node.js single-threaded event loop. Schema cache writes happen in `async` `exec()` methods. JavaScript's event loop ensures that a single `Map.set()` is atomic. The existing `Cache.mutex` protects `CacheContents` for the allowedOrgs Set (which uses `safeUpdate` for read-modify-write across ticks). Schema writes are pure overwrites (`map.set(key, value)`) — no read-modify-write pattern — so no mutex is needed.

**Do this instead:** Access `OrgSchemaStore` directly without mutex. If future requirements add a read-modify-write pattern (e.g., merging partial schema into existing), revisit at that time.

---

## Suggested Build Order

Dependencies constrain this order. The interface contract must exist before the implementation, which must exist before the tool modifications.

### Phase 1 — Schema Types and Service Interface (Foundation)

**Files:** `mcp-provider-api/src/schema.ts`, `mcp-provider-api/src/index.ts`, `mcp-provider-api/src/services.ts`

**Rationale:** All downstream work depends on these types. Define `SObjectSchema`, `RelationshipEdge`, `QueryHistoryEntry`, and the `SchemaService` interface first. Update `Services` interface to include `getSchemaService()`. This compiles in isolation.

**Unblocks:** Phases 2 and 3 in parallel.

---

### Phase 2 — Storage and Utility Primitives

**Files:** `packages/mcp/src/utils/schema-cache.ts`, `packages/mcp/src/utils/soql-parser.ts`, `packages/mcp/src/utils/fuzzy-matcher.ts`

**Rationale:** Pure data structures and pure functions. No external service calls. All three are independently unit-testable. Write tests first (TDD applies cleanly here — `parseSoql` and `suggestFields` are deterministic pure functions).

**Dependency on:** Phase 1 (types from `mcp-provider-api`)

---

### Phase 3 — SchemaServiceImpl + Cache Extension

**Files:** `packages/mcp/src/schema-service.ts`, `packages/mcp/src/utils/cache.ts` (modify), `packages/mcp/src/services.ts` (modify)

**Rationale:** Implement the `SchemaService` interface using Phase 2 primitives. Extend `CacheContents` to hold `OrgSchemaStore`. Wire into `Services` class.

**Dependency on:** Phases 1 and 2

---

### Phase 4 — describe_object Tool (Standalone New Tool)

**Files:** `mcp-provider-dx-core/src/tools/describe_object.ts`, register in `index.ts`, `tool-categories.ts`

**Rationale:** This tool stands alone — it calls `describeAndCache()` and returns the result. No dependency on query history or fuzzy matching. Can be built and tested independently of `run_soql_query` modifications.

**Dependency on:** Phase 3

---

### Phase 5 — run_soql_query Modifications

**Files:** `mcp-provider-dx-core/src/tools/run_soql_query.ts`

**Rationale:** This is the most complex modification. Builds on all prior phases: needs `SchemaService` (Phase 3), `soql-parser` (Phase 2), and `fuzzy-matcher` (Phase 2) to work through `SchemaService`. The existing tests for `run_soql_query` must pass unchanged — the caching side-effects are invisible to callers.

**Dependency on:** Phases 3 and 4 (the `describe_object` pattern validates `describeAndCache` works end-to-end)

---

### Phase 6 — Query History Tool

**Files:** `mcp-provider-dx-core/src/tools/soql_query_history.ts`, register in `index.ts`, `tool-categories.ts`

**Rationale:** Simplest new tool — reads from `getQueryHistory()`. Can only be meaningful after Phase 5 (which populates history). Register last.

**Dependency on:** Phase 5

---

### Dependency Graph

```
Phase 1 (Interface + Types)
    │
    ├─── Phase 2 (Storage + Utils)
    │         │
    │         └─── Phase 3 (SchemaServiceImpl + Cache wiring)
    │                   │
    │                   ├─── Phase 4 (describe_object tool)
    │                   │         │
    │                   │         └─── Phase 5 (run_soql_query modifications)
    │                   │                   │
    │                   │                   └─── Phase 6 (query history tool)
    │                   │
    │                   └─── (Phase 4 also feeds Phase 5)
```

Phases 1 → 2 → 3 are strictly sequential. Phases 4 and 5 are sequential within the tool chain. Phase 6 is last.

---

## Confidence Assessment

| Area | Confidence | Basis |
|------|------------|-------|
| Service interface placement (`mcp-provider-api`) | HIGH | Direct inspection of existing `OrgService`, `TelemetryService` pattern; same unidirectional dependency |
| Cache extension (`CacheContents`) | HIGH | Direct inspection of `cache.ts` — typed key map, extension pattern is clear |
| `connection.describe()` availability | HIGH | `@salesforce/core` `Connection` type; used in existing tools for `connection.query()` |
| Tool-level interception (not middleware) | HIGH | `SfMcpServer.registerTool()` inspected — domain logic has no place there |
| Levenshtein without library | HIGH | Node.js standard; 50-200 field candidate set is trivially small |
| SOQL regex parsing sufficiency | MEDIUM | Covers SELECT/FROM/WHERE patterns; subqueries and relationship queries are edge cases |
| Per-org isolation via username key | HIGH | `usernameOrAlias` is injected by middleware and used uniformly across existing tools |
| No Mutex needed on `OrgSchemaStore` | HIGH | Single-threaded Node.js event loop; pure `Map.set()` overwrites are atomic |

---

## Sources

- Direct inspection: `packages/mcp/src/utils/cache.ts` — `CacheContents` type, Mutex pattern
- Direct inspection: `packages/mcp/src/services.ts` — `Services` class, all four `get*Service()` methods
- Direct inspection: `packages/mcp/src/sf-mcp-server.ts` — middleware chain, no domain logic
- Direct inspection: `packages/mcp-provider-api/src/services.ts` — `Services` interface, `OrgService`, `TelemetryService`
- Direct inspection: `packages/mcp-provider-api/src/index.ts` — export pattern for interfaces and types
- Direct inspection: `packages/mcp-provider-dx-core/src/tools/run_soql_query.ts` — full exec() flow, existing error handling
- Direct inspection: `packages/mcp-provider-dx-core/src/index.ts` — `DxCoreMcpProvider.provideTools()` registration
- Direct inspection: `packages/mcp/src/utils/tool-categories.ts` — `salesforce_describe_object` already in category map as `'read'`
- Direct inspection: `packages/mcp/src/index.ts` — server startup, Services instantiation
- `@salesforce/core` `Connection.describe()`: returns `DescribeSObjectResult` (field names, types, reference targets)

---

*Architecture research for: Salesforce MCP Server — v1.3 Smart Schema Cache*
*Researched: 2026-04-12*
