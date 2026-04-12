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
import { Duration } from '@salesforce/kit';
import { McpTool, McpToolConfig, ReleaseState, Services, Toolset, toolError, classifyError } from '@dormon/mcp-provider-api';
import { SfError } from '@salesforce/core';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { directoryParam, usernameOrAliasParam } from '../shared/params.js';
import { textResponse } from '../shared/utils.js';

/*
 * Run Agent tests in a Salesforce org.
 *
 * Parameters:
 * - agentApiName: this will be the aiEvaluationDefinition's name
 * - usernameOrAlias: Username or alias of the Salesforce org to run tests in.
 * - directory: Directory of the local project.
 *
 * Returns:
 * - textResponse: Test result.
 */

const runAgentTestsParam = z.object({
  agentApiName: z.string().describe(
    `Agent test to run
            if unsure, list all files matching the pattern **/aiEvaluationDefinitions/*.aiEvaluationDefinition-meta.xml
            only one test can be executed at a time
`,
  ),
  usernameOrAlias: usernameOrAliasParam,
  directory: directoryParam,
  async: z
    .boolean()
    .default(false)
    .describe('Whether to wait for the tests to finish (false) or quickly return only the test id (true)'),
});

const agentTestOutputSchema = z.object({
  runId: z.string().optional(),
  status: z.string().optional(),
  startTime: z.string().optional(),
  endTime: z.string().optional(),
  testCases: z.array(z.record(z.unknown())).optional(),
});

type InputArgs = z.infer<typeof runAgentTestsParam>;
type InputArgsShape = typeof runAgentTestsParam.shape;
type OutputArgsShape = typeof agentTestOutputSchema.shape;

export class TestAgentsMcpTool extends McpTool<InputArgsShape, OutputArgsShape> {
  public constructor(private readonly services: Services) {
    super();
  }

  public getReleaseState(): ReleaseState {
    return ReleaseState.GA;
  }

  public getToolsets(): Toolset[] {
    return [Toolset.TESTING];
  }

  public getName(): string {
    return 'run_agent_test';
  }

  public getConfig(): McpToolConfig<InputArgsShape, OutputArgsShape> {
    return {
      title: 'Run Agent Tests',
      description: `Run Agent tests in an org.

AGENT INSTRUCTIONS:
If the user doesn't specify what to test, take context from the currently open file
This will ONLY run Agent tests, NOT apex tests, lightning tests, flow tests, or any other type of test.

this should be chosen when a file in the 'aiEvaluationDefinitions' directory is mentioned

EXAMPLE USAGE:
Run tests for the X agent
Run this test
start myAgentTest and don't wait for results`,
      inputSchema: runAgentTestsParam.shape,
      outputSchema: agentTestOutputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    };
  }

  public async exec(input: InputArgs): Promise<CallToolResult> {
    if (!input.usernameOrAlias)
      return textResponse(
        'The usernameOrAlias parameter is required, if the user did not specify one use the #get_username tool',
        true,
      );

    const connection = await this.services.getOrgService().getConnection(input.usernameOrAlias);

    try {
      const agentTester = new AgentTester(connection);

      if (input.async) {
        const startResult = await agentTester.start(input.agentApiName);
        return {
          content: [{ type: 'text' as const, text: `Test Run: ${JSON.stringify(startResult)}` }],
          structuredContent: startResult as Record<string, unknown>,
        };
      } else {
        const test = await agentTester.start(input.agentApiName);
        const result = await agentTester.poll(test.runId, { timeout: Duration.minutes(10) });
        return {
          content: [{ type: 'text' as const, text: `Test result: ${JSON.stringify(result)}` }],
          structuredContent: result as Record<string, unknown>,
        };
      }
    } catch (e) {
      const err = SfError.wrap(e);
      const recovery = err.actions?.join(' ')
        ?? 'Verify the agentApiName matches an aiEvaluationDefinition in the org. List files matching **/aiEvaluationDefinitions/*.aiEvaluationDefinition-meta.xml to check.';

      return toolError(`Failed to run agent tests: ${err.message}`, {
        recovery,
        category: classifyError(err),
      });
    }
  }
}
