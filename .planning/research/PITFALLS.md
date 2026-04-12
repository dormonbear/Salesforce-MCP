# Pitfalls Research

**Domain:** Adding Smart Schema Cache and SOQL Auto-Correction to an existing Salesforce MCP server
**Project:** Salesforce MCP Server v1.3 — Smart Schema Cache milestone
**Researched:** 2026-04-12
**Confidence:** HIGH for API-limit pitfalls (official Salesforce docs + community issues confirmed), HIGH for caching design pitfalls (jsforce issue tracker + LRU cache documentation), MEDIUM for fuzzy-matching thresholds (general algorithm knowledge applied to SOQL domain), HIGH for SOQL parsing edge cases (official SOQL reference Spring '26)

---

## Critical Pitfalls

### Pitfall 1: Unbounded Schema Cache Growth Causes Memory Exhaustion Over Long Sessions

**What goes wrong:**
A plain `Map<orgAlias, Map<objectName, DescribeResult>>` — or extending the existing `Cache` singleton — grows indefinitely if no eviction policy exists. A Salesforce enterprise org can have 1,000+ custom objects, each with 200–500 fields. A describe result for one object is typically 20–100 KB of JSON. Caching 200 objects for 3 orgs yields 120–600 MB of in-process heap in the worst case. MCP servers run as long-lived stdio processes for the duration of a Claude Desktop session, making this a real risk.

**Why it happens:**
Developers prototype the cache as a `Map` because it is simple and correct for small schemas. The fix "add LRU eviction" gets deferred as a "nice to have." No obvious symptom appears during development against scratch orgs with 20 objects.

**How to avoid:**
Use `lru-cache` (npm) from day one. The `lru-cache` package requires at least one of `max`, `ttl`, or `maxSize` to be set, making unbounded growth a compile-time configuration error. Recommended configuration for this codebase:
- `max: 200` (object-level entries per org)
- `ttl: 1800000` (30-minute TTL — see Pitfall 2)
- `maxSize` with a `sizeCalculation` function measuring serialized byte length

The per-org structure should be `Map<orgUsername, LRUCache<objectApiName, DescribeResult>>` so that the entire org's cache can be invalidated atomically without touching other orgs.

**Warning signs:**
- Node.js heap size grows monotonically over multi-hour sessions
- `process.memoryUsage().heapUsed` exceeds 500 MB
- No "cache miss" log entries after the first hour of a session (everything has been cached and never evicted)

**Phase to address:** Phase 1 (Schema Cache foundation). Do not ship a Map-based prototype, even temporarily.

---

### Pitfall 2: Stale Cache Serves Wrong Field Metadata After Deployment

**What goes wrong:**
A Salesforce admin or CI pipeline deploys a new custom field, renames a field's API name, or deletes a deprecated field. The schema cache retains the old `DescribeResult`. The AI subsequently generates SOQL queries that reference the new field (not found in cache → no suggestion) or the deleted field (found in cache → suggested → query fails). The auto-correction loop then describes the object again, finds the deleted field is gone, and presents no suggestion — but the root error was the stale cache, not the query.

**Why it happens:**
There is no Salesforce push notification for schema changes via the REST API (unlike record changes via Streaming API). Cache implementers assume TTL-based expiry is "good enough" and set it to hours or days for performance. In active development orgs where metadata is deployed multiple times per day, this is wrong.

**How to avoid:**
- Set a TTL short enough to tolerate typical Salesforce deployment cycles. 30 minutes is a reasonable default for development orgs; expose it as a configurable option (e.g., `SCHEMA_CACHE_TTL_MS` environment variable).
- On `INVALID_FIELD` error from `connection.query()`: immediately evict the affected object from cache and re-describe before generating suggestions. This is the "describe-on-failure" pattern recommended by the jsforce maintainers (jsforce issue #391).
- On `INVALID_TYPE` error (object itself doesn't exist): evict the object's entry from the global object list cache.
- Do NOT cache `describeGlobal()` results for more than the same TTL — the object list itself can change on deployment.

**Warning signs:**
- `INVALID_FIELD` errors persist across multiple query retries despite auto-correction
- Fuzzy suggestions consistently include fields the user knows were deleted last week
- Log shows cache hits for an object describe that was last refreshed >1 hour ago

**Phase to address:** Phase 1 (Schema Cache) must include TTL + evict-on-failure as first-class requirements, not afterthoughts.

---

### Pitfall 3: Fuzzy Matching Returns False Positives That Are More Confusing Than No Suggestion

**What goes wrong:**
A purely edit-distance (Levenshtein) approach with a loose threshold recommends wrong field names. Examples:
- User typos `Amout` → system suggests `Amount` (correct) AND `AccountId` (edit distance 3, just as close numerically)
- User types `Phone` → `PhoneCell__c`, `PhoneHome__c`, `PhoneWork__c`, `HomePhone__c` all score similarly
- Very short field names (e.g., `Id`, `Name`) match almost everything below length 4

Worse: if the AI acts on a false-positive suggestion without human review, it retries the query with the wrong field. Salesforce's SOQL error for `INVALID_FIELD` is precise; the auto-correction replacing it with an equally wrong field turns a clear error into a silent wrong-data bug.

**Why it happens:**
Levenshtein alone does not model domain-specific naming conventions. Salesforce fields have structure: `__c` suffix for custom, namespace prefixes, relationship names ending in `__r`. A pure character-edit distance treats `Phone__c` and `PhoneHome__c` as very similar even though they are conceptually different fields.

**How to avoid:**
- Apply a **two-gate filter**: edit distance threshold AND a minimum match confidence ratio (`matchedLength / max(queryLength, fieldLength) >= 0.7`).
- Strip `__c` suffix before comparison to avoid spurious penalization of custom fields vs standard fields.
- Normalize namespace prefixes: strip managed package prefix before comparing (e.g., `myns__Phone__c` → `Phone__c` for comparison purposes).
- Cap the suggestions list at 3 items. More suggestions increase false positive consumption.
- Prefer prefix matches over arbitrary substring matches: `Amo` should prefer `Amount` over `AccountModifiedDate`.
- Return suggestions as informational hints only, never as auto-applied corrections. The AI should present them to the user, not retry silently.

**Warning signs:**
- AI silently retries with a suggested field and gets wrong data (no `INVALID_FIELD` error but query semantics are wrong)
- Suggestions include fields from completely different conceptual areas than the original field name
- Short-name fields (under 4 characters) always appear in every suggestion list

**Phase to address:** Phase 3 (Failure Auto-Describe and fuzzy matching). Build the two-gate filter from the start.

---

### Pitfall 4: Per-Org Cache Uses Org Alias Instead of Canonical Username, Causing Isolation Leaks

**What goes wrong:**
The server allows tools to be called with `usernameOrAlias` — either a human-readable alias (`my-sandbox`) or a full username (`user@example.com.sandbox`). If the cache key is the raw value of `usernameOrAlias`, the same org can accumulate multiple independent cache entries:
- `my-sandbox` → cache entry A
- `user@example.com.sandbox` → cache entry B (same org, different key)

Auto-describe on failure populates entry B while entry A has stale data. When the next query uses alias again, the stale entry A is used. The bug is nondeterministic and appears only when callers alternate between alias and username forms.

Worse: if two different users share an alias string across different orgs (e.g., both have a local `dev` alias pointing to different org instances), a shared in-process cache keyed by alias leaks schema data from org A to org B.

**Why it happens:**
`usernameOrAlias` is what the tool receives. Resolving it to a canonical username requires an async lookup (`getConnection()` or `StateAggregator`). Developers skip this to avoid extra latency.

**How to avoid:**
- Cache key MUST be the canonical org username (the actual login username, e.g., `user@company.com.sandbox`), NOT the alias.
- The canonical username is available from `connection.getUsername()` after `getConnection()` resolves — use it as the cache key.
- The org resolution already happens at server startup for the allowed-orgs list (v1.0 decision). Extend the startup resolution to build an `alias → canonical username` map, and use that for O(1) lookups per call.
- If no canonical username is resolvable (edge case), fall back to not caching rather than caching under an ambiguous key.

**Warning signs:**
- Describe cache misses for objects that were already described earlier in the same session
- Different schemas returned for the same object in the same session
- Log shows two cache entries for what appears to be the same org

**Phase to address:** Phase 1 (Per-Org Cache Isolation). This must be designed correctly from the start — retrofitting the key scheme after cache population is disruptive.

---

### Pitfall 5: describe() Calls Count Against Daily API Limits — Triggering Them on Every SOQL Failure Is Expensive

**What goes wrong:**
Salesforce REST API `describe()` calls (GET `/services/data/vXX.0/sobjects/{ObjectName}/describe/`) count against the org's rolling 24-hour API limit. Enterprise Edition starts at 100,000 requests/day. The `Sforce-Limit-Info` response header confirms each call decrements the counter.

If `run_soql_query` auto-describes on every failure, and an AI agent is iterating through a bad query multiple times, the implementation can generate tens of describe calls per minute. For developer edition orgs (15,000 daily limit) or orgs near their limit, this triggers `REQUEST_LIMIT_EXCEEDED` errors — which are indistinguishable from schema errors in logs, creating a confusing debugging loop.

Additionally: Concurrent request limit is 25 long-running (>20s) requests in production, 5 in developer orgs. `describeGlobal()` on a large org with 1,000+ objects can take 5–15 seconds, occupying a concurrent slot.

**Why it happens:**
The describe endpoint feels "cheap" — it is a single HTTP call and returns quickly for small objects. Developers model it as "free" during development against scratch orgs with few objects and low API usage.

**How to avoid:**
- **Never describe without checking cache first.** The auto-describe path must be: (1) check cache, (2) only call `connection.describe()` on cache miss.
- **Debounce describe calls per object per org.** Track a `pendingDescribe: Map<orgKey+objectName, Promise>` to avoid concurrent identical describes triggered by parallel SOQL failures.
- **Limit auto-describe depth.** Only auto-describe the root object of a failed query, not all related objects. Do not eagerly describe parent/child relationships on initial cache population.
- **Expose a describe budget.** Log a warning when more than N describe calls have been made in a rolling 5-minute window.
- **Never call `describeGlobal()`** in the auto-describe path. Use it only for the Schema Graph building phase, and only lazily/on-demand.

**Warning signs:**
- `REQUEST_LIMIT_EXCEEDED` errors appearing in SOQL query results
- `Sforce-Limit-Info` header showing daily limit dropping by 50+ in a short session
- Log shows describe calls for the same object multiple times within 30 seconds

**Phase to address:** Phase 2 (Success Auto-Cache) and Phase 3 (Failure Auto-Describe). The describe budget and debounce must be in place before Phase 3 ships.

---

### Pitfall 6: SOQL Parsing Extracts Wrong Object/Field Names From Complex Queries

**What goes wrong:**
A regex-based or naive string-parsing approach to extract `objectName` and `fieldNames` from a SOQL query fails on legal SOQL syntax patterns:

1. **Subqueries / semi-joins**: `SELECT Id FROM Account WHERE Id IN (SELECT AccountId FROM Contact)` — the inner `SELECT` is a different object; extracting all field names uniformly yields `AccountId` as a field on `Account`, which it is not.

2. **Parent-to-child relationship notation**: `SELECT Name, (SELECT LastName FROM Contacts) FROM Account` — `Contacts` is a relationship name, not a field name; `LastName` is on `Contact`, not `Account`.

3. **Polymorphic TYPEOF**: `SELECT TYPEOF Owner WHEN User THEN Name, Email ELSE Name END FROM Case` — `Owner` is not a standard field name; `Name` and `Email` belong to `User` or generic owner, not `Case`. TYPEOF is not allowed in COUNT queries, Bulk API, or PushTopics (SOQL Spring '26 reference).

4. **Aggregate functions**: `SELECT COUNT(Id), MAX(CreatedDate), AccountId FROM Opportunity GROUP BY AccountId` — `COUNT(Id)` and `MAX(CreatedDate)` are not field names; extracting them as fields to cache yields junk entries.

5. **`toLabel()`, `convertCurrency()`, `FORMAT()`**: `SELECT toLabel(StageName) FROM Opportunity` — `toLabel(StageName)` is not a field name; `StageName` is. A naive extractor captures the function call, not the inner field.

6. **Namespace prefixes**: `SELECT myns__CustomField__c FROM myns__CustomObject__c` — fuzzy matching `CustomField` without stripping `myns__` prefix will miss the canonical name.

**Why it happens:**
SOQL is not a simple SQL dialect. The first working version of a regex extractor handles simple `SELECT f1, f2 FROM Object WHERE ...` and passes all tests. The edge cases above are not covered until they appear in production.

**How to avoid:**
- Do not attempt a full SOQL AST parser. Instead, extract object/field names using a **best-effort conservative strategy**: only extract from simple flat queries; bail out gracefully on detected complexity markers (nested `SELECT`, `TYPEOF`, `GROUP BY`).
- When bailing out, skip caching from the success path — but do not error. Log a debug message: "Complex query structure detected; schema not extracted for caching."
- For the failure auto-describe path, extract only the object name from the `FROM` clause (the primary object), not field names. The object name is structurally simple to extract reliably.
- Strip function wrappers before recording field names: `toLabel(StageName)` → `StageName`, `COUNT(Id)` → skip (aggregate).
- Strip namespace prefix before fuzzy matching, but store the full canonical name for describe lookup.

**Warning signs:**
- Cache entries for field names containing `(`, `)`, or spaces (signs of function calls being stored as field names)
- Subquery object names appearing as fields on the parent object in the cache
- `INVALID_FIELD` error on a field that is listed in the cache as valid (sign that a wrong name was cached)

**Phase to address:** Phase 2 (Success Auto-Cache). The extraction logic must handle these cases before any cache population.

---

## Moderate Pitfalls

### Pitfall 7: Schema Graph Complexity Explosion With Large Org Object Count

**What goes wrong:**
Building a full object relationship graph by calling `describeGlobal()` followed by `describe()` for each object to extract lookup/master-detail relationships is O(N) API calls where N is the number of objects. An enterprise Salesforce org has 900+ standard objects plus potentially hundreds of custom objects. At 1 second per describe call, this takes 15–30 minutes and consumes thousands of API calls just to bootstrap the graph.

The in-memory graph itself (adjacency list of relationship edges) is manageable for 1,000 nodes, but if the implementation stores full DescribeResult objects in graph nodes rather than just relationship metadata, it balloons to hundreds of MB.

**How to avoid:**
- Build the graph **lazily and incrementally**, not upfront. Only add an object to the graph when its `DescribeResult` is already in cache from a successful query or explicit describe.
- Store only relationship edges in the graph (`{ fromObject, fromField, toObject, relationshipName }`), not the full DescribeResult.
- Cap graph traversal depth at 2 hops for join suggestions. Returning 5-hop join paths is not useful and makes the suggestion set unmanageable.
- Never call `describeGlobal()` automatically. Only call it if the user explicitly requests it via the `describe_object` tool with a wildcard or "all objects" intent.

**Phase to address:** Phase 4 (Schema Graph). The lazy-building constraint must be a design requirement, not a post-ship optimization.

---

### Pitfall 8: Query History Storage Grows Unbounded and Contains Sensitive Data

**What goes wrong:**
Storing the full SOQL query string in query history retains potentially sensitive filter values in plaintext: `SELECT Id FROM Case WHERE Subject LIKE '%password reset%' AND OwnerId = '005...'`. Over long sessions or if history is persisted to disk, this creates a sensitive data exposure.

Additionally, if history is stored in-memory without a size cap and the AI runs hundreds of analytical queries, the history array grows indefinitely.

**How to avoid:**
- Apply a hard cap on history entries: 100–500 entries in-memory, configurable via `QUERY_HISTORY_MAX` environment variable.
- Store only metadata, not the full query string, if persistence is needed: `{ timestamp, objectName, fieldCount, success, durationMs }`. Store the full query string only in-memory, never persisted to disk.
- If disk persistence is required, document it clearly and warn users that query strings may contain org data.
- Implement a ring-buffer approach: oldest entries are automatically overwritten when the cap is reached.

**Phase to address:** Phase 5 (Query History). Define the retention cap and data-sensitivity policy before implementation.

---

### Pitfall 9: `describe()` Response Shape Differs Between API Versions and Object Types

**What goes wrong:**
The `@salesforce/core` `connection.describe()` returns a `DescribeSObjectResult` object. However, the exact field shape varies:
- **Tooling API objects** (e.g., `ApexClass`, `ApexTrigger`) have a different describe schema than standard/custom objects. The Tooling API describe endpoint is at a different path and is called via `connection.tooling.describe()`. Mixing the two in one cache without distinguishing them causes `INVALID_FIELD` errors when the wrong describe result is used.
- **Big Objects** (custom `__b` suffix) have restricted field types and do not support all SOQL operations. Storing their describe results in the same cache without flagging them leads to suggestions of unsupported operations.
- **External Objects** (`__x` suffix) connected via Salesforce Connect also have a distinct describe shape.

**How to avoid:**
- Tag each cached `DescribeResult` with `{ objectType: 'standard' | 'custom' | 'tooling' | 'bigObject' | 'externalObject' }` based on the object API name suffix and the API used to fetch it.
- Use a different cache namespace for Tooling API describes vs standard describes.
- When generating suggestions, filter to the same `objectType` as the query's `FROM` clause.

**Phase to address:** Phase 1 (Schema Cache design). Include `objectType` tagging in the initial data model.

---

### Pitfall 10: Concurrent Parallel SOQL Failures Trigger Redundant Describe Stampedes

**What goes wrong:**
In parallel execution mode (the mutex was removed in v1.1), multiple SOQL queries can fail simultaneously for the same object with `INVALID_FIELD`. If auto-describe triggers on each failure independently, N concurrent failures produce N concurrent `describe()` API calls for the same object — all returning the same data but consuming N API limit units. In an agentic loop generating 10 parallel queries, this wastes 10× API quota.

**Why it happens:**
The "check cache, miss, describe, populate cache" sequence is not atomic. Two concurrent failures can both see a cache miss and both trigger describe before either has populated the result.

**How to avoid:**
- Implement a **single-flight** pattern: maintain a `Map<orgKey+objectName, Promise<DescribeResult>>` of in-flight describe requests. Before issuing a new `describe()` call, check if one is already in flight for the same key; if so, await the existing promise rather than issuing a new one.
- This is analogous to the existing Mutex pattern removed from v1.1, but scoped to per-object-per-org instead of globally.
- Use the `async-mutex` package's `Semaphore` or a custom single-flight implementation.

**Phase to address:** Phase 3 (Failure Auto-Describe). Test with intentionally concurrent SOQL failures.

---

### Pitfall 11: SOQL Field Names Are Case-Insensitive in Queries but Case-Sensitive in Cache Keys

**What goes wrong:**
Salesforce SOQL is case-insensitive for field and object names: `SELECT id, name FROM account` is valid. The `DescribeResult.fields[].name` property returns the canonical API name with the correct casing (e.g., `AccountId`, `Name`). If a fuzzy-match comparison normalizes the input field name to lowercase but the cache stores canonical casing, `account.name` as a cache key will miss a `DescribeResult` cached under `Account.Name`.

**How to avoid:**
- Normalize all cache keys to lowercase: `orgUsername.toLowerCase() + ':' + objectApiName.toLowerCase() + ':' + fieldApiName.toLowerCase()`.
- Store and return the canonical (correct-case) name from the DescribeResult for display and SOQL generation.
- Fuzzy matching comparisons must use case-normalized versions of both input and candidate field names.

**Phase to address:** Phase 1 (cache key design) and Phase 3 (fuzzy match normalization).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Use `Map` instead of `lru-cache` | Simpler code, no dependency | Memory leak in long sessions; no TTL expiry | Never — add `lru-cache` from day one |
| Cache keyed by alias not canonical username | No async resolution needed | Multi-alias isolation leaks; cross-org schema bleed | Never |
| Regex SOQL field extractor for all query types | Fast to build | Wrong names cached from subqueries/aggregates; silent bad suggestions | Only for simple flat queries; bail on complexity detection |
| describeGlobal() at startup to pre-warm | No latency on first query | 900+ API calls on startup; blocks session initialization | Never automatically; only explicitly on user request |
| Store full DescribeResult in graph nodes | Easy to navigate | Graph grows to hundreds of MB | Never for graph; store edge metadata only |
| No single-flight for concurrent describes | Simple code | API limit waste × N concurrent failures | Never in parallel execution mode |
| No TTL; manual invalidation only | Simpler eviction logic | Stale schema permanently cached until restart | Acceptable only for read-only production orgs with stable schemas |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `@salesforce/core` `connection.describe()` | Calling it for Tooling API objects against standard REST path | Use `connection.tooling.describe()` for `__` objects queried via Tooling API |
| `connection.getUsername()` | Calling after connection may throw if session expired | Wrap in try/catch; fall back to not caching if username resolution fails |
| Existing `Cache` singleton in `packages/mcp/src/utils/cache.ts` | Extending `CacheContents` with schema keys of type `Map<string, unknown>` | The existing Cache is a Map; create a separate SchemaCache module with its own LRU instance rather than stuffing nested Maps into the existing Cache |
| `SfMcpServer.wrappedCb` | Adding describe calls inside `wrappedCb` increases tool latency for all tools | Schema cache lookups must be inside the specific tool implementations, not in the middleware wrapper |
| Salesforce `INVALID_FIELD` error parsing | Relying on `sfErr.message` regex to extract the bad field name | Parse `sfErr.message` pattern `"No such column 'fieldName' on entity 'ObjectName'"` — but treat this as fragile; the pattern may change across API versions |
| `connection.query()` vs `connection.tooling.query()` | Using same schema cache for both | Keep separate cache namespaces: standard API fields ≠ Tooling API fields |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Synchronous cache lookup blocking async describe | All SOQL queries serialize behind describe calls | Keep describe async and non-blocking; use single-flight pattern | With 3+ concurrent SOQL queries |
| describeGlobal() for every schema graph update | Session hangs for 10–30 seconds on large orgs | Never call describeGlobal in hot path; build graph lazily | Orgs with 200+ objects |
| Storing parsed DescribeResult JSON in query history | History grows to 10s of MB with complex objects | Store metadata only; cap history size | After 50–100 complex queries |
| Fuzzy match scanning all cached fields for every error | O(N×M) per error where N=objects, M=fields | Pre-build field index per object; scope search to hinted object name | Orgs with 500+ fields per object |
| No TTL on in-flight describe promise map | Stale in-flight entries block future describes if a describe times out | Expire in-flight map entries after describe times out (10-minute Salesforce hard limit) | Describe call that times out |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Caching schema from one org and serving to another due to alias collision | Cross-org data structure leakage | Key cache by canonical username; fail closed on ambiguous aliases |
| Logging full describe results at DEBUG level | Schema metadata (field names, types, relationships) written to logs consumed by external log aggregators | Log only object name and field count at DEBUG; never log field-level metadata |
| Surfacing full `INVALID_FIELD` error message including internal paths | Error may contain org instance URL or internal Salesforce infrastructure info | Sanitize error messages before returning to MCP client (consistent with v1.2 Pitfall 7) |
| Storing query history containing filter values | `WHERE Email = 'user@company.com'` persisted to disk reveals PII | In-memory only; explicit user consent before any disk persistence |

---

## "Looks Done But Isn't" Checklist

- [ ] **Schema cache eviction:** LRU or TTL is configured AND tested — verify by checking no entry survives beyond TTL even under continuous use
- [ ] **Per-org isolation:** Two different orgs with the same alias resolve to different canonical usernames — verify by calling the same object describe for two orgs and asserting separate cache entries
- [ ] **Failure auto-describe:** Evicts the bad cache entry before re-describing — verify that a second query after auto-describe uses fresh data, not the stale entry
- [ ] **Fuzzy suggestions:** Returns at most 3 candidates AND all candidates belong to the correct object (not from relationship sub-objects) — verify with an object that has 300+ fields
- [ ] **Single-flight describe:** 10 concurrent SOQL failures on the same object trigger exactly 1 describe call — verify with a concurrency test
- [ ] **Query history cap:** Adding more than the configured max entries does not grow the history size beyond the cap — verify by inserting max+50 entries and asserting length stays at max
- [ ] **SOQL parser bail-out:** Complex queries (subquery, GROUP BY, TYPEOF) log a "skipping cache extraction" debug message and do not populate cache with wrong names

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Unbounded cache growth (OOM) | HIGH | Restart MCP server process; implement LRU before restart |
| Stale cache serving wrong fields | LOW | Expose a `describe_object` tool call to force re-describe; TTL will expire automatically |
| False positive fuzzy suggestion causes wrong data | MEDIUM | User must notice wrong results; increase fuzzy match threshold; add confirmation step before retry |
| API limit exceeded from describe stampede | HIGH | Wait for rolling 24-hour window to reset; implement describe budget and single-flight before re-enabling auto-describe |
| Cross-org schema leak from alias collision | HIGH | Flush entire schema cache; audit all cache keys; migrate to canonical-username keys |
| Query history filled with PII from filter values | MEDIUM | Clear in-memory history; document data sensitivity before adding disk persistence |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Unbounded cache growth | Phase 1: Schema Cache foundation | Memory test: heap stable after 200 object describes |
| Stale cache on deployment | Phase 1 + Phase 3 | Test: post-deployment query uses fresh schema |
| False positive fuzzy suggestions | Phase 3: Failure Auto-Describe | Test: 3-candidate cap; all from correct object |
| Per-org isolation via alias | Phase 1: Cache key design | Test: two orgs share alias, assert separate entries |
| describe() API limit exhaustion | Phase 2 + Phase 3 | Test: 10 concurrent failures → exactly 1 describe call |
| SOQL parsing edge cases | Phase 2: Success Auto-Cache | Test: subquery, GROUP BY, TYPEOF — no junk cache entries |
| Schema graph complexity explosion | Phase 4: Schema Graph | Test: graph builds lazily; no describeGlobal() at startup |
| Query history unbounded + PII | Phase 5: Query History | Test: history capped at configured max; no disk write by default |
| Concurrent describe stampede | Phase 3: Failure Auto-Describe | Test: single-flight — N failures → 1 API call |
| Case sensitivity in cache keys | Phase 1: Cache key design | Test: `account` and `Account` resolve to same cache entry |

---

## Sources

- jsforce issue #391: stale schema cache requiring application restart, maintainer-recommended describe-on-failure pattern — https://github.com/jsforce/jsforce/issues/391
- Salesforce REST API limits: describe calls count against rolling 24-hour daily limit; `Sforce-Limit-Info` header confirms per-call decrement — https://developer.salesforce.com/docs/atlas.en-us.api_rest.meta/api_rest/resources_limits.htm
- Salesforce concurrent request limit: 25 long-running (>20s) in production, 5 in developer orgs — https://coefficient.io/salesforce-api/salesforce-api-rate-limits
- SOQL Spring '26 reference (v66.0): TYPEOF restrictions, semi-join limits (max 2 subqueries), toLabel/convertCurrency/FORMAT field extraction — https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/salesforce_soql_sosl.pdf
- SOQL polymorphic relationships: TYPEOF not allowed in COUNT, Bulk API, PushTopics, or as semi-join SELECT clause — https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/langCon_apex_SOQL_polymorphic_relationships.htm
- lru-cache npm: `max`/`ttl`/`maxSize` required to prevent unsafe unbounded storage — https://www.npmjs.com/package/lru-cache
- Salesforce Trailblazer Community: field API names are case-sensitive at the API level — https://trailhead.salesforce.com/trailblazer-community/feed/0D54S00000A7fMQSAZ
- Direct codebase inspection: `packages/mcp/src/utils/cache.ts` — existing Cache singleton uses plain Map with Mutex; no TTL or eviction
- Direct codebase inspection: `packages/mcp-provider-dx-core/src/tools/run_soql_query.ts` — current error path provides no describe integration; error message references `salesforce_describe_object` as a future tool
- Direct codebase inspection: `packages/mcp/src/sf-mcp-server.ts` — parallel execution enabled (v1.1); Mutex only for serialized tools; no global describe lock
- PMD parser issues with convertCurrency() and toLabel() in SOQL — https://github.com/pmd/pmd/issues/5228, https://github.com/pmd/pmd/issues/5163

---
*Pitfalls research for: Salesforce MCP Server v1.3 — Smart Schema Cache milestone*
*Researched: 2026-04-12*
