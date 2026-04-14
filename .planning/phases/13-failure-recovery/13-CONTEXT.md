# Phase 13: Failure Recovery - Context

**Gathered:** 2026-04-12
**Status:** Ready for planning

<domain>
## Phase Boundary

When a SOQL query fails with an INVALID_FIELD error, automatically describe the failing object via `connection.describe()`, fuzzy-match the invalid field name against actual field names using Levenshtein distance, and return the top 3 suggestions alongside the original error. The fresh describe result is stored in SchemaService for future use. Single-flight coalescing prevents redundant describe calls for concurrent failures on the same object.

</domain>

<decisions>
## Implementation Decisions

### Error Detection
- **D-01:** Detect INVALID_FIELD errors by checking `SfError.name === 'INVALID_FIELD'` or matching the error message pattern `No such column '...' on entity '...'` (Salesforce returns both patterns). The check lives in the existing catch block of `QueryOrgMcpTool.exec()`.
- **D-02:** Extract the invalid field name and object name from the error message using regex: `No such column '(\w+)' on entity '(\w+)'`. If extraction fails, fall back to using the SOQL parser's object name and the full error message without suggestions.

### Auto-Describe
- **D-03:** On INVALID_FIELD detection, call `this.schemaService.describeAndCache()` with the extracted object name. This leverages the existing single-flight coalescing (from Phase 10) to prevent redundant API calls when multiple parallel queries fail on the same object.
- **D-04:** The describe call is `await` (not fire-and-forget) because we need the field names for suggestions. The latency cost is acceptable since the query already failed.
- **D-05:** If the describe also fails (e.g., object doesn't exist), fall back to the original error message without suggestions.

### Fuzzy Matching
- **D-06:** Implement Levenshtein distance as a pure function in `packages/mcp-provider-dx-core/src/schema/levenshtein.ts`. No external dependencies — inline implementation. This aligns with the roadmap decision.
- **D-07:** The fuzzy match function signature: `findSimilarFields(needle: string, fieldNames: string[], maxResults?: number): string[]`. Returns field names sorted by ascending Levenshtein distance, limited to `maxResults` (default 3).
- **D-08:** Use case-insensitive comparison for fuzzy matching (lowercase both the needle and candidate field names for distance calculation, but return original-case field names).
- **D-09:** Filter out results where Levenshtein distance exceeds a threshold (e.g., distance > Math.max(needle.length * 0.6, 3)) to avoid suggesting completely unrelated fields.

### Error Response
- **D-10:** Format the enhanced error response as: original error message + `"\n\nDid you mean: Field1, Field2, Field3?"`. Include up to 3 suggestions. If no close matches found, return the original error with the generic recovery hint.
- **D-11:** Store the fresh describe result in SchemaService as a FullDescribeEntry (already handled by describeAndCache). The requirement FAIL-04 is satisfied automatically.

### File Structure
- **D-12:** New file: `src/schema/levenshtein.ts` — Levenshtein distance + findSimilarFields
- **D-13:** Modify: `src/tools/run_soql_query.ts` — Add INVALID_FIELD detection + auto-describe + suggestion logic in catch block
- **D-14:** No changes needed to describe_object.ts, index.ts, or SchemaService — all infrastructure already exists.

### Agent's Discretion
- Exact Levenshtein implementation variant (standard dynamic programming)
- Whether to include the distance value in the suggestion output
- Exact threshold formula for filtering poor matches

</decisions>

<canonical_refs>
## Canonical References

### Schema Infrastructure (Phase 10-12)
- `packages/mcp-provider-dx-core/src/schema/schema-service.ts` — describeAndCache() with single-flight coalescing
- `packages/mcp-provider-dx-core/src/schema/types.ts` — FullDescribeEntry with data.fields array

### Error Handling
- `packages/mcp-provider-dx-core/src/tools/run_soql_query.ts` — Current catch block with SfError.wrap and toolError
- `packages/mcp-provider-api/src/errors.ts` — toolError function signature and classifyError

### SOQL Parser (Phase 12)
- `packages/mcp-provider-dx-core/src/schema/soql-parser.ts` — parseSoqlFields for object name extraction fallback

</canonical_refs>

<specifics>
## Specific Ideas

- The Salesforce error for invalid fields typically looks like: `SELECT Id, Naem FROM Account ^ERROR at Row:1:Column:16\nNo such column 'Naem' on entity 'Account'. If you are attempting to use a custom field, be sure to append the '__c' after the custom field name.`
- FullDescribeEntry.data.fields is an array of `{ name: string, ... }` objects — extract field names with `entry.data.fields.map(f => f.name)`
- describeAndCache already stores the result in cache (FAIL-04), so no additional set() call needed
- Single-flight coalescing from Phase 10 already handles concurrent describe calls for the same org+object

</specifics>

<deferred>
## Deferred Ideas

- MALFORMED_QUERY error recovery (syntax suggestions) → future phase if needed
- Fuzzy matching for object names (not just field names) → Phase 14 or future
- Using fuse.js for ranked scoring → only if Levenshtein proves insufficient
- Caching field suggestions for repeated failures → not needed, describe result is already cached

</deferred>

---

*Phase: 13-failure-recovery*
*Context gathered: 2026-04-12 via auto-select*
