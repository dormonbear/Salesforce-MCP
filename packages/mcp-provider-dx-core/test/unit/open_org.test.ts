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
import { OrgOpenMcpTool } from '../../src/tools/open_org.js';

/**
 * T06 unit tests for open_org:
 * - Test A: omit usernameOrAlias → actionable error listing allowed orgs
 * - Test B: omit directory but valid usernameOrAlias → succeeds (org-only tool)
 * - Test C: usernameOrAlias not in allowedOrgs → actionable error
 *
 * Note: open_org calls open() (browser) and Org.create(). We stub at Services level
 * so getConnection throws for invalid alias; actual browser open is not tested here.
 */

describe('open_org unit', () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());

  const allowedOrgs = ['OMNI_Staging', 'OMNI_Admin'];

  function makeConnection(): Connection {
    return {
      getUsername: () => 'user@staging.com',
      instanceUrl: 'https://staging.my.salesforce.com',
      getAuthInfoFields: () => ({ orgId: '00Dp000STAGING' }),
    } as unknown as Connection;
  }

  function makeServices(allowedOrgNames: string[], connection: Connection): Services {
    const orgService: OrgService = {
      getAllowedOrgUsernames: sandbox.stub().resolves(new Set(allowedOrgNames)),
      getAllowedOrgs: sandbox.stub().resolves(allowedOrgNames.map((a) => ({ username: a, aliases: [a] }))),
      getConnection: sandbox.stub().callsFake(async (alias: string) => {
        if (allowedOrgNames.includes(alias)) return connection;
        throw new Error(`Org "${alias}" not in allowed list`);
      }),
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

  // Test A: empty usernameOrAlias → actionable error
  it('Test A: empty usernameOrAlias returns error listing allowed orgs', async () => {
    const conn = makeConnection();
    const services = makeServices(allowedOrgs, conn);
    const tool = new OrgOpenMcpTool(services);

    const result = await tool.exec({ usernameOrAlias: '', directory: '/tmp' });

    expect(result.isError).to.equal(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).to.satisfy(
      (t: string) => t.includes('Allowed orgs') || t.includes('usernameOrAlias') || t.includes('required'),
    );
  });

  // Test B: omit directory → should succeed for org-only tool (no chdir needed)
  it('Test B: omitting directory succeeds with valid usernameOrAlias', async () => {
    const conn = makeConnection();
    const services = makeServices(allowedOrgs, conn);
    const tool = new OrgOpenMcpTool(services);

    // open_org calls Org.create({ connection }) and open() — these will fail in unit test
    // but the key is: the tool should NOT fail due to missing directory
    // We expect either success or a non-directory-related error
    const result = await tool.exec({
      usernameOrAlias: 'OMNI_Staging',
      directory: undefined as unknown as string,
    });

    // If it errors, it should NOT be a directory-related error
    if (result.isError) {
      const text = (result.content[0] as { text: string }).text;
      expect(text).to.not.include('directory');
      expect(text).to.not.include('chdir');
      expect(text).to.not.include('ENOENT');
    }
  });

  // Test C: usernameOrAlias not in allowedOrgs → actionable error
  it('Test C: usernameOrAlias not in allowed list returns actionable error', async () => {
    const conn = makeConnection();
    const services = makeServices(allowedOrgs, conn);
    const tool = new OrgOpenMcpTool(services);

    const result = await tool.exec({
      usernameOrAlias: 'UNKNOWN_ORG',
      directory: undefined as unknown as string,
    });

    expect(result.isError).to.equal(true);
    const text = (result.content[0] as { text: string }).text;
    expect(text).to.satisfy(
      (t: string) => t.includes('Allowed orgs') || t.includes('OMNI_Staging') || t.includes('not in') || t.includes('usernameOrAlias'),
    );
  });
});
