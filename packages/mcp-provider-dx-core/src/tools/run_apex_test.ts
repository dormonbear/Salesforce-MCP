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
import { TestLevel, TestResult, TestRunIdResult, TestService } from '@salesforce/apex-node';
import { ApexTestResultOutcome } from '@salesforce/apex-node/lib/src/tests/types.js';
import { Duration, ensureArray } from '@salesforce/kit';
import { McpTool, type McpToolConfig, ReleaseState, type Services, Toolset, toolError, classifyError } from '@dormon/mcp-provider-api';
import { SfError } from '@salesforce/core';
import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { usernameOrAliasParam } from '../shared/params.js';
import { textResponse, connectionHeader, requireUsernameOrAlias } from '../shared/utils.js';

/*
 * Run Apex tests in a Salesforce org.
 *
 * Parameters:
 * - testLevel: 'RunSpecifiedTests', 'RunLocalTests', 'RunAllTestsInOrg', used to specify the specific test-level.
 * - classNames: if testLevel='RunSpecifiedTests', this will be the specified tests to run
 * - usernameOrAlias: Username or alias of the Salesforce org to run tests in.
 * - directory: Directory of the local project.
 *
 * Returns:
 * - textResponse: Test result.
 */

export const runApexTestsParam = z.object({
  testLevel: z.enum([TestLevel.RunLocalTests, TestLevel.RunAllTestsInOrg, TestLevel.RunSpecifiedTests]).describe(
    `Apex test level

AGENT INSTRUCTIONS
Choose the correct value based on what tests are meant to be executed in some of these ways:

RunLocalTests="Run all tests in the org, except the ones that originate from installed managed and unlocked packages."
RunAllTestsInOrg="Run all tests in the org, including tests of managed packages"
RunSpecifiedTests="Run the Apex tests I specify, these will be specified in the classNames parameter"
`,
  ),
  classNames: z
    .array(z.string())
    .describe(
      `Apex tests classes to run.
            if Running all tests, all tests should be listed
            Run the tests, find apex classes matching the pattern **/classes/*.cls, that include the @isTest decorator in the file and then join their test names together with ','
`,
    )
    .optional(),
  methodNames: z
    .array(z.string())
    .describe(
      'Specific test method names, functions inside of an apex test class, must be joined with the Apex tests name',
    )
    .optional(),
  async: z
    .boolean()
    .default(false)
    .describe(
      'Weather to wait for the test to finish (false) or enque the Apex tests and return the test run id (true)',
    ),
  suiteName: z.string().describe('a suite of apex test classes to run').optional(),
  testRunId: z.string().default('an id of an in-progress, or completed apex test run').optional(),
  verbose: z
    .boolean()
    .default(false)
    .describe('If a user wants more test information in the context, or information about passing tests'),
  codeCoverage: z
    .boolean()
    .default(false)
    .describe('set to true if a user wants codecoverage calculated by the server'),
  usernameOrAlias: usernameOrAliasParam,
  directory: z.string().optional().describe('Salesforce DX project directory (optional for this tool)'),
});

const apexTestOutputSchema = z.object({
  testRunId: z.string().optional(),
  summary: z.object({
    outcome: z.string().optional(),
    testsRan: z.number().optional(),
    passing: z.number().optional(),
    failing: z.number().optional(),
    skipped: z.number().optional(),
    passRate: z.string().optional(),
    failRate: z.string().optional(),
    testExecutionTimeInMs: z.number().optional(),
    orgId: z.string().optional(),
  }).optional(),
  tests: z.array(z.record(z.unknown())).optional(),
});

type InputArgs = z.infer<typeof runApexTestsParam>;
type InputArgsShape = typeof runApexTestsParam.shape;
type OutputArgsShape = typeof apexTestOutputSchema.shape;

export class TestApexMcpTool extends McpTool<InputArgsShape, OutputArgsShape> {
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
    return 'run_apex_test';
  }

  public getConfig(): McpToolConfig<InputArgsShape, OutputArgsShape> {
    return {
      title: 'Apex Tests',
      description: `Run Apex tests in an org.

AGENT INSTRUCTIONS:
If the user doesn't specify what to test, take context from the currently open file
This will ONLY run APEX tests, NOT agent tests, lightning tests, flow tests, or any other type of test.

this should be chosen when a file in the 'classes' directory is mentioned

EXAMPLE USAGE:
Run tests A, B, C.
Run the myTestMethod in this file
Run this test and include success and failures
Run all tests in the org.
Test the "mySuite" suite asynchronously. I’ll check results later.
Run tests for this file and include coverage
What are the results for 707XXXXXXXXXXXX`,
      inputSchema: runApexTestsParam.shape,
      outputSchema: apexTestOutputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    };
  }

  public async exec(input: InputArgs): Promise<CallToolResult> {
    if (
      (ensureArray(input.suiteName).length >= 1 ||
        ensureArray(input.methodNames).length >= 1 ||
        ensureArray(input.classNames).length >= 1) &&
      input.testLevel !== TestLevel.RunSpecifiedTests
    ) {
      return textResponse("You can't specify which tests to run without setting testLevel='RunSpecifiedTests'", true);
    }

    const allowedOrgs = (await this.services.getOrgService().getAllowedOrgs()).flatMap((o) => [o.username, ...(o.aliases ?? [])].filter(Boolean) as string[]);
    try {
      requireUsernameOrAlias(allowedOrgs, input.usernameOrAlias);
    } catch (e) {
      return textResponse((e as Error).message, true);
    }

    const connection = await this.services.getOrgService().getConnection(input.usernameOrAlias);
    try {
      const testService = new TestService(connection);
      let result: TestResult | TestRunIdResult;

      if (input.testRunId) {
        // we just need to get the test results
        result = await testService.reportAsyncResults(input.testRunId, input.codeCoverage);
      } else {
        // we need to run tests
        const payload = await testService.buildAsyncPayload(
          input.testLevel,
          input.methodNames?.join(','),
          input.classNames?.join(','),
          input.suiteName,
        );
        result = await testService.runTestAsynchronous(
          payload,
          input.codeCoverage,
          input.async,
          undefined,
          undefined,
          Duration.minutes(10),
        );
        if (input.async) {
          const asyncResult = result as TestRunIdResult;
          return {
            content: [{ type: 'text' as const, text: `${connectionHeader(connection)}\n\nTest Run Id: ${JSON.stringify(result)}` }],
            structuredContent: { testRunId: asyncResult.testRunId },
          };
        }
        // the user waited for the full results, we know they're TestResult
        result = result as TestResult;
      }

      if (!input.verbose) {
        // aka concise, filter out passing tests
        result.tests = result.tests.filter((test) => test.outcome === ApexTestResultOutcome.Fail);
      }

      return {
        content: [{ type: 'text' as const, text: `${connectionHeader(connection)}\n\nTest result: ${JSON.stringify(result)}` }],
        structuredContent: {
          testRunId: result.summary?.testRunId,
          summary: result.summary ? {
            outcome: result.summary.outcome,
            testsRan: result.summary.testsRan,
            passing: result.summary.passing,
            failing: result.summary.failing,
            skipped: result.summary.skipped,
            passRate: result.summary.passRate,
            failRate: result.summary.failRate,
            testExecutionTimeInMs: result.summary.testExecutionTimeInMs,
            orgId: result.summary.orgId,
          } : undefined,
          tests: result.tests as Record<string, unknown>[],
        },
      };
    } catch (e) {
      const err = SfError.wrap(e);
      const recovery = err.actions?.join(' ')
        ?? 'Verify the test class names exist in the org. Use run_soql_query with "SELECT Name FROM ApexClass WHERE Name IN (\'ClassName\')" to confirm.';

      return toolError(`Failed to run Apex tests: ${err.message}`, {
        recovery,
        category: classifyError(err),
      });
    }
  }
}
