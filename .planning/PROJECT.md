# Salesforce MCP Server

## What This Is

A Model Context Protocol (MCP) server that exposes Salesforce CLI capabilities as MCP tools, enabling AI agents to interact with Salesforce orgs. Built as a monorepo with a plugin-based provider architecture, supporting 49 tools across 11 toolsets covering data queries, metadata deployment, testing, DevOps Center, code analysis, and mobile development.

## Core Value

AI agents can safely and efficiently interact with Salesforce orgs through well-defined, permission-controlled MCP tools.

## Current Milestone: v1.1 Eliminate process.chdir() and Enable Tool Parallelism

**Goal:** Remove process.chdir() dependency from all tools, eliminate global Mutex serialization, and unlock parallel tool execution.

**Target features:**
- Eliminate process.chdir() calls from 14 tools (three waves)
- Remove global toolExecutionMutex, enable tool parallelism
- Fix SIGTERM handler bug (process.stdin → process)
- Complete tool-categories.ts with missing tool classifications
- Consolidate directoryParam/sanitizePath to mcp-provider-api

## Requirements

### Validated

- Startup org resolution — resolve symbolic org names once at startup (v1.0 Phase 1)
- Simplified getConnection — skip redundant per-call config reads (v1.0 Phase 1)

### Active

- [ ] Eliminate process.chdir() from all 14 tools
- [ ] Remove global Mutex, enable parallel execution
- [ ] Fix SIGTERM handler bug
- [ ] Complete tool-categories.ts
- [ ] Consolidate shared params to mcp-provider-api

### Out of Scope

- Streamable HTTP transport — not needed for current single-client stdio use case
- MCP Resources/Prompts implementation — valuable but separate initiative
- Tasks primitive adoption — depends on SDK support maturity
- External provider modifications (lwc-experts, aura-experts) — closed source

## Context

- Monorepo with 10 packages (Yarn workspaces, nohoist)
- MCP SDK: `@modelcontextprotocol/sdk` ^1.18.0
- Salesforce core: `@salesforce/core` ^8.24.3
- 14 tools call `process.chdir()`, forcing all 49 tools through a single Mutex
- Phase 1 (v1.0) resolved org names at startup, removing the primary reason many tools needed CWD-dependent config reads
- `@salesforce/core` APIs (SfProject, SourceTracking) still use `process.cwd()` in some paths — need per-tool verification

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
*Last updated: 2026-04-11 after milestone v1.1 initialization*
