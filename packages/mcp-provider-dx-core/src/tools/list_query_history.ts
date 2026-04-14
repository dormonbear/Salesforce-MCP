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
import { McpTool, type McpToolConfig, ReleaseState, type Services, Toolset, toolError, classifyError } from '@dormon/mcp-provider-api';
import { SfError } from '@salesforce/core';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { textResponse } from '../shared/utils.js';
import { usernameOrAliasParam } from '../shared/params.js';
import { QueryHistoryService } from '../schema/query-history-service.js';

export const listQueryHistoryParamsSchema = z.object({
  usernameOrAlias: usernameOrAliasParam,
  objectName: z.string().optional().describe(
    'Optional filter: only return queries for this Salesforce object (e.g., "Account")'
  ),
  limit: z.number().optional().default(10).describe(
    'Maximum number of recent queries to return (default: 10)'
  ),
});

export const listQueryHistoryOutputSchema = z.object({
  queries: z.array(z.object({
    query: z.string(),
    objectName: z.string(),
    timestamp: z.number(),
    fieldCount: z.number(),
  })),
  totalStored: z.number(),
  orgUsername: z.string(),
});

type InputArgs = z.infer<typeof listQueryHistoryParamsSchema>;
type InputArgsShape = typeof listQueryHistoryParamsSchema.shape;
type OutputArgsShape = typeof listQueryHistoryOutputSchema.shape;

export class ListQueryHistoryMcpTool extends McpTool<InputArgsShape, OutputArgsShape> {
  public constructor(
    private readonly services: Services,
    private readonly queryHistoryService: QueryHistoryService,
  ) {
    super();
  }

  public getName(): string {
    return 'salesforce_list_query_history';
  }

  public getReleaseState(): ReleaseState {
    return ReleaseState.GA;
  }

  public getToolsets(): Toolset[] {
    return [Toolset.DATA];
  }

  public getConfig(): McpToolConfig<InputArgsShape, OutputArgsShape> {
    return {
      title: 'List Query History',
      description:
        'List recent successful SOQL queries for a Salesforce org. ' +
        'Use this to discover query patterns and reuse previously successful queries. ' +
        'Results are ordered newest-first.',
      inputSchema: listQueryHistoryParamsSchema.shape,
      outputSchema: listQueryHistoryOutputSchema.shape,
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

      const queries = this.queryHistoryService.list(orgUsername, {
        objectName: input.objectName,
        limit: input.limit,
      });
      const totalStored = this.queryHistoryService.list(orgUsername).length;

      const structured = { queries, totalStored, orgUsername };
      const queryList = queries.length > 0
        ? queries.map((q, i) => `${i + 1}. [${q.objectName}] ${q.query}`).join('\n')
        : 'No query history found for this org.';

      return {
        content: [{ type: 'text' as const, text: `Query history for ${orgUsername} (${queries.length} of ${totalStored} stored):\n\n${queryList}` }],
        structuredContent: structured,
      };
    } catch (error) {
      const sfErr = SfError.wrap(error);
      return toolError(`Failed to list query history: ${sfErr.message}`, {
        recovery: 'Verify the org username or alias is correct.',
        category: classifyError(sfErr),
      });
    }
  }
}
