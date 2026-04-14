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
import { McpTool, type McpToolConfig, ReleaseState, type Services, Toolset, toolError, classifyError } from '@dormon/mcp-provider-api';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { textResponse, connectionHeader, requireUsernameOrAlias } from '../shared/utils.js';
import { usernameOrAliasParam } from '../shared/params.js';

const orgOpenParamsSchema = z.object({
  filePath: z
    .string()
    .optional()
    .describe('File path of the metadata to open. This should be an existent file path in the project.'),
  usernameOrAlias: usernameOrAliasParam,
  directory: z.string().optional().describe('Salesforce DX project directory (optional for this tool)'),
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
    const allowedOrgs = (await this.services.getOrgService().getAllowedOrgs()).flatMap((o) => [o.username, ...(o.aliases ?? [])].filter(Boolean) as string[]);
    try {
      requireUsernameOrAlias(allowedOrgs, input.usernameOrAlias);
    } catch (e) {
      return textResponse((e as Error).message, true);
    }

    try {
      const connection = await this.services.getOrgService().getConnection(input.usernameOrAlias);

      const org = await Org.create({
        connection
      })

      if (input.filePath) {
        const metadataResolver = new MetadataResolver();
        const components = metadataResolver.getComponentsFromPath(input.filePath);
        const typeName = components[0]?.type?.name;

        const metadataBuilderUrl = await org.getMetadataUIURL(typeName, input.filePath);
        await open(metadataBuilderUrl);

        const message = metadataBuilderUrl.includes('FlexiPageList')
          ? "Opened the org in your browser. This metadata file doesn't have a builder UI, opened Lightning App Builder instead."
          : 'Opened this metadata in your browser';
        return textResponse(`${connectionHeader(connection)}\n\n${message}`);
      }

      await open(await org.getFrontDoorUrl());

      return textResponse(`${connectionHeader(connection)}\n\nOpened the org in your browser.`);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return toolError(`Failed to open org: ${err.message}`, {
        recovery: 'Verify the org is authenticated and the connection is valid. Try running list_all_orgs first.',
        category: classifyError(err),
      });
    }
  }
}
