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
import { expect } from 'chai';
import { z } from 'zod';
import { Services } from '@salesforce/mcp-provider-api';
import { QueryOrgMcpTool } from '../../src/tools/run_soql_query.js';
import { ListAllOrgsMcpTool } from '../../src/tools/list_all_orgs.js';
import { GetOrgInfoMcpTool } from '../../src/tools/get_org_info.js';
import { TestApexMcpTool } from '../../src/tools/run_apex_test.js';
import { TestAgentsMcpTool } from '../../src/tools/run_agent_test.js';
import { AssignPermissionSetMcpTool } from '../../src/tools/assign_permission_set.js';

describe('structured output schemas', () => {
  const mockServices = {} as Services;

  describe('run_soql_query', () => {
    const tool = new QueryOrgMcpTool(mockServices);
    const config = tool.getConfig();
    const schema = z.object(config.outputSchema!);

    it('should expose an outputSchema in getConfig', () => {
      expect(config.outputSchema).to.not.be.undefined;
    });

    it('should validate valid SOQL query output', () => {
      const valid = {
        totalSize: 3,
        done: true,
        records: [
          { Id: '001xx000003GYRAA2', Name: 'Acme' },
          { Id: '001xx000003GYRAB2', Name: 'GlobalCorp' },
          { Id: '001xx000003GYRAC2', Name: 'United' },
        ],
      };
      const result = schema.safeParse(valid);
      expect(result.success).to.be.true;
    });

    it('should reject invalid SOQL query output', () => {
      const invalid = { totalSize: 'not a number', done: true, records: [] };
      const result = schema.safeParse(invalid);
      expect(result.success).to.be.false;
    });
  });

  describe('list_all_orgs', () => {
    const tool = new ListAllOrgsMcpTool(mockServices);
    const config = tool.getConfig();
    const schema = z.object(config.outputSchema!);

    it('should expose an outputSchema in getConfig', () => {
      expect(config.outputSchema).to.not.be.undefined;
    });

    it('should validate valid org list output', () => {
      const valid = {
        orgs: [
          {
            username: 'user@example.com',
            aliases: ['my-org'],
            instanceUrl: 'https://na1.salesforce.com',
            orgId: '00Dxx0000001234',
            isScratchOrg: false,
            isDevHub: true,
            isSandbox: false,
            isExpired: false,
          },
        ],
      };
      const result = schema.safeParse(valid);
      expect(result.success).to.be.true;
    });

    it('should accept orgs with minimal fields', () => {
      const minimal = { orgs: [{}] };
      const result = schema.safeParse(minimal);
      expect(result.success).to.be.true;
    });

    it('should reject invalid org list output', () => {
      const invalid = { orgs: 'not an array' };
      const result = schema.safeParse(invalid);
      expect(result.success).to.be.false;
    });
  });

  describe('salesforce_get_org_info', () => {
    const tool = new GetOrgInfoMcpTool(mockServices);
    const config = tool.getConfig();
    const schema = z.object(config.outputSchema!);

    it('should expose an outputSchema in getConfig', () => {
      expect(config.outputSchema).to.not.be.undefined;
    });

    it('should validate valid org info output', () => {
      const valid = {
        defaultOrg: 'user@example.com',
        authorizedOrgs: [
          {
            alias: 'my-org',
            username: 'user@example.com',
            instanceUrl: 'https://na1.salesforce.com',
            orgId: '00Dxx0000001234',
          },
        ],
      };
      const result = schema.safeParse(valid);
      expect(result.success).to.be.true;
    });

    it('should reject missing required fields', () => {
      const invalid = { defaultOrg: 'user@example.com' };
      const result = schema.safeParse(invalid);
      expect(result.success).to.be.false;
    });
  });

  describe('run_apex_test', () => {
    const tool = new TestApexMcpTool(mockServices);
    const config = tool.getConfig();
    const schema = z.object(config.outputSchema!);

    it('should expose an outputSchema in getConfig', () => {
      expect(config.outputSchema).to.not.be.undefined;
    });

    it('should validate async test run output (testRunId only)', () => {
      const valid = { testRunId: '707xx0000001234' };
      const result = schema.safeParse(valid);
      expect(result.success).to.be.true;
    });

    it('should validate full test result output', () => {
      const valid = {
        testRunId: '707xx0000001234',
        summary: {
          outcome: 'Pass',
          testsRan: 5,
          passing: 4,
          failing: 1,
          skipped: 0,
          passRate: '80%',
          failRate: '20%',
          testExecutionTimeInMs: 1234,
          orgId: '00Dxx0000001234',
        },
        tests: [
          { fullName: 'MyTest.testMethod1', outcome: 'Pass' },
          { fullName: 'MyTest.testMethod2', outcome: 'Fail', message: 'assertion failed' },
        ],
      };
      const result = schema.safeParse(valid);
      expect(result.success).to.be.true;
    });

    it('should reject invalid summary fields', () => {
      const invalid = { summary: { testsRan: 'not a number' } };
      const result = schema.safeParse(invalid);
      expect(result.success).to.be.false;
    });
  });

  describe('run_agent_test', () => {
    const tool = new TestAgentsMcpTool(mockServices);
    const config = tool.getConfig();
    const schema = z.object(config.outputSchema!);

    it('should expose an outputSchema in getConfig', () => {
      expect(config.outputSchema).to.not.be.undefined;
    });

    it('should validate valid agent test output', () => {
      const valid = {
        runId: 'run-123',
        status: 'Completed',
        startTime: '2026-04-11T10:00:00Z',
        endTime: '2026-04-11T10:05:00Z',
        testCases: [
          { name: 'case1', status: 'Passed' },
        ],
      };
      const result = schema.safeParse(valid);
      expect(result.success).to.be.true;
    });

    it('should accept empty object (all fields optional)', () => {
      const result = schema.safeParse({});
      expect(result.success).to.be.true;
    });
  });

  describe('assign_permission_set', () => {
    const tool = new AssignPermissionSetMcpTool(mockServices);
    const config = tool.getConfig();
    const schema = z.object(config.outputSchema!);

    it('should expose an outputSchema in getConfig', () => {
      expect(config.outputSchema).to.not.be.undefined;
    });

    it('should validate valid permission set assignment output', () => {
      const valid = {
        permissionSetName: 'MyPermSet',
        assignedTo: 'user@example.com',
      };
      const result = schema.safeParse(valid);
      expect(result.success).to.be.true;
    });

    it('should reject missing required fields', () => {
      const invalid = { permissionSetName: 'MyPermSet' };
      const result = schema.safeParse(invalid);
      expect(result.success).to.be.false;
    });
  });
});
