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
import { Org } from '@salesforce/core';
import { MetadataResolver } from '@salesforce/source-deploy-retrieve';
import open from 'open';
import { McpTool, McpToolConfig, ReleaseState, Services, Toolset } from '@salesforce/mcp-provider-api';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { textResponse, connectionHeader, requireUsernameOrAlias } from '../shared/utils.js';
import { usernameOrAliasParam } from '../shared/params.js';

const orgOpenParamsSchema = z.object({
  filePath: z
    .string()
    .optional()
    .describe('File path of the metadata to open. This should be an existent file path in the project.'),
  usernameOrAlias: usernameOrAliasParam,
  directory: z.string().optional().describe('OPTIONAL — not required to open an org in the browser.'),
});

type InputArgs = z.infer<typeof orgOpenParamsSchema>;
type InputArgsShape = typeof orgOpenParamsSchema.shape;
type OutputArgsShape = z.ZodRawShape;

export class OrgOpenMcpTool extends McpTool<InputArgsShape, OutputArgsShape> {
  public constructor(private readonly services: Services) {
    super();
  }

  public getReleaseState(): ReleaseState {
    return ReleaseState.NON_GA;
  }

  public getToolsets(): Toolset[] {
    return [Toolset.ORGS];
  }

  public getName(): string {
    return 'open_org';
  }

  public getConfig(): McpToolConfig<InputArgsShape, OutputArgsShape> {
    return {
      title: 'Open Org in Browser',
      description: `Open a Salesforce org in the browser.

You can specify a metadata file you want to open.`,
      inputSchema: orgOpenParamsSchema.shape,
      outputSchema: undefined,
      annotations: {
        readOnlyHint: true,
        openWorldHint: false,
      },
    };
  }

  public async exec(input: InputArgs): Promise<CallToolResult> {
    try {
      const orgService = this.services.getOrgService();
      const allowedOrgs = (await orgService.getAllowedOrgs()).flatMap((o) => [
        ...(o.aliases ?? []),
        ...(o.username ? [o.username] : []),
      ]);
      let usernameOrAlias: string;
      try {
        usernameOrAlias = requireUsernameOrAlias(allowedOrgs, input.usernameOrAlias);
      } catch (e) {
        return textResponse(e instanceof Error ? e.message : String(e), true);
      }
      const connection = await orgService.getConnection(usernameOrAlias);
      const org = await Org.create({ connection });

      if (input.filePath) {
        const metadataResolver = new MetadataResolver();
        const components = metadataResolver.getComponentsFromPath(input.filePath);
        const typeName = components[0]?.type?.name;
        const metadataBuilderUrl = await org.getMetadataUIURL(typeName, input.filePath);
        await open(metadataBuilderUrl);
        return textResponse(
          `${connectionHeader(connection)}\n\n${
            metadataBuilderUrl.includes('FlexiPageList')
              ? "Opened the org in your browser. This metadata file doesn't have a builder UI, opened Lightning App Builder instead."
              : 'Opened this metadata in your browser'
          }`,
        );
      }

      await open(await org.getFrontDoorUrl());
      return textResponse(`${connectionHeader(connection)}\n\nOpened the org in your browser.`);
    } catch (error) {
      return textResponse(`Failed to open org: ${error instanceof Error ? error.message : 'Unknown error'}`, true);
    }
  }
}
