---
phase: 12
slug: auto-cache-on-success
status: draft
nyquist_compliant: false
---

# Phase 12 — Validation Strategy

## Requirements → Validation Map

| Req ID | Behavior | Nyquist Sampling | Test Type | Automated? |
|--------|----------|-----------------|-----------|------------|
| ACCH-01 | Successful SOQL queries auto-cache object+fields as partial entry (zero API calls) | Every successful flat query must produce a PartialFieldsEntry; complex queries must produce nothing | unit | ✅ |
| ACCH-02 | Parser extracts FROM object and SELECT fields from flat queries; returns null for complex | Flat queries: 5+ positive cases; Complex: subquery, aggregate, GROUP BY, TYPEOF, relationship | unit | ✅ |
| ACCH-03 | Partial entries merge with full describe (full wins on conflict, extra partial preserved) | partial→partial union, full→partial skip, partial→full replace | unit | ✅ |

## Sampling Strategy

### ACCH-01: Auto-Cache Hook
- **Positive:** Flat SELECT→FROM query triggers set() with PartialFieldsEntry
- **Negative:** Complex query (subquery) does NOT trigger set()
- **Negative:** Tooling API query does NOT trigger set()
- **Error path:** SchemaService.set() throws → original query response still returned
- **Zero API calls:** Verify no describe/REST calls made during hook execution

### ACCH-02: SOQL Parser
- **Flat queries:** `SELECT Id, Name FROM Account`, `select id from contact`, mixed case
- **Aliases:** `SELECT Name n, Id i FROM Account` → strips aliases
- **Whitespace:** Extra spaces, tabs, newlines between tokens
- **Relationship fields:** `SELECT Account.Name FROM Contact` → filtered out (dotted)
- **Complex skip:** Subqueries `(SELECT`, aggregates `COUNT(`, GROUP BY, TYPEOF, HAVING
- **Edge:** `SELECT Id FROM Account WHERE Name = 'SELECT FROM'` — string literal with keywords
- **Custom fields:** `Custom_Field__c` preserved correctly
- **Null return:** All skip cases return null, never throw

### ACCH-03: Merge Logic
- **Partial + new partial:** fieldNames union (deduplicated)
- **Partial + full describe:** full entry replaces partial entirely (via set())
- **Full + new partial:** partial is skipped (never downgrade)
- **describe_object with partial in cache:** Must NOT return partial as describe result; must fetch fresh

## Regression Scope

| Prior Phase | Tests | Command |
|-------------|-------|---------|
| Phase 10 | SchemaService + disk persistence | `npx mocha "test/unit/schema/schema-service.test.ts" --timeout 5000 --node-option=loader=ts-node/esm` |
| Phase 11 | describe_object tool | `npx mocha "test/unit/schema/describe-object.test.ts" --timeout 5000 --node-option=loader=ts-node/esm` |
| All | Full suite | `cd packages/mcp-provider-dx-core && npx mocha "test/**/*.test.ts" --exclude "test/e2e/**/*.test.ts" --timeout 10000 --node-option=loader=ts-node/esm` |

## Phase Gate

- [ ] All ACCH-01 sampling cases pass
- [ ] All ACCH-02 sampling cases pass (positive + negative + edge)
- [ ] All ACCH-03 sampling cases pass (merge + promotion + no-downgrade)
- [ ] Phase 10 regression: 0 failures
- [ ] Phase 11 regression: 0 failures
- [ ] Full suite: 0 regressions from 104-test baseline
