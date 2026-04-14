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
import { SchemaEntryType, type PartialFieldsEntry } from '../../../src/schema/types.js';

const invalidFieldError = Object.assign(
  new Error(
    "SELECT Id, Naem FROM Account\n                      ^\nERROR at Row:1:Column:23\nNo such column 'Naem' on entity 'Account'. If you are attempting to use a custom field, be sure to append the '__c' after the custom field name.",
  ),
  { name: 'INVALID_FIELD' },
);

const mockDescribeResult = {
  fields: [
    { name: 'Id' },
    { name: 'Name' },
    { name: 'Email' },
    { name: 'Phone' },
  ],
};

function createMockServices(queryError?: Error): {
  services: Services;
  queryStub: sinon.SinonStub;
  describeStub: sinon.SinonStub;
} {
  const queryStub = sinon.stub().rejects(queryError ?? invalidFieldError);
  const describeStub = sinon.stub().resolves(mockDescribeResult);
  const mockConnection = {
    query: queryStub,
    tooling: { query: sinon.stub().rejects(queryError ?? invalidFieldError) },
    describe: describeStub,
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
  return { services, queryStub, describeStub };
}

describe('QueryOrgMcpTool INVALID_FIELD recovery', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should call describeAndCache on INVALID_FIELD error (FAIL-01)', async () => {
    const { services } = createMockServices();
    const schemaService = new SchemaService();
    const describeSpy = sandbox.spy(schemaService, 'describeAndCache');

    const tool = new QueryOrgMcpTool(services, schemaService);
    await tool.exec({ query: 'SELECT Id, Naem FROM Account', usernameOrAlias: 'user@test.org', directory: '/tmp' });

    expect(describeSpy.calledOnce).to.be.true;
    expect(describeSpy.firstCall.args[0]).to.equal('user@test.org');
    expect(describeSpy.firstCall.args[1]).to.equal('Account');
  });

  it('should return fuzzy field suggestions ranked by similarity (FAIL-02, FAIL-03)', async () => {
    const { services } = createMockServices();
    const schemaService = new SchemaService();

    const tool = new QueryOrgMcpTool(services, schemaService);
    const result = await tool.exec({ query: 'SELECT Id, Naem FROM Account', usernameOrAlias: 'user@test.org', directory: '/tmp' });

    expect(result.isError).to.be.true;
    const text = (result.content[0] as { text: string }).text;
    expect(text).to.include('Did you mean: Name?');
  });

  it('should return top 3 suggestions when multiple matches exist', async () => {
    const multiFieldDescribe = {
      fields: [
        { name: 'Amount' },
        { name: 'AmountPaid__c' },
        { name: 'AnnualRevenue' },
        { name: 'Id' },
        { name: 'Name' },
      ],
    };
    const amontError = Object.assign(
      new Error("No such column 'Amont' on entity 'Opportunity'."),
      { name: 'INVALID_FIELD' },
    );
    const queryStub = sinon.stub().rejects(amontError);
    const describeStub = sinon.stub().resolves(multiFieldDescribe);
    const services = {
      getOrgService: () => ({
      getAllowedOrgs: sinon.stub().resolves([{ username: 'user@test.org', aliases: ['test'] }]),
        getConnection: sinon.stub().resolves({
          query: queryStub,
          tooling: { query: sinon.stub() },
          describe: describeStub,
          getUsername: sinon.stub().returns('user@test.org'),
    getAuthInfoFields: sinon.stub().returns({ orgId: '00Dxx0000000000' }),
    instanceUrl: 'https://test.salesforce.com',
        }),
      }),
    } as unknown as Services;

    const schemaService = new SchemaService();
    const tool = new QueryOrgMcpTool(services, schemaService);
    const result = await tool.exec({ query: 'SELECT Amont FROM Opportunity', usernameOrAlias: 'user@test.org', directory: '/tmp' });

    expect(result.isError).to.be.true;
    const text = (result.content[0] as { text: string }).text;
    expect(text).to.include('Did you mean:');
    expect(text).to.include('Amount');
  });

  it('should store full describe in cache after recovery (FAIL-04)', async () => {
    const { services } = createMockServices();
    const schemaService = new SchemaService();

    const tool = new QueryOrgMcpTool(services, schemaService);
    await tool.exec({ query: 'SELECT Id, Naem FROM Account', usernameOrAlias: 'user@test.org', directory: '/tmp' });

    const cached = schemaService.get('user@test.org', 'Account');
    expect(cached).to.not.be.undefined;
    expect(cached!.type).to.equal(SchemaEntryType.FullDescribe);
  });

  it('should invalidate partial entry before describe (Pitfall 4)', async () => {
    const { services } = createMockServices();
    const schemaService = new SchemaService();

    // Pre-populate with a partial entry
    schemaService.set('user@test.org', 'Account', {
      type: SchemaEntryType.PartialFields,
      objectName: 'Account',
      fieldNames: ['Id'],
      cachedAt: Date.now(),
    } as PartialFieldsEntry);

    const tool = new QueryOrgMcpTool(services, schemaService);
    await tool.exec({ query: 'SELECT Id, Naem FROM Account', usernameOrAlias: 'user@test.org', directory: '/tmp' });

    const cached = schemaService.get('user@test.org', 'Account');
    expect(cached).to.not.be.undefined;
    expect(cached!.type).to.equal(SchemaEntryType.FullDescribe);
  });

  it('should fall back to generic error when describe fails (D-05)', async () => {
    const queryStub = sinon.stub().rejects(invalidFieldError);
    const describeStub = sinon.stub().rejects(new Error('Describe failed'));
    const services = {
      getOrgService: () => ({
      getAllowedOrgs: sinon.stub().resolves([{ username: 'user@test.org', aliases: ['test'] }]),
        getConnection: sinon.stub().resolves({
          query: queryStub,
          tooling: { query: sinon.stub() },
          describe: describeStub,
          getUsername: sinon.stub().returns('user@test.org'),
    getAuthInfoFields: sinon.stub().returns({ orgId: '00Dxx0000000000' }),
    instanceUrl: 'https://test.salesforce.com',
        }),
      }),
    } as unknown as Services;

    const schemaService = new SchemaService();
    const tool = new QueryOrgMcpTool(services, schemaService);
    const result = await tool.exec({ query: 'SELECT Id, Naem FROM Account', usernameOrAlias: 'user@test.org', directory: '/tmp' });

    expect(result.isError).to.be.true;
    const text = (result.content[0] as { text: string }).text;
    expect(text).to.not.include('Did you mean');
    expect(text).to.include('No such column');
  });

  it('should fall back when regex extraction fails (D-02)', async () => {
    const oddError = Object.assign(new Error('Some unexpected error format'), { name: 'INVALID_FIELD' });
    const { services, describeStub } = createMockServices(oddError);

    const schemaService = new SchemaService();
    const tool = new QueryOrgMcpTool(services, schemaService);
    const result = await tool.exec({ query: 'SELECT Id FROM Account', usernameOrAlias: 'user@test.org', directory: '/tmp' });

    expect(result.isError).to.be.true;
    expect(describeStub.called).to.be.false;
  });

  it('should not trigger recovery for non-INVALID_FIELD errors', async () => {
    const malformedError = Object.assign(new Error('Malformed query'), { name: 'MALFORMED_QUERY' });
    const { services, describeStub } = createMockServices(malformedError);

    const schemaService = new SchemaService();
    const tool = new QueryOrgMcpTool(services, schemaService);
    const result = await tool.exec({ query: 'SELECT FROM', usernameOrAlias: 'user@test.org', directory: '/tmp' });

    expect(result.isError).to.be.true;
    expect(describeStub.called).to.be.false;
  });

  it('should return generic hint when no close matches exist (D-10)', async () => {
    const weirdFieldError = Object.assign(
      new Error("No such column 'xyzxyzxyz' on entity 'Account'."),
      { name: 'INVALID_FIELD' },
    );
    const queryStub = sinon.stub().rejects(weirdFieldError);
    const describeStub = sinon.stub().resolves({ fields: [{ name: 'Id' }, { name: 'CreatedDate' }] });
    const services = {
      getOrgService: () => ({
      getAllowedOrgs: sinon.stub().resolves([{ username: 'user@test.org', aliases: ['test'] }]),
        getConnection: sinon.stub().resolves({
          query: queryStub,
          tooling: { query: sinon.stub() },
          describe: describeStub,
          getUsername: sinon.stub().returns('user@test.org'),
    getAuthInfoFields: sinon.stub().returns({ orgId: '00Dxx0000000000' }),
    instanceUrl: 'https://test.salesforce.com',
        }),
      }),
    } as unknown as Services;

    const schemaService = new SchemaService();
    const tool = new QueryOrgMcpTool(services, schemaService);
    const result = await tool.exec({ query: 'SELECT xyzxyzxyz FROM Account', usernameOrAlias: 'user@test.org', directory: '/tmp' });

    expect(result.isError).to.be.true;
    const text = (result.content[0] as { text: string }).text;
    expect(text).to.include('salesforce_describe_object');
    expect(text).to.not.include('Did you mean');
  });
});
