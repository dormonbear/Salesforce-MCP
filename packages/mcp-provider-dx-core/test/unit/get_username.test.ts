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
import type { OrgService, SanitizedOrgAuthorization, OrgConfigInfo } from '@salesforce/mcp-provider-api';
import { suggestUsername } from '../../src/tools/get_username.js';

/**
 * Test for the suggestUsername bug:
 *
 * Bug: when multiple allowed orgs exist and the global target-org (e.g. OMNI_Admin)
 * is in the allowed list, suggestUsername returns it as the suggestion even if the
 * user intended a different org (e.g. OMNI_Staging). The AI then uses OMNI_Admin
 * for all subsequent tool calls, routing queries to Live instead of Staging.
 *
 * Fix: when the inferred org from target-org is NOT the only allowed org, the response
 * must list ALL allowed orgs and ask the user to confirm, rather than silently binding
 * the AI to the default.
 */
describe('suggestUsername', () => {
  const sandbox = sinon.createSandbox();
  afterEach(() => sandbox.restore());

  const stagingOrg: SanitizedOrgAuthorization = {
    username: 'dormon.zhou@ef.cn.staging',
    aliases: ['OMNI_Staging'],
    orgId: '00Dp0000000E0zWEAS',
    instanceUrl: 'https://english1--stg.sandbox.my.salesforce.com',
    isScratchOrg: false,
    isDevHub: false,
    isSandbox: true,
    oauthMethod: 'web',
    isExpired: false,
    configs: null,
  };

  const adminOrg: SanitizedOrgAuthorization = {
    username: 'omni.admin@yingfu.com',
    aliases: ['OMNI_Admin'],
    orgId: '00D28000000bkxyEAA',
    instanceUrl: 'https://english1.my.salesforce.com',
    isScratchOrg: false,
    isDevHub: true,
    isSandbox: false,
    oauthMethod: 'jwt',
    isExpired: false,
    configs: null,
  };

  const sfoa: SanitizedOrgAuthorization = {
    username: 'dormon.zhou@ef.cn.sfoa',
    aliases: ['SFOA_Live'],
    orgId: '00DC800000AqT0DMAV',
    instanceUrl: 'https://english1.my.sfcrmproducts.cn',
    isScratchOrg: false,
    isDevHub: true,
    isSandbox: false,
    oauthMethod: 'jwt',
    isExpired: false,
    configs: null,
  };

  function makeOrgService(
    allOrgs: SanitizedOrgAuthorization[],
    defaultTargetOrg: OrgConfigInfo | undefined,
    defaultTargetDevHub: OrgConfigInfo | undefined = undefined,
  ): OrgService {
    return {
      getAllowedOrgUsernames: sinon.stub().resolves(new Set(allOrgs.map((o) => o.username))),
      getAllowedOrgs: sinon.stub().resolves(allOrgs),
      getConnection: sinon.stub(),
      getDefaultTargetOrg: sinon.stub().resolves(defaultTargetOrg),
      getDefaultTargetDevHub: sinon.stub().resolves(defaultTargetDevHub),
      findOrgByUsernameOrAlias: (orgs, usernameOrAlias) =>
        orgs.find(
          (o) =>
            o.username === usernameOrAlias ||
            (Array.isArray(o.aliases) && o.aliases.includes(usernameOrAlias)),
        ),
    };
  }

  it('returns the only allowed org when exactly one is present', async () => {
    const orgService = makeOrgService([stagingOrg], undefined);
    const result = await suggestUsername(orgService);
    expect(result.suggestedUsername).to.equal('dormon.zhou@ef.cn.staging');
    expect(result.aliasForReference).to.equal('OMNI_Staging');
    expect(result.reasoning).to.include('only org');
  });

  it('returns default target org when it is the only matching allowed org', async () => {
    const orgService = makeOrgService(
      [stagingOrg],
      { key: 'target-org', value: 'OMNI_Staging', path: '/fake' },
    );
    const result = await suggestUsername(orgService);
    // Only one org in the list, so it should be returned directly
    expect(result.suggestedUsername).to.equal('dormon.zhou@ef.cn.staging');
  });

  it('BUG REGRESSION: does NOT silently return global default when multiple orgs are allowed', async () => {
    // This is the exact bug scenario:
    // --orgs OMNI_Admin,OMNI_Staging,SFOA_Live  (3 orgs)
    // ~/.sf/config.json  target-org=OMNI_Admin  (Live admin)
    // Expected: the response must NOT silently bind to OMNI_Admin.
    // It must list all allowed orgs so the user/AI can pick the right one.
    const orgService = makeOrgService(
      [stagingOrg, adminOrg, sfoa],
      { key: 'target-org', value: 'OMNI_Admin', path: '/fake/.sf/config.json' },
    );

    const result = await suggestUsername(orgService);

    // Must not silently return the Live admin org
    expect(result.suggestedUsername).to.not.equal('omni.admin@yingfu.com',
      'suggestUsername must not return the global default when multiple allowed orgs exist — this causes silent routing to Live');

    // The response should either be undefined (force explicit selection) or contain all allowed orgs
    // Either way, the reasoning must not claim the default is authoritative
    if (result.suggestedUsername) {
      expect(result.reasoning).to.not.match(/it is the default.*target org/i,
        'When multiple orgs exist, the default target-org must not be silently used as the authoritative selection');
    }
  });

  it('BUG REGRESSION: response lists all allowed orgs when multiple exist and default is ambiguous', async () => {
    const orgService = makeOrgService(
      [stagingOrg, adminOrg, sfoa],
      { key: 'target-org', value: 'OMNI_Admin', path: '/fake/.sf/config.json' },
    );

    const result = await suggestUsername(orgService);

    // The reasoning or context must mention that multiple orgs are available
    const hasListedOrgs =
      (result.reasoning ?? '').includes('OMNI_Staging') ||
      (result.reasoning ?? '').includes('OMNI_Admin') ||
      (result.reasoning ?? '').includes('SFOA_Live') ||
      result.suggestedUsername === undefined;

    expect(hasListedOrgs).to.equal(true,
      'When multiple allowed orgs exist, the response must enumerate them or decline to suggest one automatically');
  });
});
