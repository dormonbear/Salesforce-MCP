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

export const SchemaEntryType = {
  FullDescribe: 'full-describe',
  PartialFields: 'partial-fields',
  RelationshipEdges: 'relationship-edges',
} as const;

export type RelationshipEdge = {
  from: string;
  to: string;
  via: string;
  type: 'lookup' | 'master-detail';
};

export type FullDescribeEntry = {
  type: typeof SchemaEntryType.FullDescribe;
  data: Record<string, unknown>; // DescribeSObjectResult from @salesforce/core
  cachedAt: number;
};

export type PartialFieldsEntry = {
  type: typeof SchemaEntryType.PartialFields;
  objectName: string;
  fieldNames: string[];
  cachedAt: number;
};

export type RelationshipEdgesEntry = {
  type: typeof SchemaEntryType.RelationshipEdges;
  edges: RelationshipEdge[];
  cachedAt: number;
};

export type SchemaEntry = FullDescribeEntry | PartialFieldsEntry | RelationshipEdgesEntry;
