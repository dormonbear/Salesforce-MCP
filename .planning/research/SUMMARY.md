# Research Summary: v1.2 MCP Best Practices Alignment

**Project:** Salesforce MCP Server
**Domain:** MCP protocol compliance and best practices alignment
**Researched:** 2026-04-11
**Confidence:** HIGH

## Executive Summary

All five target features (Tool Annotations, structuredContent, MCP Resources, MCP Prompts, logging/setLevel) are fully supported by the currently installed SDK ^1.18.0 (resolves to 1.18.2). **No new npm dependencies needed.** Resources and Prompts infrastructure already exists as abstract base classes in mcp-provider-api; the missing piece is registration wiring in registry-utils.ts and concrete implementations.

## Key Findings

### Recommended Stack

No new technologies needed. SDK 1.18.2 has every API required.

- **Do NOT upgrade** to SDK 1.29.0 — introduces `ZodRawShapeCompat` signature change with zero functional benefit for this milestone.
- `logging: {}` and `prompts: {}` capability declarations missing from `index.ts` — must be added before connect.
- Zod v3 unchanged; Prompt parameters constrained to string types by MCP protocol.

### Expected Features

**Table stakes (must have):**

| Feature | Complexity | Dependencies |
|---------|------------|--------------|
| Tool Annotations — all 4 hints on every tool | Low (mechanical) | None |
| Error Recovery — recovery guidance in catch blocks | Medium (domain knowledge) | None |
| Structured Output — `outputSchema` + `structuredContent` on core tools | Medium | Error cleanup first |
| MCP Resources — org info, permissions as discoverable resources | Medium | registry-utils wiring |
| Protocol Logging — `logging/setLevel` + telemetry error forwarding | Low | Capability declaration |

**Should have (differentiators):**
- MCP Prompts — 2 core workflow templates (deploy, SOQL builder)
- Annotations/categories consistency test

**Defer (v2+):**
- Resource subscriptions (`subscribe: true`)
- All-tool outputSchema coverage
- MCP Sampling
- SDK v2.0 upgrade (still alpha)

### Architecture Integration Points

1. `index.ts` — Add `logging: {}`, `prompts: {}` to capabilities (before connect)
2. `sf-mcp-server.ts` — Add `sendLog()` helper for protocol-level logging
3. `registry-utils.ts` — Add `registerResourcesFromProviders()`, `registerPromptsFromProviders()`
4. `mcp-provider-api/src/errors.ts` — New `toolError(message, recovery?)` factory
5. `mcp-provider-dx-core/src/resources/` — Concrete McpResource implementations
6. `mcp-provider-dx-core/src/prompts/` — Concrete McpPrompt implementations
7. `telemetry.ts` — Replace empty catch blocks with `sendLog('warning', ...)` forwarding

### Critical Pitfalls

1. **wrappedCb structuredContent pass-through** — Never rebuild CallToolResult in error paths; add middleware pass-through test before any outputSchema work
2. **Annotations vs tool-categories.ts inconsistency** — `readOnlyHint: true` must match `'read'` in category map; add consistency unit test
3. **Capabilities must be declared at startup** — SDK throws hard error if logging/prompts capabilities added after connect
4. **Resources wiring missing** — `provideResources()` is never called; implementation + wiring must ship together
5. **outputSchema requires dual return** — Both `content` (text) and `structuredContent` (typed) must be returned for backward compatibility

## Implications for Roadmap

### Phase 6: Tool Annotations + Error Factory
**Rationale:** Zero infrastructure risk, pure leaf-level changes, immediate user-visible benefit
**Delivers:** Complete annotations on all 49+ tools; shared `toolError()` factory; annotations/categories consistency test
**Addresses:** Missing readOnlyHint causing false write-confirmation dialogs in Claude Code

### Phase 7: Error Recovery Messages
**Rationale:** Uses Phase 6's error factory; requires domain knowledge per tool; dedicated phase ensures quality
**Delivers:** Recovery guidance in ~30 catch blocks; prioritize top-10 most-used tools
**Must complete before:** Phase 9 (structuredContent requires clean error handling)

### Phase 8: Protocol Logging
**Rationale:** Infrastructure change to SfMcpServer; independent of Phases 6/7
**Delivers:** `logging: {}` capability, `sendLog()` helper, telemetry error forwarding, `prompts: {}` capability declaration
**Enables:** Observable resource/prompt registration in later phases

### Phase 9: Structured Output (structuredContent)
**Rationale:** Only add to tools with clean, predictable return shapes after Phase 7 error cleanup
**Delivers:** `outputSchema` + `structuredContent` on 5-8 core tools (SOQL, list_orgs, get_username, get_org_info, etc.)
**Prerequisite:** Middleware pass-through test confirming structuredContent survives wrappedCb

### Phase 10: MCP Resources
**Rationale:** Requires registry-utils.ts wiring + concrete implementations; do after Phase 8 for logging observability
**Delivers:** Org list resource, permissions resource, connection status resource

### Phase 11: MCP Prompts
**Rationale:** Same wiring pattern as Resources; content quality is the hard part
**Delivers:** 2 core prompt templates (deploy workflow, SOQL query builder)

### Phase Ordering Rationale

- Phases 6, 7, 8 are fully parallelizable (no dependencies between them)
- Phase 9 depends on Phase 7 (error cleanup needed before structuredContent)
- Phase 10 depends on Phase 8 (logging for registration observability)
- Phase 11 depends on Phase 10 (reuses same wiring pattern)

### Research Flags

Phases needing deeper research during planning:
- **Phase 7:** Per-tool domain knowledge for error recovery messages
- **Phase 11:** Salesforce DX workflow knowledge for prompt content quality

Standard patterns (skip extra research):
- **Phase 6:** Mechanical annotation filling; classification matrix documented
- **Phase 8:** Single capability declaration + sendLog() helper
- **Phase 10:** Same provideTools() loop pattern already exists

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified against installed SDK 1.18.2 type definitions |
| Features | HIGH | Confirmed against MCP spec 2025-06-18 + SDK source |
| Architecture | HIGH | All 11 provider packages inspected; 1 MEDIUM gap (logging API wrapper) |
| Pitfalls | HIGH | Direct code inspection + verified community issue reports |

**Overall confidence:** HIGH

### Gaps to Address

- `McpServer`-level convenience method for `sendLoggingMessage()` — verify at Phase 8 implementation time
- External providers (lwc-experts, aura-experts) annotation quality — Phase 6 scope limited to own tools
- Prompt content quality depends on Salesforce DX domain expertise — Phase 11 reference: salesforcecli/mcp

## Sources

### Primary (HIGH confidence)
- MCP Specification 2025-06-18 (modelcontextprotocol.io)
- AWS Labs MCP Design Guidelines
- Block's Playbook for Designing MCP Servers
- MCPcat guides (error handling, transport comparison)
- @modelcontextprotocol/sdk 1.18.2 compiled source (node_modules)
- Direct codebase inspection of all provider packages

---
*Research completed: 2026-04-11*
*Ready for roadmap: yes*
