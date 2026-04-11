# Pitfalls: MCP Best Practices Alignment

**Domain:** Adding Tool Annotations, structured output, Resources, Prompts, and logging to an existing production MCP server
**Project:** Salesforce MCP Server (49+ tools, plugin architecture, middleware layer)
**Researched:** 2026-04-11
**Confidence:** HIGH — based on direct codebase inspection of all 11 provider packages plus SDK internals, supplemented by verified MCP specification documents and confirmed community issue reports

---

## Critical Pitfalls

### Pitfall 1: Middleware Strips structuredContent from Tool Results

**What goes wrong:**
`SfMcpServer.registerTool()` wraps every tool callback in `wrappedCb`. The wrapper calls `cb(args, extra)` and stores the result in `result`. The current implementation passes `result` through to `McpServer.prototype.registerTool.call(...)` intact. However, if anyone adds post-processing to `wrappedCb` (e.g., normalizing errors, extracting content for telemetry), there is a high risk of reassigning `result` to a new object that only contains `{ isError, content }` without preserving `structuredContent`.

The existing `calculateResponseCharCount` method already accesses `structuredContent` via a cast `(result as CallToolResult & { structuredContent?: unknown })`, confirming the SDK's `CallToolResult` type doesn't include `structuredContent` in its declared interface. Any code that reconstructs a `CallToolResult` from scratch (e.g., for error wrapping) will silently drop structured output.

**Why it happens:**
TypeScript's `CallToolResult` type in SDK ≤1.18 does not include `structuredContent` as a declared field; it is only present at runtime. Developers writing `return { isError: true, content: [...] }` in error paths never get a compiler warning about the missing field. Any catch-and-rewrap pattern in middleware produces a structuredContent-less response.

**Confirmed community impact:**
langchain-mcp-adapters, n8n, and similar clients drop `structuredContent` when only processing `content`. Clients that do preserve `structuredContent` will silently get `undefined` if middleware dropped it.

**Consequences:**
- LLMs receive only the text fallback for tools that implemented structuredContent, defeating the purpose of structured output.
- The regression is invisible in existing tests because no existing tests verify structuredContent round-trips through the `wrappedCb` wrapper.
- Code Analyzer tools (`list_code_analyzer_rules`, `query_code_analyzer_results`) already use `structuredContent`; these would silently degrade if middleware is modified carelessly.

**Prevention:**
- When adding error recovery messages in `wrappedCb`, never reconstruct the result object. Mutate `result.content` or prepend guidance text; do not replace `result`.
- Add a middleware-level test: verify that a tool returning `{ content: [...], structuredContent: { key: 'value' } }` produces a response with `structuredContent` present after passing through `wrappedCb`.
- Do NOT add a `structuredContent` override in `wrappedCb` error paths — keep them as `{ isError: true, content: [...] }` only.

**Detection:**
- Unit test: spy on `tool.exec`, return a value with `structuredContent`, assert that `wrappedCb` returns an object with the same `structuredContent`.
- Integration test: call `list_code_analyzer_rules` through the full server, assert the `structuredContent` field is present in the SDK response.

**Phase:** Any phase that modifies `wrappedCb` in `sf-mcp-server.ts`. Address as a prerequisite before adding per-tool structured output.

---

### Pitfall 2: Missing `content` Field When Returning structuredContent Only

**What goes wrong:**
MCP spec 2025-06-18 requires that tools declaring an `outputSchema` MUST return `structuredContent` conforming to that schema AND SHOULD also return a serialized JSON `TextContent` block in `content` for backwards compatibility. Tools that return only `structuredContent` with an empty or missing `content` array break clients that have not yet adopted the structured output spec.

The MCP Python SDK issue #1378 and the SEP-1624 clarification debate confirm this is an active ecosystem ambiguity: some readers believe `content` should be optional when `outputSchema` is declared; the spec says SHOULD (not MUST), but the SDK type system and existing clients treat `content` as required.

**Why it happens:**
Developers adding structured output for the first time see `structuredContent` as the "real" response and omit the redundant text serialization, producing a response that fails validation in strict clients.

**Consequences:**
- Clients enforcing the old schema reject responses with `content: []` or missing `content`.
- Streaming clients that chunk content blocks see no visible output and may time out or loop.

**Prevention:**
- Always return both fields: `content: [{ type: 'text', text: JSON.stringify(structuredData) }]` and `structuredContent: structuredData`.
- The code-analyzer tools already do this correctly — treat them as the reference implementation.
- In error paths, `structuredContent` is optional; returning only `{ isError: true, content: [...] }` is correct.

**Detection:**
- Tool test assertions: verify any tool with an `outputSchema` returns a non-empty `content` array in addition to `structuredContent`.

**Phase:** Every phase that adds `outputSchema` to a tool.

---

### Pitfall 3: Capabilities Declared at Startup — Cannot Be Added After `server.connect()`

**What goes wrong:**
The current server startup in `index.ts` declares only `capabilities: { resources: {}, tools: {} }`. Logging (`logging: {}`) and prompts (`prompts: {}`) are absent. The SDK throws `"Cannot register capabilities after connecting to transport"` if `registerCapabilities()` is called post-connect. Registering a Resource or Prompt handler also auto-injects the corresponding capability via `_resourceHandlersInitialized` / `_promptHandlersInitialized` guards in `McpServer`, but `logging` is not auto-injected — it requires an explicit capability declaration.

**Why it happens:**
The SDK's `Server` class (the low-level transport-level class underlying `McpServer`) validates capability declarations at initialization. The `McpServer` high-level class auto-registers the `resources` and `prompts` capabilities when the first `resource()` or `prompt()` call is made (before `connect()`). Logging requires manual addition.

**Consequences:**
- Forgetting `logging: {}` causes the SDK to throw when `logging/setLevel` is received from the client, and `sendLoggingMessage()` throws `"Server does not support logging"`. This is a hard server error that terminates the current request and may crash stdio transport.
- Adding capabilities after `connect()` always throws regardless of which capability.

**Prevention:**
- Add `logging: {}` and `prompts: {}` to the `capabilities` object in `index.ts` when implementing those features.
- Confirmed pattern: `capabilities: { resources: {}, tools: {}, logging: {}, prompts: {} }`.
- Keep all capability declarations in one place (`index.ts` startup, not inside `registerTool`/provider logic).

**Detection:**
- Integration test: send a `logging/setLevel` request to the server; assert no protocol error is returned.
- Start-up smoke test: assert `server.server.getClientCapabilities()` round-trip includes the declared capabilities after connect.

**Phase:** Logging phase. Declare `logging: {}` and `prompts: {}` in the same commit that first uses those features.

---

### Pitfall 4: Tool Annotations — readOnlyHint Must Match tool-categories.ts or Permission Enforcement Breaks

**What goes wrong:**
`SfMcpServer.registerTool` calls `getToolCategory(name)` which looks up a hardcoded `toolCategoryMap` in `tool-categories.ts`. If a tool declares `readOnlyHint: true` in its annotation but is listed as `'write'` in `toolCategoryMap` (or vice versa), the two systems give contradictory signals. Worse: `getToolCategory` falls back to `'write'` for any tool not in the map. New tools added without a `toolCategoryMap` entry will be treated as write operations and may get `needs-approval` permission checks even if they are read-only.

The inverse problem: a tool listed as `'read'` in the map but with `annotations: { readOnlyHint: false, destructiveHint: true }` will be passed through the permission check as read-only (allowed without approval on protected orgs) even though the annotation says it is destructive.

**Why it happens:**
Two separate systems encode the same semantic: `tool-categories.ts` for runtime permission enforcement, `ToolAnnotations` for MCP protocol metadata visible to clients. They were designed independently and there is no automated consistency check between them.

**Consequences:**
- Permission enforcement on production orgs uses the wrong category — a destructive tool might bypass the approval gate, or a read tool might trigger unnecessary approval flows.
- MCP clients (e.g., Claude Desktop) that inspect `readOnlyHint` to display lock icons or warnings will show misleading metadata.

**Prevention:**
- Establish an invariant: `readOnlyHint: true` ↔ category `'read'` in the map. `destructiveHint: true` ↔ category `'write'` or `'execute'`.
- Write a unit test that iterates every registered tool, reads its annotation from `getConfig()`, calls `getToolCategory()`, and asserts consistency.
- When adding annotations to a tool not yet in `toolCategoryMap`, add the entry to the map in the same PR.
- The 3 tools with empty `annotations: {}` (`create_org_snapshot`, `delete_org`, `create_scratch_org`) are currently covered by the map's fallback to `'write'` — when filling in their annotations, confirm the map entry matches.

**Detection:**
- Automated: annotation-vs-category consistency test (described above).
- Manual: search for tools in `toolCategoryMap` that are categorized as `'read'` and verify their `annotations.readOnlyHint` is `true`.

**Phase:** Tool Annotations phase. Run consistency check before the phase closes.

---

### Pitfall 5: Resources Registered but Not Wired Through Provider Plugin Architecture

**What goes wrong:**
`McpProvider.provideResources()` exists as a method returning `Promise<(McpResource | McpResourceTemplate)[]>` with a default no-op implementation. The main server's `registerToolsets()` function in `registry-utils.ts` calls `provider.provideTools()` but does NOT call `provider.provideResources()` or `provider.providePrompts()`. Resource implementations in provider packages will be silently ignored at runtime if someone adds them without also wiring them into `registry-utils.ts`.

**Why it happens:**
The API was designed in advance of server-side implementation. The `McpResource` and `McpPrompt` base classes in `mcp-provider-api` carry a comment: `NOTE - CURRENTLY THE MAIN MCP SERVER DOES NOT CONSUME THIS YET`. The provider architecture is ready; the wiring is absent.

**Consequences:**
- Resources and prompts added to provider packages never get registered — no error, no log, complete silence.
- Tests for individual provider `provideResources()` methods pass; integration tests (which rely on the wiring) silently have no resources available.
- The `capabilities: { resources: {} }` is already declared in the server, so clients will query `resources/list` and get an empty list, not an error — making the omission very hard to detect.

**Prevention:**
- Add `provideResources()` wiring in `registry-utils.ts` alongside the existing `provideTools()` wiring. This should be a single phase: implement at least one resource AND wire the registry in the same commit.
- Add an integration test that calls `resources/list` after server startup and asserts at least one resource is returned.
- The `McpResource` / `McpResourceTemplate` abstract classes require `kind: 'McpResource'` discriminants — use these in the registry wiring to distinguish them.

**Detection:**
- Integration smoke test: `resources/list` returns non-empty after startup with `--toolsets all`.
- Unit test: assert `createToolRegistryFromProviders` equivalent function for resources returns non-zero entries when providers return resources.

**Phase:** Resources phase. Wiring must happen in the same phase as the first Resource implementation.

---

## Moderate Pitfalls

### Pitfall 6: ToolAnnotations `openWorldHint` Defaults to `true` — Omitting It Is a Misleading Signal

**What goes wrong:**
The MCP spec defines `openWorldHint` default as `true` (the tool interacts with external systems beyond the local environment). For the 3 tools with empty `annotations: {}` (`create_org_snapshot`, `delete_org`, `create_scratch_org`), the field is absent, which the SDK treats as `openWorldHint: true`. Since all three tools connect to Salesforce orgs, this is actually correct — but for a purely local tool (hypothetical future tool operating only on local files), an empty annotation object would silently misrepresent its scope.

**Why it happens:**
Developers adding `annotations: {}` assume "empty is neutral." The spec's defaults are non-neutral: `readOnlyHint` defaults to `false`, `destructiveHint` defaults to `true`, `idempotentHint` defaults to `false`, `openWorldHint` defaults to `true`.

**Prevention:**
- Never leave `annotations: {}`. Every tool must explicitly set all four hints to prevent ambiguous defaults.
- Reference values for this codebase: all Salesforce tools should set `openWorldHint: true` (they call remote APIs). Tools that only read local files would set `openWorldHint: false`.

**Phase:** Tool Annotations phase. Include in annotation review checklist.

---

### Pitfall 7: Error Messages With Recovery Guidance Must Avoid Leaking Internal State

**What goes wrong:**
Adding LLM-readable recovery guidance to error messages creates a new surface for information leakage. An error like `"Org 'prod-org' is not found in StateAggregator path /home/user/.sf/orgs/prod-org"` gives the AI (and any log consumers) an internal filesystem path and the name of an internal Salesforce core class. This is acceptable in debug logs but not in tool call responses.

The current pattern in `run_soql_query` is: `return textResponse('Failed to query org: ' + errorMessage, true)`, which forwards the raw `error.message`. Many `@salesforce/core` exceptions include stack traces, internal paths, and SFDC API version details in their messages.

**Why it happens:**
Developers want to give the LLM enough context to retry, and the raw error message seems like the most convenient source of that context. The difference between "what to tell the LLM" and "what the exception contains" is easy to overlook.

**Prevention:**
- Distinguish three message layers: (1) raw error for internal telemetry/logging, (2) sanitized recovery guidance for the LLM content field, (3) structured error metadata for structuredContent if applicable.
- Recovery messages should answer: "What happened? What should the LLM try differently?" — not expose internal paths or class names.
- Wrap raw `@salesforce/core` exceptions; extract only the user-facing message portions.

**Phase:** Error recovery phase. Apply to all tools being updated.

---

### Pitfall 8: MCP Prompts Must Use Only `z.ZodType<string>` Arg Types — Zod Non-String Types Fail Silently

**What goes wrong:**
`PromptArgsRawShape` (defined in `mcp-provider-api/src/prompts.ts`) constrains each argument to `z.ZodType<string> | z.ZodOptional<z.ZodType<string>>`. This means prompt arguments can only be strings. Developers who want to pass a boolean flag or a number (e.g., `maxRecords: z.number()`) will hit a TypeScript compile error — but if they work around it with `as any` or use a runtime-only library they may produce prompt argument schemas that the SDK rejects at registration time with an opaque error.

**Why it happens:**
The MCP protocol requires prompt arguments to be strings (they are user-supplied text values). The constraint is correct but not obvious to developers coming from tool design where Zod numbers/booleans are common.

**Prevention:**
- Prompt arguments must model all input as strings. Boolean flags become `"true"/"false"` strings. Numbers become string-encoded numerals. Parse inside the `prompt()` implementation.
- Add this constraint to internal contributor documentation for the Prompts phase.

**Phase:** Prompts phase.

---

### Pitfall 9: Resource URI Collisions Between Providers Break List Responses

**What goes wrong:**
If two providers register resources at the same URI (e.g., both a DX core provider and a scale products provider register `salesforce://org/info`), the second registration silently overwrites the first in `McpServer`'s internal `_registeredResources` map. `resources/list` returns only the second. There is no runtime warning.

**Why it happens:**
The MCP SDK `resource()` method does not validate uniqueness against existing URIs. There is no centralized URI registry.

**Prevention:**
- Use provider-namespaced URIs: `salesforce://{provider}/{resource}` pattern, e.g., `salesforce://dx-core/org-info`, `salesforce://devops/pipeline-status`.
- Add a startup assertion (similar to the tool duplicate-name check in `registry-utils.ts`) that fails if two resources share a URI.

**Phase:** Resources phase.

---

### Pitfall 10: Logging Messages Sent Before Client Issues `logging/setLevel` Are Silently Dropped

**What goes wrong:**
The MCP spec states that servers SHOULD NOT emit log messages until the client has set a log level via `logging/setLevel`. The SDK enforces this by checking `_loggingLevels` per session. If `sendLoggingMessage()` is called at server startup (before the client connects and sets a level), the message is silently dropped without error.

Additionally, the spec says: "If the server emits log messages at a level lower than the currently configured level, the server SHOULD NOT send them." Emitting a large number of low-level debug messages without honoring the configured level wastes stdio bandwidth and can degrade client performance.

**Why it happens:**
Developers implement logging as a drop-in replacement for `console.error()` or the existing `@salesforce/core` Logger, not realizing the conditional delivery semantics of MCP log notifications.

**Prevention:**
- Wrap `sendLoggingMessage()` in a helper that checks if the server is connected and a level has been set.
- Buffer startup log messages for delivery after the `oninitialized` callback fires (when the client is confirmed connected and may have already sent `logging/setLevel`).
- Never route `@salesforce/core` Logger output directly into MCP log notifications without level filtering.

**Phase:** Logging phase.

---

## Minor Pitfalls

### Pitfall 11: `idempotentHint: true` on Destructive Tools Enables Unsafe Retry

**What goes wrong:**
`idempotentHint: true` signals to MCP clients that calling the tool multiple times with the same arguments produces the same result as calling it once. Clients and agents use this to decide whether to auto-retry on failure. Setting it on tools like `delete_org` or `deploy_metadata` would enable automatic retries of destructive operations.

**Prevention:**
- Only set `idempotentHint: true` on tools where the second identical call produces no additional state change: `run_soql_query` (read-only), `get_org_info` (read-only), `list_all_orgs` (read-only). Do not set it on `deploy_metadata`, `delete_org`, `create_scratch_org`, `assign_permission_set`, or any DevOps write tools.

**Phase:** Tool Annotations phase.

---

### Pitfall 12: Tools in External Packages Cannot Receive Annotations Updates

**What goes wrong:**
`lwc-experts` and `aura-experts` are registered via their respective providers (`LwcExpertsMcpProvider`, `AuraExpertsMcpProvider`). Their tool configs including annotations are returned by `provideTools()` from a closed-source bundle. Annotations on these tools cannot be changed in this repo.

**Why it matters:**
These tools may currently return `annotations` with incorrect or missing hints, and there is no path to fix them short of filing a request with the provider owners.

**Prevention:**
- Document the annotation state of external provider tools at the start of the annotations phase.
- If a critical annotation (e.g., `readOnlyHint: false` on a tool that modifies state) needs to be overridden, consider wrapping the tool's registration in a shim that patches the config — but this approach has maintenance risk.
- Do not include external provider tool annotation quality in the milestone's definition of done; scope annotations only to owned tools.

**Phase:** Tool Annotations phase.

---

### Pitfall 13: Prompt Arguments Passed to `sf` CLI Commands Risk Injection

**What goes wrong:**
MCP Prompts accept string arguments from the client and embed them into prompt templates. If those strings are later passed to shell commands (e.g., `sf` CLI via `child_process`), they create a command injection surface. This is different from MCP tools where Zod validation already validates inputs.

**Prevention:**
- Prompts generate rendered message strings for the LLM context, not shell commands. Keep prompts as pure text-generation functions.
- Never use prompt argument values directly in `exec()` or `child_process.spawn()` calls.
- Validate prompt argument content with the same Zod approach used in tool `inputSchema`.

**Phase:** Prompts phase.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|----------------|------------|
| Tool Annotations | Empty `annotations: {}` on 3 tools produces misleading defaults | Fill all four hints; add consistency test vs `tool-categories.ts` |
| Tool Annotations | External provider tools (lwc-experts, aura-experts) cannot be updated | Scope annotations work to owned tools only; document external gaps |
| Error Recovery Messages | Raw `@salesforce/core` exceptions expose internal paths | Add sanitization wrapper; layer: telemetry gets raw, LLM gets sanitized |
| Structured Output | Middleware (`wrappedCb`) may drop `structuredContent` if result is reconstructed | Add pass-through test; never reconstruct result object in error paths |
| Structured Output | Tools with `outputSchema` that omit `content` break backward-compat clients | Always return both `content` and `structuredContent` |
| MCP Resources | `provideResources()` is never called — resources silently not registered | Wire `provideResources()` in `registry-utils.ts` in same phase as first Resource |
| MCP Resources | Two providers register same URI — second silently wins | Namespaced URIs; startup duplicate-URI assertion |
| MCP Prompts | Prompt args must be strings only — Zod non-string types fail at registration | Document constraint; string-encode all non-string values |
| MCP Logging | `logging: {}` capability absent — `sendLoggingMessage()` throws | Add `logging: {}` to capability declarations in `index.ts` |
| MCP Logging | Messages sent before client sets level are silently dropped | Buffer startup messages; send after `oninitialized` |

---

## Integration Gotchas Specific to This Codebase

| Integration Point | Common Mistake | Correct Approach |
|-------------------|----------------|------------------|
| `wrappedCb` in `sf-mcp-server.ts` | Reconstructing `CallToolResult` in error branch drops `structuredContent` | Mutate `result.content` only; preserve the original `result` object |
| `tool-categories.ts` | Adding annotation without updating category map | Update map entry in the same commit as annotation; add consistency test |
| `registry-utils.ts` | Calling only `provideTools()` on providers | Add `provideResources()` and `providePrompts()` calls for new primitives |
| Server `capabilities` in `index.ts` | Not declaring `logging` or `prompts` capability | Add at startup; the SDK rejects post-connect registration |
| Resource URIs | No namespace prefix on URI | Use `salesforce://{provider}/{resource}` pattern for all Resources |
| `McpResource` base class | Forgetting `kind: 'McpResource'` discriminant | Already enforced by abstract base — do not override `kind` field |
| Error messages | Forwarding raw `error.message` to `textResponse` | Sanitize before returning; use raw message only for telemetry |

---

## Telemetry Interaction Warnings

The existing `sendEvent` and `sendPdpEvent` calls in `wrappedCb` are wrapped in `try/catch`. Adding `sendLoggingMessage` calls for MCP protocol logging must NOT be similarly swallowed — a failure in `sendLoggingMessage` when the server is disconnected throws and should be let through so it surfaces in the transport error handler, not silently suppressed. Confirm `sendLoggingMessage` is called only inside the connected lifecycle.

---

## Sources

- Direct code inspection: `packages/mcp/src/sf-mcp-server.ts` — `wrappedCb`, `calculateResponseCharCount`, `structuredContent` cast
- Direct code inspection: `packages/mcp/src/index.ts` — `capabilities: { resources: {}, tools: {} }` missing `logging` and `prompts`
- Direct code inspection: `packages/mcp/src/registry.ts` and `packages/mcp/src/utils/registry-utils.ts` — `provideTools()` called, `provideResources()` and `providePrompts()` not called
- Direct code inspection: `packages/mcp-provider-api/src/provider.ts` — `provideResources()` and `providePrompts()` default no-op with explicit TODO comment
- Direct code inspection: `packages/mcp-provider-api/src/resources.ts` and `packages/mcp-provider-api/src/prompts.ts` — `McpResource`, `McpPrompt` base classes with "NOT CONSUMED YET" note
- Direct code inspection: `packages/mcp/src/utils/tool-categories.ts` — `toolCategoryMap`, fallback to `'write'`
- Direct code inspection: all `packages/mcp-provider-dx-core/src/tools/*.ts` — 3 tools have `annotations: {}`, rest have partial annotation sets
- Direct code inspection: `packages/mcp-provider-code-analyzer/src/tools/list_code_analyzer_rules.ts`, `query_code_analyzer_results.ts` — reference implementations of structuredContent with dual content+structuredContent return
- SDK inspection: `packages/mcp/node_modules/@modelcontextprotocol/sdk/dist/cjs/server/index.js` — `logging: {}` capability required; `registerCapabilities` throws after connect
- SDK inspection: `packages/mcp/node_modules/@modelcontextprotocol/sdk/dist/cjs/server/mcp.d.ts` — `registerTool`, `registerResource`, `registerPrompt`, `sendLoggingMessage` signatures
- MCP spec: https://modelcontextprotocol.io/specification/2025-06-18/server/tools — structuredContent SHOULD dual-return
- MCP spec: https://modelcontextprotocol.io/specification/2025-03-26/server/utilities/logging — logging capability required; setLevel before emit
- Community: https://github.com/langchain-ai/langchain-mcp-adapters/issues/283 — structuredContent dropped by middleware
- Community: https://github.com/n8n-io/n8n/issues/26963 — structuredContent drop causes agent loops
- Community: https://github.com/firecrawl/firecrawl-mcp-server/issues/86 — logging capability declared but method not implemented
- Community: https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1624 — structuredContent vs content guidance ambiguity
- Blog: https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/ — annotation defaults, trust semantics
- Blog: https://dev.to/alpic/better-mcp-toolscall-error-responses-help-your-ai-recover-gracefully-15c7 — error recovery message best practices

---
*Pitfalls research for: Salesforce MCP Server v1.2 — MCP Best Practices Alignment*
*Researched: 2026-04-11*
