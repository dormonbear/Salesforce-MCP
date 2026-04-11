# Phase 2: Prerequisites - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-11
**Phase:** 02-prerequisites
**Areas discussed:** Parameter consolidation, Tool categories, SIGTERM fix scope

---

## Parameter Consolidation

### usernameOrAliasParam handling

| Option | Description | Selected |
|--------|-------------|----------|
| Export two versions | mcp-provider-api exports required and optional variants | |
| Unify as required | Force all tools to require username, scale-products adjusts | |
| You decide | Claude's discretion on best approach | ✓ |

**User's choice:** You decide
**Notes:** Claude will determine optimal approach. Current state: dx-core=required, devops=required, scale-products=optional.

### sanitizePath consolidation

| Option | Description | Selected |
|--------|-------------|----------|
| Move everything to api | directoryParam + sanitizePath + baseAbsolutePathParam as complete unit | ✓ |
| Only move directoryParam | sanitizePath stays in dx-core, others copy | |
| You decide | Claude's discretion | |

**User's choice:** Move everything to mcp-provider-api as a complete unit
**Notes:** This ensures all providers get path traversal protection consistently.

---

## Tool Categories

| Option | Description | Selected |
|--------|-------------|----------|
| Use proposed classifications | Read operations → read, write/modify → write | ✓ |
| Adjust classifications | User wants to modify some categorizations | |

**User's choice:** Use proposed classifications as-is
**Notes:** All query/analysis tools classified as read; all create/modify/delete tools as write. enrich_metadata classified as write (modifies local files).

---

## SIGTERM Fix Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Fix one line only | process.stdin.on → process.on, keep existing logic | |
| Add graceful shutdown | Fix bug + add server.close(), timeout, full shutdown flow | ✓ |

**User's choice:** Add graceful shutdown logic
**Notes:** Beyond the one-line fix, add proper server.close(), telemetry flush, and timeout-based forced exit.

---

## Claude's Discretion

- Naming convention for required vs optional usernameOrAlias variants
- Whether to also export useToolingApiParam
- Graceful shutdown timeout duration
- File organization of sanitizePath in mcp-provider-api
