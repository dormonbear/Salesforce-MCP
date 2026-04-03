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

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { McpTool, McpToolConfig, ReleaseState, Services, Toolset } from '@salesforce/mcp-provider-api';
import { textResponse } from '../shared/utils.js';

export class GetOrgInfoMcpTool extends McpTool<Record<string, never>> {
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

  public getConfig(): McpToolConfig<Record<string, never>> {
    return {
      title: 'Get Org Info',
      description:
        'Returns a list of all authorized Salesforce orgs, their aliases, usernames, instance URLs, and permission levels. ' +
        'Use this tool to discover which orgs are available before performing operations.',
      inputSchema: {} as Record<string, never>,
      outputSchema: undefined,
      annotations: {
        openWorldHint: false,
        readOnlyHint: true,
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

      return textResponse(JSON.stringify(result, null, 2));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return textResponse(`Failed to retrieve org info: ${errorMessage}`, true);
    }
  }
}
