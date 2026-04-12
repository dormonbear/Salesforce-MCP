# Feature Landscape: Smart Schema Cache (v1.3)

**Domain:** Schema-aware SOQL tool layer for Salesforce MCP server
**Researched:** 2026-04-12
**Confidence:** HIGH (codebase inspected directly; Salesforce describe API verified via jsforce docs; patterns verified across Postgres MCP Pro, Microsoft SQL MCP Server, Vanna.ai, text-to-SQL literature)

---

## Context: This Milestone's Scope

v1.3 adds schema intelligence on top of the existing `run_soql_query` tool (already GA) and the `salesforce_describe_object` placeholder (registered in `tool-categories.ts` as a read tool, not yet implemented). All features operate inside `packages/mcp-provider-dx-core` with a new per-org schema cache module. The existing `Cache` class in `packages/mcp/src/utils/cache.ts` handles `allowedOrgs` and `tools` — schema data needs a separate, org-keyed, TTL-aware store.

---

## Domain Survey: How Schema-Aware SQL/SOQL Tools Work

### What the Ecosystem Does (cross-tool patterns)

**Postgres MCP Pro (crystaldba):** Exposes `list_schemas`, `list_objects`, `get_object_details` as discrete read tools. Schema is always fetched on demand — no in-memory cache between calls. Uses tool-based delivery (not MCP Resources) for broader client compatibility. Schema details include columns, constraints, indexes, and foreign key relationships.

**Microsoft SQL MCP Server:** Provides `read_records` with automatic result caching per entity. Schema is embedded in DAB (Data API Builder) entity layer — the MCP server queries against a pre-declared entity model, so schema discovery at query time is not needed. High-confidence schema because it is pre-validated at server startup.

**Vanna.ai:** Uses a `SchemaCacheEnricher` that calls `get_schema_info()` and stores the result in a dictionary on first access. Cache is populated lazily — first query for an object fetches and stores schema; subsequent queries reuse it. Training data (DDL, documentation, question-SQL pairs) is stored in a vector database and used as RAG context for query generation. The key insight: schema is chunked into bite-sized pieces addressable by the LLM, not dumped wholesale into context.

**Oracle NL2SQL Agent:** Performs schema search (semantic matching on column/table names), data sampling, and read-only SQL execution as separate steps. Schema search is a first-class operation — the LLM is expected to call it before writing queries on unfamiliar objects.

**Common pattern across all:** Schema discovery is always gated — the LLM calls a tool to get schema context before writing queries. None of these systems force the LLM to guess field names. The difference is whether schema is fetched proactively (tool call before query) or reactively (auto-fetched on query failure).

### Salesforce-Specific Context

`@salesforce/core` exposes `connection.describe(objectName)` for single-object schema and `connection.describeGlobal()` for all objects. jsforce (underlying library) has a built-in `describe$()` cached variant that memoizes the result in-process. However: the cache requires explicit invalidation; there is no TTL mechanism; and after org schema changes (field additions, deletions), the cached data is stale until the process restarts.

SOQL-specific failure modes that schema intelligence directly addresses:
- `INVALID_FIELD: X is not a field on Y` — field name wrong or does not exist
- `INVALID_TYPE: X is not supported in this API version` — object availability issue
- `MALFORMED_QUERY` — syntax error, often includes a position hint but no field suggestion

---

## Table Stakes (Users Expect These)

These are the baseline for any schema-aware tool layer. Missing them means the AI repeatedly fails on known-fixable SOQL errors.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `describe_object` tool | All comparable database MCP servers (Postgres MCP Pro, Oracle NL2SQL, Vanna.ai) expose an explicit schema discovery tool. `run_soql_query` already references it in error recovery messages — users see "Use salesforce_describe_object" in errors but the tool doesn't exist yet. | MEDIUM | Placeholder registered in `tool-categories.ts`. Implement using `connection.describe(objectName)`. Return: fields (name, label, type, filterable, updateable), relationships, key prefix. |
| Per-org schema cache isolation | Multiple orgs have different schemas (sandboxes, scratch orgs, production). A shared cache would bleed prod schema into sandbox queries. The existing `Cache` class is singleton with no org-key partitioning. | MEDIUM | New `SchemaCache` class keyed by org alias/username. Separate from existing `Cache` — different TTL semantics. |
| TTL-based cache expiration | Salesforce admins add/remove fields. Stale cached schema causes worse failures than no cache (tool confidently suggests a field that no longer exists). jsforce's `describe$()` has no TTL. | MEDIUM | Configurable TTL (default 1 hour). On TTL expiry, cache entry is purged; next access re-fetches. Environment variable override for aggressive environments (e.g., `SF_SCHEMA_CACHE_TTL_MINUTES=5`). |
| Success query auto-cache | Every successful SOQL query reveals which fields exist on an object. Extracting the object name and queried fields from the query string populates the cache at zero cost — no extra API call. This is the "free schema intel" path. | MEDIUM | Parse the FROM clause of successful queries. Extract queried field names. Store as partial schema entry: `{ objectName, knownFields: string[], cachedAt: Date }`. Not a full describe — just the fields the query used. |
| Failure auto-describe with field suggestions | When SOQL fails with `INVALID_FIELD`, the error message already references `salesforce_describe_object`. The natural next step — auto-calling describe on failure and returning suggestions — is the difference between "here is an error" and "here is what you probably meant". Every production text-to-SQL system that handles errors does this. | HIGH | On `INVALID_FIELD` error: extract object name, call `connection.describe()`, fuzzy-match the failing field name against actual field names. Return top 3 matches. Levenshtein distance is sufficient — no external library needed. |

---

## Differentiators (Competitive Advantage)

Features that set this server apart from comparable MCP database tools.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Schema relationship graph (lookup/master-detail) | Postgres MCP Pro returns foreign keys but does not suggest join paths. Salesforce has first-class relationship names (`Contact.Account.Name` traversal syntax). Building a relationship graph enables join suggestions when a query touches multiple objects — no comparable Salesforce MCP server does this. | HIGH | On describe: capture `fields[].referenceTo[]` and `fields[].relationshipName`. Store as `RelationshipEdge { from, to, via, type: 'lookup'|'master-detail' }`. Suggest: when a queried object has lookup to a needed object, surface the relationship name. |
| Configurable query history retention | Vanna.ai uses query history as training data for better SQL generation. Oracle's NL2SQL Agent uses query logs to improve schema descriptions. Storing recent successful SOQL queries per org lets the AI reuse proven patterns. No other Salesforce MCP tool does this. | MEDIUM | Ring buffer of N most recent successful queries per org (default N=50, configurable). Stored in schema cache file. Surface via a `list_query_history` tool or as an MCP Resource. |
| Partial schema entries from query success | Unlike full describe (which fetches all 100+ fields), success-path caching stores only fields that were actually queried. This means the cache is populated organically without explicit tool calls — high-value fields accumulate first. | LOW | Straightforward SOQL parse for FROM clause + field list. Already partially needed for success auto-cache (table stakes). The differentiator is exposing this as a "known fields" list in `describe_object` results so the AI knows the cache is partial vs. full. |
| Cache warm hint in describe_object output | When `describe_object` is called and the result came from cache, indicate age and whether it is a full describe or partial (success-path derived). The AI can then decide whether to force a refresh. | LOW | Add `{ source: 'cache' | 'api', cachedAt: ISO8601, isFull: boolean }` metadata to describe response. |

---

## Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Persistent schema cache to disk (SQLite/JSON file) | "Cache survives process restart" sounds useful. | Salesforce schema can change between sessions. A persistent cache creates a hidden source of stale data with no clear invalidation signal. The jsforce issue tracker (#391) shows this causes hard-to-debug `INVALID_FIELD` errors where the cache has fields that were deleted. | In-memory cache with TTL. On process restart, cache is empty — first query re-fetches. Zero stale data risk. |
| Auto-inject full schema into every query context | Some text-to-SQL tools dump entire DDL into every LLM call. For Salesforce, Account has 100+ fields, Contact has 80+. | Token explosion. A full describe of 10 objects is ~15K tokens of context. Context window consumed, costs increase, latency increases. | Lazy: describe on demand. Cache: reuse in session. Surface: only relevant fields in error recovery. |
| Fuzzy match using vector embeddings | "Semantic field matching" is appealing — find `Billing_Address` when the user typed `BillingAddr`. | Over-engineering. Salesforce field names follow naming conventions (camelCase API names, human labels). Levenshtein distance at threshold 3 covers 99% of typos. Embeddings require a vector store dependency, model calls, latency, and ongoing maintenance. | Levenshtein distance + case-insensitive exact match on Label. If no match within distance 3, show all fields sorted by similarity score. No external dependencies. |
| describeGlobal auto-run at startup | Fetches all available objects at startup. Looks like a fast cache warm-up. | Salesforce orgs have 800+ objects (standard + custom). `describeGlobal()` returns names/labels only (no fields), so it is low-value. Full describe of all objects would be 800 API calls — rate limit hit guaranteed. Startup time increases by seconds. | On-demand describe only. Populate cache as queries succeed. |
| Global (cross-org) schema cache | Shared cache between orgs would reduce API calls for orgs with the same objects. | Orgs differ. Custom fields on Account in org A do not exist in org B. Sandbox orgs frequently diverge from production. Mixing cache entries creates high-confidence wrong suggestions. | Per-org isolation is non-negotiable (already listed in Table Stakes). |

---

## Feature Dependencies

```
[Per-org schema cache]
    └──required by──> [describe_object tool]
    └──required by──> [Success query auto-cache]
    └──required by──> [Failure auto-describe + fuzzy match]
    └──required by──> [Schema relationship graph]
    └──required by──> [Configurable query history]

[describe_object tool]
    └──enables──> [Failure auto-describe] (auto-describe calls same describe logic)
    └──enables──> [Schema relationship graph] (relationship data comes from describe)

[Success query auto-cache]
    └──enhances──> [describe_object tool] (cache hit returns partial data faster)
    └──precedes──> [Failure auto-describe] (partial cache used as first-pass in failure path)

[Failure auto-describe + fuzzy match]
    └──depends on──> [describe_object tool] (must exist to call on failure)
    └──depends on──> [Per-org schema cache] (check cache before API call)

[Schema relationship graph]
    └──depends on──> [describe_object tool] (relationship data extracted from describe)
    └──depends on──> [Per-org schema cache] (graph stored in cache)

[Configurable query history]
    └──depends on──> [Per-org schema cache] (stored alongside schema entries)
    └──independent from──> [Schema relationship graph]
```

### Dependency Notes

- **Per-org schema cache is the foundation:** Every other feature depends on it. It must be designed to hold three data types: full describe results, partial (success-path) results, and relationship graph edges.
- **describe_object before failure auto-describe:** The failure path calls the same `connection.describe()` logic as the explicit tool. If the tool is not implemented first, the failure path has nowhere to delegate.
- **Success auto-cache is a free precursor:** It can be added as a side effect inside `run_soql_query.exec()` without a new tool. Parsing the FROM clause on success is low-risk because it only adds data — it never blocks the query result.
- **Relationship graph is additive:** It can be added after describe_object ships, extracting relationship fields from describe results. The schema cache must be designed to hold edge data from the start.

---

## MVP Definition

### Launch With (v1.3.0)

Minimum viable for the milestone goal: reduce AI SOQL query failures through schema intelligence.

- [ ] Per-org schema cache (in-memory, TTL-aware, keyed by org alias) — foundation for everything else
- [ ] `describe_object` tool — implement the placeholder; return fields, types, relationships; use cache
- [ ] Success query auto-cache — side effect in `run_soql_query`, no new tool, no user-visible API change
- [ ] Failure auto-describe with fuzzy field matching — upgrade the catch block in `run_soql_query`; auto-call describe on `INVALID_FIELD`; return top 3 fuzzy matches

### Add After Validation (v1.3.x)

Add once core path is working and AI failure rate measurably drops.

- [ ] Schema relationship graph — builds on describe_object; add relationship edge extraction and storage; expose in describe_object response
- [ ] Configurable query history — ring buffer in schema cache; expose via tool or MCP Resource; trigger: user requests history or AI asks "what queries have succeeded on this org?"

### Future Consideration (v2+)

- [ ] Query history as training data for prompt enrichment — semantic matching against stored queries when writing new SOQL; aligns with Vanna.ai pattern; requires embedding or keyword index
- [ ] Persistent cache with checksum-based invalidation — store schema to disk with Salesforce org API version as checksum; purge on API version change; requires careful staleness design

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Per-org schema cache (in-memory, TTL) | HIGH | MEDIUM | P1 |
| `describe_object` tool (implement placeholder) | HIGH | MEDIUM | P1 |
| Success query auto-cache (side effect in run_soql_query) | HIGH | LOW | P1 |
| Failure auto-describe + fuzzy field suggestions | HIGH | HIGH | P1 |
| Cache warm hint in describe_object output | LOW | LOW | P2 |
| Schema relationship graph | MEDIUM | HIGH | P2 |
| Configurable query history | MEDIUM | MEDIUM | P2 |
| Query history as RAG training data | LOW | HIGH | P3 |
| Persistent schema cache | LOW | HIGH | P3 |

---

## Competitor Feature Analysis

| Feature | Postgres MCP Pro | Microsoft SQL MCP | Vanna.ai | Our Approach |
|---------|-----------------|------------------|---------|--------------|
| Schema discovery tool | Yes (`get_object_details`) | Pre-declared entity model | Yes (training API) | `describe_object` tool — direct Salesforce describe API |
| Schema cache | No (always live API) | Implicit in entity model | Yes (SchemaCacheEnricher dictionary) | In-memory per-org cache with TTL |
| Auto-cache on query success | No | N/A | Via training (manual) | Yes — side effect in `run_soql_query` |
| Auto-describe on failure | No — returns raw error | N/A | Partial (retrains) | Yes — detect INVALID_FIELD, auto-call describe, return fuzzy matches |
| Relationship graph | FK keys returned in schema | No | No | Yes — extract from describe response, store relationship edges |
| Query history | No | No | Yes (training corpus) | Configurable ring buffer per org |
| Fuzzy field matching | No | No | Partial (via embeddings) | Levenshtein distance + case-insensitive label match |

---

## Implementation Boundary Notes

All new code goes in `packages/mcp-provider-dx-core`:
- New module: `src/schema/schema-cache.ts` — the per-org TTL cache
- New module: `src/schema/describe-utils.ts` — wraps `connection.describe()`, populates cache, extracts relationships
- New module: `src/schema/fuzzy-match.ts` — Levenshtein distance, field suggestion ranking
- New tool: `src/tools/describe_object.ts` — implements the registered placeholder
- Modified: `src/tools/run_soql_query.ts` — add success auto-cache side effect + failure auto-describe path

The existing `Cache` class (`packages/mcp/src/utils/cache.ts`) is for server-level data (allowed orgs, tool list). Schema cache is domain-level data and should NOT extend it — separate class, separate location, separate TTL semantics.

---

## Sources

- Postgres MCP Pro source/docs: https://github.com/crystaldba/postgres-mcp
- Microsoft SQL MCP Server: https://learn.microsoft.com/en-us/azure/data-api-builder/mcp/overview
- Vanna.ai schema cache docs: https://vanna.ai/docs/placeholder/context-enrichers + https://medium.com/vanna-ai/how-vanna-works-how-to-train-it-data-security-8d8f2008042
- Text-to-SQL best practices: https://medium.com/@vi.ha.engr/bridging-natural-language-and-databases-best-practices-for-llm-generated-sql-fcba0449d4e5
- jsforce describe caching: https://jsforce.github.io/jsforce/doc/connection.js.html (describes `describe$()` cached variant)
- jsforce INVALID_FIELD re-cache issue: https://github.com/jsforce/jsforce/issues/391
- Query history for text-to-SQL: https://motherduck.com/research/query-log-informed-schema-descriptions-text-to-sql/
- MCP error-in-result pattern: https://mcpcat.io/guides/error-handling-custom-mcp-servers/
- Direct code inspection: `packages/mcp-provider-dx-core/src/tools/run_soql_query.ts`, `packages/mcp/src/utils/cache.ts`, `packages/mcp/src/utils/tool-categories.ts`

---
*Feature research for: Salesforce MCP Server v1.3 — Smart Schema Cache*
*Researched: 2026-04-12*
