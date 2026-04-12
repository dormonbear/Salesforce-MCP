# Phase 13 Discussion Log

**Phase:** 13-failure-recovery
**Mode:** auto-select
**Gathered:** 2026-04-12

## Scout Summary

| Asset | Location | Reusable? |
|-------|----------|-----------|
| SchemaService.describeAndCache() | schema-service.ts | Yes — single-flight coalescing built in |
| SfError.wrap + classifyError | run_soql_query.ts catch block | Yes — existing error handling pattern |
| toolError with recovery | mcp-provider-api/errors.ts | Yes — enhanced error response format |
| parseSoqlFields | soql-parser.ts | Partial — can extract object name as fallback |
| PartialFieldsEntry / FullDescribeEntry | schema/types.ts | Yes — types already defined |
| SchemaEntryType.FullDescribe | schema/types.ts | Yes — entry type check |

## Decisions Auto-Selected

14 decisions (D-01 through D-14) auto-selected with recommended defaults.

Key choices:
- INVALID_FIELD detection via SfError.name or message pattern matching
- describeAndCache for auto-describe (leverages existing single-flight)
- Pure Levenshtein in `levenshtein.ts` (no external deps, per roadmap decision)
- Top 3 suggestions, case-insensitive, distance threshold filtering
- Enhanced error: original message + "Did you mean: ..." suggestions

## Questions Skipped (Auto Mode)

None — all decisions resolved via codebase analysis and prior roadmap decisions.
