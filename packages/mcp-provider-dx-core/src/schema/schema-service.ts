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

import { LRUCache } from 'lru-cache';
import type { SchemaEntry } from './types.js';

export type SchemaServiceOptions = {
  ttlMs?: number;
};

const DEFAULT_TTL_MS = 3_600_000; // 1 hour
const MAX_ENTRIES_PER_ORG = 100;

/**
 * In-memory schema cache with per-org LRU isolation, configurable TTL,
 * and single-flight request coalescing.
 *
 * - Each org gets its own LRUCache (keyed by canonical username)
 * - Object names are normalized to lowercase for case-insensitive lookups
 * - TTL defaults to 1 hour, overridable via SF_SCHEMA_CACHE_TTL_MINUTES env var or constructor option
 * - describeAndCache deduplicates concurrent API calls for the same org+object
 */
export class SchemaService {
  public onMutation?: () => void;

  private readonly orgCaches: Map<string, LRUCache<string, SchemaEntry>>;
  private readonly inFlight: Map<string, Promise<SchemaEntry>>;
  private readonly ttlMs: number;

  public constructor(options?: SchemaServiceOptions) {
    this.orgCaches = new Map();
    this.inFlight = new Map();

    // SF_SCHEMA_CACHE_TTL_MINUTES env var takes precedence
    const envTtl = process.env.SF_SCHEMA_CACHE_TTL_MINUTES;
    if (envTtl !== undefined && envTtl !== '') {
      this.ttlMs = parseInt(envTtl, 10) * 60_000;
    } else {
      this.ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
    }
  }

  /**
   * Get a cached schema entry for the given org and object.
   * Returns undefined on cache miss or TTL expiry.
   */
  public get(orgUsername: string, objectName: string): SchemaEntry | undefined {
    const cache = this.orgCaches.get(orgUsername);
    if (!cache) {
      return undefined;
    }
    return cache.get(objectName.toLowerCase());
  }

  /**
   * Store a schema entry in the cache for the given org and object.
   */
  public set(orgUsername: string, objectName: string, entry: SchemaEntry): void {
    const cache = this.getOrCreateOrgCache(orgUsername);
    cache.set(objectName.toLowerCase(), entry);
    this.onMutation?.();
  }

  /**
   * Describe and cache with single-flight coalescing.
   * If a describe is already in-flight for the same org+object, returns the existing promise.
   * Otherwise invokes describeFn, caches the result, and returns it.
   */
  public async describeAndCache(
    orgUsername: string,
    objectName: string,
    describeFn: () => Promise<SchemaEntry>,
  ): Promise<SchemaEntry> {
    // Check cache first
    const cached = this.get(orgUsername, objectName);
    if (cached) {
      return cached;
    }

    // Build flight key for single-flight coalescing
    const flightKey = orgUsername + ':' + objectName.toLowerCase();

    // Check if there's already an in-flight request
    const existing = this.inFlight.get(flightKey);
    if (existing) {
      return existing;
    }

    // Create new in-flight promise
    const promise = describeFn()
      .then((entry) => {
        this.set(orgUsername, objectName, entry);
        return entry;
      })
      .finally(() => {
        this.inFlight.delete(flightKey);
      });

    this.inFlight.set(flightKey, promise);
    return promise;
  }

  /**
   * Remove a single cached entry. Returns true if the entry existed.
   */
  public invalidate(orgUsername: string, objectName: string): boolean {
    const cache = this.orgCaches.get(orgUsername);
    if (!cache) {
      return false;
    }
    const deleted = cache.delete(objectName.toLowerCase());
    if (deleted) {
      this.onMutation?.();
    }
    return deleted;
  }

  /**
   * Remove all cached entries for an org.
   */
  public invalidateOrg(orgUsername: string): void {
    this.orgCaches.delete(orgUsername);
  }

  /**
   * Clear all cached entries for all orgs.
   */
  public clear(): void {
    this.orgCaches.clear();
  }

  /**
   * Get the number of cached entries for an org (for testing/monitoring).
   */
  public getOrgCacheSize(orgUsername: string): number {
    const cache = this.orgCaches.get(orgUsername);
    if (!cache) {
      return 0;
    }
    return cache.size;
  }

  /**
   * Get all org usernames that have cached entries (for disk persistence).
   */
  public getAllOrgUsernames(): string[] {
    return Array.from(this.orgCaches.keys());
  }

  /**
   * Get or create the LRU cache for a specific org.
   */
  private getOrCreateOrgCache(orgUsername: string): LRUCache<string, SchemaEntry> {
    let cache = this.orgCaches.get(orgUsername);
    if (!cache) {
      cache = new LRUCache<string, SchemaEntry>({
        max: MAX_ENTRIES_PER_ORG,
        ttl: this.ttlMs,
      });
      this.orgCaches.set(orgUsername, cache);
    }
    return cache;
  }
}
