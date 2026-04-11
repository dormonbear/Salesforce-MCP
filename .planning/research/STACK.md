# Technology Stack

**Project:** Salesforce MCP Server — v1.2 MCP Best Practices Alignment
**Researched:** 2026-04-11
**Confidence:** HIGH (verified against installed SDK 1.18.2 node_modules and 1.29.0 extracted type definitions)

---

## Verdict: No New Dependencies Required

All five features (Tool Annotations, structuredContent, MCP Resources, MCP Prompts, logging/setLevel) are fully supported by SDK 1.18.2, which `^1.18.0` already resolves to. Zero new npm packages are needed for this milestone.

---

## SDK Version

| Package | Current Constraint | Installed | Latest Stable | Action |
|---------|-------------------|-----------|---------------|--------|
| `@modelcontextprotocol/sdk` | `^1.18.0` | 1.18.2 | 1.29.0 | No change needed |

**Why not upgrade to 1.29.0:** None of the five target features require APIs introduced after 1.18.2. The 1.25+ Zod v4 compat layer (`zod-compat`) is not relevant since the project uses Zod v3. The 1.29.0 `registerTool()` signature change (`ZodRawShape` → `ZodRawShapeCompat`) would require TypeScript updates in `mcp-provider-api` with no functional benefit. PROJECT.md explicitly defers SDK v2.0 (still alpha).

---

## Feature-by-Feature API Availability (SDK 1.18.2)

### 1. Tool Annotations — Complete Remaining Tools

**API:** `ToolAnnotations` type, imported from `@modelcontextprotocol/sdk/types.js`

**All four fields exist in 1.18.2:**

| Field | Type | Meaning |
|-------|------|---------|
| `readOnlyHint` | `boolean?` | Tool does not modify environment state |
| `destructiveHint` | `boolean?` | Tool may perform destructive/irreversible changes (only meaningful when `readOnlyHint == false`) |
| `idempotentHint` | `boolean?` | Repeated calls with same args have no additional effect (only meaningful when `readOnlyHint == false`) |
| `openWorldHint` | `boolean?` | Tool may interact with entities beyond those listed in inputs |

**Current state:** `ToolAnnotations` is already in `McpToolConfig.annotations` in `mcp-provider-api/src/tools.ts` (line 55). `SfMcpServer.registerTool()` passes annotations through unchanged. Three tools have empty annotation objects; multiple tools are missing `destructiveHint`/`idempotentHint`. This is a pure fill-in task — no framework changes needed.

**Integration point:** `mcp-provider-api/src/tools.ts` `McpToolConfig.annotations` field — no changes required.

---

### 2. structuredContent (Structured Tool Output)

**API:**
- `outputSchema?: OutputArgsShape` field in `registerTool()` config
- `structuredContent` field in `CallToolResult` return value

**How the SDK processes it (verified in `server/mcp.js` line 118–122):**
1. If tool declares `outputSchema`, the SDK expects `result.structuredContent` in the response
2. If `structuredContent` is missing, SDK logs a warning
3. SDK validates `structuredContent` against `outputSchema` via `safeParseAsync`

**MCP backward-compat rule:** Tools returning `structuredContent` MUST also include the serialized JSON as a `text` content item so older clients still receive data. This is a per-tool implementation decision, not enforced by the SDK.

**Current state:** `McpToolConfig<InputArgsShape, OutputArgsShape>` already includes `outputSchema?: OutputArgsShape` (line 53 of `tools.ts`). `SfMcpServer.registerTool()` passes `outputSchema` through to `McpServer.prototype.registerTool`. `calculateResponseCharCount()` in `SfMcpServer` already handles `structuredContent` for telemetry (lines 304–313). The `CallToolResult` type in SDK 1.18.2 includes `structuredContent` as an optional typed field.

**Type note:** Use `type` aliases (not `interface`) for structured output shapes to avoid index signature type errors when assigning to `{ [key: string]: unknown }`.

**Integration point:** Per-tool change only. Framework layer requires no changes.

---

### 3. MCP Resources

**API:** `registerResource()` on `McpServer`, from `@modelcontextprotocol/sdk/server/mcp.js`

**Two variants:**
```typescript
// Static resource at a fixed URI
registerResource(
  name: string,
  uri: string,
  config: ResourceMetadata,
  readCallback: (uri: URL, extra) => ReadResourceResult | Promise<ReadResourceResult>
): RegisteredResource

// Template resource matching a URI pattern
registerResource(
  name: string,
  template: ResourceTemplate,
  config: ResourceMetadata,
  readCallback: (uri: URL, variables: Variables, extra) => ReadResourceResult | Promise<ReadResourceResult>
): RegisteredResourceTemplate
```

**`ResourceMetadata`** = `Omit<Resource, 'uri' | 'name'>` — includes `title`, `description`, `mimeType`, `annotations`.

**`ResourceTemplate`** is a class from `@modelcontextprotocol/sdk/server/mcp.js` accepting a URI template string (e.g., `"salesforce://org/{orgAlias}/info"`) and a `list` callback.

**Capability auto-registration:** `McpServer` automatically calls `server.registerCapabilities({ resources: { listChanged: true } })` when the first resource handler is initialized. The `capabilities: { resources: {} }` in `index.ts` line 182 is therefore redundant but harmless.

**Current state:**
- `McpResource` and `McpResourceTemplate` abstract classes exist in `mcp-provider-api/src/resources.ts` with correct method signatures matching the SDK
- `McpProvider.provideResources()` exists but is never called by the server
- `registry-utils.ts` only calls `provider.provideTools()` — resources are skipped
- `SfMcpServer` does not expose `registerResource()` — this is correct because resources bypass permission/rate-limit middleware (they are read-only)

**Required framework change:** Add a resource registration loop in `registerToolsets()` (or a new `registerResourcesAndPrompts()` function) in `packages/mcp/src/utils/registry-utils.ts`:
1. Call `provider.provideResources(services)` for each provider
2. For each returned `McpResource`, call `server.server.registerResource(...)` (via the underlying `Server` instance, not `SfMcpServer` which doesn't wrap resources) — or expose `registerResource()` on `SfMcpServer`
3. For each returned `McpResourceTemplate`, call the template variant

**Note:** Resources are read-only by MCP spec. Do not route them through the org permission middleware.

---

### 4. MCP Prompts

**API:** `registerPrompt()` on `McpServer`, from `@modelcontextprotocol/sdk/server/mcp.js`

**Signature:**
```typescript
registerPrompt<Args extends PromptArgsRawShape>(
  name: string,
  config: { title?: string; description?: string; argsSchema?: Args },
  cb: (args: z.objectOutputType<Args>, extra) => GetPromptResult | Promise<GetPromptResult>
): RegisteredPrompt
```

**`PromptArgsRawShape`** (verified in SDK types): `Record<string, ZodType<string, ZodTypeDef, string> | ZodOptional<...>>` — prompt args must be string-typed only (MCP protocol constraint, not SDK constraint). This matches `mcp-provider-api/src/prompts.ts` line 33–35 exactly.

**Capability auto-registration:** `McpServer` automatically calls `server.registerCapabilities({ prompts: { listChanged: true } })` when the first prompt handler is set up.

**Completion helper:** `completable()` from `@modelcontextprotocol/sdk/server/completable.js` is available in 1.18.2. Wraps a Zod string field with an autocomplete callback. Useful for org alias selectors or SObject name fields in Salesforce prompts.

**Current state:**
- `McpPrompt` abstract class exists in `mcp-provider-api/src/prompts.ts` with correct signatures
- `McpProvider.providePrompts()` exists but is never called by the server
- `registry-utils.ts` does not call `providePrompts()`

**Required framework change:** Same as resources — add prompt registration loop to `registry-utils.ts`.

**Do not route prompts through permission middleware.** Prompts are user-invoked templates (the host decides when to call them), not LLM-invoked operations. Rate limiting and org permission checks don't apply.

---

### 5. Protocol-level Logging (logging/setLevel)

**API:** `McpServer.sendLoggingMessage()` (delegates to `Server.sendLoggingMessage()`)

**Parameters:**
```typescript
sendLoggingMessage(
  params: { level: LoggingLevel; logger?: string; data: unknown },
  sessionId?: string
): Promise<void>
```

**`LoggingLevel`** values (verified in `types.d.ts` line 26990): `"debug" | "info" | "notice" | "warning" | "error" | "critical" | "alert" | "emergency"`

**How the SDK handles setLevel (verified in `server/index.js` lines 52–59, 137–139, 233–234):**
1. Client sends `logging/setLevel` request with a `level`
2. `Server` handles it in `SetLevelRequestSchema` handler — stores per-session level in `_loggingLevels` Map
3. `Server.sendLoggingMessage()` calls `isMessageIgnored()` which compares message level against stored level by severity order — messages below the threshold are silently dropped
4. No custom `setLevel` handler needed in application code

**Capability requirement:** `logging: {}` MUST be declared in `ServerCapabilities`. The `McpServer` does NOT auto-register this capability (unlike tools, resources, and prompts). Without it, `sendLoggingMessage()` silently no-ops and `logging/setLevel` requests throw `"Server does not support logging"`.

**Current state:** `index.ts` line 181–183 declares `capabilities: { resources: {} }` but not `logging: {}`. This is the blocker.

**Required changes:**
1. Add `logging: {}` to `ServerCapabilities` object in `index.ts`
2. Bridge `@salesforce/core Logger` to MCP logging: hook into Logger's write lifecycle to emit `sendLoggingMessage` calls at the appropriate level
3. Surface telemetry errors (currently swallowed in empty `catch {}` blocks in `telemetry.ts` lines 137, 145, 155) via `sendLoggingMessage` at `warning` level — this is the "telemetry error visibility" goal

**`@salesforce/core` Logger mapping:**

| `@salesforce/core` Logger level | MCP `LoggingLevel` |
|--------------------------------|--------------------|
| `debug` (10) | `"debug"` |
| `info` (20) | `"info"` |
| `warn` (40) | `"warning"` |
| `error` (50) | `"error"` |

---

## Changes Required — Summary

| Feature | New Packages | Framework Changes | Per-Tool/Resource/Prompt Work |
|---------|-------------|-------------------|-------------------------------|
| Tool Annotations | None | None | Fill annotations on 49 tools |
| structuredContent | None | None | Add `outputSchema` + return `structuredContent` in core tools |
| MCP Resources | None | Add resource registration loop in `registry-utils.ts`; expose `registerResource` on `SfMcpServer` or call via `server.server` | Implement `McpResource` subclasses for org info, permissions, connection status |
| MCP Prompts | None | Add prompt registration loop in `registry-utils.ts` | Implement `McpPrompt` subclasses for common Salesforce operations |
| logging/setLevel | None | Add `logging: {}` capability in `index.ts`; bridge `@salesforce/core` Logger | None |

---

## Error Recovery Guidance — Not a Library, a Pattern

The "error messages with recovery guidance for LLM self-repair" feature requires no new dependencies. It is a writing convention applied during tool error handling:

```typescript
// Instead of bare error text:
return { isError: true, content: [{ type: 'text', text: 'Deploy failed' }] }

// Include recovery steps:
return {
  isError: true,
  content: [{
    type: 'text',
    text: [
      'Deploy failed: Component MyClass has compile error on line 5.',
      '',
      'Recovery options:',
      '1. Fix the Apex syntax error in MyClass.cls and retry deploy_metadata',
      '2. Use retrieve_metadata to get the current server-side version',
      '3. Run run_apex_test to check for related test failures',
    ].join('\n')
  }]
}
```

Applied to existing error paths in each tool — no framework changes.

---

## Do NOT Add

| Package | Reason to Exclude |
|---------|-------------------|
| `ajv` / `json-schema-typed` | SDK bundles its own JSON Schema validation for `outputSchema`; do not duplicate |
| `zod-to-json-schema` | SDK bundles this internally (used for `inputSchema`/`outputSchema` → JSON Schema conversion) |
| `express` / `hono` / SSE/StreamableHTTP transport | stdio only; out of scope per PROJECT.md |
| `@modelcontextprotocol/sdk` v2.0.x alpha | Explicitly out of scope per PROJECT.md |
| `winston` / `pino` | MCP logging uses the protocol's `sendLoggingMessage`; bridge through existing `@salesforce/core` Logger instead |
| Any Zod v4 package | Project uses Zod v3; Zod v4 compat only relevant if upgrading SDK to 1.25+ |

---

## Sources

- SDK 1.18.2 type definitions and source: verified in `/packages/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/`
- SDK 1.29.0 type definitions: inspected via `npm pack @modelcontextprotocol/sdk@1.29.0` and tar extraction to `/tmp/sdk129/`
- `@modelcontextprotocol/sdk` latest dist-tag `1.29.0` verified via `npm show @modelcontextprotocol/sdk dist-tags`
- MCP Tools spec (structuredContent): https://modelcontextprotocol.io/specification/2025-11-25/server/tools
- TypeScript SDK server docs: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md
- Provider API source: `packages/mcp-provider-api/src/` (tools.ts, resources.ts, prompts.ts, provider.ts)
- Server startup: `packages/mcp/src/index.ts` lines 177–193 (capabilities declaration)
- SfMcpServer: `packages/mcp/src/sf-mcp-server.ts` (registerTool wrapper, calculateResponseCharCount)
- Registry utils: `packages/mcp/src/utils/registry-utils.ts` (registerToolsets — no resource/prompt loop)
