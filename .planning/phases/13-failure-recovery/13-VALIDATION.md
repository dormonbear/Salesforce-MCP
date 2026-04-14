---
phase: 13
slug: failure-recovery
status: draft
nyquist_compliant: false
---

# Phase 13 — Validation Strategy

## Requirements → Validation Map

| Req ID | Behavior | Nyquist Sampling | Test Type | Automated? |
|--------|----------|-----------------|-----------|------------|
| FAIL-01 | On INVALID_FIELD, auto-call connection.describe() | Spy on describeAndCache; verify called with correct org+object | unit | ✅ |
| FAIL-02 | Fuzzy-match failing field using Levenshtein distance | 10+ distance calculations with known pairs; findSimilarFields ranking | unit | ✅ |
| FAIL-03 | Return top 3 suggestions ranked by similarity | Verify error response contains "Did you mean:" with correct fields | unit | ✅ |
| FAIL-04 | Fresh describe stored in schema cache | Verify describeAndCache stores FullDescribeEntry | unit | ✅ |

## Sampling Strategy

### FAIL-01: Auto-Describe on Error
- **Positive:** INVALID_FIELD error → describeAndCache called with object name
- **Negative:** Non-INVALID_FIELD error → no describe call (e.g. MALFORMED_QUERY)
- **Error path:** Describe also fails → original error returned without suggestions
- **Connection scoping:** Connection obtained before try block, available in catch

### FAIL-02: Levenshtein Distance
- **Exact match:** distance("Name", "Name") = 0
- **Single char:** distance("Naem", "Name") = 2 (transposition)
- **Insert/delete:** distance("Nam", "Name") = 1
- **Case insensitive:** distance("name", "Name") = 0 (when lowercase comparison)
- **Empty strings:** distance("", "abc") = 3
- **Completely different:** distance("xyz", "Name") = high number
- **findSimilarFields:** returns sorted by distance, max 3 results, filters by threshold

### FAIL-03: Error Response Format
- **With suggestions:** Original error + "\n\nDid you mean: Field1, Field2, Field3?"
- **No close matches:** Original error with generic recovery (no "Did you mean")
- **Single suggestion:** "Did you mean: Amount?"

### FAIL-04: Cache Update
- **Verified by:** describeAndCache already stores in cache — spy on set() or verify get() returns entry after recovery

## Regression Scope

| Prior Phase | Tests | Command |
|-------------|-------|---------|
| Phase 10 | SchemaService | `npx mocha "test/unit/schema/schema-service.test.ts"` |
| Phase 11 | describe_object | `npx mocha "test/unit/schema/describe-object.test.ts"` |
| Phase 12 | SOQL parser + auto-cache | `npx mocha "test/unit/schema/soql-parser.test.ts" "test/unit/schema/auto-cache-hook.test.ts"` |
| All | Full suite | `npx mocha "test/**/*.test.ts" --exclude "test/e2e/**/*.test.ts" --timeout 10000` |

## Phase Gate

- [ ] FAIL-01: INVALID_FIELD → describeAndCache called
- [ ] FAIL-02: Levenshtein distance correct for all sampling cases
- [ ] FAIL-03: Error response includes top 3 suggestions
- [ ] FAIL-04: Cache updated after recovery
- [ ] Regression: 131 test baseline, 0 failures
