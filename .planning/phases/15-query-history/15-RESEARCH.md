# Phase 15: Query History - Research

**Researched:** 2026-04-13
**Domain:** In-memory ring buffer data structure + MCP tool implementation
**Confidence:** HIGH

## Summary

Phase 15 adds per-org query history via a ring buffer that stores the N most recent successful SOQL queries, plus a new `salesforce_list_query_history` MCP tool for AI agents to access the history. All 10 decisions are locked in CONTEXT.md — the implementation is fully prescribed.

The implementation involves three distinct artifacts: (1) a `QueryHistoryService` class with per-org ring buffers, (2) a fire-and-forget recording hook in `QueryOrgMcpTool.exec()`, and (3) a new `ListQueryHistoryMcpTool` registered alongside existing tools in `DxCoreMcpProvider.provideTools()`. Zero external dependencies are needed — the ring buffer is a plain array with modulo-index overwriting.

**Primary recommendation:** Implement as two plans — Plan 1 (TDD: QueryHistoryService + recording hook) and Plan 2 (TDD: ListQueryHistoryMcpTool + provider wiring + tool-categories registration).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** New `QueryHistoryService` class in `src/schema/` with per-org ring buffer using a fixed-size array. Not stored in SchemaService LRU — different eviction semantics (FIFO ring vs LRU TTL).
- **D-02:** Simple array-based ring buffer with `push()` that overwrites oldest entry when full. Store `{ query: string, objectName: string, timestamp: number, fieldCount: number }` per entry.
- **D-03:** Default N=50 per org. Configurable via `SF_QUERY_HISTORY_LIMIT` environment variable (parsed as integer at construction time).
- **D-04:** Only successful SOQL queries (not Tooling API queries). Store the raw SOQL string, extracted objectName (from parseSoqlFields), timestamp (Date.now()), and field count. Do NOT store query results.
- **D-05:** Fire-and-forget in `run_soql_query.ts` after successful query, same location as auto-cache hook. Call `queryHistoryService.record(orgUsername, query, objectName)`.
- **D-06:** New `ListQueryHistoryMcpTool` registered alongside existing tools. Parameters: `usernameOrAlias` (required), `objectName` (optional filter), `limit` (optional, default 10). Returns array of `{ query, objectName, timestamp, fieldCount }`.
- **D-07:** Tool name: `salesforce_list_query_history`. Read-only, non-destructive, idempotent. Release state: GA. Toolset: query.
- **D-08:** No disk persistence for query history. In-memory only — history resets on server restart.
- **D-09:** Allow duplicates — if the same query is run multiple times, each execution is stored as a separate entry.
- **D-10:** QueryHistoryService is instantiated in `DxCoreMcpProvider.provideTools()` alongside SchemaService. Passed to `QueryOrgMcpTool` and `ListQueryHistoryMcpTool` constructors.

### Codebase Assets
- `run_soql_query.ts` — fire-and-forget hooks established in Phase 12
- `soql-parser.ts` — `parseSoqlFields()` extracts objectName and fieldNames
- `index.ts` — `DxCoreMcpProvider.provideTools()` instantiates services and creates tools
- `schema/` directory — established pattern for cache-related services

### Deferred Ideas (OUT OF SCOPE)
- Disk persistence for query history — future if needed
- Query frequency analytics / most-queried objects — future
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| QHST-01 | Store N most recent successful SOQL queries per org in a ring buffer (default N=50) | QueryHistoryService with per-org Map<string, RingBuffer>; D-01, D-02, D-03 prescribe exact implementation |
| QHST-02 | Query history retention limit is configurable (environment variable or server config) | `SF_QUERY_HISTORY_LIMIT` env var parsed at construction; follows `SF_SCHEMA_CACHE_TTL_MINUTES` precedent (D-03) |
| QHST-03 | Query history is accessible via a `list_query_history` tool or included in describe_object context | New `ListQueryHistoryMcpTool` with `salesforce_list_query_history` name; D-06, D-07 prescribe exact API |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | ^5.8.3 | Implementation language | Already used across entire project [VERIFIED: package.json] |
| zod | ^3.25.76 | Input/output schema validation | Used by all MCP tools for param/output schemas [VERIFIED: package.json] |
| @modelcontextprotocol/sdk | ^1.18.0 | MCP types (CallToolResult) | Standard MCP protocol types [VERIFIED: package.json] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| mocha | 11.7.2 | Test framework | All unit tests [VERIFIED: package.json] |
| chai | ^4.3.10 | Assertions | All test assertions [VERIFIED: package.json] |
| sinon | 10.0.0 | Stubs/spies | Mocking services in tool tests [VERIFIED: package.json] |
| nyc | ^17.0.0 | Coverage | Coverage reporting [VERIFIED: package.json] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Array ring buffer | lru-cache or circular-buffer npm | Over-engineering — D-02 explicitly locks simple array-based implementation. Ring buffer is ~30 lines of code |

**No new dependencies required.** D-02 locks a simple array-based ring buffer — no external packages needed.

## Architecture Patterns

### Recommended Project Structure
```
src/schema/
├── query-history-service.ts  # QueryHistoryService with per-org ring buffers
├── query-history-types.ts    # QueryHistoryEntry type + RingBuffer<T> class
├── index.ts                  # Re-export new types and service
├── schema-service.ts         # Existing — unchanged
├── soql-parser.ts            # Existing — reused for objectName extraction
└── types.ts                  # Existing — unchanged

src/tools/
├── run_soql_query.ts         # Modified — add fire-and-forget recording hook
├── list_query_history.ts     # NEW — ListQueryHistoryMcpTool
└── describe_object.ts        # Existing — unchanged

test/unit/schema/
├── query-history-service.test.ts  # Ring buffer + service tests
└── list-query-history.test.ts     # Tool tests
```

### Pattern 1: Ring Buffer (Array-Based, O(1) Push)
**What:** Fixed-size array that overwrites the oldest entry when full using modulo arithmetic.
**When to use:** When you need bounded FIFO storage with constant-time insert and no allocations after initial sizing.
**Why prescribed:** D-02 locks this implementation — no LRU, no linked list, just array + write index.

```typescript
// Source: D-02 (CONTEXT.md)
export class RingBuffer<T> {
  private readonly buffer: (T | undefined)[];
  private writeIndex = 0;
  private count = 0;

  public constructor(private readonly capacity: number) {
    this.buffer = new Array<T | undefined>(capacity).fill(undefined);
  }

  public push(item: T): void {
    this.buffer[this.writeIndex] = item;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Return entries newest-first */
  public toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.count; i++) {
      // Walk backwards from writeIndex
      const idx = (this.writeIndex - 1 - i + this.capacity) % this.capacity;
      result.push(this.buffer[idx] as T);
    }
    return result;
  }

  public get size(): number {
    return this.count;
  }
}
```

[VERIFIED: This is standard array-based circular buffer — well-established CS pattern]

### Pattern 2: Per-Org Isolation (Map of Ring Buffers)
**What:** `Map<string, RingBuffer<QueryHistoryEntry>>` keyed by org canonical username.
**When to use:** Same per-org isolation pattern as `SchemaService.orgCaches`.
**Source:** D-01, follows established SchemaService pattern.

```typescript
// Source: schema-service.ts pattern (verified in codebase)
export class QueryHistoryService {
  private readonly orgBuffers: Map<string, RingBuffer<QueryHistoryEntry>>;
  private readonly limit: number;

  public constructor(limit?: number) {
    const envLimit = process.env.SF_QUERY_HISTORY_LIMIT;
    this.limit = (envLimit ? parseInt(envLimit, 10) : undefined) ?? limit ?? 50;
    this.orgBuffers = new Map();
  }

  public record(orgUsername: string, query: string, objectName: string, fieldCount: number): void {
    let buffer = this.orgBuffers.get(orgUsername);
    if (!buffer) {
      buffer = new RingBuffer<QueryHistoryEntry>(this.limit);
      this.orgBuffers.set(orgUsername, buffer);
    }
    buffer.push({ query, objectName, timestamp: Date.now(), fieldCount });
  }

  public list(orgUsername: string, options?: { objectName?: string; limit?: number }): QueryHistoryEntry[] {
    const buffer = this.orgBuffers.get(orgUsername);
    if (!buffer) return [];
    let entries = buffer.toArray(); // newest-first
    if (options?.objectName) {
      entries = entries.filter(e => e.objectName.toLowerCase() === options.objectName!.toLowerCase());
    }
    if (options?.limit) {
      entries = entries.slice(0, options.limit);
    }
    return entries;
  }
}
```

[VERIFIED: Follows exact pattern from SchemaService.orgCaches (Map<string, LRUCache>)]

### Pattern 3: Fire-and-Forget Recording Hook
**What:** Record query history in run_soql_query.ts after successful query, inside a try/catch that silently swallows errors.
**When to use:** D-05 prescribes same location as auto-cache hook.
**Source:** Existing auto-cache hook at lines 118-144 of run_soql_query.ts.

```typescript
// Source: run_soql_query.ts lines 118-144 (existing auto-cache pattern)
// Insert after the auto-cache block, before relationship suggestions
if (!input.useToolingApi) {
  try {
    const parsed = parseSoqlFields(input.query);
    if (parsed) {
      const orgUsername = connection.getUsername() ?? input.usernameOrAlias;
      this.queryHistoryService.record(orgUsername, input.query, parsed.objectName, parsed.fieldNames.length);
    }
  } catch {
    // Silently ignore — history recording must never fail the query (D-05)
  }
}
```

### Pattern 4: McpTool Implementation (ListQueryHistoryMcpTool)
**What:** New tool following exact same class structure as DescribeObjectMcpTool / QueryOrgMcpTool.
**Source:** describe_object.ts (verified in codebase — lines 134-231).

Key structural elements from existing tools:
1. `extends McpTool<InputArgsShape, OutputArgsShape>` [VERIFIED: describe_object.ts:134]
2. Constructor takes `(services: Services, queryHistoryService: QueryHistoryService)` [follows D-10]
3. `getReleaseState()` → `ReleaseState.GA` [D-07]
4. `getToolsets()` → `[Toolset.DATA]` [D-07 says "query" but Toolset enum has `DATA` — see note below]
5. `getName()` → `'salesforce_list_query_history'` [D-07]
6. `getConfig()` returns inputSchema, outputSchema, annotations [all read-only hints]
7. `exec()` returns `CallToolResult` with text content + structuredContent

### Pattern 5: Provider Wiring
**What:** Instantiate QueryHistoryService in `provideTools()` and pass to tool constructors.
**Source:** index.ts lines 82-115 (verified in codebase).

```typescript
// In DxCoreMcpProvider.provideTools():
const queryHistoryService = new QueryHistoryService();
// ...
new QueryOrgMcpTool(services, schemaService, queryHistoryService),  // add 3rd param
new ListQueryHistoryMcpTool(services, queryHistoryService),          // new tool
```

### Anti-Patterns to Avoid
- **Storing query results in history:** D-04 explicitly forbids this — results can be huge. Only store the query string, objectName, timestamp, fieldCount.
- **Using SchemaService LRU for history:** D-01 explicitly separates the two — ring buffer has FIFO count-based eviction, not LRU TTL eviction.
- **Deduplicating queries:** D-09 explicitly allows duplicates — each execution is a separate entry.
- **Async recording:** The recording must be synchronous (just a `buffer.push()` call) — no need for async/await, making fire-and-forget trivial.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SOQL parsing | Custom parser | Existing `parseSoqlFields()` | Already handles field extraction, edge cases, and graceful skip for complex queries [VERIFIED: soql-parser.ts] |
| Zod schemas | Manual JSON Schema | `z.object()` with `.describe()` | All existing tools use Zod — consistent pattern [VERIFIED: describe_object.ts, run_soql_query.ts] |
| Error responses | Raw text errors | `toolError()` from mcp-provider-api | Standardized error format with recovery hints [VERIFIED: run_soql_query.ts] |

**Key insight:** The ring buffer IS hand-rolled, but intentionally — D-02 prescribes it. It's ~30 lines of well-understood CS. Everything else should reuse existing infrastructure.

## Common Pitfalls

### Pitfall 1: Toolset Enum Mismatch
**What goes wrong:** D-07 says toolset "query" but the `Toolset` enum has no `QUERY` value — only `DATA`, `CORE`, `ORGS`, etc.
**Why it happens:** The context document used a conceptual name, not the actual enum value.
**How to avoid:** Use `Toolset.DATA` — same toolset as `run_soql_query` and `salesforce_describe_object`. [VERIFIED: run_soql_query.ts:71, describe_object.ts:147, enums.ts:14]
**Warning signs:** TypeScript compile error on `Toolset.QUERY`.

### Pitfall 2: Constructor Signature Change for QueryOrgMcpTool
**What goes wrong:** Adding `queryHistoryService` as a third constructor parameter breaks existing instantiation.
**Why it happens:** QueryOrgMcpTool currently takes `(services, schemaService)` — must change to `(services, schemaService, queryHistoryService)`.
**How to avoid:** Update both the constructor AND the instantiation in `index.ts:110`. Also update all test files that instantiate `QueryOrgMcpTool` (auto-cache-hook.test.ts, failure-recovery.test.ts, relationship-graph.test.ts, etc.).
**Warning signs:** TypeScript errors about wrong number of arguments.

### Pitfall 3: Ring Buffer toArray() Ordering
**What goes wrong:** Returning entries oldest-first when AI agents expect newest-first.
**Why it happens:** Naive `buffer.filter(Boolean)` returns insertion-order, not reverse chronological.
**How to avoid:** `toArray()` must walk backward from `writeIndex - 1` using modulo arithmetic. D-06 implies "recent" = newest-first ordering for `limit` to be useful.
**Warning signs:** Tests asserting `entries[0].timestamp > entries[1].timestamp` fail.

### Pitfall 4: tool-categories.ts Registration
**What goes wrong:** New tool not added to `packages/mcp/src/utils/tool-categories.ts` → tool-categories consistency test fails (Phase 6 META-02).
**Why it happens:** Easy to forget the cross-package registration.
**How to avoid:** Add `salesforce_list_query_history: 'read'` to the toolCategoryMap. [VERIFIED: tool-categories.ts uses this exact format]
**Warning signs:** Existing `readOnlyHint` consistency test fails.

### Pitfall 5: Parsable Queries Only
**What goes wrong:** Recording queries where `parseSoqlFields()` returns null (complex queries), leading to entries with undefined objectName.
**Why it happens:** Not checking the return value before recording.
**How to avoid:** D-04 says "extracted objectName (from parseSoqlFields)" — only record when parseSoqlFields returns a non-null result. Complex queries (subqueries, aggregates, GROUP BY) are silently skipped.
**Warning signs:** Entries with empty objectName in the history.

### Pitfall 6: Integer Parsing Edge Case for SF_QUERY_HISTORY_LIMIT
**What goes wrong:** `parseInt('abc', 10)` returns `NaN`, which makes the ring buffer capacity `NaN` and all modulo operations produce `NaN`.
**Why it happens:** No validation on the env var value.
**How to avoid:** Validate parsed integer: if `isNaN(parsed)` or `parsed <= 0`, fall back to default 50. Follow `SF_SCHEMA_CACHE_TTL_MINUTES` precedent in schema-service.ts.
**Warning signs:** `buffer.length` is `NaN`, all pushes go to index `NaN`.

## Code Examples

### QueryHistoryEntry Type
```typescript
// Source: D-02 (CONTEXT.md)
export type QueryHistoryEntry = {
  query: string;        // Raw SOQL string
  objectName: string;   // Extracted from parseSoqlFields
  timestamp: number;    // Date.now() at recording time
  fieldCount: number;   // Number of fields in SELECT clause
};
```

### ListQueryHistoryMcpTool Input Schema
```typescript
// Source: D-06 (CONTEXT.md) + existing param patterns (params.ts)
export const listQueryHistoryParamsSchema = z.object({
  usernameOrAlias: usernameOrAliasParam,
  objectName: z.string().optional().describe(
    'Optional filter: only return queries for this Salesforce object (e.g., "Account")'
  ),
  limit: z.number().optional().default(10).describe(
    'Maximum number of recent queries to return (default: 10)'
  ),
});
```

### ListQueryHistoryMcpTool Output Schema
```typescript
// Source: D-06 (CONTEXT.md)
export const listQueryHistoryOutputSchema = z.object({
  queries: z.array(z.object({
    query: z.string(),
    objectName: z.string(),
    timestamp: z.number(),
    fieldCount: z.number(),
  })),
  totalStored: z.number(),
  orgUsername: z.string(),
});
```

### Tool Config with Annotations
```typescript
// Source: D-07 (CONTEXT.md) + existing annotation pattern (describe_object.ts:155-168)
public getConfig(): McpToolConfig<InputArgsShape, OutputArgsShape> {
  return {
    title: 'List Query History',
    description:
      'List recent successful SOQL queries for a Salesforce org. ' +
      'Use this to discover query patterns and reuse previously successful queries.',
    inputSchema: listQueryHistoryParamsSchema.shape,
    outputSchema: listQueryHistoryOutputSchema.shape,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  };
}
```

### Recording Hook Integration Point
```typescript
// Source: run_soql_query.ts lines 118-163 (verified in codebase)
// The recording hook goes AFTER the auto-cache block (line 144) and BEFORE the relationship suggestions (line 147)
// At approximately line 145:

// Query history: record successful SOQL for pattern reuse (QHST-01)
// Fire-and-forget — never fail a successful query because of history recording
if (!input.useToolingApi) {
  try {
    const parsed = parseSoqlFields(input.query);
    if (parsed) {
      const orgUsername = connection.getUsername() ?? input.usernameOrAlias;
      this.queryHistoryService.record(orgUsername, input.query, parsed.objectName, parsed.fieldNames.length);
    }
  } catch {
    // Silently ignore — history recording must never fail the query
  }
}
```

### Provider Wiring in index.ts
```typescript
// Source: index.ts lines 82-115 (verified in codebase)
// Add import:
import { QueryHistoryService } from './schema/query-history-service.js';
import { ListQueryHistoryMcpTool } from './tools/list_query_history.js';

// In provideTools(), after SchemaService creation:
const queryHistoryService = new QueryHistoryService();

// Modify QueryOrgMcpTool instantiation:
new QueryOrgMcpTool(services, schemaService, queryHistoryService),

// Add new tool:
new ListQueryHistoryMcpTool(services, queryHistoryService),
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| No query history | Ring buffer per org | Phase 15 | AI agents can reference previously successful queries for pattern reuse |

**No deprecated patterns apply** — this is new functionality, not replacing anything.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | D-07 "toolset: query" maps to `Toolset.DATA` since there is no `Toolset.QUERY` in the enum | Pitfall 1 | TypeScript compile error — easily fixable by checking enum values |
| A2 | `parseSoqlFields()` result is reused for both auto-cache and history recording (parsed once in auto-cache block, can be reused or re-parsed for history) | Code Examples | Minor performance impact if parsed twice; could optimize by extracting parsed result to outer scope |
| A3 | The `limit` parameter in the tool schema uses Zod `.default(10)` which is server-side default — client may or may not send the value | Code Examples | If client sends `undefined`, Zod default handles it; no risk |

**If this table is empty:** N/A — three assumptions listed above.

## Open Questions

1. **Should `parseSoqlFields()` be called once or twice?**
   - What we know: The auto-cache block at line 121 already calls `parseSoqlFields(input.query)` and gets `parsed`. The relationship suggestions block at line 149 calls it again.
   - What's unclear: Whether to extract the `parsed` variable to a shared scope (reducing duplicate parsing) or add a third independent call for the history hook.
   - Recommendation: Extract `parsed` once before the auto-cache block and reuse it for both auto-cache and history recording. This is a minor optimization but improves code clarity. The relationship block already duplicates the call, so this would be a nice cleanup.

2. **Toolset.DATA vs conceptual "query" toolset**
   - What we know: D-07 says "Toolset: query" but enum only has `DATA`, `CORE`, `ORGS`, etc. Both `run_soql_query` and `salesforce_describe_object` use `Toolset.DATA`.
   - What's unclear: Whether the user intended a specific toolset not yet created.
   - Recommendation: Use `Toolset.DATA` — it's what all query-related tools use. The "query" in D-07 is conceptual.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Mocha 11.7.2 + Chai 4.3.10 + Sinon 10.0.0 |
| Config file | `packages/mcp-provider-dx-core/.mocharc.json` |
| Quick run command | `cd packages/mcp-provider-dx-core && npx mocha "test/unit/schema/query-history*.test.ts"` |
| Full suite command | `cd packages/mcp-provider-dx-core && yarn test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| QHST-01 | Ring buffer stores N entries, FIFO overwrites oldest | unit | `npx mocha "test/unit/schema/query-history-service.test.ts" -x` | ❌ Wave 0 |
| QHST-01 | Per-org isolation — org A history separate from org B | unit | `npx mocha "test/unit/schema/query-history-service.test.ts" -x` | ❌ Wave 0 |
| QHST-01 | Fire-and-forget recording in run_soql_query after success | unit | `npx mocha "test/unit/schema/query-history-hook.test.ts" -x` | ❌ Wave 0 |
| QHST-02 | SF_QUERY_HISTORY_LIMIT env var overrides default 50 | unit | `npx mocha "test/unit/schema/query-history-service.test.ts" -x` | ❌ Wave 0 |
| QHST-02 | Invalid env var falls back to default | unit | `npx mocha "test/unit/schema/query-history-service.test.ts" -x` | ❌ Wave 0 |
| QHST-03 | list_query_history tool returns entries newest-first | unit | `npx mocha "test/unit/schema/list-query-history.test.ts" -x` | ❌ Wave 0 |
| QHST-03 | objectName filter works case-insensitively | unit | `npx mocha "test/unit/schema/list-query-history.test.ts" -x` | ❌ Wave 0 |
| QHST-03 | limit parameter caps returned results | unit | `npx mocha "test/unit/schema/list-query-history.test.ts" -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `cd packages/mcp-provider-dx-core && npx mocha "test/unit/schema/query-history*.test.ts" "test/unit/schema/list-query-history.test.ts"`
- **Per wave merge:** `cd packages/mcp-provider-dx-core && yarn test`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/unit/schema/query-history-service.test.ts` — covers QHST-01, QHST-02
- [ ] `test/unit/schema/query-history-hook.test.ts` — covers QHST-01 (fire-and-forget recording)
- [ ] `test/unit/schema/list-query-history.test.ts` — covers QHST-03

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A — tool delegates auth to existing `getConnection()` |
| V3 Session Management | no | N/A |
| V4 Access Control | yes (inherited) | usernameOrAlias must be a valid authenticated org — enforced by existing `services.getOrgService().getConnection()` |
| V5 Input Validation | yes | Zod schema validates all inputs; objectName filter is string comparison only (no injection vector) |
| V6 Cryptography | no | N/A — no secrets stored |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-org data leakage | Information Disclosure | Per-org Map isolation — history keyed by canonical username; no cross-org API [VERIFIED: follows SchemaService pattern] |
| Memory exhaustion via large history | Denial of Service | Ring buffer has fixed capacity (default 50); Map grows per-org but orgs are bounded by auth [VERIFIED: D-03] |

## Sources

### Primary (HIGH confidence)
- `packages/mcp-provider-dx-core/src/tools/run_soql_query.ts` — auto-cache hook pattern, constructor signature, fire-and-forget pattern
- `packages/mcp-provider-dx-core/src/tools/describe_object.ts` — McpTool implementation pattern, output schema pattern, annotations
- `packages/mcp-provider-dx-core/src/index.ts` — DxCoreMcpProvider.provideTools() wiring, SchemaService lifecycle
- `packages/mcp-provider-dx-core/src/schema/schema-service.ts` — per-org Map pattern, env var configuration pattern
- `packages/mcp-provider-dx-core/src/schema/soql-parser.ts` — parseSoqlFields() API
- `packages/mcp-provider-dx-core/src/schema/types.ts` — type definition patterns
- `packages/mcp-provider-api/src/enums.ts` — Toolset enum values (no QUERY — only DATA)
- `packages/mcp-provider-api/src/tools.ts` — McpTool abstract class contract
- `packages/mcp/src/utils/tool-categories.ts` — tool category registration format
- `packages/mcp-provider-dx-core/test/unit/schema/auto-cache-hook.test.ts` — test patterns (mock services, sinon stubs)
- `.planning/phases/15-query-history/15-CONTEXT.md` — all 10 locked decisions

### Secondary (MEDIUM confidence)
- None needed — all findings sourced directly from codebase

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies, all existing libraries verified in package.json
- Architecture: HIGH — all patterns directly observed in codebase (SchemaService, McpTool, fire-and-forget hooks)
- Pitfalls: HIGH — identified from concrete code analysis (enum values, constructor signatures, test files that need updates)

**Research date:** 2026-04-13
**Valid until:** 2026-05-13 (30 days — stable codebase, no external API changes expected)
