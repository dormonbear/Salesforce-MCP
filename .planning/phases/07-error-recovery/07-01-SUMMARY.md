---
plan: "07-01"
status: complete
started: "2026-04-11"
completed: "2026-04-11"
commits: ["a3cff0a"]
---

# Plan 07-01 Summary: toolError Factory

## What Was Done

Created `packages/mcp-provider-api/src/errors.ts` with:
- `toolError(message, options?)` — produces structured CallToolResult with [USER_ERROR]/[SYSTEM_ERROR] prefix and optional [RECOVERY] section
- `classifyError(error)` — categorizes errors as 'user' or 'system' based on known patterns
- Both exported from package index

## Test Coverage

- 19 test cases covering all error categories, recovery formatting, and edge cases
- All tests passing

## Key Details

- Format: `[USER_ERROR] message\n\n[RECOVERY] hint` or `[SYSTEM_ERROR] message\n\n[RECOVERY] hint`
- Known user errors: NamedOrgNotFoundError, MALFORMED_QUERY, INVALID_FIELD, etc.
- Known system errors: ECONNREFUSED, ETIMEDOUT, INVALID_SESSION_ID, socket hang up
- Default category: 'user' (safe default — prompts retry with better params)
