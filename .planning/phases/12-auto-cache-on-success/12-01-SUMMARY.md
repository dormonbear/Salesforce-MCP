# Phase 12-01: Auto-Cache on Success — Execution Summary

**Executed:** 2026-04-12
**Status:** ✅ Complete
**Test baseline:** 104 → **131 tests** (+27 new, 0 regressions)

## Tasks Completed

| Task | Name | Type | Status |
|------|------|------|--------|
| 1 | RED — SOQL parser and auto-cache hook tests | TDD RED | ✅ 27 tests written, all fail |
| 2 | GREEN — Implement parseSoqlFields SOQL parser | TDD GREEN | ✅ 18 parser tests pass |
| 3 | GREEN — Auto-cache hook, wiring, describe_object fix | TDD GREEN | ✅ All 131 tests pass |

## Files Created

| File | Purpose | Lines |
|------|---------|-------|
| `src/schema/soql-parser.ts` | `parseSoqlFields()` pure function — regex SOQL extraction | 52 |
| `test/unit/schema/soql-parser.test.ts` | 18 parser unit tests (flat, alias, relationship, complex skip, edge) | 107 |
| `test/unit/schema/auto-cache-hook.test.ts` | 9 hook tests (auto-cache, merge, fire-and-forget, constructor) | 191 |

## Files Modified

| File | Change |
|------|--------|
| `src/schema/index.ts` | Added re-export of `parseSoqlFields` and `ParsedSoql` |
| `src/tools/run_soql_query.ts` | Constructor `(services, schemaService)`, auto-cache hook in exec() |
| `src/tools/describe_object.ts` | Invalidate partial entries before describeAndCache (ACCH-03) |
| `src/index.ts` | Pass `schemaService` to `QueryOrgMcpTool` constructor |
| `test/unit/structured-output.test.ts` | Updated QueryOrgMcpTool constructor call for new signature |

## Requirements Coverage

| Requirement | Status | Evidence |
|-------------|--------|----------|
| ACCH-01 | ✅ | Successful SOQL query auto-caches PartialFieldsEntry via fire-and-forget hook |
| ACCH-02 | ✅ | parseSoqlFields extracts FROM object + SELECT fields; returns null for complex queries |
| ACCH-03 | ✅ | Partial+partial union, full overwrites partial, describe_object invalidates partials |

## Deviations

| ID | Description | Impact |
|----|-------------|--------|
| DEV-01 | Updated `structured-output.test.ts` to pass `SchemaService` to `QueryOrgMcpTool` | Necessary — constructor signature changed; pre-existing test needed the new arg |

## Commits

| Hash | Message |
|------|---------|
| dc161f6 | `test(12-01): RED — add SOQL parser and auto-cache hook tests` |
| d2256ba | `feat(12-01): implement parseSoqlFields SOQL parser` |
| adf6855 | `feat(12-01): implement auto-cache hook, wiring, and describe_object partial fix` |
