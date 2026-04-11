# Salesforce MCP Server

## What This Is

A Model Context Protocol (MCP) server that exposes Salesforce CLI capabilities as MCP tools, enabling AI agents to interact with Salesforce orgs. Built as a monorepo with a plugin-based provider architecture, supporting 49 tools across 11 toolsets covering data queries, metadata deployment, testing, DevOps Center, code analysis, and mobile development.

## Core Value

AI agents can safely and efficiently interact with Salesforce orgs through well-defined, permission-controlled MCP tools.

## Current Milestone: v1.2 MCP Best Practices Alignment

**Goal:** Align with 2025-2026 MCP best practices — improve tool metadata, error recovery, structured output, discoverability, and observability.

**Target features:**
- Complete Tool Annotations for all tools (readOnlyHint/destructiveHint/idempotentHint/openWorldHint)
- Error messages with recovery guidance for LLM self-repair
- Structured Output (structuredContent) for core tools
- MCP Resources for org info, permissions, and connection status
- MCP Prompts for common Salesforce operations
- Protocol-level logging (logging/setLevel) and telemetry error visibility

## Requirements

### Validated

- Startup org resolution — resolve symbolic org names once at startup (v1.0 Phase 1)
- Simplified getConnection — skip redundant per-call config reads (v1.0 Phase 1)
- Eliminated process.chdir() from all 14 tools (v1.1 Phase 3-4)
- Removed global Mutex, enabled parallel execution (v1.1 Phase 5)
- Fixed SIGTERM handler bug (v1.1 Phase 2)
- Completed tool-categories.ts (v1.1 Phase 2)
- Consolidated shared params to mcp-provider-api (v1.1 Phase 2)

### Active

- [ ] Complete Tool Annotations for all tools
- [ ] Error messages with recovery guidance
- [ ] Structured Output (structuredContent) for core tools
- [ ] MCP Resources for org info and permissions
- [ ] MCP Prompts for common operations
- [ ] Protocol-level logging and telemetry visibility

### Out of Scope

- Streamable HTTP transport — not needed for current single-client stdio use case
- Tasks primitive adoption — depends on SDK support maturity
- External provider modifications (lwc-experts, aura-experts) — closed source
- Tool consolidation (merging 49+ tools) — requires upstream coordination
- SDK v2.0 upgrade — still in alpha, wait for stable release

## Context

- Monorepo with 10 packages (Yarn workspaces, nohoist)
- MCP SDK: `@modelcontextprotocol/sdk` ^1.18.0
- Salesforce core: `@salesforce/core` ^8.24.3
- v1.0 resolved org names at startup; v1.1 eliminated all process.chdir() and enabled parallel execution
- 3 tools have empty annotations; multiple tools missing destructiveHint/idempotentHint
- All tools return plain text only, no structuredContent
- No MCP Resources or Prompts registered
- Telemetry has silent empty catch blocks; no MCP logging/setLevel support

## Constraints

- **External packages**: lwc-experts and aura-experts are closed-source npm packages; cannot modify their chdir behavior
- **@salesforce/core API**: Some APIs may internally depend on process.cwd(); each tool needs individual verification
- **Backward compatibility**: Tool input schemas (names, parameters) must remain stable per MCP convention

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Resolve orgs at startup | Eliminate per-call config reads that caused race conditions | Good |
| Keep Mutex until all chdir removed | Safe incremental approach — remove Mutex only after all chdir eliminated | Pending |
| Three-wave approach for chdir removal | Wave 1: already unnecessary, Wave 2: need projectPath param, Wave 3: need API verification | Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? Move to Out of Scope with reason
2. Requirements validated? Move to Validated with phase reference
3. New requirements emerged? Add to Active
4. Decisions to log? Add to Key Decisions
5. "What This Is" still accurate? Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-11 after milestone v1.2 initialization*
