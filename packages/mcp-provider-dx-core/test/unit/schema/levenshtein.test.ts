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
import { levenshtein, findSimilarFields } from '../../../src/schema/levenshtein.js';

describe('levenshtein()', () => {
  it('should return 0 for exact match', () => {
    expect(levenshtein('Name', 'Name')).to.equal(0);
  });

  it('should return 0 for both empty strings', () => {
    expect(levenshtein('', '')).to.equal(0);
  });

  it('should return length of other string when one is empty', () => {
    expect(levenshtein('', 'abc')).to.equal(3);
    expect(levenshtein('abc', '')).to.equal(3);
  });

  it('should handle transposition-like edits', () => {
    expect(levenshtein('Naem', 'Name')).to.equal(2);
  });

  it('should handle single deletion', () => {
    expect(levenshtein('Nam', 'Name')).to.equal(1);
  });

  it('should handle longer strings with errors', () => {
    expect(levenshtein('AccountName', 'AccountNaem')).to.equal(2);
  });

  it('should handle completely different strings of same length', () => {
    expect(levenshtein('xyz', 'abc')).to.equal(3);
  });

  it('should handle single character substitution', () => {
    expect(levenshtein('a', 'b')).to.equal(1);
  });

  it('should compute classic textbook example', () => {
    expect(levenshtein('kitten', 'sitting')).to.equal(3);
  });
});

describe('findSimilarFields()', () => {
  it('should return closest match', () => {
    const result = findSimilarFields('Naem', ['Name', 'Id', 'Email', 'Phone']);
    expect(result).to.deep.equal(['Name']);
  });

  it('should return top 3 ranked by distance', () => {
    const result = findSimilarFields('Amont', ['Amount', 'AmountPaid__c', 'AnnualRevenue', 'Id']);
    expect(result[0]).to.equal('Amount');
    expect(result.length).to.be.at.most(3);
  });

  it('should return empty array when no close matches exist', () => {
    const result = findSimilarFields('xyzxyzxyz', ['Name', 'Id', 'Email']);
    expect(result).to.deep.equal([]);
  });

  it('should be case-insensitive (return original casing)', () => {
    const result = findSimilarFields('name', ['Name', 'Id', 'Email']);
    expect(result).to.deep.equal(['Name']);
  });

  it('should respect maxResults parameter', () => {
    const result = findSimilarFields('Naem', ['Name', 'Id'], 1);
    expect(result).to.have.lengthOf(1);
    expect(result[0]).to.equal('Name');
  });

  it('should return empty array for empty field list', () => {
    const result = findSimilarFields('Naem', []);
    expect(result).to.deep.equal([]);
  });

  it('should preserve original casing in results', () => {
    const result = findSimilarFields('accountid', ['AccountId', 'Account_Id__c', 'Id']);
    expect(result[0]).to.equal('AccountId');
  });
});
