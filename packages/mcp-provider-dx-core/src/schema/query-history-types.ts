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

export type QueryHistoryEntry = {
  query: string;
  objectName: string;
  timestamp: number;
  fieldCount: number;
};

export class RingBuffer<T> {
  private readonly buffer: (T | undefined)[];
  private writeIndex = 0;
  private count = 0;

  public constructor(private readonly capacity: number) {
    this.buffer = new Array<T | undefined>(capacity).fill(undefined);
  }

  public push(item: T): void {
    this.buffer[this.writeIndex] = item;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  /** Return entries newest-first */
  public toArray(): T[] {
    const result: T[] = [];
    for (let i = 0; i < this.count; i++) {
      const idx = (this.writeIndex - 1 - i + this.capacity) % this.capacity;
      result.push(this.buffer[idx] as T);
    }
    return result;
  }

  public get size(): number {
    return this.count;
  }
}
