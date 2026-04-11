# Stack Research: Eliminating process.chdir() and Enabling Tool Parallelism

**Domain:** Salesforce MCP Server refactoring — CWD-free concurrent tool execution
**Researched:** 2026-04-11
**Confidence:** HIGH (verified against compiled @salesforce/core ^8.24.3 and MCP SDK ^1.18.0 source)

---

## 1. Which @salesforce/core APIs Internally Use process.cwd()?

### SfProject.resolve(path?)

**CWD dependency:** YES, when `path` is omitted.

```js
// lib/sfProject.js line 391
static async resolve(path) {
    const resolvedPath = await this.resolveProjectPath(path ?? process.cwd());
    return this.getMemoizedInstance(resolvedPath);
}
```

**Safe pattern:** Always pass `input.directory` explicitly:

```ts
// BEFORE (CWD-dependent)
const project = await SfProject.resolve();

// AFTER (CWD-free)
const project = await SfProject.resolve(input.directory);
```

All 14 affected tools already pass `input.directory` — they just need to drop the preceding `process.chdir()` call. The `SfProject.resolve(input.directory)` calls are already correct.

---

### ConfigAggregator.create(options?)

**CWD dependency:** YES, when `options?.projectPath` is omitted.

```js
// lib/config/configAggregator.js line 72
const projectPath = options?.projectPath
    ? resolve(options.projectPath)
    : process.cwd();  // <-- CWD-dependent cache key
```

**Instance cache:** Keyed by absolute path. Different `projectPath` values produce different cached instances.

**Safe pattern:** Pass `projectPath` explicitly:

```ts
// BEFORE (CWD-dependent)
await ConfigAggregator.clearInstance(process.cwd());
const aggregator = await ConfigAggregator.create();

// AFTER (CWD-free)
await ConfigAggregator.clearInstance(projectPath);
const aggregator = await ConfigAggregator.create({ projectPath });
```

This is the critical fix needed in `auth.ts:getDefaultConfig()`. The current code calls `clearInstance(process.cwd())` and `ConfigAggregator.create()` without a projectPath — both use `process.cwd()` as cache key, making concurrent calls with different directories race.

---

### Org.create(options)

**CWD dependency:** CONDITIONAL.

- `Org.create({ connection })` — **NO CWD dependency**. Skips ConfigAggregator entirely; uses the provided connection directly (see `org.js:init()` line 999).
- `Org.create({ aliasOrUsername })` — **YES CWD dependency**. Calls `ConfigAggregator.create()` internally without a projectPath (line 999: `this.options.aggregator ?? (await ConfigAggregator.create())`).
- `Org.create()` (no args) — **YES CWD dependency**. Reads TARGET_ORG from ConfigAggregator.

**Current usage in tools:** All tools that call `Org.create()` pass `{ connection }`, which is CWD-safe. Exception: `create_scratch_org.ts` calls `Org.create({ aliasOrUsername: input.devHub })` — this creates a CWD dependency.

**Exception — `scratchOrgCreate()` internal call:** The `@salesforce/core` `scratchOrgCreate()` function internally calls `ConfigAggregator.create()` (without projectPath) at two points. This cannot be fixed from outside the library. This is the hardest tool to make parallel-safe.

---

### SourceTracking.create(options)

**CWD dependency:** NO, when called correctly with an explicit `project` object.

```js
// lib/sourceTracking.js line 97
this.projectPath = options.project.getPath();
```

`SourceTracking.create({ org, project, ... })` derives all paths from the `project` parameter (an `SfProject` instance). As long as `SfProject` was resolved with an explicit path, `SourceTracking` is CWD-free.

---

### AuthInfo.create(options)

**CWD dependency:** NO. Uses `~/.sf/` global state (`StateAggregator`), not project directory.

---

### StateAggregator.getInstance()

**CWD dependency:** NO. Singleton keyed on the global Salesforce config directory (`~/.sf/`), not CWD.

---

## 2. The Allowlist Pattern: Why chdir() Was Originally Added

The comment `// needed for org allowlist to work` appears in 12 of the 14 tools. This was the historical reason for `process.chdir()`.

**What the comment referred to:** Before v1.0, `getAllowedOrgs()` called `getDefaultTargetOrg()` / `getDefaultTargetDevHub()`, which called `ConfigAggregator.create()` without a projectPath. Since ConfigAggregator uses `process.cwd()` as its cache key, each tool needed to `chdir()` to the project directory to load the correct local `.sf/config.json`.

**Current state after v1.0:** The middleware in `sf-mcp-server.ts` now validates org authorization before the tool runs. The `getConnection()` function in `auth.ts` uses `StateAggregator` (global, CWD-free). The `allowedOrgs` cache is populated at startup.

**Conclusion:** For most tools, `process.chdir()` is now vestigial. The comment is stale. The actual remaining CWD dependency is in `auth.ts:getDefaultConfig()` which is only called when determining default org names — not on every tool call.

---

## 3. Tool-by-Tool Classification

### Wave 1 — CWD call is completely vestigial (safe to delete immediately)

Tools that call `process.chdir()` but then only use `getConnection()` + `Org.create({ connection })` or connection-only APIs:

| Tool | APIs Used | CWD Needed? |
|------|-----------|-------------|
| `run_soql_query` | `getConnection()`, `connection.query()` | NO |
| `assign_permission_set` | `getConnection()`, `Org.create({ connection })`, `StateAggregator` | NO |
| `open_org` | `getConnection()`, `Org.create({ connection })` | NO |
| `delete_org` | `getConnection()`, `Org.create({ connection })` | NO |
| `run_apex_test` | `getConnection()`, `TestService(connection)` | NO |
| `run_agent_test` | `getConnection()`, connection APIs | NO |
| `list_all_orgs` | `getAllowedOrgs()` (cache-based) | NO |
| `get_username` | `getAllowedOrgs()`, `getDefaultTargetOrg()` | NO* |
| `resume_tool_operation` | `getConnection()`, connection APIs | NO |
| `create_org_snapshot` | `getConnection()`, `Org.create({ connection })` | NO |
| `scan_apex_antipatterns` | `getConnection()` (optional) | NO |
| `enrich_metadata` | `getConnection()`, `SfProject.resolve(input.directory)` | NO |

*`get_username` calls `getDefaultTargetOrg()` which calls `ConfigAggregator.create()` — but that function needs to be fixed independently (see Wave 2 below).

### Wave 2 — Needs fix in shared infrastructure before chdir can be removed

| Tool | Blocker | Fix Required |
|------|---------|--------------|
| `deploy_metadata` | Uses `SfProject.resolve(input.directory)` + `SourceTracking.create({ project })` — both CWD-free; `process.chdir()` is vestigial | Remove chdir; already passes directory explicitly |
| `retrieve_metadata` | Same as deploy_metadata | Remove chdir; already passes directory explicitly |

These actually belong in Wave 1 — the code already passes `input.directory` to all API calls. The `process.chdir()` is pure legacy.

### Wave 3 — Requires @salesforce/core internal change or workaround

| Tool | Blocker | Notes |
|------|---------|-------|
| `create_scratch_org` | `scratchOrgCreate()` internally calls `ConfigAggregator.create()` without projectPath | Cannot be fixed without library change; must remain serialized or accept potential CWD race |

---

## 4. ConfigAggregator.create() — The Critical Fix in auth.ts

The `getDefaultConfig()` function in `packages/mcp/src/utils/auth.ts` is the shared infrastructure that must be fixed before removing chdir from any tool that calls `getDefaultTargetOrg()` or `getDefaultTargetDevHub()`:

```ts
// CURRENT (CWD-dependent — line 132)
async function getDefaultConfig(property) {
    await ConfigAggregator.clearInstance(process.cwd());
    const aggregator = await ConfigAggregator.create();  // uses process.cwd() as key
    // ...
}

// FIXED (CWD-free — accepts projectPath parameter)
async function getDefaultConfig(
    property: OrgConfigProperties.TARGET_ORG | OrgConfigProperties.TARGET_DEV_HUB,
    projectPath: string,
): Promise<OrgConfigInfo | undefined> {
    await ConfigAggregator.clearInstance(projectPath);
    const aggregator = await ConfigAggregator.create({ projectPath });
    // ...
}
```

**Caller impact:** `getDefaultTargetOrg()` and `getDefaultTargetDevHub()` must also accept and forward the `projectPath`. This flows up through `OrgService` interface and into the tools.

---

## 5. MCP SDK Concurrency Model

**Verdict:** The MCP SDK is concurrent by design. The Mutex is purely a workaround for `process.chdir()`.

### How requests are dispatched (verified in SDK source)

```js
// shared/protocol.js _onrequest():
Promise.resolve()
    .then(() => handler(request, fullExtra))  // no queuing, no lock
    .then((result) => { ... })
```

The SDK fires each tool handler as an independent promise. No built-in serialization exists.

### Stdio transport

```js
// server/stdio.js processReadBuffer():
while (true) {
    const message = this._readBuffer.readMessage();
    if (message === null) break;
    this.onmessage?.(message);  // triggers _onrequest synchronously...
}
// ...but _onrequest wraps the handler in Promise.resolve().then()
// so the handler runs in the next microtask tick, enabling interleaving
```

**Practical result:** Claude (the MCP client) can send multiple `tools/call` requests in rapid succession. The SDK processes each as a separate promise. Without the Mutex, two concurrent tools calling `process.chdir()` would race. Once all `process.chdir()` calls are removed, removing the Mutex enables true concurrent execution.

---

## 6. Node.js Best Practice for CWD-Free Operation

### The core problem: process.cwd() is global process state

Node.js is single-threaded but async concurrent. `process.cwd()` is a process-level global. `process.chdir()` changes it for all concurrent async code, not just the current call stack.

### Pattern 1: Pass explicit paths (primary approach)

All APIs that accept a `path` parameter should receive it explicitly. Never default to `process.cwd()` in application code.

```ts
// Always pass directory explicitly
const project = await SfProject.resolve(input.directory);
const aggregator = await ConfigAggregator.create({ projectPath: input.directory });
```

### Pattern 2: Avoid chdir entirely in servers

Long-running server processes should never call `process.chdir()`. It is safe only in short-lived CLI scripts where no concurrency exists. In an MCP server with concurrent tool handlers, it is a data race.

### Pattern 3: Use absolute paths throughout

All paths received from tool inputs should be validated as absolute (or resolved to absolute) before use. The existing `sanitizePath()` / `directoryParam` infrastructure already does this.

### What NOT to do

| Anti-pattern | Problem |
|---|---|
| `process.chdir()` in async handlers | Races with concurrent handlers sharing the same process |
| `ConfigAggregator.create()` without `projectPath` | Uses `process.cwd()` as instance cache key — corrupted by chdir |
| `SfProject.resolve()` without path argument | Falls back to `process.cwd()` |
| `Org.create({ aliasOrUsername })` without pre-resolved connection | Calls `ConfigAggregator.create()` internally without projectPath |

---

## 7. Removing the Mutex

The `toolExecutionMutex` in `sf-mcp-server.ts` (line 85) can be removed once:

1. All 14 tools have `process.chdir()` removed
2. `auth.ts:getDefaultConfig()` is updated to accept explicit `projectPath`
3. `create_scratch_org` is assessed (Wave 3) — its internal `scratchOrgCreate()` call is the only remaining risk

**Removal is straightforward:** Replace line 230:
```ts
// BEFORE
const result = await this.toolExecutionMutex.lock(() => cb(args as unknown as InputArgs, extra));

// AFTER
const result = await cb(args as unknown as InputArgs, extra);
```

The `Mutex` import from `@salesforce/core` can then be removed.

---

## 8. SIGTERM Handler Bug

The current handler in the server listens on `process.stdin` for `SIGTERM` instead of `process` itself. Fix:

```ts
// WRONG (process.stdin does not emit SIGTERM)
process.stdin.on('SIGTERM', handler);

// CORRECT
process.on('SIGTERM', handler);
```

---

## Sources

- Verified in `packages/mcp/node_modules/@salesforce/core/lib/sfProject.js` lines 390–391 — `SfProject.resolve()` uses `process.cwd()` as default
- Verified in `packages/mcp/node_modules/@salesforce/core/lib/config/configAggregator.js` lines 71–75 — `ConfigAggregator.create()` keyed on `options?.projectPath ?? process.cwd()`
- Verified in `packages/mcp/node_modules/@salesforce/core/lib/org/org.js` lines 994–1025 — `Org.create({ connection })` skips ConfigAggregator; `Org.create({ aliasOrUsername })` triggers ConfigAggregator.create()
- Verified in `packages/mcp/node_modules/@salesforce/core/lib/org/scratchOrgCreate.js` lines 91, 197 — internal `ConfigAggregator.create()` calls without projectPath
- Verified in `packages/mcp/node_modules/@salesforce/source-tracking/lib/sourceTracking.js` line 97 — `SourceTracking` derives path from `project.getPath()`, not CWD
- Verified in `packages/mcp/node_modules/@modelcontextprotocol/sdk/dist/cjs/shared/protocol.js` lines 133–168 — no serialization in request dispatch
- Verified in `packages/mcp/node_modules/@modelcontextprotocol/sdk/dist/cjs/server/stdio.js` — `processReadBuffer()` calls `onmessage` in a while loop; handlers fire as independent promises
- Verified in `packages/mcp/src/utils/auth.ts` lines 126–143 — `getDefaultConfig()` uses `process.cwd()` in both `clearInstance()` and `create()` calls

---

*Stack research for: Salesforce MCP Server v1.1 — CWD elimination and parallel tool execution*
*Researched: 2026-04-11*
