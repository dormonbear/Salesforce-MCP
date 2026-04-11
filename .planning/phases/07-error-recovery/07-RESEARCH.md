# Phase 7: Error Recovery - Research

**Researched:** 2026-04-11
**Domain:** MCP tool error handling, LLM-consumable error messages, Salesforce CLI error taxonomy
**Confidence:** HIGH

## Summary

Phase 7 adds recovery guidance to the top-10 most-used GA tools so that an LLM agent can self-correct without human intervention. The current error handling pattern is simple: every catch block does `textResponse(\`Failed to X: ${error.message}\`, true)` — the error message is passed through but no recovery hint tells the LLM what to try next.

The MCP spec explicitly states that tool execution errors (isError: true) are "injected back into the LLM context window" and should contain "actionable feedback that language models can use to self-correct and retry with adjusted parameters." [CITED: modelcontextprotocol.io/specification/2025-11-25/server/tools] The `@salesforce/core` SfError class already has an `actions` field (array of recovery hints), but no tool currently extracts or surfaces these actions in its error response.

The implementation needs: (1) a shared `toolError()` factory in `mcp-provider-api` that formats errors with recovery guidance, (2) error classification (user-fixable vs system errors), and (3) per-tool domain-specific recovery hints for the top-10 GA tools.

**Primary recommendation:** Create a `toolError(message, options?)` factory in `mcp-provider-api/src/errors.ts` that produces a standardized `CallToolResult` with structured error text including what went wrong + what to try next, then update each top-10 tool's catch blocks to use it with domain-specific recovery hints.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ERR-01 | Top-10 most-used GA tools return error messages with recovery guidance (what went wrong + what to try next) | toolError() factory provides format; per-tool error mapping provides domain knowledge; SfError.actions already carries recovery hints from @salesforce/core |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @salesforce/core | (installed) | SfError with actions[], error wrapping | Already provides recovery hints in `actions` field [VERIFIED: sfError.d.ts inspection] |
| @modelcontextprotocol/sdk | ^1.18.0 | CallToolResult type with isError | Already installed, no new dep needed [VERIFIED: codebase] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| (none) | - | - | No new dependencies required |

**Installation:**
```bash
# No new packages needed
```

## Architecture Patterns

### Recommended Project Structure
```
packages/mcp-provider-api/src/
  errors.ts              # NEW: toolError() factory + ErrorCategory type
  index.ts              # Export toolError, ErrorCategory

packages/mcp-provider-dx-core/src/tools/
  run_soql_query.ts     # Updated catch blocks
  deploy_metadata.ts    # Updated catch blocks
  retrieve_metadata.ts  # Updated catch blocks
  ...
```

### Pattern 1: toolError Factory
**What:** A shared factory function that produces standardized `CallToolResult` with structured error messages
**When to use:** Every catch block in a tool's exec() method
**Example:**
```typescript
// Source: new code, based on MCP spec error handling guidance
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type ErrorCategory = 'user' | 'system';

export interface ToolErrorOptions {
  /** What to try next — helps LLM self-correct */
  recovery?: string;
  /** Whether this is user-fixable or a system error */
  category?: ErrorCategory;
}

/**
 * Creates a standardized error CallToolResult with recovery guidance.
 * Format: "[ERROR] {message}\n\n[RECOVERY] {recovery}" when recovery is provided.
 */
export function toolError(message: string, options?: ToolErrorOptions): CallToolResult {
  const { recovery, category } = options ?? {};
  
  let text = `[ERROR] ${message}`;
  if (category) {
    text = `[${category === 'user' ? 'USER_ERROR' : 'SYSTEM_ERROR'}] ${message}`;
  }
  if (recovery) {
    text += `\n\n[RECOVERY] ${recovery}`;
  }
  
  return {
    isError: true,
    content: [{ type: 'text', text }],
  };
}
```

### Pattern 2: SfError Actions Extraction
**What:** Extract the `actions` array from SfError instances (which @salesforce/core populates) and include them in recovery guidance
**When to use:** When catching errors from @salesforce/core APIs
**Example:**
```typescript
// Source: pattern derived from SfError.d.ts actions field
import { SfError } from '@salesforce/core';
import { toolError } from '@salesforce/mcp-provider-api';

} catch (error) {
  const sfErr = SfError.wrap(error);
  const recovery = sfErr.actions?.join(' ') 
    ?? 'Check the org alias and retry. Use #get_username to resolve the correct org.';
  return toolError(`Failed to query org: ${sfErr.message}`, { 
    recovery, 
    category: classifyError(sfErr) 
  });
}
```

### Pattern 3: Error Classification
**What:** Distinguish between user-fixable errors and system errors so the LLM knows whether to retry, ask the user, or report a system issue
**When to use:** Inside every catch block before calling toolError()
**Example:**
```typescript
// Source: new code, based on common @salesforce/core error names
function classifyError(error: Error): ErrorCategory {
  const userErrors = [
    'NamedOrgNotFoundError',    // Wrong alias
    'NoOrgFound',               // Org doesn't exist
    'InvalidProjectWorkspace',  // Not in a SFDX project
    'INVALID_FIELD',            // Bad SOQL field
    'MALFORMED_QUERY',          // Bad SOQL syntax
    'NOT_FOUND',                // Snapshot pref not enabled
    'DomainNotFoundError',      // Org expired
    'INSUFFICIENT_ACCESS',      // Missing permission
  ];
  
  if (userErrors.includes(error.name)) return 'user';
  if (error.message?.includes('ECONNREFUSED') || 
      error.message?.includes('ETIMEDOUT') ||
      error.message?.includes('socket hang up') ||
      error.message?.includes('INVALID_SESSION_ID')) return 'system';
  
  return 'user'; // Default: assume user can fix it
}
```

### Anti-Patterns to Avoid
- **Raw stack traces:** Never pass `error.stack` to the LLM — it wastes tokens and confuses models
- **Silent swallowing:** Never catch without returning — always return a toolError result
- **Generic "Unknown error":** Always try to classify and provide at least a generic recovery hint
- **Protocol-level errors for tool failures:** MCP spec is clear: tool execution errors MUST use `isError: true` in the result, NOT JSON-RPC error codes [CITED: modelcontextprotocol.io/specification/2025-11-25/server/tools]

## Top-10 GA Tools Identification

Based on tool-categories.ts classification, GA release state, and likely usage patterns (data/query tools used most, then metadata, then testing): [VERIFIED: codebase inspection of ReleaseState.GA]

| # | Tool Name | Provider | Category | Current Error Pattern |
|---|-----------|----------|----------|---------------------|
| 1 | run_soql_query | dx-core | read | Generic `Failed to query org: ${message}` |
| 2 | deploy_metadata | dx-core | write | Has timeout recovery, generic for other errors |
| 3 | retrieve_metadata | dx-core | read | Generic `Failed to retrieve metadata: ${message}` |
| 4 | get_username | dx-core | read | Generic `Failed to determine appropriate username` |
| 5 | list_all_orgs | dx-core | read | Generic `Failed to list orgs: ${message}` |
| 6 | run_apex_test | dx-core | read | Generic `Failed to run Apex Tests: ${message}` |
| 7 | assign_permission_set | dx-core | write | Has alias resolution hint, generic for other errors |
| 8 | salesforce_get_org_info | dx-core | read | Generic `Failed to retrieve org info: ${message}` |
| 9 | resume_tool_operation | dx-core | read | Generic per-operation failures |
| 10 | run_agent_test | dx-core | read | Generic `Failed to run Agent Tests: ${message}` |

**Note:** `create_scratch_org`, `delete_org`, `open_org`, `create_org_snapshot` are NON_GA. The top-10 list focuses exclusively on GA tools. [VERIFIED: getReleaseState() in each tool file]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Error formatting | Ad-hoc string concatenation per tool | Shared `toolError()` factory | Consistent format, single place to update |
| Recovery hint lookup | Hardcoded strings in each catch block | SfError.actions extraction + fallback map | @salesforce/core already provides hints for many errors |
| Error classification | Custom instanceof chains | Name-based classification function | SfError.name is the stable identifier across versions |

**Key insight:** @salesforce/core's `SfError.actions` field already provides recovery hints for many common errors (wrong org, auth expired, etc.). The toolError factory should extract these first, then fall back to tool-specific recovery maps.

## Common Pitfalls

### Pitfall 1: Inconsistent Error Formats
**What goes wrong:** Each tool formats errors differently — some say "Failed to X:", others say "Error:", others just pass the raw message
**Why it happens:** No shared utility existed; each developer wrote their own pattern
**How to avoid:** Enforce `toolError()` usage through a unit test that greps catch blocks
**Warning signs:** Catch blocks that still use `textResponse(message, true)` directly

### Pitfall 2: Missing the SfError.actions Field
**What goes wrong:** @salesforce/core errors already carry recovery hints in `actions[]`, but tools discard them by only reading `.message`
**Why it happens:** Developers treat all errors as plain `Error` instances
**How to avoid:** Always wrap with `SfError.wrap(error)` then check `.actions`
**Warning signs:** `error instanceof Error ? error.message : 'Unknown error'` pattern

### Pitfall 3: Over-prescriptive Recovery for System Errors
**What goes wrong:** Telling the LLM to "fix" something that requires human intervention (e.g., re-authenticate the org)
**Why it happens:** Treating all errors the same
**How to avoid:** Classify errors. For system errors, tell the LLM to inform the user rather than retry
**Warning signs:** Recovery hints that say "retry" for auth expiry errors

### Pitfall 4: Breaking Existing Recovery Guidance
**What goes wrong:** Some tools already have inline recovery (e.g., SOQL's "Try using/not using the Tooling API", deploy's timeout resume hint). Refactoring loses these.
**Why it happens:** Wholesale catch-block rewrites without reading existing logic
**How to avoid:** Preserve existing recovery hints as the primary guidance; toolError() adds structure around them
**Warning signs:** Lost conditional recovery logic (the `if (errorMessage.endsWith('is not supported.'))` pattern in run_soql_query)

### Pitfall 5: Error Messages Too Long for LLM Context
**What goes wrong:** Including full JSON responses, stack traces, or deployment details in error messages wastes context window tokens
**Why it happens:** Passing `JSON.stringify(result)` into error text
**How to avoid:** Keep error text concise (< 200 chars for message, < 300 chars for recovery). For complex failures (deploy), summarize the key issue
**Warning signs:** Error text > 500 characters

## Code Examples

### Example 1: toolError Factory (Complete Implementation)
```typescript
// packages/mcp-provider-api/src/errors.ts
// Source: new implementation based on MCP spec guidance

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type ErrorCategory = 'user' | 'system';

export interface ToolErrorOptions {
  /** Recovery guidance for the LLM */
  recovery?: string;
  /** Error classification */
  category?: ErrorCategory;
}

/**
 * Produces a standardized error CallToolResult with optional recovery guidance.
 * 
 * Format when recovery provided:
 *   [USER_ERROR] The permission set "BadName" does not exist.
 *   [RECOVERY] Verify the permission set name. Use run_soql_query with 
 *   "SELECT Name FROM PermissionSet" to list available permission sets.
 */
export function toolError(message: string, options?: ToolErrorOptions): CallToolResult {
  if (!message) throw new Error('toolError: message cannot be empty');
  
  const { recovery, category = 'user' } = options ?? {};
  const prefix = category === 'system' ? '[SYSTEM_ERROR]' : '[USER_ERROR]';
  
  let text = `${prefix} ${message}`;
  if (recovery) {
    text += `\n\n[RECOVERY] ${recovery}`;
  }
  
  return {
    isError: true,
    content: [{ type: 'text', text }],
  };
}
```

### Example 2: Updated run_soql_query catch block
```typescript
// packages/mcp-provider-dx-core/src/tools/run_soql_query.ts
// Source: refactored from current codebase

import { SfError } from '@salesforce/core';
import { toolError } from '@salesforce/mcp-provider-api';

// Inside exec():
} catch (error) {
  const sfErr = SfError.wrap(error);
  
  // Preserve existing conditional recovery logic
  if (sfErr.message.endsWith('is not supported.')) {
    const hint = input.useToolingApi
      ? 'Try setting useToolingApi to false for this query.'
      : 'Try setting useToolingApi to true for this query.';
    return toolError(`SOQL query failed: ${sfErr.message}`, {
      recovery: hint,
      category: 'user',
    });
  }
  
  // Extract SfError.actions if available
  const recovery = sfErr.actions?.join(' ')
    ?? 'Check the SOQL syntax and field names. Use salesforce_describe_object to verify available fields.';
  
  return toolError(`Failed to query org: ${sfErr.message}`, {
    recovery,
    category: classifyError(sfErr),
  });
}
```

### Example 3: Updated deploy_metadata catch block
```typescript
// packages/mcp-provider-dx-core/src/tools/deploy_metadata.ts
// Source: refactored from current codebase

import { SfError } from '@salesforce/core';
import { toolError } from '@salesforce/mcp-provider-api';

// Inside exec():
} catch (error) {
  const err = SfError.wrap(error);
  
  if (err.message.includes('timed out')) {
    // Preserve existing timeout recovery — this already works well
    return toolError(`Deploy timed out.`, {
      recovery: `Use the resume_tool_operation tool with jobId "${jobId}" to check the deploy status.`,
      category: 'system',
    });
  }
  
  const recovery = err.actions?.join(' ')
    ?? 'Verify the source files exist and are valid metadata. Check org permissions with assign_permission_set if access denied.';
  
  return toolError(`Failed to deploy metadata: ${err.message}`, {
    recovery,
    category: classifyError(err),
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Generic error.message passthrough | Structured error with recovery guidance | MCP best practices 2025 | LLM can self-correct instead of asking user |
| Protocol-level JSON-RPC errors for tool failures | isError: true in CallToolResult | MCP spec 2024-11 | Errors visible to LLM in context window |
| Single error format | Error classification (user vs system) | Industry pattern 2025 | LLM knows whether to retry or escalate |

**Deprecated/outdated:**
- Returning raw stack traces — wastes tokens, confuses LLMs
- Catching errors without any response — MCP spec mandates tool errors in result payload

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The "top-10 most-used" list is ordered by likely usage frequency (SOQL queries > metadata > testing) | Top-10 GA Tools | Low — all GA tools get coverage; order only affects implementation priority |
| A2 | `[USER_ERROR]`/`[SYSTEM_ERROR]`/`[RECOVERY]` prefix format is effective for LLM parsing | Pattern 1 | Medium — if LLMs don't parse well, format can be adjusted. The structured format from the MCP community is well-established |
| A3 | SfError.actions is populated for common errors like auth failures and SOQL errors | Pattern 2 | Low — the factory has a fallback map; if actions is empty, tool-specific hints are used |

## Open Questions

1. **Should the error format include a machine-readable error code?**
   - What we know: MCP spec doesn't require error codes in tool results, just text content with isError
   - What's unclear: Whether adding a numeric/string code (like `SOQL_SYNTAX_ERROR`) helps downstream LLM processing
   - Recommendation: Start without codes (keep it simple); add later if needed

2. **Should the toolError factory live in mcp-provider-api or in dx-core shared?**
   - What we know: Research summary suggests `mcp-provider-api/src/errors.ts`; other providers (code-analyzer, devops) could also benefit
   - What's unclear: Whether non-dx-core GA tools need it in Phase 7 scope
   - Recommendation: Put in mcp-provider-api so all providers can use it. Phase 7 only updates dx-core tools but the utility is shared.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Mocha + Chai + Sinon (dx-core), Vitest (mcp-provider-api) |
| Config file | packages/mcp-provider-dx-core/.mocharc.json, packages/mcp-provider-api/vitest.config.ts |
| Quick run command | `cd packages/mcp-provider-api && yarn test` |
| Full suite command | `yarn test` (root — runs all package tests via wireit) |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ERR-01a | toolError() factory produces correct format | unit | `cd packages/mcp-provider-api && yarn test` | No — Wave 0 |
| ERR-01b | Each top-10 tool catch block returns recovery guidance | unit | `cd packages/mcp-provider-dx-core && yarn test` | No — Wave 0 |
| ERR-01c | No catch block in top-10 tools returns raw message without recovery | integration (grep-based) | `grep -r 'textResponse.*true' packages/mcp-provider-dx-core/src/tools/` | N/A — manual audit |
| ERR-01d | Error messages distinguish user vs system errors | unit | `cd packages/mcp-provider-api && yarn test` | No — Wave 0 |

### Sampling Rate
- **Per task commit:** `cd packages/mcp-provider-api && yarn test && cd ../mcp-provider-dx-core && yarn test`
- **Per wave merge:** `yarn test` (root)
- **Phase gate:** Full suite green before /gsd-verify-work

### Wave 0 Gaps
- [ ] `packages/mcp-provider-api/test/errors.test.ts` — covers ERR-01a, ERR-01d
- [ ] Update existing dx-core tool tests to verify error format — covers ERR-01b

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A |
| V5 Input Validation | yes | Zod schemas already validate inputs before tool execution |
| V6 Cryptography | no | N/A |

### Known Threat Patterns for Error Handling

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Information disclosure via stack traces | Information Disclosure | toolError() never includes stack traces; only message text |
| Error messages revealing internal paths | Information Disclosure | SfError.message is user-facing by design; no additional risk |
| Retry loops caused by misleading recovery | Denial of Service | Classify system errors to prevent infinite retry suggestion |

## Sources

### Primary (HIGH confidence)
- MCP Specification 2025-11-25 — Error handling section (modelcontextprotocol.io/specification/2025-11-25/server/tools)
- @salesforce/core SfError.d.ts — actions field, wrap() method, error options
- Direct codebase inspection — all 10 GA dx-core tool files, mcp-provider-api source

### Secondary (MEDIUM confidence)
- [MCPcat Error Handling Guide](https://mcpcat.io/guides/error-handling-custom-mcp-servers/) — error classification patterns
- [Alpic AI: Better MCP tools/call Error Responses](https://dev.to/alpic/better-mcp-toolscall-error-responses-help-your-ai-recover-gracefully-15c7) — recovery guidance format patterns

### Tertiary (LOW confidence)
- None — all critical claims verified against MCP spec and codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - verified against installed packages, no new deps
- Architecture: HIGH - direct inspection of all tool files and existing patterns
- Pitfalls: HIGH - derived from actual codebase patterns observed during inspection

**Research date:** 2026-04-11
**Valid until:** 2026-05-11 (stable domain — error handling patterns don't change rapidly)
