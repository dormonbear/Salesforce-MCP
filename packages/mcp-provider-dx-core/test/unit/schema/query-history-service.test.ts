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
import { RingBuffer } from '../../../src/schema/query-history-types.js';
import { QueryHistoryService } from '../../../src/schema/query-history-service.js';

describe('RingBuffer', () => {
  it('should store and return items newest-first', () => {
    const buf = new RingBuffer(5);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.toArray()).to.deep.equal([3, 2, 1]);
  });

  it('should overwrite oldest items when full', () => {
    const buf = new RingBuffer(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    buf.push(4);
    buf.push(5);
    expect(buf.toArray()).to.deep.equal([5, 4, 3]);
    expect(buf.size).to.equal(3);
  });

  it('should report correct size', () => {
    const buf = new RingBuffer(5);
    expect(buf.size).to.equal(0);
    buf.push(1);
    expect(buf.size).to.equal(1);
    buf.push(2);
    expect(buf.size).to.equal(2);
  });

  it('should return empty array when empty', () => {
    const buf = new RingBuffer(10);
    expect(buf.toArray()).to.deep.equal([]);
    expect(buf.size).to.equal(0);
  });
});

describe('QueryHistoryService', () => {
  const originalEnv = process.env.SF_QUERY_HISTORY_LIMIT;

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env.SF_QUERY_HISTORY_LIMIT = originalEnv;
    } else {
      delete process.env.SF_QUERY_HISTORY_LIMIT;
    }
  });

  it('should default to limit 50', () => {
    delete process.env.SF_QUERY_HISTORY_LIMIT;
    const svc = new QueryHistoryService();
    expect(svc.getLimit()).to.equal(50);
  });

  it('should respect SF_QUERY_HISTORY_LIMIT env var', () => {
    process.env.SF_QUERY_HISTORY_LIMIT = '25';
    const svc = new QueryHistoryService();
    expect(svc.getLimit()).to.equal(25);
  });

  it('should fall back to default for invalid env var', () => {
    process.env.SF_QUERY_HISTORY_LIMIT = 'abc';
    const svc = new QueryHistoryService();
    expect(svc.getLimit()).to.equal(50);
  });

  it('should fall back to default for zero env var', () => {
    process.env.SF_QUERY_HISTORY_LIMIT = '0';
    const svc = new QueryHistoryService();
    expect(svc.getLimit()).to.equal(50);
  });

  it('should accept constructor limit arg', () => {
    delete process.env.SF_QUERY_HISTORY_LIMIT;
    const svc = new QueryHistoryService(10);
    expect(svc.getLimit()).to.equal(10);
  });

  it('should record and list entries newest-first', () => {
    delete process.env.SF_QUERY_HISTORY_LIMIT;
    const svc = new QueryHistoryService(50);
    svc.record('orgA', 'SELECT Id FROM Account', 'Account', 1);
    svc.record('orgA', 'SELECT Name FROM Contact', 'Contact', 1);
    const entries = svc.list('orgA');
    expect(entries).to.have.lengthOf(2);
    expect(entries[0].objectName).to.equal('Contact'); // newest
    expect(entries[1].objectName).to.equal('Account');
  });

  it('should isolate per-org histories', () => {
    delete process.env.SF_QUERY_HISTORY_LIMIT;
    const svc = new QueryHistoryService(50);
    svc.record('orgA', 'SELECT Id FROM Account', 'Account', 1);
    svc.record('orgB', 'SELECT Id FROM Contact', 'Contact', 1);
    expect(svc.list('orgA')).to.have.lengthOf(1);
    expect(svc.list('orgA')[0].objectName).to.equal('Account');
    expect(svc.list('orgB')).to.have.lengthOf(1);
  });

  it('should return empty array for unknown org', () => {
    delete process.env.SF_QUERY_HISTORY_LIMIT;
    const svc = new QueryHistoryService(50);
    expect(svc.list('unknown')).to.deep.equal([]);
  });

  it('should filter by objectName case-insensitively', () => {
    delete process.env.SF_QUERY_HISTORY_LIMIT;
    const svc = new QueryHistoryService(50);
    svc.record('orgA', 'SELECT Id FROM Account', 'Account', 1);
    svc.record('orgA', 'SELECT Id FROM Contact', 'Contact', 1);
    const filtered = svc.list('orgA', { objectName: 'account' });
    expect(filtered).to.have.lengthOf(1);
    expect(filtered[0].objectName).to.equal('Account');
  });

  it('should cap results with limit option', () => {
    delete process.env.SF_QUERY_HISTORY_LIMIT;
    const svc = new QueryHistoryService(50);
    for (let i = 0; i < 10; i++) {
      svc.record('orgA', `SELECT Id FROM Obj${i}`, `Obj${i}`, 1);
    }
    expect(svc.list('orgA', { limit: 5 })).to.have.lengthOf(5);
  });

  it('should allow duplicate queries (D-09)', () => {
    delete process.env.SF_QUERY_HISTORY_LIMIT;
    const svc = new QueryHistoryService(50);
    svc.record('orgA', 'SELECT Id FROM Account', 'Account', 1);
    svc.record('orgA', 'SELECT Id FROM Account', 'Account', 1);
    expect(svc.list('orgA')).to.have.lengthOf(2);
  });
});
