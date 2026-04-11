# Phase 8: Structured Output - Research

**Researched:** 2026-04-11
**Domain:** MCP structured output (outputSchema + structuredContent)
**Confidence:** HIGH

## Summary

Phase 8 adds `outputSchema` and `structuredContent` to 5-8 core GA query tools in the Salesforce MCP Server. The SDK (1.18.2) already fully supports this: `McpServer.registerTool()` accepts `outputSchema` as a `ZodRawShape`, internally converts it to JSON Schema via `zod-to-json-schema`, and validates `structuredContent` against the schema at runtime via `safeParseAsync`. The existing codebase has working reference implementations in the `mcp-provider-code-analyzer` package (6 tools already ship with `outputSchema` + `structuredContent`).

The critical prerequisite (OUT-02) is a middleware pass-through test proving that `structuredContent` survives the `wrappedCb` in `SfMcpServer.registerTool()`. Code inspection confirms the middleware returns the tool callback result object unchanged -- it does not rebuild `CallToolResult` -- but this must be proven by test. The `SfMcpServer.calculateResponseCharCount()` already handles `structuredContent` for telemetry, further confirming the architecture anticipated this feature.

**Primary recommendation:** Write the middleware pass-through test first (OUT-02), then add `outputSchema` + `structuredContent` to the 6 priority tools using the code-analyzer pattern as reference. Always return both `content` (text) and `structuredContent` for backward compatibility.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| OUT-02 | Middleware pass-through test confirms `structuredContent` survives `wrappedCb` unchanged | wrappedCb code inspection confirms pass-through behavior (lines 234-272 of sf-mcp-server.ts). Existing test infrastructure in packages/mcp/test/unit/sf-mcp-server.test.ts provides `captureWrappedCallback` helper. |
| OUT-01 | 5-8 core GA query tools declare `outputSchema` and return `structuredContent` alongside text `content` | 6 candidate tools identified with predictable return shapes. Code-analyzer package provides verified reference pattern. SDK validates structuredContent against outputSchema at runtime. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

From global CLAUDE.md:
- Use English for code and comments
- Prefer concise comments (only for complex logic)
- Many small files over few large files
- No console.log in production code
- Input validation with Zod or similar
- TDD: Write tests first when possible
- Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`
- Run tests and lint before committing
- `sf` CLI always with `--json` flag

From project STATE.md accumulated decisions:
- Do NOT upgrade SDK to 1.29.0 -- zero functional benefit, ZodRawShapeCompat signature change [VERIFIED: STATE.md]
- OUT-02 middleware test is prerequisite for OUT-01 [VERIFIED: STATE.md]

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @modelcontextprotocol/sdk | 1.18.2 | MCP server, outputSchema support, structuredContent validation | Already installed; has `registerTool` with `outputSchema`, `zodToJsonSchema` conversion, and `safeParseAsync` validation [VERIFIED: node_modules inspection] |
| zod | ^3.25.76 | Schema definitions for outputSchema shapes | Already used across all tool files; SDK requires ZodRawShape for outputSchema [VERIFIED: package.json] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| mocha | 11.7.2 | Test runner for mcp and dx-core packages | Unit tests for middleware pass-through and tool output [VERIFIED: packages/mcp/package.json] |
| chai | ^4.3.10 | Assertion library | Test assertions [VERIFIED: packages/mcp/package.json] |
| sinon | 10.0.0 | Stubbing/spying for middleware tests | Mock tool callbacks to return structuredContent [VERIFIED: packages/mcp/package.json] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Zod for outputSchema | JSON Schema literal | SDK expects ZodRawShape, would need custom type gymnastics -- not worth it |
| zod-to-json-schema (manual) | SDK's built-in conversion | SDK already calls zodToJsonSchema internally -- never call it yourself |

**Installation:**
No new packages needed. All dependencies already installed.

## Architecture Patterns

### How outputSchema + structuredContent Works End-to-End

The flow is fully documented from SDK source inspection:

1. **Tool registration:** Tool returns `getConfig()` with `outputSchema: someZodShape.shape` (a `ZodRawShape`, NOT a `ZodObject`)
2. **SfMcpServer.registerTool()** passes config (including outputSchema) to `McpServer.prototype.registerTool()` [VERIFIED: sf-mcp-server.ts line 274]
3. **SDK `_createRegisteredTool()`** wraps the shape: `outputSchema === undefined ? undefined : z.object(outputSchema)` -- converts `ZodRawShape` to `ZodObject` [VERIFIED: mcp.js line 444]
4. **SDK `tools/list` handler** converts to JSON Schema: `zodToJsonSchema(tool.outputSchema, { strictUnions: true })` [VERIFIED: mcp.js line 64]
5. **SDK `tools/call` handler** validates result: if `outputSchema && !result.isError`, checks `result.structuredContent` exists, then runs `tool.outputSchema.safeParseAsync(result.structuredContent)` [VERIFIED: mcp.js lines 117-125]
6. **Error bypass:** When `result.isError === true`, SDK skips structuredContent validation entirely [VERIFIED: mcp.js line 117]

### wrappedCb Pass-Through Analysis

The `wrappedCb` in `SfMcpServer.registerTool()` (lines 143-272) does NOT rebuild `CallToolResult`. The execution path is:

```
line 234: const execute = () => Promise.resolve(cb(args));
line 235-236: const result = ... await execute();
      // Lines 240-269: Only READ result.isError and result.content for telemetry
line 272: return result;  // Unchanged object returned
```

The `calculateResponseCharCount()` method (lines 293-314) already reads `structuredContent` from the result for telemetry character counting. No mutation occurs. [VERIFIED: direct code inspection]

### Reference Pattern: code-analyzer tools

The `mcp-provider-code-analyzer` package already implements 6 tools with outputSchema + structuredContent. Use `describe_code_analyzer_rule.ts` as the canonical reference:

```typescript
// Source: packages/mcp-provider-code-analyzer/src/tools/describe_code_analyzer_rule.ts

// 1. Define output schema as a Zod object
const outputSchema = z.object({
    status: z.string().describe('If the operation succeeds, this will be "success". Otherwise, it will be an error message.'),
    rule: z.object({
        name: z.string(),
        engine: z.string(),
        // ... more fields
    }).optional()
});
type OutputArgsShape = typeof outputSchema.shape;

// 2. In getConfig(), pass outputSchema.shape (NOT the ZodObject itself)
public getConfig(): McpToolConfig<InputArgsShape, OutputArgsShape> {
    return {
        // ...
        outputSchema: outputSchema.shape,  // <-- .shape extracts ZodRawShape
        // ...
    };
}

// 3. In exec(), return BOTH content AND structuredContent
public async exec(input): Promise<CallToolResult> {
    let output;
    try {
        output = await this.action.exec(input);
    } catch (e) {
        output = { status: getErrorMessage(e) };
    }
    return {
        content: [{ type: "text", text: JSON.stringify(output) }],  // backward compat
        structuredContent: output                                     // machine-parseable
    };
}
```

Key points from this pattern:
- `outputSchema.shape` extracts the `ZodRawShape` from the `ZodObject` [VERIFIED: code-analyzer source]
- Error path returns structuredContent with a status message (NOT toolError) -- this is specific to code-analyzer's pattern where errors are part of the schema
- For dx-core tools that use `toolError()`, the error path returns `isError: true` with no `structuredContent` -- the SDK skips validation when `isError: true` [VERIFIED: SDK mcp.js line 117]

### Recommended Pattern for dx-core Tools

```typescript
// 1. Define output schema
const outputSchema = z.object({
    totalSize: z.number(),
    done: z.boolean(),
    records: z.array(z.record(z.unknown())),
});
type OutputArgsShape = typeof outputSchema.shape;

// 2. Change class generic and getConfig
export class QueryOrgMcpTool extends McpTool<InputArgsShape, OutputArgsShape> {
    public getConfig(): McpToolConfig<InputArgsShape, OutputArgsShape> {
        return {
            // ...existing config...
            outputSchema: outputSchema.shape,
        };
    }

    // 3. Modify exec() success path only
    public async exec(input: InputArgs): Promise<CallToolResult> {
        try {
            const result = await connection.query(input.query);
            return {
                content: [{ type: 'text', text: `SOQL query results:\n\n${JSON.stringify(result, null, 2)}` }],
                structuredContent: {
                    totalSize: result.totalSize,
                    done: result.done,
                    records: result.records,
                },
            };
        } catch (error) {
            // Error path unchanged -- toolError() returns isError:true, SDK skips validation
            return toolError(`Failed: ${err.message}`, { recovery: '...', category: classifyError(err) });
        }
    }
}
```

### Anti-Patterns to Avoid
- **Declaring outputSchema without returning structuredContent:** SDK throws `McpError` -- "Tool X has an output schema but no structured content was provided" [VERIFIED: mcp.js line 119]
- **Returning structuredContent in error paths:** When `isError: true`, do NOT include `structuredContent`. The SDK skips validation, but it creates confusion. Let `toolError()` handle errors as-is.
- **Passing `z.object(...)` instead of `outputSchema.shape`:** The `McpToolConfig.outputSchema` expects `ZodRawShape` (a plain object of Zod types), NOT a `ZodObject`. The SDK wraps it in `z.object()` internally. Passing a ZodObject would create `z.object(z.object(...))` -- double-wrapped. [VERIFIED: mcp.js line 444]
- **Omitting text content field:** Always return `content: [{ type: 'text', text: JSON.stringify(data) }]` alongside `structuredContent` for backward compatibility with older clients [VERIFIED: PITFALLS.md, MCP spec]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Zod-to-JSON Schema conversion | Manual JSON Schema construction | SDK's built-in `zodToJsonSchema` | SDK handles conversion automatically when `outputSchema` is provided [VERIFIED: mcp.js line 64] |
| structuredContent validation | Custom validation logic | SDK's `safeParseAsync` | SDK validates automatically at runtime [VERIFIED: mcp.js line 122] |
| Schema type derivation | Manual TypeScript types | `typeof schema.shape` | Zod's type inference ensures consistency [VERIFIED: code-analyzer pattern] |
| Error handling in structured tools | Custom error schema | Existing `toolError()` factory | `isError: true` bypasses schema validation -- no schema change needed for errors [VERIFIED: mcp.js line 117] |

**Key insight:** The SDK does ALL the heavy lifting for structured output. Tool authors only need to: (1) define a Zod schema, (2) pass `.shape` in config, (3) return `structuredContent` in the success path. The SDK handles JSON Schema conversion, runtime validation, and error bypass.

## Common Pitfalls

### Pitfall 1: structuredContent Not Matching outputSchema at Runtime
**What goes wrong:** Tool returns a `structuredContent` object that doesn't match the declared `outputSchema`. SDK throws `McpError: Invalid structured content for tool X: ...` at runtime.
**Why it happens:** Schema defines required fields but the tool data source returns optional/null fields. Or schema uses `.number()` but data returns string representation.
**How to avoid:** Use `.optional()` on schema fields that may be absent. For SOQL results, use `z.record(z.unknown())` for records since field shapes vary by query. Test with real data shapes.
**Warning signs:** `McpError` with "Invalid structured content" in test output.

### Pitfall 2: Forgetting to Update OutputArgsShape Generic
**What goes wrong:** Tool class still uses `type OutputArgsShape = z.ZodRawShape` (generic) instead of `typeof outputSchema.shape` (specific). TypeScript compiles fine but loses type safety.
**Why it happens:** Mechanical change easily missed when updating getConfig().
**How to avoid:** Always update the type alias: `type OutputArgsShape = typeof outputSchema.shape;` and update the class generic `McpTool<InputArgsShape, OutputArgsShape>`.
**Warning signs:** No TypeScript errors on structuredContent field mismatches.

### Pitfall 3: SOQL Query Results Have Dynamic Schema
**What goes wrong:** Defining a strict outputSchema for `run_soql_query` that specifies field names, but SOQL queries return arbitrary fields depending on the query.
**Why it happens:** run_soql_query returns whatever fields the user queried -- it's a generic query tool.
**How to avoid:** Use a schema with `records: z.array(z.record(z.unknown()))` -- this validates the structure (array of objects) without constraining field names. The `totalSize`, `done`, and `records` envelope is always present.
**Warning signs:** Every SOQL query with different fields fails schema validation.

### Pitfall 4: get_username Has Multiple Return Paths with Different Shapes
**What goes wrong:** `get_username` has 3 distinct success paths: (1) explicit default org lookup, (2) explicit dev hub lookup, (3) suggestion mode. Each returns different text structure.
**Why it happens:** The tool is logic-heavy with branching returns, not a simple data-fetch tool.
**How to avoid:** Design the outputSchema to accommodate all success paths with optional fields, or consider whether this tool is a good candidate. A union schema (`z.discriminatedUnion`) adds complexity.
**Warning signs:** One success path works, others fail validation.

### Pitfall 5: ToolTextResponse Type Lacks structuredContent
**What goes wrong:** The `textResponse()` helper in `shared/utils.ts` returns `ToolTextResponse` type which only has `isError` and `content`. Cannot add `structuredContent` to its return.
**Why it happens:** `textResponse()` was designed for text-only output before structured output existed.
**How to avoid:** Do NOT modify `textResponse()` -- it serves text-only tools correctly. For structured tools, construct the `CallToolResult` directly in the success path instead of using `textResponse()`. Error paths can still use `toolError()`.
**Warning signs:** TypeScript error adding `structuredContent` to `textResponse()` return type.

## Code Examples

### Example 1: Middleware Pass-Through Test (OUT-02)

```typescript
// Source: Pattern derived from existing sf-mcp-server.test.ts + research
// File: packages/mcp/test/unit/sf-mcp-server.test.ts (add to existing file)

describe('structuredContent pass-through', () => {
    it('should pass structuredContent from tool callback through wrappedCb unchanged', async () => {
        const structuredData = { totalSize: 5, done: true, records: [{ Id: '001xx' }] };
        const cb = sinon.stub().resolves({
            content: [{ type: 'text', text: JSON.stringify(structuredData) }],
            structuredContent: structuredData,
        });

        const wrappedCb = captureWrappedCallback(server, 'test_structured_tool',
            { query: z.string() }, cb);

        const result = await wrappedCb({ targetOrg: 'staging', query: 'test' }, {});

        expect(result.structuredContent).to.deep.equal(structuredData);
        expect(result.content[0].text).to.equal(JSON.stringify(structuredData));
    });

    it('should not include structuredContent when tool returns error', async () => {
        const cb = sinon.stub().resolves({
            isError: true,
            content: [{ type: 'text', text: 'Error occurred' }],
        });

        const wrappedCb = captureWrappedCallback(server, 'test_error_tool',
            { query: z.string() }, cb);

        const result = await wrappedCb({ targetOrg: 'staging', query: 'test' }, {});

        expect(result.isError).to.be.true;
        expect(result).to.not.have.property('structuredContent');
    });
});
```

### Example 2: run_soql_query with Structured Output

```typescript
// Source: Derived from existing run_soql_query.ts + code-analyzer pattern

const queryOutputSchema = z.object({
    totalSize: z.number().describe('Total number of records returned'),
    done: z.boolean().describe('Whether all records have been returned'),
    records: z.array(z.record(z.unknown())).describe('Array of record objects'),
});
type OutputArgsShape = typeof queryOutputSchema.shape;

// In exec() success path:
const result = input.useToolingApi
    ? await connection.tooling.query(input.query)
    : await connection.query(input.query);

return {
    content: [{ type: 'text', text: `SOQL query results:\n\n${JSON.stringify(result, null, 2)}` }],
    structuredContent: {
        totalSize: result.totalSize,
        done: result.done,
        records: result.records,
    },
};
```

### Example 3: list_all_orgs with Structured Output

```typescript
// Source: Derived from existing list_all_orgs.ts + SanitizedOrgAuthorization type

const listOrgsOutputSchema = z.object({
    orgs: z.array(z.object({
        username: z.string().optional(),
        aliases: z.array(z.string()).nullable().optional(),
        instanceUrl: z.string().optional(),
        orgId: z.string().optional(),
        isScratchOrg: z.boolean().optional(),
        isDevHub: z.boolean().optional(),
        isSandbox: z.boolean().optional(),
        isExpired: z.union([z.boolean(), z.literal('unknown')]).optional(),
    })).describe('Array of authorized Salesforce orgs'),
});
type OutputArgsShape = typeof listOrgsOutputSchema.shape;

// In exec() success path:
const orgs = await this.services.getOrgService().getAllowedOrgs();
return {
    content: [{ type: 'text', text: `List of configured Salesforce orgs:\n\n${JSON.stringify(orgs, null, 2)}` }],
    structuredContent: { orgs },
};
```

### Example 4: salesforce_get_org_info with Structured Output

```typescript
// Source: Derived from existing get_org_info.ts

const getOrgInfoOutputSchema = z.object({
    defaultOrg: z.union([
        z.object({
            key: z.string(),
            value: z.string(),
            location: z.string().optional(),
            path: z.string(),
        }),
        z.literal('none'),
    ]).describe('Default org configuration or "none"'),
    authorizedOrgs: z.array(z.object({
        alias: z.string(),
        username: z.string(),
        instanceUrl: z.string(),
        orgId: z.string(),
    })).describe('List of authorized Salesforce orgs with key fields'),
});
```

## Candidate Tool Selection

### Priority Tools (clear structured return shapes)

| Tool | Package | Return Shape | Complexity | Recommendation |
|------|---------|--------------|------------|----------------|
| `run_soql_query` | dx-core | `{ totalSize, done, records[] }` | LOW | Yes -- envelope is always consistent, records use `z.record(z.unknown())` |
| `list_all_orgs` | dx-core | `SanitizedOrgAuthorization[]` | LOW | Yes -- matches existing type exactly |
| `salesforce_get_org_info` | dx-core | `{ defaultOrg, authorizedOrgs[] }` | LOW | Yes -- already constructs structured object internally |
| `run_apex_test` | dx-core | `TestResult` or `TestRunIdResult` | MEDIUM | Yes -- but dual return shape (async vs sync) requires union schema or discriminated union |
| `run_agent_test` | dx-core | Start result or poll result | MEDIUM | Yes -- similar to run_apex_test with async/sync split |
| `assign_permission_set` | dx-core | Simple success string | LOW | Yes -- minimal but useful: `{ permissionSet, assignedTo }` |

### Tools NOT Recommended for This Phase

| Tool | Reason |
|------|--------|
| `get_username` | 3 distinct success paths with very different return shapes; would need complex union schema |
| `deploy_metadata` | Variable blob results, free-form text |
| `retrieve_metadata` | Variable structure depending on what was retrieved |
| `create_scratch_org` | Complex async flow with multiple result types |
| `resume_tool_operation` | Polymorphic -- resumes different operation types with different result shapes |
| `open_org` | Returns simple status text, no structured data benefit |
| `delete_org` | Returns simple status text, NON_GA tool |

### Final Recommended 6 Tools

1. `run_soql_query` -- highest value, most data-rich
2. `list_all_orgs` -- clean array return
3. `salesforce_get_org_info` -- already builds structured object
4. `run_apex_test` -- high value for agent workflows
5. `run_agent_test` -- same pattern as apex test
6. `assign_permission_set` -- simple but demonstrates the pattern on write tools

This gives 6 tools (within the 5-8 range). Adding `get_username` could reach 7 but the complexity of its 3-way return shape makes it a poor early candidate.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Text-only content in CallToolResult | structuredContent + outputSchema | MCP spec 2025-06-18 | Agents can parse results programmatically without text extraction |
| No runtime validation of tool output | SDK validates structuredContent against outputSchema | SDK 1.8+ (fix #655, June 2025) | Malformed output caught at tool execution time |
| isError + outputSchema conflict | isError bypasses validation | SDK 1.8+ (fix #654) | Error paths work correctly with outputSchema tools |

**Deprecated/outdated:**
- None for this phase -- structured output is the current approach, no migration from older patterns needed.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `run_apex_test` TestResult object serializes cleanly to match a Zod schema | Candidate Tools | Need to inspect actual TestResult type more deeply; may have non-serializable fields |
| A2 | `run_agent_test` poll result is a plain JSON-serializable object | Candidate Tools | Same risk as A1 for agent test results |
| A3 | Returning `structuredContent` in the code-analyzer pattern (status field for errors) is intentional, not a mistake | Architecture Patterns | dx-core tools should use toolError() for errors instead, which omits structuredContent |

**All other claims in this research were verified against source code or SDK internals.**

## Open Questions

1. **TestResult / TestRunIdResult shapes for run_apex_test**
   - What we know: The tool returns `JSON.stringify(result)` for both sync and async paths
   - What's unclear: Exact field shapes of `TestResult` from `@salesforce/apex-node` -- are all fields JSON-serializable? Do we need to filter fields?
   - Recommendation: Inspect `@salesforce/apex-node` types at implementation time. Use a broad schema with `z.unknown()` for complex nested fields if needed.

2. **Whether to use z.discriminatedUnion for async vs sync test results**
   - What we know: `run_apex_test` returns `TestRunIdResult` (async) or `TestResult` (sync) depending on `input.async`
   - What's unclear: Whether the planner should use one schema with optional fields or a discriminated union
   - Recommendation: Use a single schema with optional fields (simpler). The async path returns a test run ID; the sync path returns full results. A `status` discriminator field would require adding one.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | mocha 11.7.2 + chai ^4.3.10 + sinon 10.0.0 |
| Config file | `packages/mcp/.mocharc.json` |
| Quick run command | `cd packages/mcp && yarn test` |
| Full suite command | `cd packages/mcp && yarn test && cd ../mcp-provider-dx-core && yarn test` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| OUT-02 | structuredContent survives wrappedCb middleware | unit | `cd packages/mcp && yarn test` | Partial -- sf-mcp-server.test.ts exists, new describe block needed |
| OUT-01 (soql) | run_soql_query returns structuredContent matching outputSchema | unit | `cd packages/mcp-provider-dx-core && yarn test` | No -- new test file or additions to existing |
| OUT-01 (list_orgs) | list_all_orgs returns structuredContent matching outputSchema | unit | `cd packages/mcp-provider-dx-core && yarn test` | No |
| OUT-01 (get_org_info) | salesforce_get_org_info returns structuredContent matching outputSchema | unit | `cd packages/mcp-provider-dx-core && yarn test` | No |
| OUT-01 (apex_test) | run_apex_test returns structuredContent matching outputSchema | unit | `cd packages/mcp-provider-dx-core && yarn test` | No |
| OUT-01 (agent_test) | run_agent_test returns structuredContent matching outputSchema | unit | `cd packages/mcp-provider-dx-core && yarn test` | No |
| OUT-01 (assign_perm) | assign_permission_set returns structuredContent matching outputSchema | unit | `cd packages/mcp-provider-dx-core && yarn test` | No |

### Sampling Rate
- **Per task commit:** `cd packages/mcp && yarn test` (middleware tests)
- **Per wave merge:** `cd packages/mcp && yarn test && cd ../mcp-provider-dx-core && yarn test`
- **Phase gate:** Full suite green before verification

### Wave 0 Gaps
- [ ] `packages/mcp-provider-dx-core/test/unit/structured-output.test.ts` -- covers OUT-01 for all 6 tools
- [ ] No new framework install needed -- mocha/chai/sinon already available

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | N/A -- no auth changes |
| V3 Session Management | No | N/A |
| V4 Access Control | No | Permission middleware unchanged |
| V5 Input Validation | Yes | Zod schemas for outputSchema (validated by SDK) |
| V6 Cryptography | No | N/A |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Schema injection via crafted SOQL results | Tampering | `z.record(z.unknown())` accepts any shape but SDK validates against declared schema |
| Information disclosure through structuredContent | Information Disclosure | Same data already exposed in text content field -- no new information surface |

**Assessment:** LOW security risk. structuredContent exposes the same data that text content already exposes. The SDK's schema validation adds a safety layer, not a risk.

## Sources

### Primary (HIGH confidence)
- `@modelcontextprotocol/sdk` 1.18.2 compiled source -- `mcp.js` (registerTool, _createRegisteredTool, tool handler, validation logic)
- `packages/mcp/src/sf-mcp-server.ts` -- wrappedCb middleware implementation (lines 143-272)
- `packages/mcp-provider-code-analyzer/src/tools/describe_code_analyzer_rule.ts` -- reference implementation
- `packages/mcp-provider-code-analyzer/test/tools/describe_code_analyzer_rule.test.ts` -- reference test pattern
- `packages/mcp-provider-api/src/tools.ts` -- McpToolConfig type definition (line 47-56)
- `packages/mcp-provider-api/src/types.ts` -- SanitizedOrgAuthorization type
- `packages/mcp-provider-api/src/errors.ts` -- toolError() factory return shape

### Secondary (MEDIUM confidence)
- `.planning/research/FEATURES.md` -- prior research on structured output patterns
- `.planning/research/PITFALLS.md` -- pitfalls #1 and #2 about structuredContent
- `.planning/research/ARCHITECTURE.md` -- anti-pattern #3 (outputSchema without structuredContent)
- MCP spec 2025-06-18 (referenced in prior research)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- all libraries already installed and verified in node_modules
- Architecture: HIGH -- SDK source code inspected, reference implementation exists in code-analyzer
- Pitfalls: HIGH -- multiple sources (SDK source, prior research, code-analyzer reference) confirm known issues
- Tool selection: HIGH -- each candidate tool's source code inspected for return shape compatibility

**Research date:** 2026-04-11
**Valid until:** 2026-05-11 (stable -- no SDK upgrade planned)
