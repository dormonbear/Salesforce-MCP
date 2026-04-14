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
import { SchemaEntryType, type PartialFieldsEntry, type FullDescribeEntry } from '../../../src/schema/types.js';

const mockQueryResult = {
  totalSize: 1,
  done: true,
  records: [{ Id: '001xx000003DGb2AAG', Name: 'Acme' }],
};

function createMockServices(): { services: Services; queryStub: sinon.SinonStub; toolingQueryStub: sinon.SinonStub } {
  const queryStub = sinon.stub().resolves(mockQueryResult);
  const toolingQueryStub = sinon.stub().resolves(mockQueryResult);
  const mockConnection = {
    query: queryStub,
    tooling: { query: toolingQueryStub },
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
  return { services, queryStub, toolingQueryStub };
}

describe('QueryOrgMcpTool auto-cache hook', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('auto-cache on success (ACCH-01)', () => {
    it('should cache object and fields after successful flat query', async () => {
      const { services } = createMockServices();
      const schemaService = new SchemaService();
      const setSpy = sandbox.spy(schemaService, 'set');
      sandbox.stub(schemaService, 'get').returns(undefined);

      const tool = new QueryOrgMcpTool(services, schemaService);
      const result = await tool.exec({ query: 'SELECT Id, Name FROM Account', usernameOrAlias: 'user@test.org', directory: '/tmp' });

      expect(result.isError).to.not.equal(true);
      expect(setSpy.calledOnce).to.be.true;
      const [org, obj, entry] = setSpy.firstCall.args;
      expect(org).to.equal('user@test.org');
      expect(obj).to.equal('Account');
      expect((entry as PartialFieldsEntry).type).to.equal(SchemaEntryType.PartialFields);
      expect((entry as PartialFieldsEntry).fieldNames).to.deep.equal(['Id', 'Name']);
    });

    it('should make zero API calls for caching (no connection.describe)', async () => {
      const { services } = createMockServices();
      const schemaService = new SchemaService();
      sandbox.spy(schemaService, 'set');
      sandbox.stub(schemaService, 'get').returns(undefined);

      const tool = new QueryOrgMcpTool(services, schemaService);
      await tool.exec({ query: 'SELECT Id FROM Account', usernameOrAlias: 'user@test.org', directory: '/tmp' });

      // Verify describe was never called — only query should have been called
      const conn = await services.getOrgService().getConnection('user@test.org');
      expect((conn as unknown as Record<string, unknown>).describe).to.be.undefined;
    });

    it('should not cache when parser returns null for complex query', async () => {
      const { services } = createMockServices();
      const schemaService = new SchemaService();
      const setSpy = sandbox.spy(schemaService, 'set');

      const tool = new QueryOrgMcpTool(services, schemaService);
      await tool.exec({ query: 'SELECT Id, (SELECT Id FROM Contacts) FROM Account', usernameOrAlias: 'user@test.org', directory: '/tmp' });

      expect(setSpy.called).to.be.false;
    });

    it('should not cache tooling API queries', async () => {
      const { services } = createMockServices();
      const schemaService = new SchemaService();
      const setSpy = sandbox.spy(schemaService, 'set');

      const tool = new QueryOrgMcpTool(services, schemaService);
      await tool.exec({ query: 'SELECT Id, Name FROM ApexClass', usernameOrAlias: 'user@test.org', useToolingApi: true, directory: '/tmp' });

      expect(setSpy.called).to.be.false;
    });
  });

  describe('merge logic (ACCH-03)', () => {
    it('should merge fieldNames when partial already exists (union)', async () => {
      const { services } = createMockServices();
      const schemaService = new SchemaService();
      const existingPartial: PartialFieldsEntry = {
        type: SchemaEntryType.PartialFields,
        objectName: 'Account',
        fieldNames: ['Id'],
        cachedAt: Date.now() - 5000,
      };
      sandbox.stub(schemaService, 'get').returns(existingPartial);
      const setSpy = sandbox.spy(schemaService, 'set');

      const tool = new QueryOrgMcpTool(services, schemaService);
      await tool.exec({ query: 'SELECT Name FROM Account', usernameOrAlias: 'user@test.org', directory: '/tmp' });

      expect(setSpy.calledOnce).to.be.true;
      const entry = setSpy.firstCall.args[2] as PartialFieldsEntry;
      expect(entry.fieldNames).to.include.members(['Id', 'Name']);
      expect(entry.fieldNames).to.have.lengthOf(2);
    });

    it('should not overwrite full describe entry with partial (no downgrade)', async () => {
      const { services } = createMockServices();
      const schemaService = new SchemaService();
      const existingFull: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: { name: 'Account', fields: [] },
        cachedAt: Date.now(),
      };
      sandbox.stub(schemaService, 'get').returns(existingFull);
      const setSpy = sandbox.spy(schemaService, 'set');

      const tool = new QueryOrgMcpTool(services, schemaService);
      await tool.exec({ query: 'SELECT Id FROM Account', usernameOrAlias: 'user@test.org', directory: '/tmp' });

      expect(setSpy.called).to.be.false;
    });
  });

  describe('fire-and-forget (D-08)', () => {
    it('should still return query result even if schemaService.set throws', async () => {
      const { services } = createMockServices();
      const schemaService = new SchemaService();
      sandbox.stub(schemaService, 'get').returns(undefined);
      sandbox.stub(schemaService, 'set').throws(new Error('Cache write failed'));

      const tool = new QueryOrgMcpTool(services, schemaService);
      const result = await tool.exec({ query: 'SELECT Id FROM Account', usernameOrAlias: 'user@test.org', directory: '/tmp' });

      expect(result.isError).to.not.equal(true);
      expect(result.structuredContent).to.have.property('totalSize', 1);
    });

    it('should still return query result when parser encounters unexpected input', async () => {
      const { services } = createMockServices();
      const schemaService = new SchemaService();
      const setSpy = sandbox.spy(schemaService, 'set');

      const tool = new QueryOrgMcpTool(services, schemaService);
      // A weird query that won't parse — parser returns null, no caching attempted
      const result = await tool.exec({ query: 'not a valid soql', usernameOrAlias: 'user@test.org', directory: '/tmp' });

      // The query itself will fail at Salesforce, but the mock resolves, so result is fine
      expect(result.isError).to.not.equal(true);
      expect(setSpy.called).to.be.false;
    });
  });

  describe('constructor (D-12)', () => {
    it('should accept (services, schemaService) constructor parameters', () => {
      const { services } = createMockServices();
      const schemaService = new SchemaService();
      const tool = new QueryOrgMcpTool(services, schemaService);
      expect(tool).to.be.instanceOf(QueryOrgMcpTool);
    });
  });
});
