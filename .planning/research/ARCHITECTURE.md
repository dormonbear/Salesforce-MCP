# Architecture Research

**Domain:** MCP Server — MCP Best Practices Alignment (v1.2)
**Researched:** 2026-04-11
**Confidence:** HIGH (based on direct codebase inspection + MCP SDK docs)

---

## Existing Architecture Baseline (post-v1.1)

```
index.ts (CLI entry)
  └─ new SfMcpServer(serverInfo, options)   // capabilities: { resources: {}, tools: {} }
       └─ registerTool(name, config, cb)    // wraps cb with middleware chain:
            1. Permission check (targetOrg)
            2. Rate limit check
            3. Serialized dispatch for lwc-experts (per-tool Mutex)
            4. await cb(args, extra)         // McpTool.exec()
            5. Telemetry emit
       └─ registerToolsets() in registry-utils.ts
            └─ McpProvider[] from registry.ts
                 └─ provideTools(services) → McpTool[]  (all 8 providers)
```

`McpResource`, `McpResourceTemplate`, and `McpPrompt` base classes exist in `mcp-provider-api` and `McpProvider.provideResources()` / `providePrompts()` are stubbed, but neither `registerToolsets()` nor any other path in `index.ts` or `registry-utils.ts` calls them. Resources and prompts are defined in the API contract but wired to nothing.

Logging capability (`logging: {}`) is absent from the capabilities object passed to `new SfMcpServer()`. The inner `this.server` (an `@modelcontextprotocol/sdk` `Server` instance) is accessible inside `SfMcpServer` and is the object that exposes `sendLoggingMessage()`.

---

## Feature Integration Map

### 1. Tool Annotations (Completion)

**What is incomplete:**
- `create_org_snapshot`, `delete_org`, `create_scratch_org` — `annotations: {}` (empty)
- All devops tools except `sfDevopsCreateWorkItem` and `sfDevopsUpdateWorkItemStatus` — no `annotations` key at all (10 of 12 tools)
- Most tools missing `idempotentHint` entirely; `destructiveHint` set on only 4 tools

**Where annotations live:** `McpTool.getConfig()` returns `McpToolConfig.annotations?: ToolAnnotations`. This flows to `server.registerTool(name, config, cb)` unchanged — `SfMcpServer.registerTool()` passes `config` through to `McpServer.prototype.registerTool.call()` at line 274 of `sf-mcp-server.ts`. No middleware touches `annotations`.

**Integration point:** Each provider package's individual tool files. No changes to `SfMcpServer`, `McpTool`, or `mcp-provider-api` needed.

**Rule for all four hints:**
| Hint | Meaning | Guidance |
|------|---------|---------|
| `readOnlyHint` | Tool makes no writes to external state | All query/list/read/test tools |
| `destructiveHint` | Side effects may be irreversible | delete, deploy with overwrite |
| `idempotentHint` | Safe to call multiple times with same args | Queries, retrieves, read tools |
| `openWorldHint` | Tool accesses entities beyond what the server knows about | Default `true` for most; `false` when output is bounded |

**Build effort:** Per-tool annotation review. No architectural change.

---

### 2. Error Messages with Recovery Guidance

**Current pattern:** `textResponse(err.message, true)` — plain error strings. The only exception is `deploy_metadata` which already embeds LLM instructions in the timeout error path.

**Where to change:** Inside each `McpTool.exec()` catch block. The response shape is unchanged (`CallToolResult` with `isError: true, content: [{ type: 'text', text }]`). The text content gains structured guidance.

**Where NOT to change:** `SfMcpServer.registerTool()` middleware error returns (permission denied, rate limit) are not tool errors — they are infrastructure errors that don't benefit from Salesforce-specific recovery hints.

**Recommended shared helper location:** `mcp-provider-api` (or a new `packages/mcp-provider-api/src/errors.ts`). A `toolError(message, recovery)` factory consolidates the pattern:

```typescript
// mcp-provider-api/src/errors.ts
export function toolError(message: string, recovery?: string): CallToolResult {
  const text = recovery ? `${message}\n\nRecovery: ${recovery}` : message;
  return { isError: true, content: [{ type: 'text', text }] };
}
```

All 8 provider packages import from `mcp-provider-api` already; adding this export is non-breaking.

**Integration point:** `mcp-provider-api/src/errors.ts` (new file, exported from `index.ts`) + per-tool catch blocks.

---

### 3. Structured Output (structuredContent)

**How the SDK wires it:** When `McpToolConfig.outputSchema` is a non-undefined Zod shape, `McpServer.registerTool()` validates `result.structuredContent` against that schema before returning to the client. `SfMcpServer.calculateResponseCharCount()` already handles `structuredContent` (added speculatively at v1.1).

**Correct TypeScript pattern (MEDIUM confidence — from SDK docs):**
```typescript
// Use type alias, not interface, for structuredContent assignability
type OrgListOutput = { orgs: Array<{ alias: string; username: string; instanceUrl: string }> };

getConfig(): McpToolConfig<InputShape, { orgs: z.ZodArray<...> }> {
  return {
    outputSchema: { orgs: z.array(z.object({ alias: z.string(), ... })) },
    ...
  };
}

async exec(): Promise<CallToolResult> {
  const output: OrgListOutput = { orgs: [...] };
  return {
    content: [{ type: 'text', text: JSON.stringify(output) }],  // backward compat
    structuredContent: output,
  };
}
```

**Where to add it:** `McpTool.getConfig()` output already accepts `outputSchema?: OutputArgsShape`. Tools just need to populate it and return `structuredContent` alongside `content`.

**Priority tools** (structured output pays off most where output is consumed programmatically):
- `salesforce_get_org_info` — already returns structured JSON stringified as text; trivial to add `structuredContent`
- `run_soql_query` — returns SOQL result as JSON string; schema can mirror `QueryResult<T>` shape
- `list_all_orgs` — same pattern as `salesforce_get_org_info`
- `salesforce_describe_object` — returns field descriptions

**Integration point:** Per-tool `getConfig()` and `exec()`. No changes to `SfMcpServer` or `McpTool` base class.

---

### 4. MCP Resources

**Current state:** `McpResource` and `McpResourceTemplate` classes exist in `mcp-provider-api/src/resources.ts`. `McpProvider.provideResources()` is stubbed. Nothing wires them to the server.

**What needs to be added:**

In `registry-utils.ts`, `createToolRegistryFromProviders()` calls only `provider.provideTools()`. A parallel `createResourceRegistryFromProviders()` (or extending the existing function) must call `provider.provideResources()` and register each result with the server.

**Server registration API (HIGH confidence — SDK docs):**
```typescript
// For McpResource (static URI):
server.resource(name, uri, config, readCallback);

// For McpResourceTemplate (dynamic URI pattern):
server.resource(name, resourceTemplate, config, readCallback);
```

`SfMcpServer` extends `McpServer`, so these methods are available as `this.resource()` inside `SfMcpServer`, or called from outside as `server.resource(...)`.

**Capability flag:** The `index.ts` startup already passes `capabilities: { resources: {} }` — the capability is already declared. No change needed there.

**Where resources should be implemented:**
- `salesforce://orgs` — static resource listing all authorized orgs with permission levels. Lives in `mcp-provider-dx-core` (it has access to `OrgService`)
- `salesforce://permissions` — current org permission map. Lives in `mcp-provider-dx-core`
- `salesforce://connection-status` — connection health. Lives in `mcp-provider-dx-core`

**Registration wiring path:**

```
registry-utils.ts: registerToolsets()
  └─ calls registerResourcesFromProviders() [NEW]
       └─ for each provider: provider.provideResources(services)
            └─ for each McpResource: server.resource(r.getName(), r.getUri(), r.getConfig(), r.read)
            └─ for each McpResourceTemplate: server.resource(r.getName(), r.getTemplate(), r.getConfig(), r.read)
```

`SfMcpServer` does not need to wrap resource reads with middleware (no `targetOrg` injection needed — resources are read-only and org context is baked into the resource URI design). Permission checks for sensitive resource data should be done inside the resource's `read()` implementation.

**Integration points:**
- `registry-utils.ts` — add resource registration loop
- `mcp-provider-dx-core` — implement 2-3 concrete `McpResource` subclasses
- Comment in `McpProvider.provideResources()` and `McpResource` must be updated to remove "NOT CONSUMED YET" note

---

### 5. MCP Prompts

**Current state:** `McpPrompt` class exists in `mcp-provider-api/src/prompts.ts`. `McpProvider.providePrompts()` is stubbed. Nothing wires them to the server.

**Server registration API (HIGH confidence — SDK docs):**
```typescript
server.registerPrompt(name, config, promptCallback);
// config shape: { title?, description?, argsSchema?: ZodObject }
```

`prompts` capability is NOT currently in the capabilities object at `index.ts:181`. Must add `prompts: {}` alongside `resources: {}` and `tools: {}`.

**Registration wiring path:**
```
registry-utils.ts: registerToolsets()
  └─ calls registerPromptsFromProviders() [NEW]
       └─ for each provider: provider.providePrompts(services)
            └─ for each McpPrompt: server.prompt(p.getName(), p.getConfig(), (...args) => p.prompt(...args))
```

**Where prompts should be implemented:**
- `deploy-metadata-workflow` — structured prompt for "deploy changed files to org X" with pre-flight checklist. Lives in `mcp-provider-dx-core`
- `org-setup-checklist` — prompt to guide setting up a scratch org. Lives in `mcp-provider-dx-core`
- `soql-query-builder` — guided SOQL construction. Lives in `mcp-provider-dx-core`

**Integration points:**
- `index.ts` — add `prompts: {}` to capabilities object
- `registry-utils.ts` — add prompt registration loop
- `mcp-provider-dx-core` — implement 2-3 concrete `McpPrompt` subclasses
- Comment in `McpProvider.providePrompts()` must be updated

---

### 6. Protocol-Level Logging

**SDK API (MEDIUM confidence — from SDK docs and GitHub issues):**

`McpServer` exposes `server.sendLoggingMessage()` (where `server` is the inner `Server` instance accessible as `this.server` inside `SfMcpServer`). The `McpServer`-level convenience wrapper may be `this.sendLoggingMessage()` — needs verification. The inner `this.server.sendLoggingMessage({ level, data })` is confirmed available.

**Capability declaration required:** Add `logging: {}` to the capabilities object in `index.ts`:
```typescript
capabilities: {
  resources: {},
  prompts: {},   // add for prompts
  tools: {},
  logging: {},   // add for logging
}
```

**How logging/setLevel works:** When a connected client sends a `logging/setLevel` request, the SDK's `McpServer` handles it automatically — it tracks the minimum level and suppresses `sendLoggingMessage()` calls below that level. The server does not need to implement a `setRequestHandler` for this.

**Integration into SfMcpServer:**

The `Telemetry` class is the internal observability sink. MCP logging is the external protocol-level sink for the client. They serve different purposes and both should coexist.

Two places to wire MCP logging:

1. **In `SfMcpServer.registerTool()` middleware** — emit `notifications/message` for tool call start/end/error at appropriate levels:
   ```typescript
   // Add to SfMcpServer:
   private sendLog(level: LoggingLevel, data: unknown): void {
     try {
       this.server.sendLoggingMessage({ level, data });
     } catch { /* never fail a tool call over logging */ }
   }
   ```

2. **In `Telemetry`'s silent catch blocks** — currently `sendEvent()` and `sendPdpEvent()` have empty catch blocks. The `catch` should emit an MCP `warning` log via `sendLoggingMessage` so clients see telemetry failures without crashing.

**Critical constraint:** `sendLoggingMessage()` must be called only AFTER `server.connect(transport)` — the transport must be established first. In `SfMcpServer`, the `connect()` call happens in `index.ts` after construction. Logging calls inside `registerTool()` callbacks are safe (they run post-connect). Logging calls in the constructor would not be.

**`Logger` (from `@salesforce/core`) already exists** as `this.logger = Logger.childFromRoot('mcp-server')` in `SfMcpServer`. This logger writes to Salesforce's own log infrastructure (not MCP protocol). MCP protocol logging is additive — route significant events to both.

**Integration points:**
- `index.ts` — add `logging: {}` to capabilities
- `SfMcpServer` — add `sendLog()` private method; call it in middleware at tool-start, tool-end, tool-error
- `telemetry.ts` — replace empty catch blocks with `sendLog('warning', ...)` forwarding

---

## Component Responsibilities After v1.2

| Component | Current Responsibility | v1.2 Change |
|-----------|----------------------|-------------|
| `SfMcpServer.registerTool()` | Auth, rate limit, telemetry middleware | Add `sendLog()` calls for tool lifecycle |
| `SfMcpServer` constructor | Build server, declare capabilities | Add `logging: {}` to capabilities |
| `index.ts` | Start server, register toolsets | Add `prompts: {}` to capabilities; call resource/prompt registration |
| `registry-utils.ts` | Register tools from providers | Add `registerResourcesFromProviders()` and `registerPromptsFromProviders()` |
| `McpTool.getConfig()` | Return tool config with annotations | Complete `annotations` in all tools; add `outputSchema` for priority tools |
| `McpTool.exec()` | Execute tool logic; return `CallToolResult` | Return `structuredContent` alongside `content` for priority tools |
| `McpProvider.provideResources()` | Stub returning `[]` | Override in `DxCoreMcpProvider` to return org/permissions resources |
| `McpProvider.providePrompts()` | Stub returning `[]` | Override in `DxCoreMcpProvider` to return workflow prompts |
| `mcp-provider-api/src/errors.ts` | Does not exist | New file: `toolError()` factory for structured error messages |
| `telemetry.ts` | Silent catch blocks | Forward telemetry failures to MCP logging |

---

## New Components (create from scratch)

| File | Package | Purpose |
|------|---------|---------|
| `mcp-provider-api/src/errors.ts` | `mcp-provider-api` | `toolError(message, recovery?)` factory; export from index |
| `mcp-provider-dx-core/src/resources/org_info_resource.ts` | `mcp-provider-dx-core` | `McpResource` for `salesforce://orgs` |
| `mcp-provider-dx-core/src/resources/permissions_resource.ts` | `mcp-provider-dx-core` | `McpResource` for `salesforce://permissions` |
| `mcp-provider-dx-core/src/prompts/deploy_workflow_prompt.ts` | `mcp-provider-dx-core` | `McpPrompt` for deploy workflow |
| `mcp-provider-dx-core/src/prompts/soql_builder_prompt.ts` | `mcp-provider-dx-core` | `McpPrompt` for SOQL query building |

---

## Modified Components (existing files changed)

| File | Change Type | What Changes |
|------|-------------|-------------|
| `packages/mcp/src/index.ts` | Modify | Add `prompts: {}` and `logging: {}` to capabilities; call resource/prompt registration |
| `packages/mcp/src/sf-mcp-server.ts` | Modify | Add `sendLog()` private method; emit logs in `registerTool()` middleware |
| `packages/mcp/src/telemetry.ts` | Modify | Replace empty catch blocks with MCP log forwarding |
| `packages/mcp/src/utils/registry-utils.ts` | Modify | Add resource and prompt registration loops |
| `packages/mcp-provider-api/src/resources.ts` | Modify | Remove "NOT CONSUMED YET" note |
| `packages/mcp-provider-api/src/prompts.ts` | Modify | Remove "NOT CONSUMED YET" note |
| `packages/mcp-provider-api/src/provider.ts` | Modify | Remove "NOT CONSUMED YET" notes |
| `packages/mcp-provider-api/src/index.ts` | Modify | Export `toolError` from new errors.ts |
| `packages/mcp-provider-dx-core/src/index.ts` | Modify | Export new resource and prompt classes from `DxCoreMcpProvider.provideResources()` and `providePrompts()` |
| All provider tool files with `annotations: {}` or missing annotations | Modify | Fill in all four annotation hints |
| Priority tool files (get_org_info, run_soql_query, etc.) | Modify | Add `outputSchema` and `structuredContent` return |

---

## Data Flow Changes

### Resource Read Flow (new)

```
Client: resources/read request for "salesforce://orgs"
  └─ McpServer SDK routes to registered handler
       └─ OrgInfoResource.read(uri, extra)
            └─ services.getOrgService().getAllowedOrgs()
            └─ returns ReadResourceResult { contents: [{ uri, text: JSON }] }
```

No middleware wrapping. Resource handlers are not wrapped by `SfMcpServer.registerTool()`.

### Prompt Get Flow (new)

```
Client: prompts/get request for "deploy-metadata-workflow"
  └─ McpServer SDK routes to registered handler
       └─ DeployWorkflowPrompt.prompt(args, extra)
            └─ returns GetPromptResult { messages: [...] }
```

No middleware wrapping. Prompt handlers receive no org context injection.

### Tool Call Flow (modified for logging)

```
Client: tools/call
  └─ SfMcpServer.registerTool() wrappedCb
       └─ sendLog('debug', `Tool ${name} called`)    [NEW]
       └─ Permission check
       └─ Rate limit check
       └─ McpTool.exec(args)
            └─ return { content, structuredContent }  [structuredContent: NEW]
       └─ sendLog('info'|'error', ...)               [NEW]
       └─ Telemetry emit
       └─ return result
```

### Error Response Flow (modified for recovery guidance)

```
McpTool.exec() catch block
  └─ toolError(err.message, 'Try X to recover')  [NEW factory from mcp-provider-api]
       └─ { isError: true, content: [{ type: 'text', text: 'Error...\n\nRecovery: ...' }] }
```

---

## Suggested Build Order

Dependencies drive this order. The `logging` capability and `sendLog()` method are independent and can be done first. Annotations are also independent. Resources and Prompts both require `registry-utils.ts` changes and should be sequenced after the wiring is in place.

### Phase A — Annotations + Error Recovery (no infrastructure changes)

**Rationale:** Pure leaf changes. No new files, no wiring. Can be done with zero risk of breaking existing behavior. Unblocks everything else by getting the "simple" work out first.

1. Fill in all empty/missing `annotations` in all provider packages (10 devops tools, 3 dx-core tools)
2. Add `idempotentHint` and complete `destructiveHint` where missing across all providers
3. Add `mcp-provider-api/src/errors.ts` with `toolError()` factory; export from `index.ts`
4. Update priority tools to use `toolError()` with recovery hints in catch blocks

**No changes to:** `SfMcpServer`, `registry-utils.ts`, `index.ts`, `McpTool` base class

---

### Phase B — Structured Output (tool-local, no wiring changes)

**Rationale:** `outputSchema` and `structuredContent` live entirely within each tool. The infrastructure (`calculateResponseCharCount` in `SfMcpServer`) already handles `structuredContent`. Safe to do independently of Resources/Prompts/Logging.

1. Add `outputSchema` to `getConfig()` in priority tools (get_org_info, run_soql_query, list_all_orgs)
2. Return `structuredContent` alongside existing `content` in `exec()` for those tools
3. Verify `calculateResponseCharCount` handles structured output correctly (already does — see sf-mcp-server.ts lines 296–312)

**No changes to:** `SfMcpServer.registerTool()` middleware, `McpTool` base class, `registry-utils.ts`

---

### Phase C — Protocol-Level Logging

**Rationale:** Infrastructure change to `SfMcpServer` and `index.ts`. Must be done before Resources/Prompts to ensure logging works during those operations, but can be done before or after Phase A/B.

1. Add `logging: {}` to capabilities in `index.ts`
2. Add `sendLog()` private method to `SfMcpServer`
3. Add log calls in `registerTool()` wrappedCb for tool lifecycle events
4. Replace empty catch blocks in `telemetry.ts` with `sendLog('warning', ...)` forwarding

**Dependency:** Phases A and B are independent; Phase C is independent of both

---

### Phase D — MCP Resources

**Rationale:** Requires both new resource implementations AND wiring in `registry-utils.ts`. Wire last so implementation is in place before the wiring test.

1. Implement `OrgInfoResource` and `PermissionsResource` in `mcp-provider-dx-core/src/resources/`
2. Override `DxCoreMcpProvider.provideResources()` to return them
3. Add `registerResourcesFromProviders()` to `registry-utils.ts`
4. Call it from `registerToolsets()` in `index.ts` flow
5. Remove "NOT CONSUMED YET" comments from `mcp-provider-api`

**Dependency:** Phase C (logging) should be complete so resource registration is logged

---

### Phase E — MCP Prompts

**Rationale:** Same pattern as Resources. Requires both prompt implementations AND wiring. Add `prompts: {}` to capabilities first.

1. Add `prompts: {}` to capabilities in `index.ts`
2. Implement `DeployWorkflowPrompt` and `SoqlBuilderPrompt` in `mcp-provider-dx-core/src/prompts/`
3. Override `DxCoreMcpProvider.providePrompts()` to return them
4. Add `registerPromptsFromProviders()` to `registry-utils.ts`
5. Call it from `registerToolsets()` in `index.ts` flow
6. Remove "NOT CONSUMED YET" comments from `mcp-provider-api`

**Dependency:** Phase D (resources wiring is the same pattern; learn from it)

---

### Dependency Graph

```
Phase A (Annotations + Error Recovery)  ←─ no dependencies
Phase B (Structured Output)              ←─ no dependencies
Phase C (Logging)                        ←─ no dependencies
Phase D (Resources)                      ←─ Phase C (recommended)
Phase E (Prompts)                        ←─ Phase D (same wiring pattern)
```

A, B, C are fully parallelizable. D depends on nothing strictly (the SDK will work without logging), but logging makes resource registration observable. E depends on D's wiring pattern being established.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Wrapping Resources/Prompts with Tool Middleware

**What goes wrong:** Applying `targetOrg` injection and permission middleware (from `registerTool()`) to resource or prompt registration.

**Why it's wrong:** Resources and prompts use different SDK registration methods and different handler signatures. The tool middleware is designed for `CallToolResult` callbacks. Org context for resources should be encoded in the resource URI design (e.g., `salesforce://orgs` reads from the startup-resolved allowlist, not from a per-request `targetOrg`).

**Do this instead:** Register resources and prompts directly via `server.resource()` / `server.registerPrompt()` without wrapping in middleware. Put any access control logic inside the resource/prompt handler itself.

---

### Anti-Pattern 2: Logging Before connect()

**What goes wrong:** Calling `this.server.sendLoggingMessage()` in `SfMcpServer`'s constructor or in any code path that runs before `server.connect(transport)`.

**Why it's wrong:** The transport is not established; the notification goes nowhere or throws. The `SfMcpServer` constructor runs before `connect()` is called in `index.ts`.

**Do this instead:** Only call `sendLog()` inside `registerTool()` callbacks (which execute post-connect), or in `oninitialized` handler. Guard with a `connected` flag if needed.

---

### Anti-Pattern 3: Declaring outputSchema Without Returning structuredContent

**What goes wrong:** Adding `outputSchema` to a tool's config but not returning `structuredContent` in `exec()`. The SDK validates `structuredContent` against `outputSchema` and will throw a validation error because `undefined` does not match the declared schema.

**Why it's wrong:** `outputSchema` in the config is a contract — the SDK enforces it.

**Do this instead:** Always pair `outputSchema` with a corresponding `structuredContent` return. Use type aliases (not interfaces) for the structured output type for TypeScript assignability.

---

### Anti-Pattern 4: Implementing Prompts as Tools

**What goes wrong:** Creating an MCP tool named `build_soql_query_prompt` that returns a text message template, instead of using the MCP Prompts primitive.

**Why it's wrong:** Prompts in MCP are a distinct primitive intended for user-facing interaction templates (client UIs show them differently; some clients have dedicated prompt UIs). Tools are for LLM-callable operations.

**Do this instead:** Use `McpPrompt` with `server.registerPrompt()` for reusable interaction templates. Use tools for actions that query or mutate Salesforce state.

---

## Confidence Assessment

| Feature | Confidence | Basis |
|---------|------------|-------|
| Annotations — where and what | HIGH | Direct code inspection of all provider packages |
| structuredContent / outputSchema | MEDIUM | SDK docs (WebFetch); `calculateResponseCharCount` already handles it in code |
| Resource registration API | HIGH | SDK docs + McpResource class already matches SDK signature |
| Prompt registration API | HIGH | SDK docs + McpPrompt class already matches SDK signature |
| registry-utils.ts wiring gap | HIGH | Direct code inspection — `provideResources()`/`providePrompts()` never called |
| MCP logging / sendLoggingMessage | MEDIUM | GitHub issue #175 confirms `this.server.sendLoggingMessage()`; McpServer-level method existence needs verification |
| capabilities: prompts absent | HIGH | Direct inspection of `index.ts:181` — only `resources` and `tools` declared |
| capabilities: logging absent | HIGH | Direct inspection of `index.ts:181` |

---

## Sources

- Direct inspection: `packages/mcp/src/sf-mcp-server.ts` (lines 1–315)
- Direct inspection: `packages/mcp/src/index.ts` (lines 177–193, capabilities object)
- Direct inspection: `packages/mcp/src/utils/registry-utils.ts` (full file — no resource/prompt registration)
- Direct inspection: `packages/mcp-provider-api/src/resources.ts`, `prompts.ts`, `provider.ts` (NOT CONSUMED YET comments)
- Direct inspection: `packages/mcp-provider-dx-core/src/tools/*.ts` (14 tools; annotation completeness audit)
- Direct inspection: `packages/mcp-provider-devops/src/tools/` (12 tools; 10 missing annotations)
- MCP TypeScript SDK docs (WebFetch): https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md
- MCP SDK issue #175 (sendLoggingMessage on McpServer): https://github.com/modelcontextprotocol/typescript-sdk/issues/175

---

*Architecture research for: Salesforce MCP Server — v1.2 MCP Best Practices Alignment*
*Researched: 2026-04-11*
