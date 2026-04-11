# Feature Landscape: MCP Best Practices Alignment (v1.2)

**Domain:** MCP Server — protocol compliance and observability improvements
**Researched:** 2026-04-11
**Confidence:** HIGH (spec verified against modelcontextprotocol.io 2025-06-18 spec + TypeScript SDK source)

---

## What This Milestone Adds

This milestone does not add Salesforce features. It adds MCP protocol compliance features to the server layer: better metadata on tools, better error communication to LLMs, structured return values, new primitives (Resources and Prompts), and protocol-level logging.

All six target features operate on the MCP boundary layer (`packages/mcp` and `packages/mcp-provider-api`). Individual tool packages are touched for annotations and error messages but follow uniform patterns.

---

## How Each Feature Works (Protocol-Level Facts)

### Feature 1: Tool Annotations

**Spec:** Four boolean hints on every tool's `annotations` field (2025-03-26 spec, current).

| Hint | Default | Meaning | Primary client use |
|------|---------|---------|-------------------|
| `readOnlyHint` | `false` | Tool does not modify environment | Skip confirmation dialog; safe for autonomous agents |
| `destructiveHint` | `true` | Modification is irreversible (only applies when readOnlyHint=false) | Trigger confirmation warning |
| `idempotentHint` | `false` | Calling twice with same args has no extra effect | Safe to retry automatically on transient failure |
| `openWorldHint` | `true` | Tool reaches external services (network, org APIs) | Used by policy engines to classify tool reach |

**Current state in this codebase:** The `annotations` field is present in `McpTool.getConfig()` return type but partial. 14 of ~20 dx-core files have at least one annotation. Specific gaps found by inspection:
- `create_org_snapshot.ts` — `annotations: {}` (empty, all defaults apply)
- `run_apex_test.ts` — has `openWorldHint: true` but missing `readOnlyHint`/`destructiveHint`/`idempotentHint`
- `run_agent_test.ts` — same gap as run_apex_test
- `delete_org.ts` — no `readOnlyHint: false` / `destructiveHint: true` explicitly set
- `assign_permission_set.ts` — has `openWorldHint: true` but missing the other three
- `resume_tool_operation.ts` — partial
- `create_scratch_org.ts` — partial
- 6+ tools in non-dx-core packages (devops, scale-products, metadata-enrichment) need audit

**Correct patterns to apply:**
```
Read-only query tools (run_soql_query, list_all_orgs, get_org_info, get_username):
  readOnlyHint: true, openWorldHint: true

Additive/non-destructive write tools (create_scratch_org, assign_permission_set, deploy_metadata):
  readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true

Destructive/irreversible tools (delete_org):
  readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true

Idempotent write tools (retrieve_metadata — overwriting local files):
  readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true
```

**Implementation cost:** LOW per tool. No API changes. Pure metadata. Pattern is mechanical once the classification matrix is agreed upon.

**Client behavior change:** Claude Code and ChatGPT Dev Mode suppress confirmation dialogs for `readOnlyHint: true` tools. Without it, Claude Code shows write-tool warnings on every SOQL query — confirmed as the problem this fixes (DEV Community issue: "My MCP Tools Were Showing as Write Tools in ChatGPT Dev Mode").

---

### Feature 2: Error Messages with Recovery Guidance

**Problem:** Current pattern is `return textResponse(`Failed to X: ${err.message}`, true)`. When the LLM receives "Failed to deploy metadata: DUPLICATE_DEVELOPER_NAME", it has no recovery path — it cannot determine whether to retry, what to change, or which other tool to call.

**Correct pattern (from MCP spec + production evidence):** Return `isError: true` in a `CallToolResult`, but populate the text content with structured recovery guidance. The message should answer: (1) what failed, (2) why it likely failed, (3) what the LLM should do next.

Three error categories with patterns:

**Category A — Tool ordering / prerequisite failure:**
```
Bad:  "Failed to terminate instance: error code 412"
Good: "Cannot delete org while deployment is in progress.
       1. Call resume_tool_operation with the pending job ID to check status.
       2. Wait for the deployment to complete or cancel it.
       3. Then retry delete_org."
```

**Category B — Input validation failure:**
```
Bad:  "Invalid parameter: apexTestLevel"
Good: "Cannot specify both 'apexTests' and 'apexTestLevel' parameters.
       Use 'apexTests' to list specific test class names, OR use 'apexTestLevel' to
       specify a level (RunLocalTests, RunAllTestsInOrg). Remove one of the two."
```

**Category C — Unknown/transient failure:**
```
Bad:  "Failed to run SOQL query: ECONNRESET"
Good: "Salesforce org connection was reset (ECONNRESET). This is usually transient.
       Retry the same query. If this is the third attempt, check org connectivity
       using get_org_info before retrying."
```

**Current codebase state:** Several tools already have good inline validation messages (deploy_metadata has detailed parameter conflict messages). The gap is in catch blocks where raw `err.message` is passed through. Count: approximately 30 catch blocks across all packages return bare error messages.

**Implementation cost:** MEDIUM. Requires reading each tool's error surface and writing domain-appropriate messages. Cannot be automated. Best done tool-by-tool, starting with the 10 highest-frequency tools.

**SDK compatibility note:** The `isError: true` + no `outputSchema` combination always works. If a tool has an `outputSchema`, a bug in SDK <1.8 (issue #654) prevented `isError: true` responses from bypassing schema validation. This was fixed in SDK PR #655 (merged June 24, 2025). Since this project targets `^1.18.0`, the fix is present.

---

### Feature 3: Structured Output (structuredContent)

**Spec:** Tools may return a `structuredContent` JSON object alongside the `content` text array. If an `outputSchema` (Zod shape) is declared on the tool, the SDK validates `structuredContent` against it. For backward compatibility, the serialized JSON must also appear as a text block.

**SDK pattern (`^1.18.0`):**
```typescript
server.registerTool(
  'run_soql_query',
  {
    inputSchema: z.object({ query: z.string(), ... }),
    outputSchema: z.object({
      records: z.array(z.record(z.unknown())),
      totalSize: z.number(),
      done: z.boolean(),
    }),
  },
  async (args) => {
    const result = await executeQuery(args);
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }], // backward compat
      structuredContent: result, // machine-parseable
    };
  }
);
```

**Current state:** `calculateResponseCharCount()` in `sf-mcp-server.ts` already handles `structuredContent` in its character counting (line 304), showing the architecture anticipates it. But no tool actually returns it yet.

**Which tools benefit most from structuredContent:**
- `run_soql_query` — returns arrays of records; structured output lets agents iterate records directly
- `list_all_orgs` — returns org list; structured lets agents pick specific orgs without text parsing
- `get_org_info` — returns a single org object; structured makes field access deterministic
- `run_apex_test` — returns pass/fail/count; structured allows downstream conditional logic

**Which tools should NOT get outputSchema yet:**
- Long-text tools (deploy_metadata result blobs) — schema would be overly complex
- Error-prone tools still using raw err.message — fix error messages first, then add schema

**Implementation cost:** MEDIUM per tool. Requires defining the output shape, ensuring consistency between `content` and `structuredContent`, and writing tests that validate both. The `outputSchema` validation in the SDK is strict — any mismatch throws at runtime.

**Important sequencing:** Add `outputSchema` only to tools that have clean, predictable return structures. Do not add it to tools that return free-form text or where the error path hasn't been cleaned up yet (the isError + outputSchema interaction requires care).

---

### Feature 4: MCP Resources

**Spec:** Resources are application-controlled read-only data sources addressable by URI. They are distinct from tools: the host application (or user) pulls them into context; the LLM does not call them autonomously.

**Protocol mechanics:**
- Server declares `capabilities: { resources: {} }` (already done in `index.ts` line 182)
- Client calls `resources/list` → gets URI + name + mimeType list
- Client calls `resources/read` with a URI → gets text or binary content
- Optional: `subscribe: true` for change notifications (not needed here)

**Current state:** `McpResource` and `McpResourceTemplate` abstract classes exist in `mcp-provider-api/src/resources.ts` with TODO comments noting the main server does not yet consume them. The server already declares `resources: {}` capability. The wiring is missing: no provider registers resources, and `index.ts` does not call any resource-registration path.

**What resources make sense for this Salesforce MCP server:**

| Resource URI | Content | Use case |
|---|---|---|
| `salesforce://orgs` | JSON list of authorized orgs with status | Context for "which orgs can I use?" before tool calls |
| `salesforce://orgs/{alias}/info` | Org metadata (instance URL, org type, edition) | Context before deciding which tools to run |
| `salesforce://orgs/{alias}/permissions` | Permission level (read-only, read-write, protected) | Context for "what can I do on this org?" |
| `salesforce://server/capabilities` | Which toolsets are enabled, server version | Orientation resource for new sessions |

**The `resources: {}` capability is already declared.** The gap is: (1) no `McpResource` implementations exist yet, (2) the main server does not call `server.registerResource()` anywhere, (3) the registry utility (`registerToolsets`) does not have a parallel `registerResources` path.

**Client support reality (2026):** Most clients implement `resources/list` and `resources/read`. Subscriptions are rarely implemented on the client side. Static resources (no template) are universally supported. URI templates have partial client support. Start with static resources only.

**Implementation cost:** MEDIUM. The abstract class infrastructure exists. Need to: (1) create 3-4 concrete `McpResource` implementations, (2) add a `getResources()` method to `McpProvider`, (3) wire registration in `registry-utils.ts`, (4) call `server.registerResource()` for each. The data for these resources is already available (resolved orgs, permissions map, toolset flags) from the startup flow in `index.ts`.

---

### Feature 5: MCP Prompts

**Spec:** Prompts are user-controlled templates that return a `messages` array for direct injection into LLM context. The user explicitly invokes them (e.g., slash commands `/deploy`, `/run-tests`). They encode multi-step workflow sequences that would otherwise require the LLM to improvise.

**Protocol mechanics:**
- Server declares `capabilities: { prompts: {} }`
- Client calls `prompts/list` → gets name + description + arguments
- Client calls `prompts/get` with arguments → gets `messages[]` with role/content pairs
- Messages can include embedded Resources as context

**Current state:** `McpPrompt` abstract class exists in `mcp-provider-api/src/prompts.ts` with TODO. No concrete implementations exist. The server does not declare `prompts` capability. No wiring in `index.ts`.

**What prompts make sense for this server:**

| Prompt | Arguments | Value |
|---|---|---|
| `deploy-to-org` | targetOrg, sourceDir?, runTests? | Pre-flight check → deploy → report results workflow |
| `run-tests` | targetOrg, testClasses? | Run Apex tests, wait for results, summarize failures |
| `org-health-check` | targetOrg | Query org info, list recent deployments, surface issues |
| `query-records` | targetOrg, objectName, fields? | Guided SOQL construction and execution |
| `scratch-org-setup` | devHub, definitionFile | Create scratch org → assign permissions → deploy metadata |

**The value of prompts here:** The official Salesforce DX MCP server (salesforcecli/mcp) ships 5 prompts and users explicitly reference them as a major usability improvement. The prompt encodes "what tools to call in what order" — preventing the LLM from guessing the workflow and calling tools in the wrong sequence.

**Complexity note:** Unlike resources, prompts require domain knowledge to write well. A `deploy-to-org` prompt must encode the correct pre-flight checks (what validations matter, in what order), handle the async nature of deployments (poll vs. check-status), and surface failures in LLM-actionable format. Writing the prompt _content_ is the hard part, not the protocol wiring.

**Implementation cost:** MEDIUM for wiring (same pattern as resources). HIGH for content quality (domain-specific workflow knowledge needed per prompt). Recommend starting with 2 prompts (deploy + run-tests) that cover the most common workflows, then expanding.

---

### Feature 6: Protocol-Level Logging (logging/setLevel)

**Spec (RFC 5424 syslog levels):** debug, info, notice, warning, error, critical, alert, emergency. Client sends `logging/setLevel` request; server responds empty; server sends `notifications/message` at or above the set level.

**SDK mechanics:**
```typescript
// Server must be 'Server' class (not McpServer) OR McpServer with logging capability
const server = new McpServer(
  { name: 'sf-mcp-server', version: '...' },
  {
    capabilities: {
      resources: {},
      tools: {},
      logging: {},     // ← must declare
    }
  }
);

// Anywhere after connect():
await server.server.sendLoggingMessage({
  level: 'info',
  logger: 'tool-executor',
  data: { tool: name, org: targetOrg, runtimeMs }
});
```

**Critical nuance — McpServer vs Server:** `sendLoggingMessage` exists on the low-level `Server` class (`@modelcontextprotocol/sdk/server/index.js`), not on `McpServer` directly. Access it via `server.server` (the wrapped instance). This was a documented SDK confusion point (issue #175, now resolved). The capability MUST be declared or the call throws "Server does not support logging".

**Current state:** `SfMcpServer` extends `McpServer` and uses `Logger.childFromRoot('mcp-server')` from `@salesforce/core` for debug logging. This writes to the `@salesforce/core` log file (if configured) but is invisible to MCP clients. The `capabilities` declaration in `index.ts` currently has `resources: {}` and `tools: {}` but no `logging: {}`.

**What to log at each level:**
- `debug`: Tool called, args (sanitized), org target
- `info`: Tool completed, runtime, success/failure summary
- `warning`: Rate limit approaching, deprecated parameter used, permission downgrade
- `error`: Tool execution error with recovery context (mirrors the error message sent back)

**Telemetry gap (silent catch blocks):** `telemetry.ts` has try/catch blocks around AppInsights calls that swallow errors silently. With MCP logging, telemetry errors can be surfaced as `warning`-level log messages without crashing the tool. The fix is: replace empty catch with `server.server.sendLoggingMessage({ level: 'warning', ... })`.

**Implementation cost:** LOW for wiring (add `logging: {}` to capabilities, replace `this.logger.debug` with `sendLoggingMessage` calls in `sf-mcp-server.ts`). MEDIUM for the telemetry visibility fix (requires understanding which AppInsights failures are expected vs. unexpected).

---

## Table Stakes (Must Ship in v1.2)

| Feature | Why Required | Complexity | Phase Candidate |
|---------|--------------|------------|-----------------|
| Complete tool annotations on all 49+ tools | Missing `readOnlyHint` causes write-tool warnings on read-only tools in Claude Code; without this, Claude Code will prompt for confirmation on every SOQL query | LOW per tool, MEDIUM total (audit + classify all tools) | Phase 1 |
| Error messages with recovery guidance | Current bare `err.message` strings are conversation-killers; LLM cannot self-repair without next-step hints | MEDIUM (requires per-tool domain knowledge) | Phase 2 |
| Protocol-level logging (`logging/setLevel`) | `--debug` flag is inert for most MCP clients; operators have no observability; telemetry errors are silently swallowed | LOW wiring + MEDIUM telemetry fix | Phase 2 |
| MCP Resources (org info, permissions) | `resources: {}` capability is already declared but no resources exist — clients see an empty list, making the capability declaration misleading | MEDIUM (infrastructure + 3-4 implementations) | Phase 3 |
| MCP Prompts (2 core workflows) | Protocol wiring is missing; `McpPrompt` class exists but nothing is registered | MEDIUM wiring + HIGH content per prompt | Phase 3 |
| structuredContent for core query tools | `calculateResponseCharCount` in sf-mcp-server.ts already handles structuredContent; tools just need to start returning it | MEDIUM per tool | Phase 4 |

---

## Differentiators (Set This Server Apart)

| Feature | Value Proposition | Complexity |
|---------|-------------------|------------|
| Recovery-aware error messages with tool-ordering hints | When deploy fails, tell the LLM exactly which tool to call next and with what args — very few MCP servers do this well | MEDIUM |
| Resource annotations with `audience` and `priority` | Telling the host which resources are `["assistant"]` priority lets Claude Code auto-inject them vs. requiring explicit user selection | LOW (add metadata to resource definitions) |
| Prompt-embedded resource links | Prompts that reference `salesforce://orgs/{alias}/info` as embedded resources so LLMs get org context automatically when invoking a prompt | LOW (within each prompt's message content) |
| `outputSchema` on structured tools | Enables strict client-side validation and typed downstream processing; only ~5% of MCP servers in the wild do this | MEDIUM per tool |

---

## Anti-Features (Do Not Build)

| Anti-Feature | Why Avoid | What to Do Instead |
|---|---|---|
| Resources with `subscribe: true` | Org state changes are not real-time; subscriptions would require polling @salesforce/core on a timer; adds complexity for zero client benefit in stdio | Static resources only; return fresh data on each `resources/read` call |
| Prompt-as-tool (registering prompts as tools so LLM auto-invokes them) | Destroys the user-controlled nature of prompts; loses the "human explicitly selects" guarantee | Keep prompts as prompts; they surface as slash commands in the client |
| `outputSchema` on all tools immediately | Complex tools (deploy, retrieve) have variable-structure results that don't fit a clean schema; forcing a schema now creates maintenance burden | Add outputSchema incrementally to the 5-8 tools with predictable flat return shapes |
| Full RFC 5424 log levels in user-facing content | Users don't need `notice`, `alert`, `emergency` for a CLI dev tool | Use debug/info/warning/error; map unexpected states to warning |
| `listChanged` notifications for resources or prompts | Resources and prompts are static at startup (determined by resolved orgs and enabled toolsets); no events trigger a list change | Omit `listChanged: true` from capabilities; simpler protocol surface |
| MCP Sampling (server-initiated LLM calls) | This server's model is: agent calls tools, tools return data; the server has no need to make LLM calls itself | Out of scope; no Salesforce workflow requires it |

---

## Feature Dependencies

```
Phase 1: Tool Annotations
  → No dependencies. Can start immediately. Pure metadata changes.
  → Prerequisite for: accurate client-side confirmation dialogs (immediate user benefit)

Phase 2: Error Messages + Logging
  → Error messages: no dependencies
  → Logging wiring: depends on capabilities declaration (trivial 1-line change)
  → Logging content: benefits from error message improvement being done first
    (log the same recovery hint in the error message AND as a warning-level log)

Phase 3: Resources + Prompts
  → Resources: requires knowing resolved orgs + permissions (already available at startup)
  → Resources MUST be wired before Prompts if prompts embed resource references
  → Prompts: can reference resources by URI; resource wiring should come first
  → Both require: adding getResources()/getPrompts() to McpProvider, wiring in registry-utils.ts

Phase 4: structuredContent
  → Depends on error message cleanup (Phase 2): do not add outputSchema to a tool
    whose catch block still returns bare err.message — the isError path needs to work cleanly
  → Depends on defining stable output shapes: agree on schemas before implementing
  → Each tool's structured output is independent of other tools
```

---

## Implementation Complexity Matrix

| Feature | Files Touched | Risk | Notes |
|---------|---|---|---|
| Complete annotations (all tools) | ~30-40 `.ts` files across all packages | LOW | Mechanical; no behavior change; test: verify annotations field is populated |
| Error messages (catch blocks) | ~30 catch blocks, ~15 tools | MEDIUM | Requires domain knowledge per tool; test: verify isError=true + helpful text |
| logging/setLevel wiring | `index.ts` (1 line), `sf-mcp-server.ts` (replace debug calls) | LOW | Must add `logging: {}` to capabilities or SDK throws |
| Telemetry error visibility | `telemetry.ts` (silent catch blocks) | MEDIUM | Replace `catch {}` with `sendLoggingMessage` — need to check AppInsights error types |
| Resources (wiring) | `mcp-provider-api`, `registry-utils.ts`, `index.ts` | MEDIUM | Abstract class exists; need concrete implementations + registration path |
| Resources (implementations) | New files in `mcp-provider-dx-core` or `mcp` package | LOW | Data already available; just format and return |
| Prompts (wiring) | Same files as resources, plus capabilities declaration | MEDIUM | No `prompts` capability declared yet — needs adding to `index.ts` |
| Prompts (content) | New files per prompt | HIGH | Domain-specific; each prompt is a mini workflow specification |
| structuredContent (core tools) | ~5-8 tool files + their test files | MEDIUM | Must update outputSchema, return shape, and tests in sync |

---

## Existing Infrastructure Already in Place

These do not need to be built — they just need wiring:

- `McpResource` and `McpResourceTemplate` abstract classes — `mcp-provider-api/src/resources.ts`
- `McpPrompt` abstract class and `McpPromptConfig` type — `mcp-provider-api/src/prompts.ts`
- `calculateResponseCharCount()` handles `structuredContent` — `sf-mcp-server.ts` line 293
- `capabilities: { resources: {} }` already declared — `index.ts` line 182
- `annotations` field in tool config type — `sf-mcp-server.ts` line 127
- `isError: true` pattern already used in middleware — multiple locations in `sf-mcp-server.ts`

---

## Sources

- MCP Tools spec (2025-06-18): https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- MCP Resources spec (2025-06-18): https://modelcontextprotocol.io/specification/2025-06-18/server/resources
- MCP Prompts spec (2025-06-18): https://modelcontextprotocol.io/specification/2025-06-18/server/prompts
- MCP Logging spec (2025-03-26): https://modelcontextprotocol.io/specification/2025-03-26/server/utilities/logging
- Tool Annotations blog post (2026-03-16): https://blog.modelcontextprotocol.io/posts/2026-03-16-tool-annotations/
- TypeScript SDK docs: https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md
- SDK issue #175 (sendLoggingMessage on McpServer): https://github.com/modelcontextprotocol/typescript-sdk/issues/175
- SDK issue #654 (structuredContent + isError conflict): https://github.com/modelcontextprotocol/typescript-sdk/issues/654
- LLM-friendly error messages: https://alpic.ai/blog/better-mcp-tool-call-error-responses-ai-recover-gracefully
- Resources and Prompts primitives guide: https://dev.to/aws-heroes/mcp-prompts-and-resources-the-primitives-youre-not-using-3oo1
- Salesforce DX MCP server reference: https://github.com/salesforcecli/mcp
- Direct code inspection: `packages/mcp/src/sf-mcp-server.ts`, `index.ts`, `mcp-provider-api/src/`

---
*Feature research for: Salesforce MCP Server v1.2 — MCP Best Practices Alignment*
*Researched: 2026-04-11*
