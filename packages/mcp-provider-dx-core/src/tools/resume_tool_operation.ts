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
import { AgentTester } from '@salesforce/agents';
import { Connection, SfError, validateSalesforceId, scratchOrgResume, PollingClient, StatusResult } from '@salesforce/core';
import { Duration } from '@salesforce/kit';
import { MetadataApiDeploy } from '@salesforce/source-deploy-retrieve';
import { McpTool, type McpToolConfig, ReleaseState, type Services, Toolset, toolError, classifyError } from '@dormon/mcp-provider-api';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { ensureString } from '@salesforce/ts-types';
import { textResponse, connectionHeader, requireUsernameOrAlias } from '../shared/utils.js';
import { usernameOrAliasParam } from '../shared/params.js';


const resumableIdPrefixes = new Map<string, string>([
  ['deploy', '0Af'],
  ['scratchOrg', '2SR'],
  ['agentTest', '4KB'],
  ['orgSnapshot', '0Oo'],
]);

/*
 * Resume a long running operation that was not completed by another tool.
 *
 * Intelligently determines the appropriate username or alias for Salesforce operations.
 *
 * Parameters:
 * - jobId: The job id of the long running operation to resume (required)
 * - wait: The amount of time to wait for the operation to complete in minutes (optional)
 * - defaultTargetOrg: Force lookup of default target org (optional)
 * - directory: The directory to run this tool from
 *
 * Returns:
 * - textResponse: Username/alias and org configuration
 */
export const resumeParamsSchema = z.object({
  jobId: z.string().describe('The job id of the long running operation to resume (required)'),
  wait: z
    .number()
    .optional()
    .default(30)
    .describe('The amount of time to wait for the operation to complete in minutes (optional)'),
  usernameOrAlias: usernameOrAliasParam,
  directory: z.string().optional().describe('Salesforce DX project directory (optional for this tool)'),
});

type InputArgs = z.infer<typeof resumeParamsSchema>;
type InputArgsShape = typeof resumeParamsSchema.shape;
type OutputArgsShape = z.ZodRawShape;

export class ResumeMcpTool extends McpTool<InputArgsShape, OutputArgsShape> {
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
    return 'resume_tool_operation';
  }

  public getConfig(): McpToolConfig<InputArgsShape, OutputArgsShape> {
    return {
      title: 'Resume',
      description: `Resume a long running operation that was not completed by another tool.

AGENT INSTRUCTIONS:
Use this tool to resume a long running operation.

EXAMPLE USAGE:
Resume the metadata deploy job 0Af1234567890
Resume the deployment and wait for 10 minutes
Resume the deployment to my org
Resume scratch org creation
Resume job 2SR1234567890
Resume agent tests
Resume org snapshot with ID 0OoKa000000XZAbKAO
Report on my org snapshot`,
      inputSchema: resumeParamsSchema.shape,
      outputSchema: undefined,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    };
  }

  public async exec(input: InputArgs): Promise<CallToolResult> {
    if (!input.jobId) {
      return textResponse('The jobId parameter is required.', true);
    }

    if (!validateSalesforceId(input.jobId)) {
      return textResponse('The jobId parameter is not a valid Salesforce id.', true);
    }

    const allowedOrgs = (await this.services.getOrgService().getAllowedOrgs()).flatMap((o) => [o.username, ...(o.aliases ?? [])].filter(Boolean) as string[]);
    try {
      requireUsernameOrAlias(allowedOrgs, input.usernameOrAlias);
    } catch (e) {
      return textResponse((e as Error).message, true);
    }

    const connection = await this.services.getOrgService().getConnection(input.usernameOrAlias);

    let result: CallToolResult;
    switch (input.jobId.substring(0, 3)) {
      case resumableIdPrefixes.get('deploy'):
        result = await resumeDeployment(connection, input.jobId, input.wait);
        break;
      case resumableIdPrefixes.get('scratchOrg'):
        result = await resumeScratchOrg(input.jobId, input.wait);
        break;
      case resumableIdPrefixes.get('agentTest'):
        result = await resumeAgentTest(connection, input.jobId, input.wait);
        break;
      case resumableIdPrefixes.get('orgSnapshot'):
        result = await resumeOrgSnapshot(connection, input.jobId, input.wait);
        break;
      default:
        return textResponse(`The job id: ${input.jobId} is not resumeable.`, true);
    }

    if (!result.isError && result.content?.[0] && 'text' in result.content[0]) {
      result.content[0].text = `${connectionHeader(connection)}\n\n${result.content[0].text}`;
    }
    return result;
  }
}

async function resumeDeployment(connection: Connection, jobId: string, wait: number): Promise<CallToolResult> {
  try {
    const deploy = new MetadataApiDeploy({ usernameOrConnection: connection, id: jobId });
    const result = await deploy.pollStatus({ timeout: Duration.minutes(wait) });
    return textResponse(`Deploy result: ${JSON.stringify(result.response)}`, !result.response.success);
  } catch (error) {
    const err = SfError.wrap(error);
    const recovery = err.actions?.join(' ')
      ?? 'Verify the deploy jobId is correct (starts with 0Af). The deployment may have been canceled or the org session expired.';
    return toolError(`Resumed deployment failed: ${err.message}`, {
      recovery,
      category: classifyError(err),
    });
  }
}

async function resumeOrgSnapshot(connection: Connection, jobId: string, wait: number): Promise<CallToolResult> {
  try {
    const poller = await PollingClient.create({
      timeout: Duration.minutes(wait),
      frequency: Duration.seconds(30),
      poll: async (): Promise<StatusResult> => {
        const queryResult = await connection.singleRecordQuery<{
          Status: 'Active' | 'Error' | 'Expired' | 'In Progress' | 'New';
        }>(
          `SELECT Status, Id, SnapshotName, Description, ExpirationDate, CreatedDate FROM OrgSnapshot WHERE Id = '${jobId}'`,
        );
        if (queryResult.Status !== 'In Progress') {
          // either done or error
          return { completed: true, payload: queryResult };
        } else {
          return { completed: false };
        }
      },
    });
    const result = await poller.subscribe();
    return textResponse(`Org snapshot: ${JSON.stringify(result)}`);
  } catch (error) {
    const err = SfError.wrap(error);
    const recovery = err.actions?.join(' ')
      ?? 'Verify the snapshot ID is correct (starts with 0Oo). Check that Org Snapshots are enabled in the org.';
    return toolError(`Resumed org snapshot failed: ${err.message}`, {
      recovery,
      category: classifyError(err),
    });
  }
}

async function resumeScratchOrg(jobId: string, wait: number): Promise<CallToolResult> {
  try {
    const result = await scratchOrgResume(jobId, Duration.minutes(wait));
    return textResponse(`Successfully created scratch org, username: ${ensureString(result.username)}`);
  } catch (error) {
    const err = SfError.wrap(error);
    const recovery = err.actions?.join(' ')
      ?? 'Verify the scratch org request ID is correct (starts with 2SR). The Dev Hub org session may have expired.';
    return toolError(`Resumed scratch org creation failed: ${err.message}`, {
      recovery,
      category: classifyError(err),
    });
  }
}

async function resumeAgentTest(connection: Connection, jobId: string, wait: number): Promise<CallToolResult> {
  try {
    const agentTester = new AgentTester(connection);
    const result = await agentTester.poll(jobId, { timeout: Duration.minutes(wait) });
    return textResponse(`Agent test result: ${JSON.stringify(result)}`, !!result.errorMessage);
  } catch (error) {
    const err = SfError.wrap(error);
    const recovery = err.actions?.join(' ')
      ?? 'Verify the agent test run ID is correct (starts with 4KB). The test may have been canceled.';
    return toolError(`Resumed agent test failed: ${err.message}`, {
      recovery,
      category: classifyError(err),
    });
  }
}
