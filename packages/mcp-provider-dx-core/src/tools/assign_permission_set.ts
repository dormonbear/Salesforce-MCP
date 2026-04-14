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
import { Org, SfError, StateAggregator, User } from '@salesforce/core';
import { McpTool, type McpToolConfig, ReleaseState, type Services, Toolset, toolError, classifyError } from '@dormon/mcp-provider-api';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { usernameOrAliasParam } from '../shared/params.js';
import { textResponse, connectionHeader, requireUsernameOrAlias } from '../shared/utils.js';

/*
 * Assign permission set
 *
 * Assign a permission set to one or more org users.
 *
 * Parameters:
 * - permissionSetName: Permission set to assign (required)
 *   Example: "Set the permission set MyPermSet", "Set the perm set MyPermSet"
 * - usernameOrAlias: Username or alias for the Salesforce org (required)
 * - onBehalfOf: Username or alias to assign the permission set to (optional)
 *   Note: This is only used when "on behalf of" is explicitly mentioned.
 *   Otherwise, the permission will be set to the usernameOrAlias user.
 *   Example: "Set the permission set MyPermSet on behalf of my-alias"
 *
 * Returns:
 * - textResponse: Permission set assignment result
 */

export const assignPermissionSetParamsSchema = z.object({
  permissionSetName: z.string().describe(`A single permission set to assign

EXAMPLE USAGE:
Set the permission set MyPermSet
Set the perm set MyPermSet`),
  usernameOrAlias: usernameOrAliasParam,
  onBehalfOf: z.string().optional()
    .describe(`A single username or alias (other than the usernameOrAlias) to assign the permission set to

AGENT INSTRUCTIONS:
If the user does not specifically say "on behalf of" this will be empty.
If the user does specifically say "on behalf of", but it is unclear what the target-org is, run the #get_username tool.
In that case, use the usernameOrAlias parameter as the org to assign the permission set to.

USAGE EXAMPLE:
Assign the permission set MyPermSet.
Set the permission set MyPermSet on behalf of test-3uyb8kmftiu@example.com.
Set the permission set MyPermSet on behalf of my-alias.`),
  directory: z.string().optional().describe('Salesforce DX project directory (optional for this tool)'),
});

const assignPermSetOutputSchema = z.object({
  permissionSetName: z.string(),
  assignedTo: z.string(),
});

type InputArgs = z.infer<typeof assignPermissionSetParamsSchema>;
type InputArgsShape = typeof assignPermissionSetParamsSchema.shape;
type OutputArgsShape = typeof assignPermSetOutputSchema.shape;

export class AssignPermissionSetMcpTool extends McpTool<InputArgsShape, OutputArgsShape> {
  public constructor(private readonly services: Services) {
    super();
  }

  public getReleaseState(): ReleaseState {
    return ReleaseState.GA;
  }

  public getToolsets(): Toolset[] {
    return [Toolset.USERS];
  }

  public getName(): string {
    return 'assign_permission_set';
  }

  public getConfig(): McpToolConfig<InputArgsShape, OutputArgsShape> {
    return {
      title: 'Assign Permission Set',
      description: 'Assign a permission set to one or more org users.',
      inputSchema: assignPermissionSetParamsSchema.shape,
      outputSchema: assignPermSetOutputSchema.shape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    };
  }

  public async exec(input: InputArgs): Promise<CallToolResult> {
    const allowedOrgs = (await this.services.getOrgService().getAllowedOrgs()).flatMap((o) => [o.username, ...(o.aliases ?? [])].filter(Boolean) as string[]);
    try {
      requireUsernameOrAlias(allowedOrgs, input.usernameOrAlias);
    } catch (e) {
      return textResponse((e as Error).message, true);
    }

    try {
      // We build the connection from the usernameOrAlias
      const connection = await this.services.getOrgService().getConnection(input.usernameOrAlias);

      // We need to clear the instance so we know we have the most up to date aliases
      // If a user sets an alias after server start up, it was not getting picked up
      await StateAggregator.clearInstanceAsync();
      // Must NOT be nullish coalescing (??) In case the LLM uses and empty string
      const assignTo = (await StateAggregator.getInstance()).aliases.resolveUsername(
        input.onBehalfOf || input.usernameOrAlias,
      );

      if (!assignTo.includes('@')) {
        return textResponse('Unable to resolve the username for alias. Make sure it is correct', true);
      }

      const org = await Org.create({ connection });
      const user = await User.create({ org });
      const queryResult = await connection.singleRecordQuery<{ Id: string }>(
        `SELECT Id FROM User WHERE Username='${assignTo}'`,
      );

      await user.assignPermissionSets(queryResult.Id, [input.permissionSetName]);

      return {
        content: [{ type: 'text' as const, text: `${connectionHeader(connection)}\n\nAssigned ${input.permissionSetName} to ${assignTo}` }],
        structuredContent: { permissionSetName: input.permissionSetName, assignedTo: assignTo },
      };
    } catch (error) {
      const err = SfError.wrap(error);

      const recovery = err.actions?.join(' ')
        ?? 'Verify the permission set name is correct. Use run_soql_query with "SELECT Name FROM PermissionSet WHERE IsOwnedByProfile = false" to list assignable permission sets.';

      return toolError(`Failed to assign permission set: ${err.message}`, {
        recovery,
        category: classifyError(err),
      });
    }
  }
}
