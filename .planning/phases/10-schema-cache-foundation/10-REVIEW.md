---
phase: 10-schema-cache-foundation
reviewed: 2025-07-14T20:30:00Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - packages/mcp-provider-dx-core/src/schema/types.ts
  - packages/mcp-provider-dx-core/src/schema/schema-service.ts
  - packages/mcp-provider-dx-core/src/schema/index.ts
  - packages/mcp-provider-dx-core/src/schema/disk-persistence.ts
  - packages/mcp-provider-dx-core/src/index.ts
  - packages/mcp-provider-dx-core/test/unit/schema/schema-service.test.ts
  - packages/mcp-provider-dx-core/test/unit/schema/disk-persistence.test.ts
  - packages/mcp-provider-dx-core/test/unit/schema/schema-integration.test.ts
  - packages/mcp-provider-dx-core/package.json
findings:
  critical: 0
  warning: 3
  info: 2
  total: 5
status: issues_found
---

# Phase 10: Code Review Report

**Reviewed:** 2025-07-14T20:30:00Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found

## Summary

This review covers the new schema cache foundation: type definitions, an in-memory LRU cache service with per-org isolation and single-flight coalescing, optional disk persistence with debounced writes, provider integration, and comprehensive unit/integration tests.

Overall the implementation is well-structured. Types are clean, the LRU + single-flight pattern is correctly implemented, disk persistence is properly non-fatal with path traversal protection, and test coverage is thorough. Three warnings were found: an unguarded `parseInt` that can silently disable TTL enforcement, a SIGTERM handler that captures a stale closure on re-initialization, and `invalidateOrg`/`clear` not persisting deletions to disk. Two minor info items are also noted.

## Warnings

### WR-01: `parseInt` without NaN guard silently disables cache TTL

**File:** `packages/mcp-provider-dx-core/src/schema/schema-service.ts:54-55`
**Issue:** When `SF_SCHEMA_CACHE_TTL_MINUTES` is set to a non-numeric value (e.g., `"abc"`), `parseInt("abc", 10)` returns `NaN`. This produces `NaN * 60_000 = NaN`, which is passed to the LRU cache as its `ttl` option. In `lru-cache` v11, a `NaN` TTL is treated as "no TTL" — entries never expire. This silently disables cache expiration with no error or log, which could cause stale schema data to persist indefinitely.
**Fix:**
```typescript
const envTtl = process.env.SF_SCHEMA_CACHE_TTL_MINUTES;
if (envTtl !== undefined && envTtl !== '') {
  const parsed = parseInt(envTtl, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    // Fall through to default TTL — invalid env var is ignored
    this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  } else {
    this.ttlMs = parsed * 60_000;
  }
} else {
  this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
}
```

### WR-02: SIGTERM handler captures stale SchemaService closure

**File:** `packages/mcp-provider-dx-core/src/index.ts:89-95`
**Issue:** The SIGTERM handler captures the local `schemaService` variable via closure. If `provideTools()` is called again (e.g., during a provider reconnect), `this.schemaService` is updated to a new instance on line 84, but `this.sigTermRegistered` prevents registering a new SIGTERM handler. The existing handler still references the old `SchemaService` instance from the first invocation. On SIGTERM, only the stale first instance would be flushed — the active instance's pending writes would be lost.
**Fix:** Reference `this.schemaService` inside the handler instead of the closure-captured local variable:
```typescript
if (!this.sigTermRegistered) {
  this.sigTermRegistered = true;
  process.on('SIGTERM', () => {
    void this.schemaService?.shutdown();
  });
}
```

### WR-03: `invalidateOrg` and `clear` don't persist deletion to disk

**File:** `packages/mcp-provider-dx-core/src/schema/schema-service.ts:150-152` and `157-159`
**Issue:** `invalidateOrg()` removes all in-memory entries for an org but does not notify the persistence layer or delete the org's JSON file from disk. Similarly, `clear()` removes all in-memory caches but leaves all disk files intact. After a process restart, `loadFromDisk()` reloads the "invalidated" entries from the still-present JSON files, effectively undoing the user's explicit invalidation.

This creates a confusing behavior: `invalidateOrg("user@org.com")` appears to work (in-memory cache is cleared), but the entries silently reappear on the next startup.
**Fix:** Either (a) schedule a save with an empty map to overwrite the file, or (b) delete the org's JSON file. Option (a) is simpler since it uses existing infrastructure:
```typescript
public invalidateOrg(orgUsername: string): void {
  this.orgCaches.delete(orgUsername);
  // Persist the deletion: overwrite disk file with empty entries
  if (this.persistence) {
    this.persistence.scheduleSave(orgUsername, () => new Map());
  }
  this.onMutation?.();
}

public clear(): void {
  const orgs = Array.from(this.orgCaches.keys());
  this.orgCaches.clear();
  // Persist the deletion for all orgs
  if (this.persistence) {
    for (const org of orgs) {
      this.persistence.scheduleSave(org, () => new Map());
    }
  }
}
```

## Info

### IN-01: Duplicate license header

**File:** `packages/mcp-provider-dx-core/src/index.ts:1-31`
**Issue:** The Apache 2.0 license comment block appears twice consecutively at the top of the file (lines 1–15 and lines 17–31). This is a copy-paste artifact.
**Fix:** Remove the duplicate block (lines 17–31).

### IN-02: Unvalidated JSON shape on disk load

**File:** `packages/mcp-provider-dx-core/src/schema/disk-persistence.ts:91`
**Issue:** `JSON.parse(raw)` is type-asserted to `CacheFileContent` without runtime schema validation. If the file was manually edited or corrupted in a way that produces valid JSON but wrong shape (e.g., `entries` is `null` or a non-object), `Object.entries(data.entries)` would throw. This is currently safe because the outer `try/catch` handles the exception gracefully (returns empty Map), but adding minimal shape validation would make the code more robust and self-documenting.
**Fix:** Add a lightweight guard before iterating:
```typescript
if (!data || typeof data.entries !== 'object' || data.entries === null) {
  return new Map();
}
```

---

_Reviewed: 2025-07-14T20:30:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
