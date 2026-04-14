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
import sinon from 'sinon';
import type { Connection } from '@salesforce/core';
import type { OrgService, Services } from '@salesforce/mcp-provider-api';
import { QueryOrgMcpTool } from '../../src/tools/run_soql_query.js';

/**
 * T06 unit tests for run_soql_query:
 * - Test A: omit usernameOrAlias → actionable error listing allowed orgs
 * - Test B: omit directory but provide valid usernameOrAlias → succeeds, response starts with connectionHeader
 * - Test C: usernameOrAlias not in allowedOrgs → actionable error
 */

describe('run_soql_query unit', () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());

  const allowedOrgs = ['OMNI_Staging', 'OMNI_Admin'];

  function makeConnection(username = 'user@staging.com', instanceUrl = 'https://staging.my.salesforce.com', orgId = '00Dp000STAGING'): Connection {
    return {
      getUsername: () => username,
      instanceUrl,
      getAuthInfoFields: () => ({ orgId }),
      query: sandbox.stub().resolves({ totalSize: 1, done: true, records: [{ Id: '001' }] }),
      tooling: { query: sandbox.stub().resolves({ totalSize: 0, done: true, records: [] }) },
    } as unknown as Connection;
  }

  function makeServices(allowedOrgNames: string[], connection: Connection): Services {
    const orgService: OrgService = {
      getAllowedOrgUsernames: sandbox.stub().resolves(new Set(allowedOrgNames)),
      getAllowedOrgs: sandbox.stub().resolves(allowedOrgNames.map((a) => ({ username: a, aliases: [a] }))),
      getConnection: sandbox.stub().resolves(connection),
      getDefaultTargetOrg: sandbox.stub().resolves(undefined),
      getDefaultTargetDevHub: sandbox.stub().resolves(undefined),
      findOrgByUsernameOrAlias: (orgs, alias) => orgs.find((o) => o.aliases?.includes(alias) || o.username === alias),
    };
    return {
      getTelemetryService: sandbox.stub().returns({ sendEvent: sandbox.stub() }),
      getOrgService: () => orgService,
      getConfigService: sandbox.stub().returns({ getDataDir: () => '/tmp', getStartupFlags: () => ({}) }),
    } as unknown as Services;
  }

  // Test A: missing usernameOrAlias → actionable error
  it('Test A: empty usernameOrAlias returns error listing allowed orgs', async () => {
    const conn = makeConnection();
    const services = makeServices(allowedOrgs, conn);
    const tool = new QueryOrgMcpTool(services);

    const result = await tool.exec({ query: 'SELECT Id FROM Account', usernameOrAlias: '', directory: '/tmp', useToolingApi: false });

    expect(result.isError).to.equal(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).to.satisfy(
      (t: string) => t.includes('Allowed orgs') || t.includes('usernameOrAlias') || t.includes('required'),
      'Error must mention allowed orgs or usernameOrAlias requirement',
    );
  });

  // Test B: omit directory (provide undefined), valid usernameOrAlias → success + connectionHeader
  it('Test B: omitting directory succeeds when usernameOrAlias is valid', async () => {
    const conn = makeConnection();
    const services = makeServices(allowedOrgs, conn);
    const tool = new QueryOrgMcpTool(services);

    // directory is required in current schema — this test drives making it optional
    // Pass undefined cast to string to simulate missing directory
    const result = await tool.exec({
      query: 'SELECT Id FROM Account',
      usernameOrAlias: 'OMNI_Staging',
      directory: undefined as unknown as string,
      useToolingApi: false,
    });

    expect(result.isError).to.equal(false);
    const text = (result.content[0] as { text: string }).text;
    expect(text).to.include('Connected to:');
  });

  // Test C: usernameOrAlias not in allowedOrgs → actionable error
  it('Test C: usernameOrAlias not in allowed list returns actionable error', async () => {
    const conn = makeConnection();
    const services = makeServices(allowedOrgs, conn);
    const tool = new QueryOrgMcpTool(services);

    const result = await tool.exec({
      query: 'SELECT Id FROM Account',
      usernameOrAlias: 'UNKNOWN_ORG',
      directory: undefined as unknown as string,
      useToolingApi: false,
    });

    expect(result.isError).to.equal(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).to.satisfy(
      (t: string) => t.includes('Allowed orgs') || t.includes('usernameOrAlias') || t.includes('OMNI_Staging'),
      'Error must list allowed orgs',
    );
  });
});
