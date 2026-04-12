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

import type { SchemaEntry } from './types.js';

export type SchemaServiceOptions = {
  ttlMs?: number;
};

/**
 * In-memory schema cache with per-org LRU isolation, configurable TTL,
 * and single-flight request coalescing.
 *
 * Stub — implementation pending (TDD RED phase).
 */
export class SchemaService {
  public onMutation?: () => void;

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public constructor(_options?: SchemaServiceOptions) {
    // stub
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public get(_orgUsername: string, _objectName: string): SchemaEntry | undefined {
    return undefined;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public set(_orgUsername: string, _objectName: string, _entry: SchemaEntry): void {
    // stub
  }

  public async describeAndCache(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _orgUsername: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _objectName: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _describeFn: () => Promise<SchemaEntry>,
  ): Promise<SchemaEntry> {
    throw new Error('Not implemented');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public invalidate(_orgUsername: string, _objectName: string): boolean {
    return false;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public invalidateOrg(_orgUsername: string): void {
    // stub
  }

  public clear(): void {
    // stub
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public getOrgCacheSize(_orgUsername: string): number {
    return 0;
  }

  public getAllOrgUsernames(): string[] {
    return [];
  }
}
