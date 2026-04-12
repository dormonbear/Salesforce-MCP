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
import { SchemaService } from '../../../src/schema/schema-service.js';
import {
  SchemaEntryType,
  type FullDescribeEntry,
  type PartialFieldsEntry,
  type RelationshipEdgesEntry,
  type SchemaEntry,
} from '../../../src/schema/types.js';

describe('SchemaService', () => {
  let service: SchemaService;

  beforeEach(() => {
    service = new SchemaService();
  });

  afterEach(() => {
    sinon.restore();
  });

  // ─── Per-org isolation ──────────────────────────────────────────────

  describe('per-org isolation', () => {
    const fullDescribeEntry: FullDescribeEntry = {
      type: SchemaEntryType.FullDescribe,
      data: { fields: [{ name: 'Id' }], childRelationships: [] },
      cachedAt: Date.now(),
    };

    it('should return undefined when querying a different org', () => {
      service.set('orgA', 'Account', fullDescribeEntry);
      const result = service.get('orgB', 'Account');
      expect(result).to.be.undefined;
    });

    it('should return the entry when querying the same org', () => {
      service.set('orgA', 'Account', fullDescribeEntry);
      const result = service.get('orgA', 'Account');
      expect(result).to.deep.equal(fullDescribeEntry);
    });

    it('should store different entries for the same object name in different orgs', () => {
      const entryA: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: { label: 'Account A' },
        cachedAt: Date.now(),
      };
      const entryB: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: { label: 'Account B' },
        cachedAt: Date.now(),
      };

      service.set('orgA', 'Account', entryA);
      service.set('orgB', 'Account', entryB);

      expect(service.get('orgA', 'Account')).to.deep.equal(entryA);
      expect(service.get('orgB', 'Account')).to.deep.equal(entryB);
    });
  });

  // ─── TTL expiry ─────────────────────────────────────────────────────

  describe('TTL expiry', () => {
    it('should return the entry immediately after set', () => {
      const entry: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: { fields: [] },
        cachedAt: Date.now(),
      };
      service.set('orgA', 'Account', entry);
      expect(service.get('orgA', 'Account')).to.deep.equal(entry);
    });

    it('should return undefined after TTL expires', (done) => {
      // Create service with very short TTL (50ms)
      const shortTtlService = new SchemaService({ ttlMs: 50 });
      const entry: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: { fields: [] },
        cachedAt: Date.now(),
      };
      shortTtlService.set('orgA', 'Account', entry);

      // Immediately should be present
      expect(shortTtlService.get('orgA', 'Account')).to.deep.equal(entry);

      // After TTL, should be gone
      setTimeout(() => {
        expect(shortTtlService.get('orgA', 'Account')).to.be.undefined;
        done();
      }, 100);
    });

    it('should use SF_SCHEMA_CACHE_TTL_MINUTES env var to override default TTL', () => {
      const originalEnv = process.env.SF_SCHEMA_CACHE_TTL_MINUTES;
      try {
        process.env.SF_SCHEMA_CACHE_TTL_MINUTES = '1'; // 1 minute = 60000ms
        const envService = new SchemaService();
        const entry: FullDescribeEntry = {
          type: SchemaEntryType.FullDescribe,
          data: { fields: [] },
          cachedAt: Date.now(),
        };
        envService.set('orgA', 'Account', entry);
        // Entry should be present (TTL hasn't expired yet, 60s is plenty)
        expect(envService.get('orgA', 'Account')).to.deep.equal(entry);
      } finally {
        if (originalEnv === undefined) {
          delete process.env.SF_SCHEMA_CACHE_TTL_MINUTES;
        } else {
          process.env.SF_SCHEMA_CACHE_TTL_MINUTES = originalEnv;
        }
      }
    });
  });

  // ─── Three data types ───────────────────────────────────────────────

  describe('three data types', () => {
    it('should store and retrieve a FullDescribeEntry', () => {
      const entry: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: { fields: [{ name: 'Id' }], childRelationships: [{ childSObject: 'Contact' }] },
        cachedAt: Date.now(),
      };
      service.set('orgA', 'Account', entry);
      const result = service.get('orgA', 'Account');
      expect(result).to.deep.equal(entry);
      expect(result?.type).to.equal('full-describe');
    });

    it('should store and retrieve a PartialFieldsEntry', () => {
      const entry: PartialFieldsEntry = {
        type: SchemaEntryType.PartialFields,
        objectName: 'Account',
        fieldNames: ['Id', 'Name', 'Industry'],
        cachedAt: Date.now(),
      };
      service.set('orgA', 'Account', entry);
      const result = service.get('orgA', 'Account');
      expect(result).to.deep.equal(entry);
      expect(result?.type).to.equal('partial-fields');
    });

    it('should store and retrieve a RelationshipEdgesEntry', () => {
      const entry: RelationshipEdgesEntry = {
        type: SchemaEntryType.RelationshipEdges,
        edges: [
          { from: 'Contact', to: 'Account', via: 'AccountId', type: 'lookup' },
          { from: 'Opportunity', to: 'Account', via: 'AccountId', type: 'master-detail' },
        ],
        cachedAt: Date.now(),
      };
      service.set('orgA', 'Account', entry);
      const result = service.get('orgA', 'Account');
      expect(result).to.deep.equal(entry);
      expect(result?.type).to.equal('relationship-edges');
    });

    it('should store all three types for different objects in the same org', () => {
      const fullDescribe: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: { fields: [] },
        cachedAt: Date.now(),
      };
      const partialFields: PartialFieldsEntry = {
        type: SchemaEntryType.PartialFields,
        objectName: 'Contact',
        fieldNames: ['Id', 'FirstName'],
        cachedAt: Date.now(),
      };
      const relEdges: RelationshipEdgesEntry = {
        type: SchemaEntryType.RelationshipEdges,
        edges: [{ from: 'Opportunity', to: 'Account', via: 'AccountId', type: 'lookup' }],
        cachedAt: Date.now(),
      };

      service.set('orgA', 'Account', fullDescribe);
      service.set('orgA', 'Contact', partialFields);
      service.set('orgA', 'Opportunity', relEdges);

      expect(service.get('orgA', 'Account')?.type).to.equal('full-describe');
      expect(service.get('orgA', 'Contact')?.type).to.equal('partial-fields');
      expect(service.get('orgA', 'Opportunity')?.type).to.equal('relationship-edges');
    });
  });

  // ─── LRU eviction ──────────────────────────────────────────────────

  describe('LRU eviction', () => {
    it('should evict the oldest entry when max (100) is exceeded', () => {
      // Insert 101 entries into one org's cache (max=100)
      for (let i = 0; i < 101; i++) {
        const entry: FullDescribeEntry = {
          type: SchemaEntryType.FullDescribe,
          data: { index: i },
          cachedAt: Date.now(),
        };
        service.set('orgA', `Object${i}`, entry);
      }

      // The very first entry (Object0) should have been evicted
      expect(service.get('orgA', 'Object0')).to.be.undefined;
      // The last entry should still be present
      expect(service.get('orgA', 'Object100')).to.not.be.undefined;
      // Size should be at most 100
      expect(service.getOrgCacheSize('orgA')).to.equal(100);
    });

    it('should refresh LRU position on access, keeping accessed entry', () => {
      // Insert 100 entries: Object0 through Object99
      for (let i = 0; i < 100; i++) {
        const entry: FullDescribeEntry = {
          type: SchemaEntryType.FullDescribe,
          data: { index: i },
          cachedAt: Date.now(),
        };
        service.set('orgA', `Object${i}`, entry);
      }

      // Access Object0 (the oldest) to refresh its position
      service.get('orgA', 'Object0');

      // Insert one more entry to trigger eviction
      const newEntry: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: { index: 100 },
        cachedAt: Date.now(),
      };
      service.set('orgA', 'Object100', newEntry);

      // Object0 should still be present (it was accessed recently)
      expect(service.get('orgA', 'Object0')).to.not.be.undefined;
      // Object1 should have been evicted (it was the oldest non-accessed entry)
      expect(service.get('orgA', 'Object1')).to.be.undefined;
    });
  });

  // ─── Single-flight coalescing ───────────────────────────────────────

  describe('single-flight coalescing', () => {
    it('should call describeFn exactly once for 10 concurrent requests for the same org+object', async () => {
      const entry: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: { fields: [{ name: 'Id' }] },
        cachedAt: Date.now(),
      };
      const describeFn = sinon.stub().callsFake(
        () => new Promise<SchemaEntry>((resolve) => setTimeout(() => resolve(entry), 50)),
      );

      // Fire 10 concurrent requests
      const promises = Array.from({ length: 10 }, () =>
        service.describeAndCache('orgA', 'Account', describeFn),
      );

      const results = await Promise.all(promises);

      // describeFn should have been called exactly once
      sinon.assert.calledOnce(describeFn);
      // All results should be the same entry
      for (const result of results) {
        expect(result).to.deep.equal(entry);
      }
    });

    it('should call describeFn once per different object in concurrent requests', async () => {
      const accountEntry: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: { name: 'Account' },
        cachedAt: Date.now(),
      };
      const contactEntry: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: { name: 'Contact' },
        cachedAt: Date.now(),
      };

      const accountFn = sinon.stub().callsFake(
        () => new Promise<SchemaEntry>((resolve) => setTimeout(() => resolve(accountEntry), 50)),
      );
      const contactFn = sinon.stub().callsFake(
        () => new Promise<SchemaEntry>((resolve) => setTimeout(() => resolve(contactEntry), 50)),
      );

      const promises = [
        service.describeAndCache('orgA', 'Account', accountFn),
        service.describeAndCache('orgA', 'Contact', contactFn),
        service.describeAndCache('orgA', 'Account', accountFn),
        service.describeAndCache('orgA', 'Contact', contactFn),
      ];

      await Promise.all(promises);

      sinon.assert.calledOnce(accountFn);
      sinon.assert.calledOnce(contactFn);
    });

    it('should allow a new describeFn call after the previous single-flight resolves', async () => {
      const entry1: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: { version: 1 },
        cachedAt: Date.now(),
      };
      const entry2: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: { version: 2 },
        cachedAt: Date.now(),
      };

      const describeFn = sinon.stub();
      describeFn.onFirstCall().resolves(entry1);
      describeFn.onSecondCall().resolves(entry2);

      // First call
      const result1 = await service.describeAndCache('orgA', 'Account', describeFn);
      expect(result1).to.deep.equal(entry1);

      // Invalidate the cached entry so the second call will actually call describeFn
      service.invalidate('orgA', 'Account');

      // Second call — should trigger describeFn again since in-flight is cleaned up
      const result2 = await service.describeAndCache('orgA', 'Account', describeFn);
      expect(result2).to.deep.equal(entry2);

      sinon.assert.calledTwice(describeFn);
    });

    it('should propagate rejection to all waiters and clean up in-flight entry for retry', async () => {
      const error = new Error('API failure');
      const describeFn = sinon.stub().callsFake(
        () => new Promise<SchemaEntry>((_, reject) => setTimeout(() => reject(error), 50)),
      );

      // Fire 3 concurrent requests
      const promises = Array.from({ length: 3 }, () =>
        service.describeAndCache('orgA', 'Account', describeFn),
      );

      // All should reject with the same error
      for (const promise of promises) {
        try {
          await promise;
          expect.fail('Expected rejection');
        } catch (err) {
          expect(err).to.equal(error);
        }
      }

      sinon.assert.calledOnce(describeFn);

      // After rejection, a new call should trigger describeFn again (in-flight cleaned up)
      const retryEntry: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: { retry: true },
        cachedAt: Date.now(),
      };
      describeFn.onSecondCall().resolves(retryEntry);

      const retryResult = await service.describeAndCache('orgA', 'Account', describeFn);
      expect(retryResult).to.deep.equal(retryEntry);
      sinon.assert.calledTwice(describeFn);
    });
  });

  // ─── Object name normalization ──────────────────────────────────────

  describe('object name normalization', () => {
    it('should normalize object names to lowercase for cache keys', () => {
      const entry: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: { fields: [] },
        cachedAt: Date.now(),
      };
      service.set('orgA', 'Account', entry);

      // Different cases should all resolve to the same entry
      expect(service.get('orgA', 'account')).to.deep.equal(entry);
      expect(service.get('orgA', 'ACCOUNT')).to.deep.equal(entry);
      expect(service.get('orgA', 'Account')).to.deep.equal(entry);
    });
  });

  // ─── Utility methods ────────────────────────────────────────────────

  describe('utility methods', () => {
    it('invalidate should return true when entry exists', () => {
      const entry: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: {},
        cachedAt: Date.now(),
      };
      service.set('orgA', 'Account', entry);
      expect(service.invalidate('orgA', 'Account')).to.be.true;
      expect(service.get('orgA', 'Account')).to.be.undefined;
    });

    it('invalidate should return false when entry does not exist', () => {
      expect(service.invalidate('orgA', 'Account')).to.be.false;
    });

    it('invalidateOrg should remove all entries for an org', () => {
      const entry: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: {},
        cachedAt: Date.now(),
      };
      service.set('orgA', 'Account', entry);
      service.set('orgA', 'Contact', entry);
      service.invalidateOrg('orgA');
      expect(service.get('orgA', 'Account')).to.be.undefined;
      expect(service.get('orgA', 'Contact')).to.be.undefined;
      expect(service.getOrgCacheSize('orgA')).to.equal(0);
    });

    it('clear should remove all entries from all orgs', () => {
      const entry: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: {},
        cachedAt: Date.now(),
      };
      service.set('orgA', 'Account', entry);
      service.set('orgB', 'Contact', entry);
      service.clear();
      expect(service.get('orgA', 'Account')).to.be.undefined;
      expect(service.get('orgB', 'Contact')).to.be.undefined;
    });

    it('getOrgCacheSize should return the number of entries in an org cache', () => {
      expect(service.getOrgCacheSize('orgA')).to.equal(0);
      const entry: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: {},
        cachedAt: Date.now(),
      };
      service.set('orgA', 'Account', entry);
      service.set('orgA', 'Contact', entry);
      expect(service.getOrgCacheSize('orgA')).to.equal(2);
    });

    it('getAllOrgUsernames should return all orgs with cached entries', () => {
      const entry: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: {},
        cachedAt: Date.now(),
      };
      service.set('orgA', 'Account', entry);
      service.set('orgB', 'Contact', entry);
      const orgs = service.getAllOrgUsernames();
      expect(orgs).to.include('orgA');
      expect(orgs).to.include('orgB');
      expect(orgs).to.have.lengthOf(2);
    });
  });

  // ─── onMutation callback ───────────────────────────────────────────

  describe('onMutation callback', () => {
    it('should call onMutation after set', () => {
      const mutationSpy = sinon.spy();
      service.onMutation = mutationSpy;

      const entry: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: {},
        cachedAt: Date.now(),
      };
      service.set('orgA', 'Account', entry);
      sinon.assert.calledOnce(mutationSpy);
    });

    it('should call onMutation after invalidate (when entry exists)', () => {
      const entry: FullDescribeEntry = {
        type: SchemaEntryType.FullDescribe,
        data: {},
        cachedAt: Date.now(),
      };
      service.set('orgA', 'Account', entry);

      const mutationSpy = sinon.spy();
      service.onMutation = mutationSpy;

      service.invalidate('orgA', 'Account');
      sinon.assert.calledOnce(mutationSpy);
    });

    it('should not call onMutation after invalidate when entry does not exist', () => {
      const mutationSpy = sinon.spy();
      service.onMutation = mutationSpy;

      service.invalidate('orgA', 'Account');
      sinon.assert.notCalled(mutationSpy);
    });
  });
});
