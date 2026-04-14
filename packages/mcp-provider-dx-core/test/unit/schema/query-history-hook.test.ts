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
import { type Services } from '@dormon/mcp-provider-api';
import { QueryOrgMcpTool } from '../../../src/tools/run_soql_query.js';
import { SchemaService } from '../../../src/schema/schema-service.js';
import { QueryHistoryService } from '../../../src/schema/query-history-service.js';

const mockQueryResult = {
  totalSize: 1,
  done: true,
  records: [{ Id: '001xx000003DGb2AAG', Name: 'Acme' }],
};

function createMockServices(): { services: Services; queryStub: sinon.SinonStub } {
  const queryStub = sinon.stub().resolves(mockQueryResult);
  const mockConnection = {
    query: queryStub,
    tooling: { query: sinon.stub().resolves(mockQueryResult) },
    getUsername: sinon.stub().returns('user@test.org'),
    getAuthInfoFields: sinon.stub().returns({ orgId: '00Dxx0000000000' }),
    instanceUrl: 'https://test.salesforce.com',
  };
  const services = {
    getOrgService: () => ({
      getAllowedOrgs: sinon.stub().resolves([{ username: 'user@test.org', aliases: ['test'] }]),
      getConnection: sinon.stub().resolves(mockConnection),
    }),
  } as unknown as Services;
  return { services, queryStub };
}

describe('QueryOrgMcpTool query history hook', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should record query history after successful flat SOQL query', async () => {
    const { services } = createMockServices();
    const schemaService = new SchemaService();
    const qhs = new QueryHistoryService(50);

    const tool = new QueryOrgMcpTool(services, schemaService, qhs);
    await tool.exec({ query: 'SELECT Id, Name FROM Account', usernameOrAlias: 'user@test.org', directory: '/tmp' });

    const entries = qhs.list('user@test.org');
    expect(entries).to.have.lengthOf(1);
    expect(entries[0].query).to.equal('SELECT Id, Name FROM Account');
    expect(entries[0].objectName).to.equal('Account');
    expect(entries[0].fieldCount).to.equal(2);
  });

  it('should not record for tooling API queries', async () => {
    const { services } = createMockServices();
    const schemaService = new SchemaService();
    const qhs = new QueryHistoryService(50);

    const tool = new QueryOrgMcpTool(services, schemaService, qhs);
    await tool.exec({ query: 'SELECT Id FROM ApexClass', usernameOrAlias: 'user@test.org', directory: '/tmp', useToolingApi: true });

    expect(qhs.list('user@test.org')).to.have.lengthOf(0);
  });

  it('should return result even if queryHistoryService.record throws', async () => {
    const { services } = createMockServices();
    const schemaService = new SchemaService();
    const qhs = new QueryHistoryService(50);
    sandbox.stub(qhs, 'record').throws(new Error('boom'));

    const tool = new QueryOrgMcpTool(services, schemaService, qhs);
    const result = await tool.exec({ query: 'SELECT Id FROM Account', usernameOrAlias: 'user@test.org', directory: '/tmp' });

    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).to.include('SOQL query results');
  });

  it('should work without queryHistoryService (backward compat)', async () => {
    const { services } = createMockServices();
    const schemaService = new SchemaService();

    // 2-arg constructor (no queryHistoryService)
    const tool = new QueryOrgMcpTool(services, schemaService);
    const result = await tool.exec({ query: 'SELECT Id FROM Account', usernameOrAlias: 'user@test.org', directory: '/tmp' });

    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).to.include('SOQL query results');
  });
});
