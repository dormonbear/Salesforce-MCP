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
import { McpTool, type McpToolConfig, type OrgConfigInfo, ReleaseState, type Services, Toolset, toolError, classifyError } from '@dormon/mcp-provider-api';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { type OrgService } from '@dormon/mcp-provider-api';
import { textResponse } from '../shared/utils.js';

import { type ToolTextResponse } from '../shared/types.js';

export async function suggestUsername(orgService: OrgService): Promise<{
  suggestedUsername: string | undefined;
  reasoning: string;
  aliasForReference?: string;
}> {
  let reasoning: string;
  let suggestedUsername: string | undefined;
  let aliasForReference: string | undefined;

  const allAllowedOrgs = await orgService.getAllowedOrgs();

  if (allAllowedOrgs.length === 0) {
    reasoning = 'Error: no allowed orgs found. Check the MCP server startup args for allowlisted orgs.';
  } else if (allAllowedOrgs.length === 1) {
    suggestedUsername = allAllowedOrgs[0].username;
    aliasForReference = allAllowedOrgs[0].aliases?.[0];
    reasoning = 'it was the only org found in the MCP Servers allowlisted orgs';
  } else {
    // Multiple orgs — do NOT auto-select based on global default.
    // Silently binding to the default target-org can route queries to the wrong org (e.g. Live instead of Staging).
    const orgList = allAllowedOrgs.map(o => `${o.aliases?.[0] ?? o.username} (${o.username})`).join(', ');
    reasoning = `Multiple allowed orgs found: ${orgList}. Please ask the user which org to use.`;
  }

  return {
    suggestedUsername,
    aliasForReference,
    reasoning,
  };
}

/*
 * Get username for Salesforce org
 *
 * Intelligently determines the appropriate username or alias for Salesforce operations.
 *
 * Parameters:
 * - defaultTargetOrg: Force lookup of default target org (optional)
 * - defaultDevHub: Force lookup of default dev hub (optional)
 * - directory: The directory to run this tool from
 *
 * Returns:
 * - textResponse: Username/alias and org configuration
 */

export const getUsernameParamsSchema = z.object({
  defaultTargetOrg: z.boolean().optional().default(false).describe('Resolve the default target org username'),
  defaultDevHub: z.boolean().optional().default(false).describe('Resolve the default target devhub org username'),
  directory: z.string().optional().describe('Salesforce DX project directory (optional for this tool)'),
});

type InputArgs = z.infer<typeof getUsernameParamsSchema>;
type InputArgsShape = typeof getUsernameParamsSchema.shape;
type OutputArgsShape = z.ZodRawShape;

export class GetUsernameMcpTool extends McpTool<InputArgsShape, OutputArgsShape> {
  public constructor(private readonly services: Services) {
    super();
  }

  public getReleaseState(): ReleaseState {
    return ReleaseState.GA;
  }

  public getToolsets(): Toolset[] {
    return [Toolset.CORE];
  }

  public getName(): string {
    return 'get_username';
  }

  public getConfig(): McpToolConfig<InputArgsShape, OutputArgsShape> {
    return {
      title: 'Get Username',
      description: `Intelligently determines the appropriate username or alias for Salesforce operations.

WHEN TO USE THIS TOOL:
- When uncertain which org username a user wants for Salesforce operations.

To resolve the default org username, set the defaultTargetOrg param to true and defaultDevHub to false.
To resole the default devhub org username, set the defaultTargetOrg param to false and defaultDevHub to true.
If it's not clear which type of org to resolve, set both defaultTargetOrg and defaultDevHub to false to an allow-listed org username available.
`,
      inputSchema: getUsernameParamsSchema.shape,
      outputSchema: undefined,
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
      const generateResponse = (defaultFromConfig: OrgConfigInfo | undefined): ToolTextResponse =>
        textResponse(`ALWAYS notify the user the following 3 pieces of information:
1. If it is default target-org or target-dev-hub ('.key' on the config)
2. The value of '.location' on the config
3. The value of '.value' on the config

- Full config: ${JSON.stringify(defaultFromConfig, null, 2)}

UNLESS THE USER SPECIFIES OTHERWISE, use this username (.value) for the "usernameOrAlias" parameter in future Tool calls.`);

      const orgService = this.services.getOrgService();
      // Case 1: User explicitly asked for default target org
      if (input.defaultTargetOrg) return generateResponse(await orgService.getDefaultTargetOrg());

      // Case 2: User explicitly asked for default dev hub
      if (input.defaultDevHub) return generateResponse(await orgService.getDefaultTargetDevHub());

      // Case 3: User was vague, so suggest a username
      const { aliasForReference, suggestedUsername, reasoning } = await suggestUsername(orgService);

      if (!suggestedUsername) {
        return textResponse(
          "No suggested username found. Please specify a username or alias explicitly. Also check the MCP server's startup args for allowlisting orgs.",
          true,
        );
      }

      return textResponse(`
YOU MUST inform the user that we are going to use "${suggestedUsername}" ${
        aliasForReference ? `(Alias: ${aliasForReference}) ` : ''
      }for the "usernameOrAlias" parameter.
YOU MUST explain the reasoning for selecting this org, which is: "${reasoning}"
UNLESS THE USER SPECIFIES OTHERWISE, use this username for the "usernameOrAlias" parameter in future Tool calls.`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return toolError(`Failed to determine appropriate username: ${err.message}`, {
        recovery: 'Check that orgs are authorized. Run list_all_orgs to see available orgs, or check MCP server startup args for allowlisted orgs.',
        category: classifyError(err),
      });
    }
  }
}
