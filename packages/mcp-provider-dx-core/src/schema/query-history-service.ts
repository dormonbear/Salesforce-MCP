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

import { RingBuffer, type QueryHistoryEntry } from './query-history-types.js';

const DEFAULT_LIMIT = 50;

export class QueryHistoryService {
  private readonly orgBuffers: Map<string, RingBuffer<QueryHistoryEntry>>;
  private readonly limit: number;

  public constructor(limit?: number) {
    const envLimit = process.env.SF_QUERY_HISTORY_LIMIT;
    if (envLimit !== undefined && envLimit !== '') {
      const parsed = parseInt(envLimit, 10);
      this.limit = !isNaN(parsed) && parsed > 0 ? parsed : DEFAULT_LIMIT;
    } else {
      this.limit = limit ?? DEFAULT_LIMIT;
    }
    this.orgBuffers = new Map();
  }

  public record(orgUsername: string, query: string, objectName: string, fieldCount: number): void {
    let buffer = this.orgBuffers.get(orgUsername);
    if (!buffer) {
      buffer = new RingBuffer<QueryHistoryEntry>(this.limit);
      this.orgBuffers.set(orgUsername, buffer);
    }
    buffer.push({ query, objectName, timestamp: Date.now(), fieldCount });
  }

  public list(orgUsername: string, options?: { objectName?: string; limit?: number }): QueryHistoryEntry[] {
    const buffer = this.orgBuffers.get(orgUsername);
    if (!buffer) return [];
    let entries = buffer.toArray();
    if (options?.objectName) {
      entries = entries.filter(e => e.objectName.toLowerCase() === options.objectName!.toLowerCase());
    }
    if (options?.limit !== undefined && options.limit >= 0) {
      entries = entries.slice(0, options.limit);
    }
    return entries;
  }

  public getLimit(): number {
    return this.limit;
  }
}
