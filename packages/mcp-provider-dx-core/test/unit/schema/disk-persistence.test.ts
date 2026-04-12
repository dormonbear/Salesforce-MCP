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

import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { expect } from 'chai';
import sinon from 'sinon';
import { SchemaDiskPersistence } from '../../../src/schema/disk-persistence.js';
import { SchemaEntryType, type SchemaEntry, type FullDescribeEntry } from '../../../src/schema/types.js';

function makeEntry(cachedAt: number = Date.now()): FullDescribeEntry {
  return {
    type: SchemaEntryType.FullDescribe,
    data: { name: 'Account', fields: ['Id', 'Name'] },
    cachedAt,
  };
}

describe('SchemaDiskPersistence', () => {
  let dataDir: string;
  let persistence: SchemaDiskPersistence;
  const TTL_MS = 3_600_000; // 1 hour

  beforeEach(async () => {
    dataDir = join(tmpdir(), 'schema-test-' + randomUUID());
    await mkdir(dataDir, { recursive: true });
    persistence = new SchemaDiskPersistence({ dataDir, ttlMs: TTL_MS, debounceMs: 5000 });
  });

  afterEach(async () => {
    await rm(dataDir, { recursive: true, force: true });
    sinon.restore();
  });

  describe('saveOrg', () => {
    it('creates file at {dataDir}/schema-cache/{orgUsername}.json', async () => {
      const entries = new Map<string, SchemaEntry>([['account', makeEntry()]]);
      await persistence.saveOrg('user@org.com', entries);

      const filePath = join(dataDir, 'schema-cache', 'user@org.com.json');
      const content = await readFile(filePath, 'utf-8');
      expect(content).to.be.a('string');
    });

    it('writes valid JSON with entries and savedAt structure', async () => {
      const entry = makeEntry();
      const entries = new Map<string, SchemaEntry>([['account', entry]]);
      await persistence.saveOrg('user@org.com', entries);

      const filePath = join(dataDir, 'schema-cache', 'user@org.com.json');
      const content = JSON.parse(await readFile(filePath, 'utf-8')) as { entries: Record<string, unknown>; savedAt: number };
      expect(content).to.have.property('entries');
      expect(content).to.have.property('savedAt');
      expect(content.entries).to.have.property('account');
      expect(content.savedAt).to.be.a('number');
    });

    it('auto-creates directory if missing', async () => {
      // Use a fresh dataDir that doesn't have schema-cache subdir
      const freshDir = join(tmpdir(), 'schema-fresh-' + randomUUID());
      const freshPersistence = new SchemaDiskPersistence({ dataDir: freshDir, ttlMs: TTL_MS });
      const entries = new Map<string, SchemaEntry>([['account', makeEntry()]]);

      await freshPersistence.saveOrg('user@org.com', entries);

      const filePath = join(freshDir, 'schema-cache', 'user@org.com.json');
      const content = await readFile(filePath, 'utf-8');
      expect(content).to.be.a('string');

      await rm(freshDir, { recursive: true, force: true });
    });
  });

  describe('loadOrg', () => {
    it('reads the JSON file and returns entries', async () => {
      const entry = makeEntry();
      const entries = new Map<string, SchemaEntry>([['account', entry]]);
      await persistence.saveOrg('user@org.com', entries);

      const loaded = await persistence.loadOrg('user@org.com');
      expect(loaded.size).to.equal(1);
      expect(loaded.has('account')).to.be.true;
      const loadedEntry = loaded.get('account')!;
      expect(loadedEntry.type).to.equal(SchemaEntryType.FullDescribe);
    });

    it('returns empty Map for non-existent file', async () => {
      const loaded = await persistence.loadOrg('nonexistent@org.com');
      expect(loaded.size).to.equal(0);
    });

    it('returns empty Map for corrupted JSON file', async () => {
      const cacheDir = join(dataDir, 'schema-cache');
      await mkdir(cacheDir, { recursive: true });
      await writeFile(join(cacheDir, 'corrupt@org.com.json'), '{invalid json!!', 'utf-8');

      const loaded = await persistence.loadOrg('corrupt@org.com');
      expect(loaded.size).to.equal(0);
    });
  });

  describe('loadOrg TTL discard', () => {
    it('discards entries where (Date.now() - entry.cachedAt) > ttlMs', async () => {
      const expiredEntry = makeEntry(Date.now() - TTL_MS - 1000);
      const entries = new Map<string, SchemaEntry>([['account', expiredEntry]]);
      await persistence.saveOrg('user@org.com', entries);

      const loaded = await persistence.loadOrg('user@org.com');
      expect(loaded.size).to.equal(0);
    });

    it('keeps entries where (Date.now() - entry.cachedAt) <= ttlMs', async () => {
      const freshEntry = makeEntry(Date.now() - 1000); // 1 second old
      const entries = new Map<string, SchemaEntry>([['account', freshEntry]]);
      await persistence.saveOrg('user@org.com', entries);

      const loaded = await persistence.loadOrg('user@org.com');
      expect(loaded.size).to.equal(1);
    });

    it('mixed file with 3 entries (1 expired, 2 fresh) returns only the 2 fresh entries', async () => {
      const expired = makeEntry(Date.now() - TTL_MS - 5000);
      const fresh1 = makeEntry(Date.now() - 1000);
      const fresh2 = makeEntry(Date.now() - 2000);
      const entries = new Map<string, SchemaEntry>([
        ['old_object', expired],
        ['fresh_one', fresh1],
        ['fresh_two', fresh2],
      ]);
      await persistence.saveOrg('user@org.com', entries);

      const loaded = await persistence.loadOrg('user@org.com');
      expect(loaded.size).to.equal(2);
      expect(loaded.has('old_object')).to.be.false;
      expect(loaded.has('fresh_one')).to.be.true;
      expect(loaded.has('fresh_two')).to.be.true;
    });
  });

  describe('debounced write', () => {
    let clock: sinon.SinonFakeTimers;

    beforeEach(() => {
      clock = sinon.useFakeTimers({ shouldAdvanceTime: false, toFake: ['setTimeout', 'clearTimeout'] });
    });

    afterEach(() => {
      clock.restore();
    });

    it('calling scheduleSave() multiple times within 5000ms results in only one writeFile call', async () => {
      let callCount = 0;
      const entries = new Map<string, SchemaEntry>([['account', makeEntry()]]);
      const getEntries = () => {
        callCount++;
        return entries;
      };

      // Schedule multiple times — all should coalesce
      persistence.scheduleSave('user@org.com', getEntries);
      persistence.scheduleSave('user@org.com', getEntries);
      persistence.scheduleSave('user@org.com', getEntries);

      // Flush to execute (bypasses timer, but proves coalescing)
      await persistence.flush();

      // getEntries should only have been called once (for the single coalesced save)
      expect(callCount).to.equal(1);

      const cacheDir = join(dataDir, 'schema-cache');
      const files = await readdir(cacheDir);
      expect(files).to.have.lengthOf(1);
      expect(files[0]).to.equal('user@org.com.json');
    });

    it('flush() writes immediately regardless of debounce timer', async () => {
      const entries = new Map<string, SchemaEntry>([['account', makeEntry()]]);
      const getEntries = () => entries;

      persistence.scheduleSave('user@org.com', getEntries);

      // Flush immediately without advancing time
      await persistence.flush();

      const cacheDir = join(dataDir, 'schema-cache');
      const files = await readdir(cacheDir);
      expect(files).to.have.lengthOf(1);
      expect(files[0]).to.equal('user@org.com.json');
    });
  });

  describe('loadAll', () => {
    it('reads all .json files from {dataDir}/schema-cache/ directory', async () => {
      const entries1 = new Map<string, SchemaEntry>([['account', makeEntry()]]);
      const entries2 = new Map<string, SchemaEntry>([['contact', makeEntry()]]);
      await persistence.saveOrg('org1@test.com', entries1);
      await persistence.saveOrg('org2@test.com', entries2);

      const allOrgs = await persistence.loadAll();
      expect(allOrgs.size).to.equal(2);
      expect(allOrgs.has('org1@test.com')).to.be.true;
      expect(allOrgs.has('org2@test.com')).to.be.true;
      expect(allOrgs.get('org1@test.com')!.has('account')).to.be.true;
      expect(allOrgs.get('org2@test.com')!.has('contact')).to.be.true;
    });

    it('returns Map with TTL-expired entries discarded', async () => {
      const expired = makeEntry(Date.now() - TTL_MS - 5000);
      const fresh = makeEntry(Date.now() - 1000);
      const entries = new Map<string, SchemaEntry>([
        ['expired_obj', expired],
        ['fresh_obj', fresh],
      ]);
      await persistence.saveOrg('mixed@org.com', entries);

      const allOrgs = await persistence.loadAll();
      const orgEntries = allOrgs.get('mixed@org.com');
      expect(orgEntries).to.not.be.undefined;
      expect(orgEntries!.size).to.equal(1);
      expect(orgEntries!.has('fresh_obj')).to.be.true;
      expect(orgEntries!.has('expired_obj')).to.be.false;
    });

    it('returns empty Map with non-existent directory', async () => {
      const freshDir = join(tmpdir(), 'schema-nonexist-' + randomUUID());
      const freshPersistence = new SchemaDiskPersistence({ dataDir: freshDir, ttlMs: TTL_MS });

      const allOrgs = await freshPersistence.loadAll();
      expect(allOrgs.size).to.equal(0);
    });

    it('returns empty Map with empty directory', async () => {
      const emptyDir = join(tmpdir(), 'schema-empty-' + randomUUID());
      await mkdir(join(emptyDir, 'schema-cache'), { recursive: true });
      const emptyPersistence = new SchemaDiskPersistence({ dataDir: emptyDir, ttlMs: TTL_MS });

      const allOrgs = await emptyPersistence.loadAll();
      expect(allOrgs.size).to.equal(0);

      await rm(emptyDir, { recursive: true, force: true });
    });
  });

  describe('flush', () => {
    it('saves all pending orgs immediately', async () => {
      const entries1 = new Map<string, SchemaEntry>([['account', makeEntry()]]);
      const entries2 = new Map<string, SchemaEntry>([['contact', makeEntry()]]);

      persistence.scheduleSave('org1@test.com', () => entries1);
      persistence.scheduleSave('org2@test.com', () => entries2);

      await persistence.flush();

      const cacheDir = join(dataDir, 'schema-cache');
      const files = await readdir(cacheDir);
      expect(files.sort()).to.deep.equal(['org1@test.com.json', 'org2@test.com.json']);
    });

    it('clears pending state after flush', async () => {
      const entries = new Map<string, SchemaEntry>([['account', makeEntry()]]);
      persistence.scheduleSave('user@org.com', () => entries);

      await persistence.flush();

      // Second flush should be a no-op (nothing pending)
      const cacheDir = join(dataDir, 'schema-cache');
      const filesBefore = await readdir(cacheDir);

      await persistence.flush();
      const filesAfter = await readdir(cacheDir);
      expect(filesAfter).to.deep.equal(filesBefore);
    });
  });

  describe('path traversal protection', () => {
    it('rejects orgUsername with forward slash', async () => {
      const entries = new Map<string, SchemaEntry>([['account', makeEntry()]]);
      await persistence.saveOrg('../evil/path', entries);

      // Should not create file outside schema-cache
      const loaded = await persistence.loadOrg('../evil/path');
      expect(loaded.size).to.equal(0);
    });

    it('rejects orgUsername with backslash', async () => {
      const entries = new Map<string, SchemaEntry>([['account', makeEntry()]]);
      await persistence.saveOrg('..\\evil\\path', entries);

      const loaded = await persistence.loadOrg('..\\evil\\path');
      expect(loaded.size).to.equal(0);
    });
  });
});
