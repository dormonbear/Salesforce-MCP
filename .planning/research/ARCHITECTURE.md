# Architecture Research

**Domain:** MCP Server — chdir elimination and tool parallelism
**Researched:** 2026-04-11
**Confidence:** HIGH (based on direct codebase inspection)

## Current Architecture

### System Overview

```
┌──────────────────────────────────────────────────────────────┐
│                       index.ts (CLI entry)                    │
│  resolveSymbolicOrgs() at startup → writes allowedOrgs cache │
└──────────────────────────┬───────────────────────────────────┘
                           │ constructs
┌──────────────────────────▼───────────────────────────────────┐
│                     SfMcpServer                               │
│  registerTool() wraps every tool with:                        │
│    1. Permission middleware (targetOrg resolution)            │
│    2. Rate limiter check                                      │
│    3. toolExecutionMutex.lock(cb)  ← global, serializes ALL  │
│    4. Telemetry emit                                          │
└──────────────────────────┬───────────────────────────────────┘
                           │ invokes via provider registry
┌──────────────────────────▼───────────────────────────────────┐
│                   McpProvider layer                           │
│  DxCoreMcpProvider    CodeAnalyzerMcpProvider   ...          │
│  ScaleProductsMcpProvider  MetadataEnrichmentMcpProvider      │
│  LwcExpertsMcpProvider (closed-source bundle)                │
│  AuraExpertsMcpProvider (closed-source bundle)               │
└──────────────────────────┬───────────────────────────────────┘
                           │ provide McpTool instances
┌──────────────────────────▼───────────────────────────────────┐
│                      McpTool.exec()                           │
│  14 tools call process.chdir(input.directory) here           │
│  Then call @salesforce/core APIs that use process.cwd()      │
└──────────────────────────────────────────────────────────────┘
```

### Component Responsibilities

| Component | Responsibility | Location |
|-----------|----------------|----------|
| `SfMcpServer.registerTool()` | Middleware chain: auth, rate limit, mutex, telemetry | `packages/mcp/src/sf-mcp-server.ts` |
| `toolExecutionMutex` | Serializes all 49 tool calls to prevent chdir race | `sf-mcp-server.ts` line 85 |
| `getConnection()` | Resolves alias → username, creates AuthInfo/Connection | `packages/mcp/src/utils/auth.ts` |
| `getDefaultConfig()` | Reads ConfigAggregator; uses `process.cwd()` at line 132 | `packages/mcp/src/utils/auth.ts` |
| `McpTool.exec()` | Business logic; 14 tools call `process.chdir()` first | provider packages |
| `directoryParam` | Zod schema for the `directory` tool input | `mcp-provider-dx-core/src/shared/params.ts` |
| `MCP_PROVIDER_REGISTRY` | Static list of all provider instances | `packages/mcp/src/registry.ts` |

## Tool Audit: chdir Classification

### 14 Tools with process.chdir() (confirmed by direct inspection)

| Tool | Package | What chdir enables | Can remove trivially? |
|------|---------|--------------------|-----------------------|
| `list_all_orgs` | dx-core | Not needed — calls `getAllowedOrgs()` only | YES (Wave 1) |
| `delete_org` | dx-core | Not needed — uses explicit connection | YES (Wave 1) |
| `run_soql_query` | dx-core | Not needed — uses explicit connection | YES (Wave 1) |
| `open_org` | dx-core | Not needed — uses explicit connection | YES (Wave 1) |
| `run_agent_test` | dx-core | Not needed — uses explicit connection | YES (Wave 1) |
| `run_apex_test` | dx-core | Not needed — uses explicit connection | YES (Wave 1) |
| `resume_tool_operation` | dx-core | Not needed — uses explicit connection | YES (Wave 1) |
| `assign_permission_set` | dx-core | Not needed — uses explicit connection + StateAggregator | YES (Wave 1) |
| `get_username` | dx-core | Unclear: calls `getDefaultTargetOrg()` which uses `process.cwd()` indirectly | NO (Wave 3) |
| `create_org_snapshot` | dx-core | Not needed — uses explicit connection | YES (Wave 1) |
| `create_scratch_org` | dx-core | Reads `definitionFile` path — file path is absolute | MAYBE (Wave 2) |
| `deploy_metadata` | dx-core | Calls `SfProject.resolve(input.directory)` + `SourceTracking.create()` | PARTIAL (Wave 2) |
| `retrieve_metadata` | dx-core | Calls `SfProject.resolve(input.directory)` + `SourceTracking.create()` | PARTIAL (Wave 2) |
| `scan_apex_class_for_antipatterns` | scale-products | Not needed — uses explicit connection + explicit file path | YES (Wave 1) |
| `enrich_metadata` | metadata-enrichment | Calls `SfProject.resolve(input.directory)` | PARTIAL (Wave 2) |

**Note:** Only 14 tools confirmed above; the comment in PROJECT.md says "14 tools" which matches this count including `enrich_metadata`.

### Key API Findings

**`SfProject.resolve(path)`** — accepts an explicit directory path. If `path` is provided, it does NOT fall back to `process.cwd()`. Source: `@salesforce/core/lib/sfProject.js` line 391: `const resolvedPath = await this.resolveProjectPath(path ?? process.cwd())`.

**`SourceTracking.create({ org, project })`** — takes `project: SfProject` which already holds the path. Does NOT independently read `process.cwd()` for project location. One internal check at `functions.js:163` compares `process.cwd() !== projectPath` to decide whether to use a `NodeFSTreeContainer`, but this is a web-platform workaround; on Node.js with an explicit projectPath the container is created correctly regardless.

**`getDefaultConfig()` in auth.ts** — calls `ConfigAggregator.clearInstance(process.cwd())` at line 132. This IS a remaining `process.cwd()` dependency. Called only from `get_username` tool. After chdir removal, this needs the directory passed explicitly or the call redesigned.

## Middleware Layer Changes

### Current SfMcpServer.registerTool() flow

```
incoming call
  → permission check (targetOrg)
  → rate limit check
  → toolExecutionMutex.lock(cb)   // serializes everything
      → tool.exec(args)           // 14 tools call process.chdir() here
  → telemetry
→ return result
```

### Post-chdir-removal SfMcpServer.registerTool() flow

```
incoming call
  → permission check (targetOrg)
  → rate limit check
  → tool.exec(args)               // no chdir, no mutex needed
  → telemetry
→ return result
```

**The Mutex must NOT be removed until every tool that calls `process.chdir()` is fixed.** This includes the external providers (see below). The three-wave incremental approach lets you remove the mutex only in Wave 3, after all waves complete.

### Mutex Replacement Strategy

The Mutex is global because `process.cwd()` is global. There is no case for per-org or per-tool mutexes — the shared state is the entire process's working directory, not per-org state. The correct replacement is no mutex at all.

**Decision: fully remove `toolExecutionMutex` after Wave 3 completes.** No per-tool or per-org variants are needed because:

1. Tools using explicit paths have no shared mutable state.
2. Org connections are independently established per-call via AuthInfo (no shared connection pool).
3. The `ConfigAggregator` singleton in `getDefaultConfig()` is the only remaining shared-state concern, and it is only called from `get_username` (Wave 3).

## External Provider Handling

### lwc-experts (closed-source)

**Confirmed:** `index.bundle.js` contains **2 calls** to `process.chdir(e.directory)`.

**Strategy: keep the Mutex active for lwc-experts tools only until a new package version is released.** This can be done by introducing a per-tool `requiresMutex` annotation, OR by wrapping only lwc-experts tool callbacks in the mutex after removing the global mutex. The cleaner approach is the `requiresMutex` flag on `McpTool`:

```typescript
// In McpTool base class (mcp-provider-api):
requiresMutex(): boolean { return false; }  // default: no mutex

// In SfMcpServer.registerTool():
if (tool.requiresMutex?.()) {
  result = await this.toolExecutionMutex.lock(() => cb(args, extra));
} else {
  result = await cb(args, extra);
}
```

Since lwc-experts is closed-source, you cannot add `requiresMutex()` to it. Instead, use a static allowlist in `SfMcpServer` of tool names that require serialization. When the closed-source provider ships chdir-free, remove those names from the list.

**Practical option:** The Mutex wrapper can be moved to a per-provider level — wrap only the LwcExpertsMcpProvider's tool registrations in the mutex. The registry already knows which provider each tool comes from. This keeps the mutex narrowly scoped without modifying closed-source code.

### aura-experts (closed-source)

**Confirmed:** `index.bundle.js` has **0 calls** to `process.chdir()` and **4 calls** to `process.cwd()` — but these are from bundled third-party dependencies (dotenv path resolution), not from tool execution logic. The `index.bundle.d.ts` has no `directory` input field.

**Strategy: aura-experts requires no special handling.** It is not a chdir user. It can run in parallel immediately after the global Mutex is removed.

## Architecture Patterns

### Pattern 1: Explicit Path Threading

**What:** Pass `input.directory` (an absolute path already validated by `directoryParam`/`sanitizePath`) directly to all APIs that previously relied on `process.cwd()`.

**When to use:** Wave 1 and Wave 2 tools.

**Example for Wave 2 (deploy/retrieve):**
```typescript
// Before:
process.chdir(input.directory);
const project = await SfProject.resolve();  // falls back to process.cwd()

// After:
const project = await SfProject.resolve(input.directory);  // explicit — no chdir needed
```

**Example for Wave 1 (connection-only tools):**
```typescript
// Before:
process.chdir(input.directory);
const connection = await this.services.getOrgService().getConnection(input.usernameOrAlias);

// After:
const connection = await this.services.getOrgService().getConnection(input.usernameOrAlias);
// directory param can be removed from the schema entirely for Wave 1 tools
// OR kept but ignored (non-breaking change)
```

The safer non-breaking change is to keep the `directory` param in the schema (existing agents already send it) but simply not use it.

### Pattern 2: Staged Mutex Removal

**What:** Remove the global `toolExecutionMutex` after all open-source tools are clean; retain a targeted mutex only for closed-source tools.

**When to use:** After Wave 3, before closing out the milestone.

**Example:**
```typescript
// In SfMcpServer — after global mutex is removed:
private readonly mutexRequiredTools = new Set<string>([
  // names of lwc-experts tools that still use chdir internally
  // populated from a constant or config
]);

// In wrappedCb:
const needsMutex = this.mutexRequiredTools.has(name);
const result = needsMutex
  ? await this.toolExecutionMutex.lock(() => cb(args, extra))
  : await cb(args, extra);
```

### Pattern 3: Consolidating Shared Params

**What:** Move `directoryParam`, `usernameOrAliasParam`, and `sanitizePath` from `mcp-provider-dx-core/src/shared/params.ts` to `mcp-provider-api`.

**When to use:** At the start of this milestone (prerequisite for Wave 1 changes in scale-products and metadata-enrichment, which currently duplicate these params from their own `shared/params.ts` files).

**Impact:** Only additive — existing imports in dx-core can keep working via re-export. New providers import from the API package directly.

### Pattern 4: ConfigAggregator Without CWD (Wave 3)

**What:** `getDefaultConfig()` in `auth.ts` calls `ConfigAggregator.clearInstance(process.cwd())` before creating a new aggregator. After chdir removal, `process.cwd()` here will always return the server start directory, which may no longer reflect the user's project.

**Resolution options:**
1. Accept the behavior: `get_username` only reads global/local config; after org resolution at startup this function is rarely called with directory sensitivity.
2. Thread the directory through: add a `directory` parameter to `getDefaultConfig()` / `getDefaultTargetOrg()` / `getDefaultTargetDevHub()` and call `ConfigAggregator.clearInstance(directory)` instead.
3. Eliminate `getDefaultConfig()` entirely — after startup org resolution, the target org is already known; `get_username` can read from the startup cache instead.

Option 3 is the cleanest and aligns with the v1.0 Phase 1 decision (resolve orgs at startup). Option 2 is the safer incremental step.

## Data Flow Changes

### Before (Serialized, CWD-dependent)

```
Tool A called           Tool B called (queued, waiting for Mutex)
    ↓
Mutex.lock()
    ↓
process.chdir("/project/A")
    ↓
SfProject.resolve()   — reads process.cwd() → "/project/A"
SourceTracking.create() — reads process.cwd() → "/project/A"
    ↓
Mutex.unlock()
    ↓           ← Tool B executes HERE, CWD still "/project/A" or changed
```

### After (Parallel, Path-explicit)

```
Tool A called           Tool B called (runs concurrently)
    ↓                       ↓
SfProject.resolve("/project/A")    SfProject.resolve("/project/B")
SourceTracking.create(projectA)    SourceTracking.create(projectB)
    ↓                       ↓
Return independently            Return independently
```

No shared mutable state between tool executions. Org connections are per-call. SfProject instances are memoized per resolved path (safe for concurrent reads).

## Recommended Project Structure Changes

```
packages/
├── mcp-provider-api/src/
│   ├── tools.ts           # McpTool base class — add requiresMutex() stub if needed
│   └── params.ts          # NEW: consolidated directoryParam, usernameOrAliasParam, sanitizePath
│
├── mcp/src/
│   ├── sf-mcp-server.ts   # Remove global mutex OR scope to mutexRequiredTools set
│   └── utils/
│       ├── auth.ts        # Fix getDefaultConfig() process.cwd() usage (Wave 3)
│       └── tool-categories.ts  # Fill in missing tool classifications
│
├── mcp-provider-dx-core/src/
│   ├── shared/params.ts   # Re-export from mcp-provider-api (backward compat)
│   └── tools/             # 13 tools: remove process.chdir(), update SfProject.resolve() calls
│
├── mcp-provider-scale-products/src/
│   └── tools/scan-apex-antipatterns-tool.ts  # Remove process.chdir() (Wave 1)
│
└── mcp-provider-metadata-enrichment/src/
    └── tools/enrich_metadata.ts  # Update SfProject.resolve(input.directory) (Wave 2)
```

## Suggested Build Order

### Phase 0 — Prerequisite: Consolidate shared params (1-2 days)

**Why first:** scale-products and metadata-enrichment both have their own `shared/params.ts` copies. Moving `directoryParam` and `sanitizePath` to `mcp-provider-api` before Wave 1 ensures changes are made once, not per-package.

- Add `params.ts` to `mcp-provider-api`
- Re-export from existing `mcp-provider-dx-core/src/shared/params.ts` (no break)
- Complete `tool-categories.ts` missing classifications (unblocks permission middleware correctness)
- Fix SIGTERM handler bug (`process.stdin` → `process`) — standalone, no dependencies

### Phase 1 — Wave 1: Trivially remove chdir (3-4 days)

**Candidates (all in dx-core unless noted):**
- `list_all_orgs` — remove chdir, optionally remove `directory` from schema
- `delete_org` — remove chdir
- `run_soql_query` — remove chdir
- `open_org` — remove chdir
- `run_agent_test` — remove chdir
- `run_apex_test` — remove chdir (connection-only, no SfProject needed)
- `resume_tool_operation` — remove chdir
- `assign_permission_set` — remove chdir
- `create_org_snapshot` — remove chdir
- `scan_apex_class_for_antipatterns` (scale-products) — remove chdir

**At end of Wave 1:** all 10 tools confirmed chdir-free. Mutex still active.

**Testing:** Run existing test suite + verify tools still work with concurrent calls.

### Phase 2 — Wave 2: SfProject.resolve() path threading (2-3 days)

**Candidates:**
- `deploy_metadata` — change `SfProject.resolve()` → `SfProject.resolve(input.directory)`, remove chdir
- `retrieve_metadata` — same pattern
- `enrich_metadata` (metadata-enrichment) — same pattern
- `create_scratch_org` — remove chdir; reads `definitionFile` as an absolute path already, no SfProject needed

**Verify for each:** confirm `SourceTracking.create({ org, project })` receives an `SfProject` instance resolved from explicit path. The `NodeFSTreeContainer` branch in source-tracking is a web-only concern; no special handling needed on Node.js.

**At end of Wave 2:** all open-source tools are chdir-free. Mutex still active (lwc-experts still uses chdir).

### Phase 3 — Wave 3: Remaining CWD dependencies + Mutex removal (2-3 days)

- `get_username` — fix `getDefaultConfig()` in `auth.ts`:
  - Option A (recommended): thread `directory` through to `ConfigAggregator.clearInstance(directory)`
  - Option B (bolder): remove `getDefaultConfig()` and read from startup cache
- Remove `toolExecutionMutex` global lock from `SfMcpServer.registerTool()`
- Add targeted mutex for lwc-experts tools (static tool name allowlist in SfMcpServer)
- Verify parallel execution: run multiple tool calls concurrently in integration tests

**At end of Wave 3:** milestone complete. 49 tools can execute in parallel (except lwc-experts, which remains serialized until the closed-source package is updated).

### Dependency Graph

```
Phase 0 (params consolidation)
    ↓
Phase 1 (Wave 1 — trivial chdir removal)
    ↓
Phase 2 (Wave 2 — SfProject path threading)
    ↓
Phase 3 (Wave 3 — CWD cleanup + Mutex removal)
```

Phases 1 and 2 are independent of each other within their scope — individual tool fixes can be done in parallel by different contributors. Phase 3 must follow Phases 1 and 2 because the Mutex should only be removed after all open-source tools are chdir-free.

## Integration Points

### SfMcpServer ↔ McpTool (primary change point)

The `wrappedCb` in `registerTool()` currently puts `toolExecutionMutex.lock()` around every `cb()` call (line 230). After removal, the call is simply `await cb(args, extra)`. The rest of the middleware (permission check, rate limit, telemetry) is unaffected and continues to work correctly with parallel execution — none of those paths modify process state.

### McpTool ↔ @salesforce/core APIs

| API | Current dependency on CWD | After fix |
|-----|--------------------------|-----------|
| `SfProject.resolve()` | Falls back to `process.cwd()` if no arg | Pass `input.directory` explicitly |
| `SourceTracking.create()` | Receives `SfProject` with embedded path; does not call `process.cwd()` independently in the relevant code path | No change needed |
| `ConfigAggregator.create()` | Reads project config files starting from `process.cwd()` | Fix in Wave 3: pass explicit directory |
| `AuthInfo.create()` / `Connection.create()` | Does not use `process.cwd()` | No change |
| `Org.create()` | Does not use `process.cwd()` | No change |

### External Providers ↔ SfMcpServer

| Provider | chdir in bundle | Strategy |
|----------|-----------------|----------|
| lwc-experts | YES — 2 calls to `process.chdir(e.directory)` | Retain mutex scoped to lwc-experts tool names |
| aura-experts | NO — 4 `process.cwd()` calls are in bundled dotenv, not tool logic | No mutex needed; runs in parallel |

## Anti-Patterns

### Anti-Pattern 1: Removing the Mutex Before All chdir Calls Are Eliminated

**What people do:** Remove the global mutex early to test parallelism.

**Why it's wrong:** lwc-experts still calls `process.chdir()`. Concurrent calls with different directories will corrupt each other's CWD, producing silent wrong results or flaky errors.

**Do this instead:** Scope the mutex to lwc-experts tool names only, then remove the global lock.

### Anti-Pattern 2: Changing Tool Input Schemas to Remove `directory`

**What people do:** Remove the `directory` field from tool schemas once chdir is eliminated.

**Why it's wrong:** MCP tool schemas must remain stable. Agents and MCP clients (Claude Desktop, VS Code Copilot, etc.) may have cached the tool schema and will error if a previously-required field disappears. Some agents include `directory` in every call as part of their context-passing behavior.

**Do this instead:** Keep `directory` in the schema but mark it as `optional()` and document that it is no longer used by the tool. It becomes a no-op input rather than a removed one.

### Anti-Pattern 3: Per-Org Mutex

**What people do:** Replace the global mutex with one mutex per org alias, reasoning that cross-org concurrency is safe.

**Why it's wrong:** `process.cwd()` is process-global — it does not know about org boundaries. Two concurrent calls to different orgs but both calling `process.chdir()` will still race on the same shared CWD.

**Do this instead:** Remove the mutex entirely (after all chdir calls are gone). Use explicit path threading — this eliminates shared mutable state at its root.

### Anti-Pattern 4: Wrapping SourceTracking.create() Results in process.chdir()

**What people do:** Leave `process.chdir()` in place for deploy/retrieve because SourceTracking "might need" the CWD.

**Why it's wrong:** `SfProject.resolve(input.directory)` is sufficient — it passes the path explicitly. SourceTracking receives the SfProject object and uses its embedded path. The CWD-vs-projectPath comparison in `functions.js:163` is a web-platform guard that does not affect Node.js behavior.

**Do this instead:** Remove chdir and verify with a concrete deploy test that `SourceTracking.create({ org, project })` behaves correctly with a project resolved from an explicit path.

## Sources

- Direct inspection of `packages/mcp/src/sf-mcp-server.ts` (line 230: mutex lock; line 85: mutex field)
- Direct inspection of `packages/mcp-provider-dx-core/src/tools/*.ts` (14 chdir call sites)
- Direct inspection of `packages/mcp-provider-scale-products/src/tools/scan-apex-antipatterns-tool.ts` (line 140)
- Direct inspection of `packages/mcp-provider-metadata-enrichment/src/tools/enrich_metadata.ts` (line 156)
- `@salesforce/core/lib/sfProject.js` line 391: `SfProject.resolve(path ?? process.cwd())`
- `@salesforce/source-tracking/lib/shared/functions.js` line 163: `process.cwd() !== projectPath` check
- `packages/mcp/node_modules/@salesforce/mcp-provider-lwc-experts/index.bundle.js`: 2 `process.chdir(e.directory)` calls confirmed
- `packages/mcp/node_modules/@salesforce/mcp-provider-aura-experts/index.bundle.js`: 0 `process.chdir` calls; 4 `process.cwd()` calls in dotenv bundled code only
- `packages/mcp/src/utils/auth.ts` line 132: `ConfigAggregator.clearInstance(process.cwd())`

---
*Architecture research for: Salesforce MCP Server — chdir elimination and tool parallelism*
*Researched: 2026-04-11*
