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

import type { RelationshipEdge } from './types.js';

/**
 * Extract relationship edges from a Salesforce describe result.
 *
 * Produces outbound edges from fields[].referenceTo[] (always 'lookup')
 * and inbound edges from childRelationships[] (lookup or master-detail
 * based on cascadeDelete). Skips entries with null relationshipName.
 */
export function extractRelationshipEdges(
  objectName: string,
  describeData: Record<string, unknown>
): RelationshipEdge[] {
  const edges: RelationshipEdge[] = [];

  // Outbound: fields with referenceTo (D-04 outbound)
  const fields = (describeData.fields as Array<Record<string, unknown>>) ?? [];
  for (const field of fields) {
    const referenceTo = field.referenceTo as string[] | undefined;
    const relationshipName = field.relationshipName as string | null;
    const fieldName = field.name as string;

    if (!referenceTo?.length || !relationshipName) continue; // D-11

    for (const target of referenceTo) { // D-10: one edge per polymorphic target
      edges.push({
        from: objectName,
        to: target,
        via: fieldName,
        type: 'lookup', // outbound edges are always lookup (no cascadeDelete on fields)
      });
    }
  }

  // Inbound: childRelationships (D-04 inbound)
  const childRels = (describeData.childRelationships as Array<Record<string, unknown>>) ?? [];
  for (const cr of childRels) {
    const relationshipName = cr.relationshipName as string | null;
    if (!relationshipName) continue; // D-11

    edges.push({
      from: cr.childSObject as string,
      to: objectName,
      via: cr.field as string,
      type: cr.cascadeDelete === true ? 'master-detail' : 'lookup', // D-02
    });
  }

  return edges;
}
