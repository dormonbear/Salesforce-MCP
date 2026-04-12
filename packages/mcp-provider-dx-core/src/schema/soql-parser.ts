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

export type ParsedSoql = {
  objectName: string;
  fieldNames: string[];
};

/**
 * Lightweight regex-based SOQL parser that extracts the object name and field names
 * from flat SELECT...FROM queries. Returns null for complex queries (subqueries,
 * aggregates, GROUP BY, TYPEOF) — never throws.
 */
export function parseSoqlFields(query: string): ParsedSoql | null {
  if (!query || !query.trim()) return null;

  // Bail out for complex queries that need a full AST parser
  if (/\(\s*SELECT\b/i.test(query)) return null;          // subqueries
  if (/\b(COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(query)) return null; // aggregates
  if (/\bGROUP\s+BY\b/i.test(query)) return null;
  if (/\bTYPEOF\b/i.test(query)) return null;
  if (/\bHAVING\b/i.test(query)) return null;

  // Extract SELECT <fields> FROM <object>
  const match = query.match(/^\s*SELECT\s+([\s\S]+?)\s+FROM\s+(\w+)/i);
  if (!match) return null;

  const rawFields = match[1];
  const objectName = match[2];

  // Parse field list: split on commas, strip aliases (take first token), filter dotted names
  const fieldNames = rawFields
    .split(',')
    .map((f) => f.trim().split(/\s+/)[0])
    .filter((f) => f && !f.includes('.'));

  if (fieldNames.length === 0) return null;

  return { objectName, fieldNames };
}
