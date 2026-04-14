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
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpTool, type McpToolConfig, ReleaseState, type Services, Toolset, toolError, classifyError } from '@dormon/mcp-provider-api';

const getOrgInfoOutputSchema = z.object({
  defaultOrg: z.string(),
  authorizedOrgs: z.array(z.object({
    alias: z.string(),
    username: z.string(),
    instanceUrl: z.string(),
    orgId: z.string(),
  })),
});

type OutputArgsShape = typeof getOrgInfoOutputSchema.shape;

export class GetOrgInfoMcpTool extends McpTool<Record<string, never>, OutputArgsShape> {
  private services: Services;

  public constructor(services: Services) {
    super();
    this.services = services;
  }

  public getReleaseState(): ReleaseState {
    return ReleaseState.GA;
  }

  public getToolsets(): Toolset[] {
    return [Toolset.CORE];
  }

  public getName(): string {
    return 'salesforce_get_org_info';
  }

  public getConfig(): McpToolConfig<Record<string, never>, OutputArgsShape> {
    return {
      title: 'Get Org Info',
      description:
        'Returns a list of all authorized Salesforce orgs, their aliases, usernames, instance URLs, and permission levels. ' +
        'Use this tool to discover which orgs are available before performing operations.',
      inputSchema: {} as Record<string, never>,
      outputSchema: getOrgInfoOutputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    };
  }

  public async exec(): Promise<CallToolResult> {
    try {
      const orgService = this.services.getOrgService();
      const allOrgs = await orgService.getAllowedOrgs();
      const defaultOrg = await orgService.getDefaultTargetOrg();

      const orgList = allOrgs.map((org) => ({
        alias: org.aliases?.join(', ') ?? '',
        username: org.username,
        instanceUrl: org.instanceUrl,
        orgId: org.orgId,
      }));

      const result = {
        defaultOrg: defaultOrg ?? 'none',
        authorizedOrgs: orgList,
      };

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        structuredContent: result,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return toolError(`Failed to retrieve org info: ${err.message}`, {
        recovery: 'Check that orgs are authorized. Re-authenticate expired orgs with "sf org login".',
        category: classifyError(err),
      });
    }
  }
}
