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
import { DescribeObjectMcpTool } from '../../../src/tools/describe_object.js';
import { QueryOrgMcpTool } from '../../../src/tools/run_soql_query.js';
import { SchemaService } from '../../../src/schema/schema-service.js';
import { SchemaEntryType, type FullDescribeEntry, type RelationshipEdge } from '../../../src/schema/types.js';
import { SfError } from '@salesforce/core';

const richDescribeResult: Record<string, unknown> = {
  name: 'Account',
  label: 'Account',
  keyPrefix: '001',
  fields: [
    { name: 'Id', label: 'Account ID', type: 'id', filterable: true, updateable: false, nillable: false, referenceTo: [], relationshipName: null },
    { name: 'Name', label: 'Account Name', type: 'string', filterable: true, updateable: true, nillable: false, referenceTo: [], relationshipName: null },
    { name: 'OwnerId', label: 'Owner ID', type: 'reference', filterable: true, updateable: true, nillable: false, referenceTo: ['User'], relationshipName: 'Owner' },
    { name: 'ParentId', label: 'Parent Account ID', type: 'reference', filterable: true, updateable: true, nillable: true, referenceTo: ['Account'], relationshipName: 'Parent' },
  ],
  childRelationships: [
    { relationshipName: 'Contacts', childSObject: 'Contact', field: 'AccountId', cascadeDelete: false },
    { relationshipName: null, childSObject: 'Task', field: 'WhatId', cascadeDelete: false },
  ],
};

const emptyDescribeResult: Record<string, unknown> = {
  name: 'EmptyObj',
  label: 'Empty Object',
  keyPrefix: '099',
  fields: [
    { name: 'Id', label: 'ID', type: 'id', filterable: true, updateable: false, nillable: false, referenceTo: [], relationshipName: null },
  ],
  childRelationships: [],
};

const mockQueryResult = {
  totalSize: 1,
  done: true,
  records: [{ Id: '001xx000003DGb2AAG', Name: 'Acme' }],
};

function createDescribeServices(describeResult?: Record<string, unknown>): { services: Services; describeStub: sinon.SinonStub } {
  const describeStub = sinon.stub().resolves(describeResult ?? richDescribeResult);
  const mockConnection = {
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
  return { services, describeStub };
}

function createQueryServices(queryError?: Error): { services: Services; queryStub: sinon.SinonStub; describeStub: sinon.SinonStub } {
  const queryStub = queryError ? sinon.stub().rejects(queryError) : sinon.stub().resolves(mockQueryResult);
  const describeStub = sinon.stub().resolves(richDescribeResult);
  const mockConnection = {
    query: queryStub,
    describe: describeStub,
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
  return { services, queryStub, describeStub };
}

describe('DescribeObjectMcpTool relationship wiring', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should store relationship edges after successful describe (D-05)', async () => {
    const { services } = createDescribeServices();
    const schemaService = new SchemaService();
    const setRelSpy = sandbox.spy(schemaService, 'setRelationships');

    const tool = new DescribeObjectMcpTool(services, schemaService);
    await tool.exec({ objectName: 'Account', usernameOrAlias: 'user@test.org' });

    expect(setRelSpy.calledOnce).to.be.true;
    const [org, obj, edges] = setRelSpy.firstCall.args;
    expect(org).to.equal('user@test.org');
    expect(obj).to.equal('Account');
    expect(edges).to.be.an('array').with.length.greaterThan(0);
  });

  it('should include relationships in curated response (D-12)', async () => {
    const { services } = createDescribeServices();
    const schemaService = new SchemaService();
    const tool = new DescribeObjectMcpTool(services, schemaService);
    const result = await tool.exec({ objectName: 'Account', usernameOrAlias: 'user@test.org' });

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured).to.have.property('relationships');
    const rels = structured.relationships as RelationshipEdge[];
    expect(rels).to.be.an('array').with.length.greaterThan(0);
    // Should have OwnerId→User and ParentId→Account outbound, Contact→Account inbound
    expect(rels.some((r: RelationshipEdge) => r.to === 'User' && r.via === 'OwnerId')).to.be.true;
  });

  it('should have empty relationships for object with no reference fields', async () => {
    const { services } = createDescribeServices(emptyDescribeResult);
    const schemaService = new SchemaService();
    const setRelSpy = sandbox.spy(schemaService, 'setRelationships');

    const tool = new DescribeObjectMcpTool(services, schemaService);
    const result = await tool.exec({ objectName: 'EmptyObj', usernameOrAlias: 'user@test.org' });

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.relationships).to.deep.equal([]);
    expect(setRelSpy.called).to.be.false;
  });

  it('should not fail describe when edge extraction throws (D-05)', async () => {
    const { services } = createDescribeServices();
    const schemaService = new SchemaService();
    sandbox.stub(schemaService, 'setRelationships').throws(new Error('boom'));

    const tool = new DescribeObjectMcpTool(services, schemaService);
    const result = await tool.exec({ objectName: 'Account', usernameOrAlias: 'user@test.org' });

    expect(result).to.not.have.nested.property('isError', true);
    expect(result.structuredContent).to.have.property('objectName', 'Account');
  });
});

describe('QueryOrgMcpTool relationship suggestions', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should include _relationships section when cached edges exist (D-07, D-08)', async () => {
    const { services } = createQueryServices();
    const schemaService = new SchemaService();
    const edges: RelationshipEdge[] = [
      { from: 'Contact', to: 'Account', via: 'AccountId', type: 'lookup' },
      { from: 'Account', to: 'User', via: 'OwnerId', type: 'lookup' },
    ];
    sandbox.stub(schemaService, 'getRelationships').returns(edges);

    const tool = new QueryOrgMcpTool(services, schemaService);
    const result = await tool.exec({ query: 'SELECT Id FROM Account', usernameOrAlias: 'user@test.org', directory: '/tmp' });

    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).to.include('_relationships:');
  });

  it('should NOT include _relationships when no cached edges (D-08)', async () => {
    const { services } = createQueryServices();
    const schemaService = new SchemaService();
    sandbox.stub(schemaService, 'getRelationships').returns(undefined);

    const tool = new QueryOrgMcpTool(services, schemaService);
    const result = await tool.exec({ query: 'SELECT Id FROM Account', usernameOrAlias: 'user@test.org', directory: '/tmp' });

    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).to.not.include('_relationships:');
  });

  it('should format suggestions as "From.Via -> To (type via Via)" (D-07)', async () => {
    const { services } = createQueryServices();
    const schemaService = new SchemaService();
    const edges: RelationshipEdge[] = [
      { from: 'Contact', to: 'Account', via: 'AccountId', type: 'lookup' },
    ];
    sandbox.stub(schemaService, 'getRelationships').returns(edges);

    const tool = new QueryOrgMcpTool(services, schemaService);
    const result = await tool.exec({ query: 'SELECT Id FROM Account', usernameOrAlias: 'user@test.org', directory: '/tmp' });

    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).to.include('Contact.AccountId -> Account (lookup via AccountId)');
  });

  it('should cap suggestions at 5 (D-07)', async () => {
    const { services } = createQueryServices();
    const schemaService = new SchemaService();
    const edges: RelationshipEdge[] = Array.from({ length: 8 }, (_, i) => ({
      from: `Child${i}`,
      to: 'Account',
      via: `Field${i}`,
      type: 'lookup' as const,
    }));
    sandbox.stub(schemaService, 'getRelationships').returns(edges);

    const tool = new QueryOrgMcpTool(services, schemaService);
    const result = await tool.exec({ query: 'SELECT Id FROM Account', usernameOrAlias: 'user@test.org', directory: '/tmp' });

    const text = (result.content as Array<{ text: string }>)[0].text;
    const relSection = text.split('_relationships:\n')[1];
    const suggestionLines = relSection.trim().split('\n').filter((l: string) => l.includes('->'));
    expect(suggestionLines).to.have.lengthOf(5);
  });

  it('should extract edges from INVALID_FIELD recovery describe (D-05)', async () => {
    const sfErr = new SfError("No such column 'Namee' on entity 'Account'", 'INVALID_FIELD');
    const { services } = createQueryServices(sfErr);
    const schemaService = new SchemaService();
    const setRelSpy = sandbox.spy(schemaService, 'setRelationships');
    // describeAndCache returns FullDescribeEntry on recovery
    sandbox.stub(schemaService, 'describeAndCache').resolves({
      type: SchemaEntryType.FullDescribe,
      data: richDescribeResult,
      cachedAt: Date.now(),
    } satisfies FullDescribeEntry);
    sandbox.stub(schemaService, 'get').returns(undefined);
    sandbox.stub(schemaService, 'invalidate').returns(true);

    const tool = new QueryOrgMcpTool(services, schemaService);
    await tool.exec({ query: "SELECT Namee FROM Account", usernameOrAlias: 'user@test.org', directory: '/tmp' });

    expect(setRelSpy.called).to.be.true;
    const [, , edges] = setRelSpy.firstCall.args;
    expect(edges).to.be.an('array').with.length.greaterThan(0);
  });
});
