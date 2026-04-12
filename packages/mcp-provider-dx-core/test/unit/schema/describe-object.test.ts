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
import { z } from 'zod';
import { ReleaseState, type Services, Toolset } from '@dormon/mcp-provider-api';
import { DescribeObjectMcpTool, describeObjectOutputSchema } from '../../../src/tools/describe_object.js';
import { SchemaService } from '../../../src/schema/schema-service.js';
import { SchemaEntryType, type FullDescribeEntry, type PartialFieldsEntry } from '../../../src/schema/types.js';

const mockDescribeSObjectResult: Record<string, unknown> = {
  name: 'Account',
  label: 'Account',
  keyPrefix: '001',
  fields: [
    { name: 'Id', label: 'Account ID', type: 'id', filterable: true, updateable: false, nillable: false, referenceTo: [], relationshipName: null },
    { name: 'Name', label: 'Account Name', type: 'string', filterable: true, updateable: true, nillable: false, referenceTo: [], relationshipName: null },
    { name: 'Industry', label: 'Industry', type: 'picklist', filterable: true, updateable: true, nillable: true, referenceTo: [], relationshipName: null },
    { name: 'OwnerId', label: 'Owner ID', type: 'reference', filterable: true, updateable: true, nillable: false, referenceTo: ['User'], relationshipName: 'Owner' },
    { name: 'ParentId', label: 'Parent Account ID', type: 'reference', filterable: true, updateable: true, nillable: true, referenceTo: ['Account'], relationshipName: 'Parent' },
  ],
  childRelationships: [
    { relationshipName: 'Contacts', childSObject: 'Contact', field: 'AccountId', cascadeDelete: false },
    { relationshipName: 'Opportunities', childSObject: 'Opportunity', field: 'AccountId', cascadeDelete: false },
    { relationshipName: null, childSObject: 'Task', field: 'WhatId', cascadeDelete: false },
  ],
};

const mockCachedAt = Date.now() - 30_000;
const mockFullEntry: FullDescribeEntry = {
  type: SchemaEntryType.FullDescribe,
  data: mockDescribeSObjectResult,
  cachedAt: mockCachedAt,
};

const mockPartialEntry: PartialFieldsEntry = {
  type: SchemaEntryType.PartialFields,
  objectName: 'Account',
  fieldNames: ['Id', 'Name'],
  cachedAt: Date.now(),
};

function createMockServices(describeResult?: Record<string, unknown>): { services: Services; connectionStub: sinon.SinonStub } {
  const connectionStub = sinon.stub().resolves(describeResult ?? mockDescribeSObjectResult);
  const mockConnection = {
    describe: connectionStub,
    getUsername: sinon.stub().returns('user@test.org'),
  };
  const services = {
    getOrgService: () => ({
      getConnection: sinon.stub().resolves(mockConnection),
    }),
  } as unknown as Services;
  return { services, connectionStub };
}

describe('DescribeObjectMcpTool', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  describe('curated fields (DISC-04)', () => {
    it('should return curated fields from DescribeSObjectResult', async () => {
      const { services } = createMockServices();
      const schemaService = new SchemaService();
      sandbox.stub(schemaService, 'get').returns(undefined);
      sandbox.stub(schemaService, 'describeAndCache').callsFake(async (_org, _obj, fn) => fn());

      const tool = new DescribeObjectMcpTool(services, schemaService);
      const result = await tool.exec({ objectName: 'Account', usernameOrAlias: 'user@test.org' });

      expect(result.isError).to.not.equal(true);
      const structured = result.structuredContent as Record<string, unknown>;
      expect(structured.objectName).to.equal('Account');
      expect(structured.label).to.equal('Account');
      expect(structured.keyPrefix).to.equal('001');

      const fields = structured.fields as Array<Record<string, unknown>>;
      expect(fields).to.have.length(5);
      expect(fields[0]).to.have.all.keys('name', 'label', 'type', 'filterable', 'updateable', 'nillable');

      const childRels = structured.childRelationships as Array<Record<string, unknown>>;
      expect(childRels).to.have.length(3);
      expect(childRels[0]).to.have.all.keys('relationshipName', 'childSObject', 'field');

      const lookups = structured.lookupFields as Array<Record<string, unknown>>;
      expect(lookups).to.have.length(2);
      expect(lookups[0]).to.have.property('fieldName', 'OwnerId');
      expect(lookups[0]).to.have.property('referenceTo').that.deep.equals(['User']);
      expect(lookups[0]).to.have.property('relationshipName', 'Owner');
    });

    it('should handle error with recovery guidance', async () => {
      const mockConnection = {
        describe: sinon.stub().rejects(new Error('InvalidObject')),
        getUsername: sinon.stub().returns('user@test.org'),
      };
      const services = {
        getOrgService: () => ({
          getConnection: sinon.stub().resolves(mockConnection),
        }),
      } as unknown as Services;
      const schemaService = new SchemaService();
      sandbox.stub(schemaService, 'get').returns(undefined);
      sandbox.stub(schemaService, 'describeAndCache').callsFake(async (_org, _obj, fn) => fn());

      const tool = new DescribeObjectMcpTool(services, schemaService);
      const result = await tool.exec({ objectName: 'BadObject', usernameOrAlias: 'user@test.org' });

      expect(result.isError).to.equal(true);
      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).to.include('Failed to describe object');
      expect(text).to.include('RECOVERY');
    });
  });

  describe('cache metadata (DISC-05)', () => {
    it('should return _meta.source=cache on cache hit', async () => {
      const { services } = createMockServices();
      const schemaService = new SchemaService();
      sandbox.stub(schemaService, 'get').returns(mockFullEntry);
      sandbox.stub(schemaService, 'describeAndCache').resolves(mockFullEntry);

      const tool = new DescribeObjectMcpTool(services, schemaService);
      const result = await tool.exec({ objectName: 'Account', usernameOrAlias: 'user@test.org' });

      const structured = result.structuredContent as Record<string, unknown>;
      const meta = structured._meta as Record<string, unknown>;
      expect(meta.source).to.equal('cache');
      expect(meta.cachedAt).to.be.a('number');
      expect(meta.ageMs).to.be.at.least(0);
      expect(meta.indicator).to.equal('full');
    });

    it('should return _meta.source=api on cache miss', async () => {
      const { services } = createMockServices();
      const schemaService = new SchemaService();
      sandbox.stub(schemaService, 'get').returns(undefined);
      sandbox.stub(schemaService, 'describeAndCache').callsFake(async (_org, _obj, fn) => fn());

      const tool = new DescribeObjectMcpTool(services, schemaService);
      const result = await tool.exec({ objectName: 'Account', usernameOrAlias: 'user@test.org' });

      const structured = result.structuredContent as Record<string, unknown>;
      const meta = structured._meta as Record<string, unknown>;
      expect(meta.source).to.equal('api');
      expect(meta.indicator).to.equal('full');
    });

    it('should treat partial cache entries as cache miss', async () => {
      const { services } = createMockServices();
      const schemaService = new SchemaService();
      sandbox.stub(schemaService, 'get').returns(mockPartialEntry);
      sandbox.stub(schemaService, 'describeAndCache').callsFake(async (_org, _obj, fn) => fn());

      const tool = new DescribeObjectMcpTool(services, schemaService);
      const result = await tool.exec({ objectName: 'Account', usernameOrAlias: 'user@test.org' });

      const structured = result.structuredContent as Record<string, unknown>;
      const meta = structured._meta as Record<string, unknown>;
      expect(meta.source).to.equal('api');
    });
  });

  describe('tool description (DISC-06)', () => {
    it('should include recommendation in tool description', () => {
      const { services } = createMockServices();
      const schemaService = new SchemaService();
      const tool = new DescribeObjectMcpTool(services, schemaService);
      const config = tool.getConfig();

      expect(config.description).to.include('Recommended before writing SOQL queries');
    });
  });

  describe('output schema', () => {
    it('should expose outputSchema in getConfig', () => {
      const { services } = createMockServices();
      const schemaService = new SchemaService();
      const tool = new DescribeObjectMcpTool(services, schemaService);
      const config = tool.getConfig();

      expect(config.outputSchema).to.not.be.undefined;
    });

    it('should validate curated output against outputSchema', async () => {
      const { services } = createMockServices();
      const schemaService = new SchemaService();
      sandbox.stub(schemaService, 'get').returns(undefined);
      sandbox.stub(schemaService, 'describeAndCache').callsFake(async (_org, _obj, fn) => fn());

      const tool = new DescribeObjectMcpTool(services, schemaService);
      const result = await tool.exec({ objectName: 'Account', usernameOrAlias: 'user@test.org' });

      const schema = z.object(tool.getConfig().outputSchema!);
      const validation = schema.safeParse(result.structuredContent);
      expect(validation.success).to.equal(true);
    });

    it('should reject invalid output against outputSchema', () => {
      const { services } = createMockServices();
      const schemaService = new SchemaService();
      const tool = new DescribeObjectMcpTool(services, schemaService);
      const schema = z.object(tool.getConfig().outputSchema!);
      const validation = schema.safeParse({ objectName: 'Account' });
      expect(validation.success).to.equal(false);
    });
  });

  describe('tool identity', () => {
    it('should have correct name and release state', () => {
      const { services } = createMockServices();
      const schemaService = new SchemaService();
      const tool = new DescribeObjectMcpTool(services, schemaService);

      expect(tool.getName()).to.equal('salesforce_describe_object');
      expect(tool.getReleaseState()).to.equal(ReleaseState.GA);
      expect(tool.getToolsets()).to.include(Toolset.DATA);
    });
  });

  describe('missing usernameOrAlias', () => {
    it('should return error when usernameOrAlias is empty', async () => {
      const { services } = createMockServices();
      const schemaService = new SchemaService();
      const tool = new DescribeObjectMcpTool(services, schemaService);
      const result = await tool.exec({ objectName: 'Account', usernameOrAlias: '' });

      expect(result.isError).to.equal(true);
      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).to.include('#get_username');
    });
  });
});
