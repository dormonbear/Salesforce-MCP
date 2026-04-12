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

/**
 * Standard Wagner-Fischer Levenshtein distance with single-row space optimization.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Ensure shorter string is in inner loop for O(min(a,b)) space
  if (a.length > b.length) [a, b] = [b, a];

  const row = Array.from({ length: a.length + 1 }, (_, i) => i);

  for (let j = 1; j <= b.length; j++) {
    let prev = row[0];
    row[0] = j;
    for (let i = 1; i <= a.length; i++) {
      const temp = row[i];
      row[i] = a[i - 1] === b[j - 1]
        ? prev
        : 1 + Math.min(prev, row[i], row[i - 1]);
      prev = temp;
    }
  }

  return row[a.length];
}

/**
 * Find field names similar to `needle` using Levenshtein distance.
 * Returns up to `maxResults` names sorted by ascending distance.
 * Comparison is case-insensitive; returned names preserve original casing.
 */
export function findSimilarFields(needle: string, fieldNames: string[], maxResults: number = 3): string[] {
  if (!fieldNames.length) return [];

  const needleLower = needle.toLowerCase();
  const threshold = Math.max(Math.ceil(needle.length * 0.6), 3);

  return fieldNames
    .map((name) => ({ name, distance: levenshtein(needleLower, name.toLowerCase()) }))
    .filter((item) => item.distance <= threshold)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, maxResults)
    .map((item) => item.name);
}
