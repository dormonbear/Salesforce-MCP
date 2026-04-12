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
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, readdir } from 'node:fs/promises';
import type { Services } from '@dormon/mcp-provider-api';
import { SchemaService } from '../../../src/schema/schema-service.js';
import { SchemaEntryType, type FullDescribeEntry, type PartialFieldsEntry } from '../../../src/schema/types.js';
import { DxCoreMcpProvider } from '../../../src/index.js';

function makeFullDescribeEntry(cachedAt: number = Date.now()): FullDescribeEntry {
  return {
    type: SchemaEntryType.FullDescribe,
    data: { name: 'Account', fields: ['Id', 'Name', 'Industry'] },
    cachedAt,
  };
}

function makePartialFieldsEntry(objectName: string, cachedAt: number = Date.now()): PartialFieldsEntry {
  return {
    type: SchemaEntryType.PartialFields,
    objectName,
    fieldNames: ['Id', 'Name'],
    cachedAt,
  };
}

describe('SchemaService + Persistence Integration', () => {
  let dataDir: string;

  beforeEach(async () => {
    dataDir = join(tmpdir(), 'schema-integration-' + randomUUID());
    await mkdir(dataDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    sinon.restore();
  });

  describe('round-trip persistence', () => {
    it('set entries → flush → new instance → loadFromDisk → entries retrieved correctly', async () => {
      // Instance 1: populate and flush
      const service1 = new SchemaService({ dataDir, ttlMs: 3_600_000 });
      service1.set('org1@test.com', 'Account', makeFullDescribeEntry());
      service1.set('org1@test.com', 'Contact', makePartialFieldsEntry('Contact'));
      service1.set('org2@test.com', 'Lead', makeFullDescribeEntry());

      await service1.flushToDisk();

      // Instance 2: load from disk (simulates process restart)
      const service2 = new SchemaService({ dataDir, ttlMs: 3_600_000 });
      await service2.loadFromDisk();

      // Verify all non-expired entries are present
      const account = service2.get('org1@test.com', 'account');
      expect(account).to.not.be.undefined;
      expect(account!.type).to.equal(SchemaEntryType.FullDescribe);

      const contact = service2.get('org1@test.com', 'contact');
      expect(contact).to.not.be.undefined;
      expect(contact!.type).to.equal(SchemaEntryType.PartialFields);

      const lead = service2.get('org2@test.com', 'lead');
      expect(lead).to.not.be.undefined;
      expect(lead!.type).to.equal(SchemaEntryType.FullDescribe);
    });
  });

  describe('TTL-expired entries discarded on load', () => {
    it('discards expired entries and keeps fresh entries across restart', async () => {
      const ttlMs = 3_600_000; // 1 hour

      // Instance 1: set entries with mixed freshness
      const service1 = new SchemaService({ dataDir, ttlMs });
      const expiredEntry = makeFullDescribeEntry(Date.now() - ttlMs - 10000);
      const freshEntry = makePartialFieldsEntry('Contact', Date.now() - 1000);

      service1.set('user@org.com', 'OldObject', expiredEntry);
      service1.set('user@org.com', 'FreshObject', freshEntry);

      await service1.flushToDisk();

      // Instance 2: load from disk
      const service2 = new SchemaService({ dataDir, ttlMs });
      await service2.loadFromDisk();

      // Expired entry should be gone
      expect(service2.get('user@org.com', 'OldObject')).to.be.undefined;
      // Fresh entry should be present
      expect(service2.get('user@org.com', 'FreshObject')).to.not.be.undefined;
    });
  });

  describe('debounced write coalescing', () => {
    it('5 rapid mutations produce a file after flush', async () => {
      const service = new SchemaService({ dataDir, ttlMs: 3_600_000 });

      // Set 5 entries rapidly
      for (let i = 0; i < 5; i++) {
        service.set('user@org.com', `Object${i}`, makeFullDescribeEntry());
      }

      // Flush to ensure writes happen
      await service.flushToDisk();

      // Verify only one file exists per org
      const cacheDir = join(dataDir, 'schema-cache');
      const files = await readdir(cacheDir);
      expect(files).to.have.lengthOf(1);
      expect(files[0]).to.equal('user@org.com.json');
    });
  });

  describe('shutdown flushes', () => {
    it('set entries → shutdown → verify files exist on disk', async () => {
      const service = new SchemaService({ dataDir, ttlMs: 3_600_000 });
      service.set('org1@test.com', 'Account', makeFullDescribeEntry());
      service.set('org2@test.com', 'Contact', makePartialFieldsEntry('Contact'));

      await service.shutdown();

      const cacheDir = join(dataDir, 'schema-cache');
      const files = await readdir(cacheDir);
      expect(files.sort()).to.deep.equal(['org1@test.com.json', 'org2@test.com.json']);

      // After shutdown, caches are cleared
      expect(service.getOrgCacheSize('org1@test.com')).to.equal(0);
      expect(service.getOrgCacheSize('org2@test.com')).to.equal(0);
    });
  });

  describe('DxCoreMcpProvider creates SchemaService', () => {
    it('provider.getSchemaService() returns SchemaService after provideTools()', async () => {
      const provider = new DxCoreMcpProvider();

      const services = {
        getConfigService: () => ({
          getDataDir: () => dataDir,
          getStartupFlags: () => ({ 'allow-non-ga-tools': undefined, debug: undefined }),
        }),
        getTelemetryService: () => ({
          sendEvent: sinon.stub(),
        }),
        getOrgService: () => ({
          getAllowedOrgUsernames: sinon.stub().resolves(new Set()),
          getAllowedOrgs: sinon.stub().resolves([]),
          getConnection: sinon.stub(),
          getDefaultTargetOrg: sinon.stub().resolves(undefined),
          getDefaultTargetDevHub: sinon.stub().resolves(undefined),
          findOrgByUsernameOrAlias: sinon.stub(),
        }),
        getPermissionService: () => ({
          getOrgPermission: sinon.stub().returns('full-access'),
          canExecuteCategory: sinon.stub().returns('allow'),
          getAuthorizedOrgs: sinon.stub().returns([]),
        }),
      } as unknown as Services;

      const tools = await provider.provideTools(services);

      // SchemaService should be available
      const schemaService = provider.getSchemaService();
      expect(schemaService).to.not.be.undefined;
      expect(schemaService).to.be.instanceOf(SchemaService);

      // Tools should still be provided
      expect(tools.length).to.be.greaterThan(0);
    });
  });

  describe('no persistence when dataDir not provided', () => {
    it('SchemaService without dataDir works normally (no disk I/O)', async () => {
      const service = new SchemaService({ ttlMs: 3_600_000 });
      service.set('user@org.com', 'Account', makeFullDescribeEntry());

      expect(service.get('user@org.com', 'account')).to.not.be.undefined;

      // These should be no-ops, not errors
      await service.loadFromDisk();
      await service.flushToDisk();
      await service.shutdown();
    });
  });
});
