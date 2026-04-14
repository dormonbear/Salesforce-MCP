# Technology Stack

**Project:** Salesforce MCP Server — v1.3 Smart Schema Cache
**Researched:** 2026-04-12
**Confidence:** HIGH (versions verified via npm registry API; existing codebase inspected)

---

## Verdict: Two New Dependencies

For four features (schema caching, fuzzy field matching, relationship graph, query history), only two new npm packages are needed. The rest builds on `@salesforce/core`'s existing `connection.describe()` API and the existing `cache.ts` utility.

---

## New Dependencies Required

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| `fuse.js` | `^7.3.0` | Fuzzy field name matching when SOQL fails | Zero-dependency, ESM+CJS dual build, bundled TypeScript types (`dist/fuse.d.ts`), supports weighted keys for field name vs. label matching. The Bitap algorithm handles 1-3 character typos typical of Salesforce field name errors. Node16 `exports` map resolves correctly (`import` → `.mjs`, `require` → `.cjs`). |
| `lowdb` | `^7.0.1` | Persistent per-org schema cache on disk | Pure ESM (`"type": "module"`) matching the project's own `"type": "module"`. Node16 exports map with `./node` subpath. Bundles TypeScript generics — define your schema type once, full type inference on reads/writes. Atomic writes via temp-file rename. No native bindings, no server process. Engines: `node >=18`, matching project's `node >=20`. |

### Already Available — No New Installs

| Capability | Source | Notes |
|------------|--------|-------|
| Schema metadata fetch | `connection.describe(orgName)` via `@salesforce/core ^8.24.3` | Returns `DescribeSObjectResult` with `fields[]`, `childRelationships[]`, `recordTypeInfos[]`. Already used transitively; hoisted to root `node_modules`. |
| Levenshtein distance (fallback) | `fast-levenshtein ^3.0.0` | Hoisted to root as transitive dep of `@salesforce/core`. Use when you only need edit distance (not ranked scored results). Lacks TypeScript types natively — add `@types/fast-levenshtein ^0.0.4` as devDep if used standalone. Prefer `fuse.js` for the full fuzzy-rank use case. |
| In-memory thread-safe cache | `packages/mcp/src/utils/cache.ts` | Existing `Cache` singleton with `@salesforce/core` Mutex. Extend `CacheContents` type to add `schemaCache` key. No new utilities needed for in-memory layer. |
| Input validation | `zod ^3.25.76` | Already a direct dependency. Use for schema cache entry type guards. |
| File-system paths | `node:path`, `node:fs/promises` | Node built-ins. Use `node:fs/promises` for cache directory creation before `lowdb` initialization. |

---

## Package Decision Rationale

### Why `fuse.js` Over `fast-levenshtein` for Fuzzy Matching

`fast-levenshtein` is already in the dependency tree (via `@salesforce/core`) and works for raw edit distance. Use `fuse.js` instead when the goal is ranked, scored, multi-field search:

- SOQL field errors typically show a wrong field name. You want to rank candidates by both `name` and `label`, not just raw distance.
- `fuse.js` `IFuseOptions.keys` supports `[{ name: 'name', weight: 0.7 }, { name: 'label', weight: 0.3 }]` — single call ranks all candidates.
- `fuse.js` `threshold: 0.4` gives a calibrated cut-off; `fast-levenshtein` returns raw integers requiring manual normalization per string length.
- `fuse.js` 7.3.0 is pure ESM/CJS dual build with bundled `.d.ts` — no separate `@types/` install, no interop issues.

### Why `lowdb` Over `node:fs/promises` Directly

You could write JSON directly to disk with `fs/promises.writeFile()`. Use `lowdb` because:

- **Atomic writes built-in:** `lowdb` v7's `JSONFilePreset` writes to a temp file then renames — prevents partial cache files on crash.
- **In-memory + disk sync:** Reads into memory once at startup, flushes on `db.write()`. No repeated disk reads during a session.
- **Type-safe generic:** `JSONFilePreset<SchemaCache>` gives full TypeScript inference on `.data` — no `JSON.parse` + type assertion needed.
- **Per-org isolation is trivial:** One lowdb file per org (keyed by org username) stored under `configService.getDataDir()`.

### Why NOT SQLite / Better-sqlite3

SQLite would support the relationship graph queries well but:
- Adds a native binding (`better-sqlite3` needs node-gyp / platform binaries)
- Published npm package must bundle prebuilds or require compile-on-install
- The graph here is O(hundreds of objects) — JSON is sufficient; graph traversal is in-process
- Monorepo's `nohoist` pattern makes native modules harder to manage

---

## Integration Points

### Where New Packages Live

Both new deps belong in `packages/mcp-provider-dx-core` (where `run_soql_query.ts` and future `describe_object.ts` live), **not** in `packages/mcp`. The schema cache service is provider-level logic, not server infrastructure.

If the `SchemaService` interface is added to `@dormon/mcp-provider-api`'s `Services`, add both deps to `packages/mcp` as well (since `Services` is constructed there).

### `lowdb` File Location

Use `configService.getDataDir()` (already exposed via `Services.getConfigService().getDataDir()`) as the root for cache files:

```
{dataDir}/schema-cache/{orgUsername}.json
{dataDir}/query-history/{orgUsername}.json
```

This keeps cache files alongside existing MCP data files and respects per-org isolation.

### `fuse.js` Call Pattern

```typescript
import Fuse from 'fuse.js';

// fields: DescribeSObjectResult['fields']
const fuse = new Fuse(fields, {
  keys: [
    { name: 'name', weight: 0.7 },
    { name: 'label', weight: 0.3 },
  ],
  threshold: 0.4,
  includeScore: true,
});

const suggestions = fuse.search(wrongFieldName).slice(0, 5).map(r => r.item.name);
```

Instantiate `Fuse` per-query (or cache per-object) — construction is O(n) on field count, not a concern for Salesforce objects (typical 50-300 fields).

### `lowdb` Schema Shape

```typescript
import { JSONFilePreset } from 'lowdb/node';

type FieldMeta = { name: string; label: string; type: string; referenceTo?: string[] };
type ObjectMeta = { label: string; fields: FieldMeta[]; childRelationships: string[]; cachedAt: number };
type SchemaCache = { objects: Record<string, ObjectMeta>; version: number };

const db = await JSONFilePreset<SchemaCache>(`${dataDir}/schema-cache/${orgUsername}.json`, {
  objects: {},
  version: 1,
});
```

---

## Installation

Add to `packages/mcp-provider-dx-core/package.json`:

```bash
yarn workspace @dormon/mcp-provider-dx-core add fuse.js lowdb
```

If `SchemaService` is added to `mcp-provider-api`'s `Services` interface, also add to `packages/mcp/package.json`:

```bash
yarn workspace @dormon/salesforce-mcp add fuse.js lowdb
```

Dev dependency (only if using `fast-levenshtein` directly in tests):

```bash
yarn workspace @dormon/mcp-provider-dx-core add -D @types/fast-levenshtein
```

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `fuse.js` | `fast-levenshtein` (already installed) | When you only need raw edit distance integers and don't need ranking — acceptable for a much simpler "did you mean X?" message without scoring |
| `fuse.js` | `minisearch` | If full-text search across query history content is also needed; heavier API, not worthwhile for field-name-only use case |
| `lowdb` | `node:fs/promises` direct | If atomic writes are not a concern and codebase already has a JSON read/write utility |
| `lowdb` | `keyv` + flat-file adapter | Only if you want a unified key-value API across multiple backends; overkill here |
| `lowdb` | SQLite via `better-sqlite3` | Only if graph traversal queries become complex (e.g., multi-hop relationship lookups) — defer unless graph queries prove insufficient with JSON |

---

## What NOT to Add

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `better-sqlite3` / `@types/better-sqlite3` | Native binding — breaks npm publish portability, requires prebuild per platform, overkill for O(hundreds) objects | `lowdb` JSON |
| `graphology` / `ngraph` | Graph library — unnecessary abstraction for a relationship map that's just `Record<string, string[]>` adjacency lists | Plain TypeScript object |
| `redis` / `ioredis` | External process dependency — the MCP server runs as a CLI subprocess with no infra guarantees | `lowdb` in-process file cache |
| `node-cache` / `lru-cache` | In-memory only — cache lost on server restart, defeating the "progressive caching" goal | `lowdb` (persists to disk) |
| `@types/fuse.js` | Unnecessary — `fuse.js` 7.3.0 bundles its own `.d.ts` at `dist/fuse.d.ts`, exposed via `exports["."].types` | Nothing; types are bundled |
| `fastest-levenshtein` | Already transitively available as dep of `fast-levenshtein`; not needed as a direct dep | Use `fuse.js` for the fuzzy ranking use case |

---

## Version Compatibility

| Package | Node | TypeScript | Module System | Notes |
|---------|------|------------|---------------|-------|
| `fuse.js@7.3.0` | `>=10` | Bundled types, no `@types/` needed | ESM (`import`) + CJS (`require`) dual build; Node16 exports map present | Safe for project's `"module": "Node16"` tsconfig |
| `lowdb@7.0.1` | `>=18` | Full generics support | Pure ESM; `./node` subpath for `JSONFilePreset` | Compatible with `"type": "module"` in `mcp-provider-dx-core/package.json` |
| `@salesforce/core@8.28.1` | latest: 8.28.1; constraint `^8.24.3` resolves to latest | `connection.describe()` returns `Promise<DescribeSObjectResult>` from `@jsforce/jsforce-node@3.10.14` types | — | `DescribeSObjectResult.fields[]` and `DescribeSObjectResult.childRelationships[]` are the raw materials for the cache |

---

## Sources

- npm registry API: `fuse.js@7.3.0` — version, exports map, TypeScript types confirmed
- npm registry API: `lowdb@7.0.1` — version, ESM type, `./node` subpath confirmed, engines `node >=18`
- npm registry API: `@salesforce/core@8.28.1` — `fast-levenshtein` as transitive dep confirmed
- npm registry API: `@types/fast-levenshtein@0.0.4` — available if needed
- npm registry API: `write-file-atomic@7.0.1` — not needed; lowdb handles atomicity
- Codebase inspection: `packages/mcp/src/utils/cache.ts` — existing Cache singleton; `CacheContents` type is the extension point
- Codebase inspection: `packages/mcp/src/services.ts` — `ConfigService.getDataDir()` is the correct path resolution API
- Codebase inspection: `packages/mcp-provider-dx-core/src/tools/run_soql_query.ts` — error path already references `salesforce_describe_object`
- Codebase inspection: `packages/mcp/tsconfig.json` → `@salesforce/dev-config/tsconfig.json` — `"module": "Node16"`, `"moduleResolution": "Node16"` confirmed

---
*Stack research for: Salesforce MCP Server v1.3 Smart Schema Cache*
*Researched: 2026-04-12*
