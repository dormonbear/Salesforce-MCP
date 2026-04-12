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

import { z } from 'zod';
import { McpTool, McpToolConfig, ReleaseState, Services, Toolset, toolError, classifyError } from '@dormon/mcp-provider-api';
import { SfError } from '@salesforce/core';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { textResponse } from '../shared/utils.js';
import { directoryParam, usernameOrAliasParam, useToolingApiParam } from '../shared/params.js';
import { SchemaService, QueryHistoryService } from '../schema/index.js';
import { SchemaEntryType, type PartialFieldsEntry, type FullDescribeEntry, type RelationshipEdge } from '../schema/types.js';
import { parseSoqlFields } from '../schema/soql-parser.js';
import { findSimilarFields } from '../schema/levenshtein.js';
import { extractRelationshipEdges } from '../schema/relationship-edges.js';

/*
 * Query Salesforce org
 *
 * Run a SOQL query against a Salesforce org.
 *
 * Parameters:
 * - query: SOQL query to run (required)
 * - usernameOrAlias: username or alias for the Salesforce org to run the query against
 *
 * Returns:
 * - textResponse: SOQL query results
 */

export const queryOrgParamsSchema = z.object({
  query: z.string().describe('SOQL query to run'),
  usernameOrAlias: usernameOrAliasParam,
  directory: directoryParam,
  useToolingApi: useToolingApiParam,
});

const queryOutputSchema = z.object({
  totalSize: z.number(),
  done: z.boolean(),
  records: z.array(z.record(z.unknown())),
});

type InputArgs = z.infer<typeof queryOrgParamsSchema>;
type InputArgsShape = typeof queryOrgParamsSchema.shape;
type OutputArgsShape = typeof queryOutputSchema.shape;

export class QueryOrgMcpTool extends McpTool<InputArgsShape, OutputArgsShape> {
  public constructor(
    private readonly services: Services,
    private readonly schemaService: SchemaService,
    private readonly queryHistoryService?: QueryHistoryService,
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
    return 'run_soql_query';
  }

  public getConfig(): McpToolConfig<InputArgsShape, OutputArgsShape> {
    return {
      title: 'Query Org',
      description: 'Run a SOQL query against a Salesforce org.',
      inputSchema: queryOrgParamsSchema.shape,
      outputSchema: queryOutputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    };
  }

  public async exec(input: InputArgs): Promise<CallToolResult> {
    if (!input.usernameOrAlias)
      return textResponse(
        'The usernameOrAlias parameter is required, if the user did not specify one use the #get_username tool',
        true,
      );

    let connection: Awaited<ReturnType<ReturnType<Services['getOrgService']>['getConnection']>>;
    try {
      connection = await this.services.getOrgService().getConnection(input.usernameOrAlias);
    } catch (error) {
      const sfErr = SfError.wrap(error);
      return toolError(`Failed to connect to org: ${sfErr.message}`, {
        recovery: 'Verify the org alias or username is correct and authenticated.',
        category: classifyError(sfErr),
      });
    }

    try {
      const result = input.useToolingApi
        ? await connection.tooling.query(input.query)
        : await connection.query(input.query);

      // Auto-cache: extract object + fields from successful SOQL (ACCH-01)
      // Fire-and-forget — never fail a successful query because of caching (D-08)
      if (!input.useToolingApi) {
        try {
          const parsed = parseSoqlFields(input.query);
          if (parsed) {
            const orgUsername = connection.getUsername() ?? input.usernameOrAlias;
            const existing = this.schemaService.get(orgUsername, parsed.objectName);

            // Never downgrade a full describe to partial
            if (!existing || existing.type === SchemaEntryType.PartialFields) {
              let fieldNames = parsed.fieldNames;
              if (existing?.type === SchemaEntryType.PartialFields) {
                fieldNames = [...new Set([...existing.fieldNames, ...fieldNames])];
              }

              this.schemaService.set(orgUsername, parsed.objectName, {
                type: SchemaEntryType.PartialFields,
                objectName: parsed.objectName,
                fieldNames,
                cachedAt: Date.now(),
              } satisfies PartialFieldsEntry);
            }
          }
        } catch {
          // Silently ignore — caching failure must never fail the query (D-08)
        }
      }

      // Relationship suggestions — only on success, only with cached edges (D-07, D-08, D-09)
      let relSection = '';
      try {
        const parsed = parseSoqlFields(input.query);
        if (parsed) {
          const orgUsername = connection.getUsername() ?? input.usernameOrAlias;
          const edges = this.schemaService.getRelationships(orgUsername, parsed.objectName);
          if (edges?.length) {
            const hints = edges.slice(0, 5).map((e: RelationshipEdge) =>
              `${e.from}.${e.via} -> ${e.to} (${e.type} via ${e.via})`
            );
            relSection = `\n\n_relationships:\n${hints.join('\n')}`;
          }
        }
      } catch {
        // Silent — suggestions must never fail a successful query
      }

      // Query history: record successful non-tooling queries (QHST-01)
      if (!input.useToolingApi && this.queryHistoryService) {
        try {
          const parsed = parseSoqlFields(input.query);
          if (parsed) {
            const orgUsername = connection.getUsername() ?? input.usernameOrAlias;
            this.queryHistoryService.record(orgUsername, input.query, parsed.objectName, parsed.fieldNames.length);
          }
        } catch {
          // Silent — history recording must never fail a successful query
        }
      }

      const structured = { totalSize: result.totalSize, done: result.done, records: result.records };
      return {
        content: [{ type: 'text' as const, text: `SOQL query results:\n\n${JSON.stringify(result, null, 2)}${relSection}` }],
        structuredContent: structured,
      };
    } catch (error) {
      const sfErr = SfError.wrap(error);

      if (sfErr.message.endsWith('is not supported.')) {
        const hint = input.useToolingApi
          ? 'Try setting useToolingApi to false for this query.'
          : 'Try setting useToolingApi to true for this query.';
        return toolError(`SOQL query failed: ${sfErr.message}`, {
          recovery: hint,
          category: 'user',
        });
      }

      // INVALID_FIELD recovery — auto-describe + fuzzy match suggestions (FAIL-01..04)
      if (sfErr.name === 'INVALID_FIELD' || /No such column '\w+' on entity '\w+'/i.test(sfErr.message)) {
        const fieldMatch = sfErr.message.match(/No such column '(\w+)' on entity '(\w+)'/i);
        if (fieldMatch) {
          const [, invalidField, objectName] = fieldMatch;
          try {
            const orgUsername = connection.getUsername() ?? input.usernameOrAlias;

            // Invalidate partial entry so describeAndCache does a full describe
            const cached = this.schemaService.get(orgUsername, objectName);
            if (cached && cached.type !== SchemaEntryType.FullDescribe) {
              this.schemaService.invalidate(orgUsername, objectName);
            }

            // Auto-describe — single-flight coalesced + cached (FAIL-01, FAIL-04)
            const entry = await this.schemaService.describeAndCache(
              orgUsername,
              objectName,
              async () => ({
                type: SchemaEntryType.FullDescribe,
                data: (await connection.describe(objectName)) as unknown as Record<string, unknown>,
                cachedAt: Date.now(),
              } satisfies FullDescribeEntry),
            );

            // Fire-and-forget: extract edges from recovery describe (D-05, RELG-01)
            try {
              if (entry.type === SchemaEntryType.FullDescribe) {
                const recoveryEdges = extractRelationshipEdges(objectName, (entry as FullDescribeEntry).data);
                if (recoveryEdges.length > 0) {
                  this.schemaService.setRelationships(orgUsername, objectName, recoveryEdges);
                }
              }
            } catch {
              // Silent — edge extraction must never fail the recovery path
            }

            // Fuzzy match field suggestions (FAIL-02, FAIL-03)
            if (entry.type === SchemaEntryType.FullDescribe) {
              const allFields = (entry.data.fields as Array<{ name: string }>).map(f => f.name);
              const suggestions = findSimilarFields(invalidField, allFields, 3);
              const recovery = suggestions.length > 0
                ? `Did you mean: ${suggestions.join(', ')}?`
                : 'Use salesforce_describe_object to verify available fields on the target object.';
              return toolError(`Failed to query org: ${sfErr.message}`, { recovery, category: 'user' });
            }
          } catch {
            // Describe failed — fall through to generic error (D-05)
          }
        }
      }

      const recovery = sfErr.actions?.join(' ')
        ?? 'Check the SOQL syntax and field names. Use salesforce_describe_object to verify available fields on the target object.';

      return toolError(`Failed to query org: ${sfErr.message}`, {
        recovery,
        category: classifyError(sfErr),
      });
    }
  }
}
