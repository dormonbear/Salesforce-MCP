# Requirements: Salesforce MCP Server

**Defined:** 2026-04-11
**Core Value:** AI agents can safely and efficiently interact with Salesforce orgs through well-defined, permission-controlled MCP tools.

## v1.1 Requirements (Complete)

All 24 requirements shipped 2026-04-11. See MILESTONES.md for details.

## v1.2 Requirements

Requirements for aligning with MCP best practices (2025-2026). Scope limited to GA tools only (non-GA tools excluded).

### Tool Metadata

- [x] **META-01**: All GA tools declare complete `readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint` annotations
- [x] **META-02**: Annotations values are consistent with `tool-categories.ts` read/write/execute classification

### Error Experience

- [x] **ERR-01**: Top-10 most-used GA tools return error messages with recovery guidance (what went wrong + what to try next)

### Structured Output

- [ ] **OUT-01**: 5-8 core GA query tools declare `outputSchema` and return `structuredContent` alongside text `content`
- [ ] **OUT-02**: Middleware pass-through test confirms `structuredContent` survives `wrappedCb` unchanged

### Discoverability

- [ ] **DISC-01**: MCP Resources expose authenticated org list as a discoverable resource
- [ ] **DISC-02**: MCP Resources expose per-org permission levels as a discoverable resource
- [ ] **DISC-03**: `registry-utils.ts` wires `provideResources()` from providers to `server.registerResource()`

## Future Requirements

Deferred to future milestones.

### Protocol Compliance
- **LOG-01**: `logging/setLevel` protocol support with `sendLoggingMessage()` bridge
- **LOG-02**: Telemetry empty catch blocks replaced with protocol-level logging

### Discoverability (Extended)
- **PROMPT-01**: MCP Prompts for common Salesforce workflows (deploy, SOQL)
- **PROMPT-02**: `registry-utils.ts` wires `providePrompts()` from providers

### Upstream Fixes
- **UPSTREAM-01**: scratchOrgCreate() accepts projectPath parameter (requires @salesforce/core change)
- **UPSTREAM-02**: lwc-experts provider ships chdir-free version (requires external team)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Streamable HTTP transport | Not needed for current single-client stdio use case |
| SDK v2.0 upgrade | Still in alpha, wait for stable release |
| Tool consolidation (merging 49+ tools) | Requires upstream coordination |
| Non-GA tool annotations/output | Not exposed to users by default |
| Resource subscriptions (`subscribe: true`) | Deferred until concrete use case arises |
| All-tool outputSchema coverage | Start with 5-8 core tools, expand later |
| External provider source modifications | lwc-experts and aura-experts are closed-source |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| META-01 | Phase 6 | Complete |
| META-02 | Phase 6 | Complete |
| ERR-01 | Phase 7 | Complete |
| OUT-02 | Phase 8 | Pending |
| OUT-01 | Phase 8 | Pending |
| DISC-03 | Phase 9 | Pending |
| DISC-01 | Phase 9 | Pending |
| DISC-02 | Phase 9 | Pending |

**Coverage:**
- v1.2 requirements: 8 total
- Mapped to phases: 8 (Phases 6-9)
- Unmapped: 0

---
*Requirements defined: 2026-04-11*
*Last updated: 2026-04-11*
