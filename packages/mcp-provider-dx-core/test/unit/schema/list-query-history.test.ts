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
import { ReleaseState, Toolset, type Services } from '@dormon/mcp-provider-api';
import { ListQueryHistoryMcpTool } from '../../../src/tools/list_query_history.js';
import { QueryHistoryService } from '../../../src/schema/query-history-service.js';

function createMockServices(): Services {
  const mockConnection = {
    getUsername: sinon.stub().returns('user@test.org'),
  };
  return {
    getOrgService: () => ({
      getConnection: sinon.stub().resolves(mockConnection),
    }),
  } as unknown as Services;
}

describe('ListQueryHistoryMcpTool', () => {
  let sandbox: sinon.SinonSandbox;

  beforeEach(() => {
    sandbox = sinon.createSandbox();
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('should return query history as structuredContent', async () => {
    const services = createMockServices();
    const qhs = new QueryHistoryService(50);
    qhs.record('user@test.org', 'SELECT Id FROM Account', 'Account', 1);
    qhs.record('user@test.org', 'SELECT Name, Industry FROM Account', 'Account', 2);

    const tool = new ListQueryHistoryMcpTool(services, qhs);
    const result = await tool.exec({ usernameOrAlias: 'user@test.org', limit: 10 });

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.orgUsername).to.equal('user@test.org');
    expect(structured.totalStored).to.equal(2);
    const queries = structured.queries as Array<Record<string, unknown>>;
    expect(queries).to.have.lengthOf(2);
    expect(queries[0].objectName).to.equal('Account');
  });

  it('should return empty queries for org with no history', async () => {
    const services = createMockServices();
    const qhs = new QueryHistoryService(50);

    const tool = new ListQueryHistoryMcpTool(services, qhs);
    const result = await tool.exec({ usernameOrAlias: 'user@test.org', limit: 10 });

    const structured = result.structuredContent as Record<string, unknown>;
    expect(structured.totalStored).to.equal(0);
    expect((structured.queries as unknown[]).length).to.equal(0);
  });

  it('should filter by objectName', async () => {
    const services = createMockServices();
    const qhs = new QueryHistoryService(50);
    qhs.record('user@test.org', 'SELECT Id FROM Account', 'Account', 1);
    qhs.record('user@test.org', 'SELECT Id FROM Contact', 'Contact', 1);

    const tool = new ListQueryHistoryMcpTool(services, qhs);
    const result = await tool.exec({ usernameOrAlias: 'user@test.org', objectName: 'Account', limit: 10 });

    const structured = result.structuredContent as Record<string, unknown>;
    const queries = structured.queries as Array<Record<string, unknown>>;
    expect(queries).to.have.lengthOf(1);
    expect(queries[0].objectName).to.equal('Account');
  });

  it('should cap results with limit parameter', async () => {
    const services = createMockServices();
    const qhs = new QueryHistoryService(50);
    for (let i = 0; i < 20; i++) {
      qhs.record('user@test.org', `SELECT Id FROM Obj${i}`, `Obj${i}`, 1);
    }

    const tool = new ListQueryHistoryMcpTool(services, qhs);
    const result = await tool.exec({ usernameOrAlias: 'user@test.org', limit: 5 });

    const structured = result.structuredContent as Record<string, unknown>;
    expect((structured.queries as unknown[]).length).to.equal(5);
    expect(structured.totalStored).to.equal(20);
  });

  it('should return error when usernameOrAlias is missing', async () => {
    const services = createMockServices();
    const qhs = new QueryHistoryService(50);

    const tool = new ListQueryHistoryMcpTool(services, qhs);
    const result = await tool.exec({ usernameOrAlias: undefined as unknown as string, limit: 10 });

    const text = (result.content as Array<{ text: string }>)[0].text;
    expect(text).to.include('usernameOrAlias');
  });

  it('should have correct tool metadata', () => {
    const services = createMockServices();
    const qhs = new QueryHistoryService(50);
    const tool = new ListQueryHistoryMcpTool(services, qhs);

    expect(tool.getName()).to.equal('salesforce_list_query_history');
    expect(tool.getReleaseState()).to.equal(ReleaseState.GA);
    expect(tool.getToolsets()).to.deep.equal([Toolset.DATA]);
    const config = tool.getConfig();
    expect(config.annotations?.readOnlyHint).to.be.true;
    expect(config.annotations?.destructiveHint).to.be.false;
  });
});
