# Pitfalls Research

**Domain:** Eliminating process.chdir() and enabling parallel tool execution in a Salesforce MCP server
**Researched:** 2026-04-11
**Confidence:** HIGH — based on direct inspection of source code: sf-mcp-server.ts, all 15 tool files with chdir, @salesforce/core lib internals (ConfigAggregator, StateAggregator, SfProject, Lifecycle, Mutex), @salesforce/source-tracking internals (ShadowRepo, SourceTracking), @salesforce/source-deploy-retrieve internals (deployMessages, variants, treeContainers)

---

## Critical Pitfalls

### Pitfall 1: ConfigAggregator Singleton Keyed on process.cwd()

**What goes wrong:**
`ConfigAggregator.getInstance()` uses `process.cwd()` as the Map key when no `projectPath` is provided. After chdir removal, when callers pass an explicit `projectPath`, the key will differ from any previously cached instances that were seeded with the old CWD. Parallel tools will get correct per-project instances but calls to `ConfigAggregator.getValue(key)` (the static synchronous method) still default to `process.cwd()` as the lookup key, not the tool's `projectPath` argument.

**Why it happens:**
The implementation in `configAggregator.js` has two code paths:
- `ConfigAggregator.create({ projectPath })` — creates and caches under the resolved absolute `projectPath`. This is the async-safe path.
- `ConfigAggregator.getInstance(projectPath ?? process.cwd())` — the synchronous path used by `ConfigAggregator.getValue()`. If not called with an explicit path, it falls through to `process.cwd()`.

`getDefaultConfig()` in `auth.ts` calls `ConfigAggregator.clearInstance(process.cwd())` then `ConfigAggregator.create()` (no path arg). Under parallel execution, `process.cwd()` at the time of `clearInstance` may differ from `process.cwd()` at the time of `create`, busting the wrong cache entry.

**How to avoid:**
- Always pass explicit `projectPath` to all `ConfigAggregator.create()`, `ConfigAggregator.getInstance()`, and `ConfigAggregator.clearInstance()` calls.
- Audit `auth.ts::getDefaultConfig()` — it is the one remaining site that clears and creates a `ConfigAggregator` without an explicit path. It must accept `projectPath` as a parameter and thread it through `getDefaultTargetOrg()` and `getDefaultTargetDevHub()`.
- Grep for `ConfigAggregator.create()` without an options argument anywhere in the project source.

**Warning signs:**
- Tests for `getDefaultTargetOrg` fail intermittently when run in parallel with tools that use different project directories.
- `auth-clearinstance.test.ts` checks `clearInstance(process.cwd())` — once chdir is gone, the test itself becomes fragile if the CWD of the test process is different from the project path under test.

**Phase to address:**
Wave 1 / Wave 2 — any wave that removes chdir from tools that also call `getAllowedOrgs()`, `getDefaultTargetOrg()`, or `getDefaultTargetDevHub()`. Before removing the Mutex, `auth.ts::getDefaultConfig` must be patched to accept an explicit path.

---

### Pitfall 2: SfProject.resolve() Falls Back to process.cwd()

**What goes wrong:**
`SfProject.resolve(path?)` and `SfProject.getInstance(path?)` both fall back to `process.cwd()` when no path is supplied. Two tools — `deploy_metadata` and `retrieve_metadata` — already pass `input.directory` explicitly: `SfProject.resolve(input.directory)`. However, the pattern is fragile. If any tool omits the path argument, it silently uses whatever CWD the process happens to be in at that moment.

Additionally, `@salesforce/source-deploy-retrieve`'s `variants.js::maybeGetProject` calls `SfProject.getInstance(projectDir ?? process.cwd())` — if `projectDir` is `undefined`, it resolves via CWD. `ComponentSetBuilder.build()` propagates this path through; the `projectDir` field in the build options must always be explicitly set.

**Why it happens:**
The @salesforce/core API was designed for CLI commands where a single CWD implies a single project. The fallback to `process.cwd()` is a convenience default that becomes a time-of-check/time-of-use race in a concurrent server.

**How to avoid:**
- Require `input.directory` (the `projectPath` param) in every tool that touches `SfProject`. Never rely on the zero-argument fallback.
- When calling `ComponentSetBuilder.build()`, always set `projectDir: stl.projectPath` or `projectDir: project.getPath()` explicitly. Both `deploy_metadata` and `retrieve_metadata` already do this; verify no new tool omits it.
- Add a lint rule or a test assertion that fails if `SfProject.resolve()` is called without an argument in tool code.

**Warning signs:**
- Deploy/retrieve succeeds against one project then silently picks up files from a different project without error.
- `SfProject.instances` cache (a private static `Map`) grows unexpectedly — inspect with a debug breakpoint in tests.

**Phase to address:**
Wave 2 (tools that need an explicit `projectPath` param). Also applies at Mutex-removal phase — make sure no newly-unlocked code path omits the path argument.

---

### Pitfall 3: ShadowRepo Singleton Keyed on projectPath — Stale Cache After Re-use

**What goes wrong:**
`ShadowRepo.getInstance(options)` returns a cached instance keyed by `options.projectPath`. The singleton is initialized once with the `packageDirs` from that project. If a tool is called for project A, then the same project is called again after a directory change on disk (e.g., new package dir added), the stale `ShadowRepo` instance will be used without reloading from disk.

`deploy_metadata` already calls `stl.reReadLocalTrackingCache()` to invalidate the shadow repo before building the component set. This call forces `ShadowRepo.getInstance` to reuse (not recreate) the cached object but refreshes its index. If this call is missing from other tools, they will use stale tracking state.

**Why it happens:**
`ShadowRepo` is designed to be a persistent singleton across CLI invocations within one process lifetime. A long-running MCP server never restarts between tool calls, so the cache never naturally expires. Removing the Mutex means two parallel deploys for the same project could corrupt the shadow repo's in-memory state simultaneously.

**How to avoid:**
- Ensure every tool using `SourceTracking.create()` also calls `stl.reReadLocalTrackingCache()` before any tracking operation. Verify `retrieve_metadata` does this (it does, confirmed in source).
- Treat `ShadowRepo` as a project-scoped singleton that can become stale. Never assume its state reflects disk without a reread call.
- For the Mutex removal phase, audit whether two concurrent SourceTracking operations on the same `projectPath` can race on the `ShadowRepo.instanceMap` — both paths would call `getInstance()` with the same key, but only one path creates the instance; the second gets the cached object. The create path (`new ShadowRepo(options)` + `await newInstance.init()`) is not protected by a lock in the source-tracking library itself. Under parallel execution, both callers could enter `getInstance()` simultaneously and both try to init.

**Warning signs:**
- "Local changes" reported incorrectly — shows files as changed when they haven't changed, or vice versa.
- Git errors from isomorphic-git during concurrent access to the shadow repo's `.sf/orgs/<orgId>` gitdir.

**Phase to address:**
Wave 3 (before Mutex removal) — verify source-tracking concurrent safety. If `ShadowRepo.getInstance` is not thread-safe, a per-project mutex may be needed for source-tracking operations.

---

### Pitfall 4: Premature Mutex Removal Exposes Latent Race Conditions

**What goes wrong:**
The global `toolExecutionMutex` in `SfMcpServer` currently serializes ALL 49 tool calls, not just those that use chdir. Removing the Mutex after eliminating chdir from 14 tools unlocks races that were previously hidden by serialization, even in tools that never called chdir. Specifically:

1. **ConfigAggregator cache corruption**: Multiple concurrent calls to `ConfigAggregator.create()` without a `projectPath` hit the internal `ConfigAggregator.mutex` (a separate per-library mutex). If callers in the MCP server also call `ConfigAggregator.clearInstance()` concurrently, they can bust a cache entry that another operation just populated.

2. **StateAggregator.getInstance()**: Keyed by `Global.DIR` (not CWD), but not protected by an external lock. Two concurrent first-time calls could both enter the `if (!instanceMap.has(...))` branch before either completes init.

3. **Lifecycle event cross-contamination**: `Lifecycle.getInstance()` is stored on `global.salesforceCoreLifecycle`. Event listeners registered by a `deploy_metadata` call (e.g., progress events from SDR) remain active for the lifetime of the singleton. Under parallel execution, a second deploy could receive events from the first deploy's emit cycle.

4. **`auth.ts::getDefaultConfig()` double-clear race**: Two concurrent tools calling `getAllowedOrgs()` will both call `ConfigAggregator.clearInstance(process.cwd())` then `ConfigAggregator.create()`. The two clears and creates interleave unpredictably without the global Mutex.

**Why it happens:**
The three-wave approach correctly requires eliminating all chdir before removing the Mutex. The mistake is assuming that eliminating chdir eliminates ALL non-chdir races. The Mutex was over-broad but it also accidentally serialized ConfigAggregator cache operations that remain racy.

**How to avoid:**
- Before removing the Mutex, audit every singleton in `@salesforce/core` that may be accessed concurrently: `ConfigAggregator`, `StateAggregator`, `Lifecycle`, `Logger` (Logger is safe — it uses a locking mechanism internally).
- Patch `auth.ts::getDefaultConfig()` to be pure (no side-effecting `clearInstance` call, or scope the clear to an explicit projectPath) before removing the Mutex.
- Consider whether a narrower per-projectPath mutex is needed for the `SourceTracking.create()` → `ShadowRepo.getInstance()` chain.
- Write a concurrency stress test that calls 5–10 tools in parallel before removing the Mutex. Run it in CI.

**Warning signs:**
- Flaky test failures that only appear when multiple tests run in the same process.
- `ConfigAggregator.instances` Map size grows unboundedly over many parallel calls.
- SDR deploy result file paths are wrong (relative vs absolute) for one of two concurrent deploys — this is the `deployMessages.js` CWD race (see Pitfall 5).

**Phase to address:**
Wave 3 / Mutex-removal phase — this is the last and riskiest phase. Do not remove the Mutex until the concurrency stress test passes consistently.

---

### Pitfall 5: SDR deployMessages.js Uses process.cwd() for Path Normalization

**What goes wrong:**
`@salesforce/source-deploy-retrieve/lib/src/client/deployMessages.js` compares `process.cwd()` to `projectPath` when normalizing file paths in deploy responses:

```js
filePath: projectPath && process.cwd() !== projectPath && !response.filePath.startsWith(projectPath)
    ? join(projectPath, response.filePath)
    : response.filePath,
```

If two deploys run concurrently for different projects and one calls `process.chdir()` (even transiently during the other's SDR callback), the path normalization of the second deploy silently produces wrong paths — relative paths are joined to the wrong project root.

**Why it happens:**
SDR was designed for single-project CLI use. The `process.cwd() !== projectPath` branch exists to detect when the deploy result returns relative paths that need anchoring to the project root. This comparison breaks under any concurrent CWD mutation.

**How to avoid:**
- This pitfall is eliminated as a direct side-effect of removing ALL chdir calls (including from Wave 1 tools that have "unnecessary" chdir). Even one remaining chdir anywhere in the process contaminates concurrent SDR path normalization.
- Do not remove the Mutex until ALL 15 chdir calls are eliminated — not just the 14 in-scope tools. Confirm the scan-apex-antipatterns-tool and enrich_metadata tools (which are in separate packages) are also addressed.
- After chdir removal, add a test that runs two concurrent deploys for two different project directories and asserts that both result file paths are rooted in their respective project directories.

**Phase to address:**
Applies across all waves — this is the reason no partial chdir removal is safe without the Mutex still in place. The Mutex must remain until the last chdir is gone.

---

### Pitfall 6: External Providers (lwc-experts, aura-experts) May Have Undiscoverable CWD Dependencies

**What goes wrong:**
`@salesforce/mcp-provider-aura-experts` ships as a 4.1MB bundled JS file (`index.bundle.js`). The bundle contains `process.cwd()` calls (confirmed in source), but they appear inside `memfs` internals and vendor code, not in the provider's own logic. The provider does NOT call `process.chdir()` itself (confirmed). However:

1. Any vendor lib inside the bundle that constructs file paths using `process.cwd()` will produce wrong results if CWD has been mutated by another tool running concurrently.
2. The provider's `@salesforce/telemetry` vendored dependency includes a vendored copy of `@salesforce/core` with its own separate `ConfigAggregator` instance map — completely isolated from the main server's copy. This means the external providers' org config reads are immune to the server's ConfigAggregator races, but they also cannot benefit from the server's startup-cached values.
3. `@salesforce/mcp-provider-lwc-experts` bundle also includes `process.cwd()` references. Without source access, it is impossible to determine all call sites.

**Why it happens:**
Closed-source bundled packages cannot be audited or patched. Their behavior under concurrent execution is opaque.

**How to avoid:**
- Do not remove the Mutex for tools that invoke lwc-experts or aura-experts functionality until those providers are tested under concurrent load.
- If the providers prove unsafe for concurrent use, scope a per-provider mutex instead of the global mutex.
- Monitor the providers' npm release notes for any concurrency-related fixes.

**Warning signs:**
- LWC or Aura expert tools return incorrect results when called concurrently with other tools.
- File-not-found errors in external provider tools that work correctly in isolation.

**Phase to address:**
Wave 3 / Mutex-removal phase — keep the global Mutex in place for tool wrappers that delegate to these providers, even after all owned chdir calls are removed.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Remove chdir from "unnecessary" tools (Wave 1) without writing a test | Faster progress | Regression if a future @salesforce/core version starts requiring CWD for some path | Never — always add a test verifying the tool works with an explicit path and no chdir |
| Keep global Mutex after removing most chdir | Avoids concurrency analysis | Kills the performance goal of the milestone | Acceptable temporarily during Wave 1 and Wave 2; must be removed in Wave 3 |
| Add `projectPath` param to tools that didn't previously expose it | Cleaner API | Technically a breaking schema change if AI agents have hardcoded tool calls | Acceptable — MCP tool input schema changes are expected during development; `directory` param already exists and is re-used |
| Use `process.cwd()` as fallback in a helper when projectPath is absent | Backward compatibility | Re-introduces a hidden CWD dependency | Never in production MCP server code |
| Skip per-project mutex for SourceTracking operations | Simpler code | Concurrent deploys to the same project corrupt ShadowRepo state | Only if E2E tests confirm it is safe under concurrent access |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `ConfigAggregator.create()` | Calling without `{ projectPath }` option assumes CWD is correct | Always pass `{ projectPath: input.directory }` or the resolved project root |
| `SfProject.resolve()` | Calling without an argument defaults to `process.cwd()` | Always call `SfProject.resolve(input.directory)` |
| `SourceTracking.create()` | Not calling `reReadLocalTrackingCache()` before the first tracking operation | Always call `stl.reReadLocalTrackingCache()` after create, before building component sets |
| `ComponentSetBuilder.build()` | Omitting `projectDir` field in build options | Always set `projectDir: stl.projectPath` or `projectDir: project.getPath()` |
| `ConfigAggregator.clearInstance()` | Calling with no argument clears ALL cached instances globally | Always call with an explicit `projectPath` argument; never clear all |
| `StateAggregator.getInstance()` | Assuming it is safe to call concurrently | Call only from startup or from serialized contexts; treat as init-once |
| `Lifecycle.getInstance()` | Assuming event listeners are scoped to one tool call | Listeners survive across calls; register with unique event names or deregister after use |
| `auth.ts::getDefaultConfig()` | Called concurrently by tools that need the default org | Patch to accept explicit `projectPath`; the implicit `process.cwd()` call must be removed before Mutex removal |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| ConfigAggregator reads from disk on every call | Slow tool startup, especially when multiple tools run in parallel | Use the singleton cache; never call `clearInstance` speculatively | Any tool call frequency above 1/sec with config re-reads |
| ShadowRepo.init() re-initializes git on every cold start | First SourceTracking call after server start is slow | Accept this as one-time cost per project; cache properly | At high parallelism when many project paths are used |
| StateAggregator.getInstance() reads all auth files on first call | Slow first tool call when many orgs are authenticated | Call once at startup and cache the result | When 20+ orgs are authenticated |
| Mutex-serialized tools blocking quick read-only tools | `run_soql_query` blocks behind a 10-minute deploy | After Mutex removal, quick tools run in parallel; no action needed until Mutex removed | With Mutex in place — every tool blocks every other tool |

---

## "Looks Done But Isn't" Checklist

- [ ] **chdir removal for Wave 1 tools**: Verify that tools like `run_soql_query`, `list_all_orgs`, `open_org`, `get_username`, `delete_org`, `assign_permission_set`, `run_apex_test`, `run_agent_test` do not use `SfProject` or `SourceTracking` internally and truly do not need CWD. Grep for `SfProject`, `SourceTracking`, `ConfigAggregator` in each tool before classifying as Wave 1.
- [ ] **chdir removal looks complete but auth.ts still uses CWD**: After removing all 15 `process.chdir()` calls, check `auth.ts::getDefaultConfig()` — it still has `ConfigAggregator.clearInstance(process.cwd())` with an implicit CWD dependency. This is not a chdir call but is equally unsafe under parallelism.
- [ ] **Mutex removal looks safe but external providers are untested**: Confirm aura-experts and lwc-experts tools have been explicitly tested under concurrent invocation before the global Mutex is removed.
- [ ] **SfProject.resolve() path passes but SDR build options miss projectDir**: After chdir removal, `SfProject.resolve(input.directory)` returns the correct project instance, but if `ComponentSetBuilder.build()` is called without `projectDir:`, SDR falls back to `SfProject.getInstance(process.cwd())` internally (in `variants.js`). The build appears to work but silently uses CWD for the registry.
- [ ] **Tests pass serially but fail under concurrency**: The existing E2E test suite runs tools sequentially. A test may show green while a real concurrent race condition is never exercised. Add at least one concurrent invocation test before declaring the Mutex removed.
- [ ] **`run_soql_query` chdir is "just for config reads" but getConnection also uses StateAggregator**: After chdir removal and startup org resolution, `getConnection(usernameOrAlias)` should not need CWD at all. Verify that `StateAggregator.getInstance()` in `auth.ts::getConnection` returns the correct aliases regardless of CWD — StateAggregator uses `Global.DIR` (~/.sf), not CWD, so this should be safe.

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| ConfigAggregator keyed on wrong CWD | MEDIUM | Add explicit `projectPath` to all `ConfigAggregator.create/getInstance/clearInstance` calls; update `auth.ts::getDefaultConfig` signature; update calling code and tests |
| Premature Mutex removal exposes races | HIGH | Re-add `toolExecutionMutex` temporarily; profile which tools race; add per-tool or per-projectPath mutexes; remove global mutex again only after fixing races |
| ShadowRepo concurrent corruption | MEDIUM | Add a per-projectPath semaphore around `SourceTracking.create()` → `reReadLocalTrackingCache()` chain; or upgrade source-tracking if a fix lands upstream |
| SDR path normalization wrong for concurrent deploys | LOW (if chdir fully removed) | If any chdir was missed, find it via `grep -r "process.chdir"` and remove it; re-run concurrent deploy test |
| External provider broken under concurrency | HIGH | Per-provider mutex wrapping all calls to that provider; file bug with provider team; cannot fix source |
| auth.ts clearInstance race | LOW | Thread `projectPath` through `getDefaultConfig`; already partially designed for this — `ConfigAggregator.create({ projectPath })` signature already accepts it |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| SfProject.resolve() without path | Wave 1 & 2 — when removing chdir from each tool | Unit test: call tool with explicit directory, assert no `process.cwd()` in call stack (use sinon spy on SfProject.resolve) |
| ConfigAggregator keyed on CWD | Before Mutex removal (Wave 3 prerequisite) | Unit test: call `getDefaultTargetOrg` from two concurrent call sites with different directories; assert both get correct results |
| ShadowRepo concurrent init | Wave 3 / before Mutex removal | E2E test: two concurrent `deploy_metadata` calls for same project; assert no git errors and correct component counts |
| Premature Mutex removal | Wave 3 — must be last | Concurrency stress test: 5 tools in parallel, all different orgs/projects; all must succeed with correct results |
| SDR deployMessages path normalization | All waves — eliminated by removing all chdir | E2E test: two concurrent deploys for two different project directories; assert result file paths are rooted in respective projects |
| External provider CWD dependency | Wave 3 / Mutex removal phase | Manual test: call lwc-expert/aura-expert tools concurrently with a deploy; assert no file-not-found errors |
| auth.ts implicit CWD in clearInstance | Before Mutex removal | Unit test: mock `ConfigAggregator.clearInstance`, call `getAllowedOrgs` from two concurrent contexts, assert `clearInstance` is called with explicit path not `process.cwd()` |
| Lifecycle event cross-contamination | Wave 3 / before Mutex removal | Integration test: two concurrent deploys; assert each deploy's progress event stream contains only its own events |

---

## Sources

- Direct code inspection: `packages/mcp/src/sf-mcp-server.ts` — `toolExecutionMutex` usage, comment explaining chdir race condition
- Direct code inspection: all 14 `packages/mcp-provider-dx-core/src/tools/*.ts` files + `packages/mcp-provider-scale-products/src/tools/scan-apex-antipatterns-tool.ts` + `packages/mcp-provider-metadata-enrichment/src/tools/enrich_metadata.ts` — all 15 `process.chdir()` call sites
- Direct code inspection: `packages/mcp-provider-dx-core/node_modules/@salesforce/core/lib/config/configAggregator.js` — `static instances = new Map()`, `getInstance(projectPath = process.cwd())`, `create({ projectPath })` mutex usage
- Direct code inspection: `packages/mcp-provider-dx-core/node_modules/@salesforce/core/lib/sfProject.js` — `resolve(path ?? process.cwd())`, `getMemoizedInstance()` singleton pattern
- Direct code inspection: `packages/mcp-provider-dx-core/node_modules/@salesforce/core/lib/stateAggregator/stateAggregator.js` — `static instanceMap = new Map()`, `getInstance()` keyed by `Global.DIR`
- Direct code inspection: `packages/mcp-provider-dx-core/node_modules/@salesforce/core/lib/lifecycleEvents.js` — `global.salesforceCoreLifecycle` singleton pattern
- Direct code inspection: `packages/mcp-provider-dx-core/node_modules/@salesforce/source-tracking/lib/shared/local/localShadowRepo.js` — `static instanceMap = new Map()`, `getInstance()` keyed by `projectPath`
- Direct code inspection: `packages/mcp-provider-dx-core/node_modules/@salesforce/source-tracking/lib/shared/functions.js` — `maybeGetTreeContainer` comparing `process.cwd() !== projectPath`
- Direct code inspection: `packages/mcp-provider-dx-core/node_modules/@salesforce/source-tracking/lib/shared/remote/remoteSourceTrackingService.js` — `process.cwd()` in file path construction
- Direct code inspection: `packages/mcp-provider-dx-core/node_modules/@salesforce/source-deploy-retrieve/lib/src/client/deployMessages.js` — `process.cwd() !== projectPath` path normalization
- Direct code inspection: `packages/mcp-provider-dx-core/node_modules/@salesforce/source-deploy-retrieve/lib/src/registry/variants.js` — `SfProject.getInstance(projectDir ?? process.cwd())`
- Direct code inspection: `packages/mcp/src/utils/auth.ts` — `ConfigAggregator.clearInstance(process.cwd())` in `getDefaultConfig()`
- Direct code inspection: `packages/mcp/test/unit/auth-clearinstance.test.ts` — existing test validating clearInstance uses CWD
- Binary inspection: `packages/mcp/node_modules/@salesforce/mcp-provider-aura-experts/index.bundle.js` — `process.cwd()` confirmed present (2 occurrences); `process.chdir` absent
- Binary inspection: `packages/mcp/node_modules/@salesforce/mcp-provider-lwc-experts/index.bundle.js` — `process.cwd()` confirmed present (3 occurrences); `process.chdir` absent

---
*Pitfalls research for: Salesforce MCP Server — chdir elimination and parallel tool execution*
*Researched: 2026-04-11*
