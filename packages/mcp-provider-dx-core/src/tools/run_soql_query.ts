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
import { McpTool, McpToolConfig, ReleaseState, Services, Toolset, toolError, classifyError } from '@salesforce/mcp-provider-api';
import { SfError } from '@salesforce/core';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { textResponse } from '../shared/utils.js';
import { directoryParam, usernameOrAliasParam, useToolingApiParam } from '../shared/params.js';

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
  public constructor(private readonly services: Services) {
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
    try {
      if (!input.usernameOrAlias)
        return textResponse(
          'The usernameOrAlias parameter is required, if the user did not specify one use the #get_username tool',
          true,
        );
      const connection = await this.services.getOrgService().getConnection(input.usernameOrAlias);
      const result = input.useToolingApi
        ? await connection.tooling.query(input.query)
        : await connection.query(input.query);

      const structured = { totalSize: result.totalSize, done: result.done, records: result.records };
      return {
        content: [{ type: 'text' as const, text: `SOQL query results:\n\n${JSON.stringify(result, null, 2)}` }],
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

      const recovery = sfErr.actions?.join(' ')
        ?? 'Check the SOQL syntax and field names. Use salesforce_describe_object to verify available fields on the target object.';

      return toolError(`Failed to query org: ${sfErr.message}`, {
        recovery,
        category: classifyError(sfErr),
      });
    }
  }
}
