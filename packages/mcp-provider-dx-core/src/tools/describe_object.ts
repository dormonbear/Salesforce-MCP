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

/*
 * Describe Salesforce Object
 *
 * Retrieve schema metadata for a Salesforce object including fields,
 * relationships, and record key prefix.
 *
 * Parameters:
 * - objectName: API name of the Salesforce sObject (required)
 * - usernameOrAlias: username or alias for the Salesforce org
 *
 * Returns:
 * - structuredContent: Curated schema metadata with cache transparency via _meta
 */

import { z } from 'zod';
import { McpTool, McpToolConfig, ReleaseState, Services, Toolset, toolError, classifyError } from '@dormon/mcp-provider-api';
import { SfError } from '@salesforce/core';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { textResponse } from '../shared/utils.js';
import { usernameOrAliasParam } from '../shared/params.js';
import { SchemaService } from '../schema/index.js';
import { SchemaEntryType, type FullDescribeEntry, type SchemaEntry, type RelationshipEdge } from '../schema/types.js';
import { extractRelationshipEdges } from '../schema/relationship-edges.js';

export const describeObjectParamsSchema = z.object({
  objectName: z.string().describe(
    'The API name of the Salesforce sObject to describe (e.g., "Account", "Contact", "Custom_Object__c")'
  ),
  usernameOrAlias: usernameOrAliasParam,
});

export const describeObjectOutputSchema = z.object({
  objectName: z.string(),
  label: z.string(),
  keyPrefix: z.string().nullable(),
  fieldCount: z.number(),
  fields: z.array(z.object({
    name: z.string(),
    label: z.string(),
    type: z.string(),
    filterable: z.boolean(),
    updateable: z.boolean(),
    nillable: z.boolean(),
  })),
  childRelationships: z.array(z.object({
    relationshipName: z.string().nullable(),
    childSObject: z.string(),
    field: z.string(),
  })),
  lookupFields: z.array(z.object({
    fieldName: z.string(),
    referenceTo: z.array(z.string()),
    relationshipName: z.string().nullable(),
  })),
  relationships: z.array(z.object({
    from: z.string(),
    to: z.string(),
    via: z.string(),
    type: z.enum(['lookup', 'master-detail']),
  })).optional().default([]),
  _meta: z.object({
    source: z.enum(['cache', 'api']),
    cachedAt: z.number(),
    ageMs: z.number(),
    indicator: z.enum(['full', 'partial']),
  }),
});

type InputArgs = z.infer<typeof describeObjectParamsSchema>;
type InputArgsShape = typeof describeObjectParamsSchema.shape;
type OutputArgsShape = typeof describeObjectOutputSchema.shape;
type CuratedDescribeResult = z.infer<typeof describeObjectOutputSchema>;

function curateDescribeResult(entry: SchemaEntry, isCacheHit: boolean, relationships: RelationshipEdge[] = []): CuratedDescribeResult {
  const data = (entry as FullDescribeEntry).data;
  const fields = (data.fields as Array<Record<string, unknown>>) ?? [];
  const childRels = (data.childRelationships as Array<Record<string, unknown>>) ?? [];

  const curatedFields = fields.map(f => ({
    name: f.name as string,
    label: f.label as string,
    type: f.type as string,
    filterable: f.filterable as boolean,
    updateable: f.updateable as boolean,
    nillable: f.nillable as boolean,
  }));

  const lookupFields = fields
    .filter(f => Array.isArray(f.referenceTo) && (f.referenceTo as string[]).length > 0)
    .map(f => ({
      fieldName: f.name as string,
      referenceTo: f.referenceTo as string[],
      relationshipName: (f.relationshipName as string) ?? null,
    }));

  return {
    objectName: data.name as string,
    label: data.label as string,
    keyPrefix: (data.keyPrefix as string) ?? null,
    fieldCount: curatedFields.length,
    fields: curatedFields,
    childRelationships: childRels.map(cr => ({
      relationshipName: (cr.relationshipName as string) ?? null,
      childSObject: cr.childSObject as string,
      field: cr.field as string,
    })),
    lookupFields,
    relationships,
    _meta: {
      source: isCacheHit ? 'cache' as const : 'api' as const,
      cachedAt: entry.cachedAt,
      ageMs: Date.now() - entry.cachedAt,
      indicator: 'full' as const,
    },
  };
}

export class DescribeObjectMcpTool extends McpTool<InputArgsShape, OutputArgsShape> {
  public constructor(
    private readonly services: Services,
    private readonly schemaService: SchemaService,
  ) {
    super();
  }

  public getReleaseState(): ReleaseState {
    return ReleaseState.GA;
  }

  public getToolsets(): Toolset[] {
    return [Toolset.DATA];
  }

  public getName(): string {
    return 'salesforce_describe_object';
  }

  public getConfig(): McpToolConfig<InputArgsShape, OutputArgsShape> {
    return {
      title: 'Describe Object',
      description:
        'Retrieve schema metadata for a Salesforce object including fields, relationships, and record key prefix. ' +
        'Recommended before writing SOQL queries against unfamiliar objects to verify available fields and relationships.',
      inputSchema: describeObjectParamsSchema.shape,
      outputSchema: describeObjectOutputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    };
  }

  public async exec(input: InputArgs): Promise<CallToolResult> {
    if (!input.usernameOrAlias) {
      return textResponse(
        'The usernameOrAlias parameter is required, if the user did not specify one use the #get_username tool',
        true,
      );
    }

    try {
      const connection = await this.services.getOrgService().getConnection(input.usernameOrAlias);
      const orgUsername = connection.getUsername() ?? input.usernameOrAlias;

      // Check cache first to determine source metadata
      const cached = this.schemaService.get(orgUsername, input.objectName);
      const isCacheHit = cached !== undefined && cached.type === SchemaEntryType.FullDescribe;

      // Invalidate partial/non-full entries so describeAndCache fetches from API (ACCH-03)
      if (cached && cached.type !== SchemaEntryType.FullDescribe) {
        this.schemaService.invalidate(orgUsername, input.objectName);
      }

      // describeAndCache handles cache-first + single-flight coalescing
      const entry = await this.schemaService.describeAndCache(
        orgUsername,
        input.objectName,
        async () => ({
          type: SchemaEntryType.FullDescribe,
          data: (await connection.describe(input.objectName)) as unknown as Record<string, unknown>,
          cachedAt: Date.now(),
        } satisfies FullDescribeEntry),
      );

      // Fire-and-forget: extract and cache relationship edges (RELG-01, RELG-02, D-05)
      let relationships: RelationshipEdge[] = [];
      try {
        if (entry.type === SchemaEntryType.FullDescribe) {
          const edges = extractRelationshipEdges(input.objectName, (entry as FullDescribeEntry).data);
          relationships = edges;
          if (edges.length > 0) {
            this.schemaService.setRelationships(orgUsername, input.objectName, edges);
          }
        }
      } catch {
        // Silently ignore — edge extraction must never fail the describe (D-05)
      }

      const curated = curateDescribeResult(entry, isCacheHit, relationships);

      return {
        content: [{ type: 'text' as const, text: `Schema for ${curated.objectName} (${curated.fieldCount} fields):\n\n${JSON.stringify(curated, null, 2)}` }],
        structuredContent: curated,
      };
    } catch (error) {
      const sfErr = SfError.wrap(error);
      return toolError(`Failed to describe object "${input.objectName}": ${sfErr.message}`, {
        recovery: 'Verify the object API name is correct (e.g., "Account", "Contact", "Custom_Object__c"). Standard objects use PascalCase; custom objects end with "__c".',
        category: classifyError(sfErr),
      });
    }
  }
}
