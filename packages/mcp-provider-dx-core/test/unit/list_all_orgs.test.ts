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
import type { OrgService, Services } from '@salesforce/mcp-provider-api';
import { ListAllOrgsMcpTool } from '../../src/tools/list_all_orgs.js';

/**
 * T06 unit tests for list_all_orgs:
 * list_all_orgs has no usernameOrAlias param — only directory.
 * Test B: omit directory → succeeds (org-only tool, directory is optional)
 * list_all_orgs does not touch an org connection, so no connectionHeader test (no connection).
 * We verify the tool works without directory.
 */

describe('list_all_orgs unit', () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());

  const mockOrgs = [
    { username: 'user@staging.com', aliases: ['OMNI_Staging'], orgId: '00Dp000STAGING' },
    { username: 'user@admin.com', aliases: ['OMNI_Admin'], orgId: '00D28000bkxy' },
  ];

  function makeServices(): Services {
    const orgService: OrgService = {
      getAllowedOrgUsernames: sandbox.stub().resolves(new Set(['OMNI_Staging', 'OMNI_Admin'])),
      getAllowedOrgs: sandbox.stub().resolves(mockOrgs),
      getConnection: sandbox.stub().rejects(new Error('getConnection should not be called for list_all_orgs')),
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

  // Test B: omit directory → succeeds (no chdir needed, directory is optional for org-only tool)
  it('Test B: omitting directory still returns org list', async () => {
    const services = makeServices();
    const tool = new ListAllOrgsMcpTool(services);

    const result = await tool.exec({ directory: undefined as unknown as string });

    expect(result.isError).to.equal(false);
    const text = (result.content[0] as { text: string }).text;
    expect(text).to.include('List of configured Salesforce orgs');
    expect(text).to.include('OMNI_Staging');
  });

  // list_all_orgs doesn't require usernameOrAlias, so no Test A/C for missing alias
  // Verify it doesn't error when no directory given
  it('should succeed without any parameters', async () => {
    const services = makeServices();
    const tool = new ListAllOrgsMcpTool(services);

    const result = await tool.exec({} as { directory: string });

    expect(result.isError).to.equal(false);
  });
});
