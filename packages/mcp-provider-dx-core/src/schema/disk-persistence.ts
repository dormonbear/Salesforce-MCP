/*
 * Copyright 2026, Salesforce, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { mkdir, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { SchemaEntry } from './types.js';

export type SchemaDiskPersistenceOptions = {
  dataDir: string;
  ttlMs: number;
  debounceMs?: number;
};

type CacheFileContent = {
  entries: Record<string, SchemaEntry>;
  savedAt: number;
};

const DEFAULT_DEBOUNCE_MS = 5000;

/**
 * Persists schema cache entries to per-org JSON files on disk.
 *
 * - Files are stored at {dataDir}/schema-cache/{orgUsername}.json
 * - Writes are debounced to avoid I/O storms from frequent cache mutations
 * - On load, TTL-expired entries are discarded
 * - All disk I/O is non-fatal: errors are logged but never thrown to callers
 * - Path traversal protection: orgUsernames containing / or \ are rejected
 */
export class SchemaDiskPersistence {
  private readonly cacheDir: string;
  private readonly ttlMs: number;
  private readonly debounceMs: number;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly pendingOrgs: Set<string> = new Set();
  private readonly getEntriesCallbacks: Map<string, () => Map<string, SchemaEntry>> = new Map();

  public constructor(options: SchemaDiskPersistenceOptions) {
    this.cacheDir = join(options.dataDir, 'schema-cache');
    this.ttlMs = options.ttlMs;
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  /**
   * Save entries for an org to disk.
   * Auto-creates the cache directory if it doesn't exist.
   */
  public async saveOrg(orgUsername: string, entries: Map<string, SchemaEntry>): Promise<void> {
    if (this.hasPathTraversal(orgUsername)) {
      return;
    }

    try {
      await mkdir(this.cacheDir, { recursive: true });
      const data: CacheFileContent = {
        entries: Object.fromEntries(entries),
        savedAt: Date.now(),
      };
      const filePath = join(this.cacheDir, orgUsername + '.json');
      await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Disk write failures are non-fatal
    }
  }

  /**
   * Load entries for an org from disk, discarding TTL-expired entries.
   * Returns empty Map on missing file, corrupted JSON, or path traversal.
   */
  public async loadOrg(orgUsername: string): Promise<Map<string, SchemaEntry>> {
    if (this.hasPathTraversal(orgUsername)) {
      return new Map();
    }

    try {
      const filePath = join(this.cacheDir, orgUsername + '.json');
      const raw = await readFile(filePath, 'utf-8');
      const data: CacheFileContent = JSON.parse(raw);

      const now = Date.now();
      const result = new Map<string, SchemaEntry>();
      for (const [key, entry] of Object.entries(data.entries)) {
        if (now - entry.cachedAt <= this.ttlMs) {
          result.set(key, entry);
        }
      }
      return result;
    } catch {
      // ENOENT, parse error, or any other issue — graceful degradation
      return new Map();
    }
  }

  /**
   * Load all org cache files from disk. Returns Map of orgUsername → entries,
   * with TTL-expired entries discarded. Skips orgs with empty results.
   */
  public async loadAll(): Promise<Map<string, Map<string, SchemaEntry>>> {
    const result = new Map<string, Map<string, SchemaEntry>>();

    try {
      const files = await readdir(this.cacheDir);
      const jsonFiles = files.filter((f) => f.endsWith('.json'));

      for (const file of jsonFiles) {
        const orgUsername = file.slice(0, -5); // strip .json
        const entries = await this.loadOrg(orgUsername);
        if (entries.size > 0) {
          result.set(orgUsername, entries);
        }
      }
    } catch {
      // Directory doesn't exist or unreadable — return empty
    }

    return result;
  }

  /**
   * Schedule a debounced save for an org.
   * Multiple calls within the debounce window are coalesced into a single write.
   */
  public scheduleSave(orgUsername: string, getEntries: () => Map<string, SchemaEntry>): void {
    this.pendingOrgs.add(orgUsername);
    this.getEntriesCallbacks.set(orgUsername, getEntries);

    if (this.pendingTimer !== null) {
      return; // Timer already set, coalesce
    }

    this.pendingTimer = setTimeout(() => {
      void this.executeSave();
    }, this.debounceMs);
  }

  /**
   * Immediately flush all pending saves, bypassing the debounce timer.
   */
  public async flush(): Promise<void> {
    if (this.pendingTimer !== null) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }

    await this.executeSave();
  }

  /**
   * Execute saves for all pending orgs.
   */
  private async executeSave(): Promise<void> {
    this.pendingTimer = null;
    const orgs = new Set(this.pendingOrgs);
    const callbacks = new Map(this.getEntriesCallbacks);
    this.pendingOrgs.clear();
    this.getEntriesCallbacks.clear();

    for (const org of orgs) {
      const getEntries = callbacks.get(org);
      if (getEntries) {
        try {
          await this.saveOrg(org, getEntries());
        } catch {
          // Non-fatal: disk write failure is acceptable
        }
      }
    }
  }

  /**
   * Check if an orgUsername contains path traversal characters.
   */
  private hasPathTraversal(orgUsername: string): boolean {
    return orgUsername.includes('/') || orgUsername.includes('\\');
  }
}
