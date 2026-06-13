# @dormon/salesforce-mcp — Project Overview

> Fork of [@salesforce/mcp](https://github.com/salesforcecli/mcp), hardened for
> multi-org, AI-agent use. Published independently under the `@dormon` npm scope.

## What This Is

A Model Context Protocol (MCP) server that exposes Salesforce CLI capabilities as
MCP tools so AI agents can interact with Salesforce orgs. Monorepo with a
plugin-based provider architecture — ~49 tools across 11 toolsets (data queries,
metadata deploy/retrieve, testing, DevOps Center, code analysis, mobile/LWC).

**Core value:** AI agents can safely and efficiently interact with Salesforce
orgs through well-defined, permission-controlled MCP tools.

## Why This Fork Exists

Started from a wrong-org debugging session: the upstream server used
`process.chdir()` plus a global target-org fallback, which routed queries to the
wrong org under concurrent / multi-org use. The fork fixes that class of bug and
adds AI-agent ergonomics the upstream lacks.

### Improvements over upstream

- **Concurrency safety** — eliminated `process.chdir()` in all org-touching
  tools; removed the global Mutex; tools run in parallel (lwc-experts uses
  targeted serialization). Org aliases resolved once at startup.
- **Error-recovery guidance** — core tools return `[USER_ERROR]`/`[SYSTEM_ERROR]`
  with `[RECOVERY]` hints for LLM self-repair.
- **Structured output** — 6 core tools return `structuredContent` + `outputSchema`.
- **MCP Resources** — org list and per-org permissions exposed as discoverable
  resources (`salesforce://orgs`).
- **Complete tool annotations** — `readOnlyHint` / `destructiveHint` /
  `idempotentHint` / `openWorldHint` on all GA tools.
- **Multi-org permissions** — per-org read-only / full-access / approval-required.
- **Smart Schema Cache** — per-org LRU cache (disk-persisted), auto-populated from
  successful SOQL; `INVALID_FIELD` recovery with Levenshtein fuzzy suggestions;
  relationship-graph extraction surfaced in query responses; query history ring
  buffer (`salesforce_list_query_history`); new `salesforce_describe_object` tool.

## Architecture

Yarn-workspaces monorepo (nohoist), published as `@dormon` scope. Plugin-based
providers register tools/resources against a shared `Services` contract.

| Layer | Location |
|---|---|
| Provider contract (`Services` interface, shared params, error factory) | `packages/mcp-provider-api/src/` |
| Server + `Services` implementation, registry wiring | `packages/mcp/src/` (`services.ts`, `utils/registry-utils.ts`) |
| Core DX provider (org tools, schema intelligence) | `packages/mcp-provider-dx-core/src/` |
| Schema cache / discovery / history | `packages/mcp-provider-dx-core/src/schema/` (`SchemaService`, `QueryHistoryService`) |
| External providers (closed-source upstream) | `mcp-provider-{code-analyzer,lwc-experts,aura-experts,mobile-web,devops,...}` |

**Stack:** `@modelcontextprotocol/sdk` ^1.18.0, `@salesforce/core` ^8.29.0,
`@salesforce/agents` ^1.3.0, Zod, lru-cache v11. Node ≥ 20. stdio transport.

## Milestone History

| Milestone | Focus | Status |
|---|---|---|
| v1.0 | Fix concurrent-org race (startup org resolution, simplified `getConnection`) | Complete |
| v1.1 | Remove all `process.chdir()`, enable parallel execution, fix SIGTERM, complete tool-categories | Complete |
| v1.2 | Tool annotations, error recovery, structured output, MCP Resources | Complete |
| v1.3 | Smart Schema Cache (foundation, describe tool, auto-cache, failure recovery, relationship graph, query history) | Complete |

There is **no active milestone in progress.** v1.3 shipped fully (6/6 phases).
The next milestone has not been started.

## Key Decisions

| Decision | Rationale |
|---|---|
| Resolve orgs at startup | Eliminate per-call config reads that caused race conditions |
| Targeted serialization for lwc-experts only | All other ~47 tools run fully parallel |
| Schema cache separate from existing `Cache` class | Different TTL semantics, per-org isolation |
| Cache key = canonical username (not alias) | Prevents cross-org schema bleed |
| Levenshtein fuzzy match (no vector deps) | Lightweight; fuse.js optional for ranked scoring |
| Disk persistence via per-org JSON in dataDir | Load on startup, discard expired entries |
| Regex SOQL parser (not AST) | Extracts flat SELECT…FROM; returns null for complex queries |
| Fire-and-forget auto-cache hook | Never fail a successful query because of caching |
| Query history = in-memory ring buffer | No disk persistence needed |
| Do NOT upgrade SDK to alpha/2.0 | Signature churn, zero functional benefit until stable |

## Out of Scope

- Modifying closed-source providers (lwc-experts, aura-experts).
- Streamable HTTP transport — single-client stdio is sufficient.
- Tool consolidation (merging 49+ tools) — requires upstream coordination.
- MCP SDK v2.0 — still alpha.

## Constraints

- External `lwc-experts` / `aura-experts` are closed-source npm packages — their
  chdir behavior cannot be modified.
- Some `@salesforce/core` APIs may internally depend on `process.cwd()` — verify
  per tool.
- Tool input schemas (names, parameters) must stay stable per MCP convention.

## Workflow

This project uses the [superpowers](https://github.com/obra/superpowers) skills
for planning and execution. Implementation plans live in
`docs/superpowers/plans/` (see that directory's README). Use
`superpowers:writing-plans` to author a plan and
`superpowers:subagent-driven-development` (or `executing-plans`) to execute it.
