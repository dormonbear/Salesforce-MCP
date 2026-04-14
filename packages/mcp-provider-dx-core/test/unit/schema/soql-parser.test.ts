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
import { parseSoqlFields } from '../../../src/schema/soql-parser.js';

describe('parseSoqlFields', () => {
  describe('flat queries (ACCH-02)', () => {
    it('should extract object and fields from flat query', () => {
      const result = parseSoqlFields('SELECT Id, Name FROM Account');
      expect(result).to.deep.equal({ objectName: 'Account', fieldNames: ['Id', 'Name'] });
    });

    it('should handle case-insensitive keywords', () => {
      const result = parseSoqlFields('select id, name from account');
      expect(result).to.deep.equal({ objectName: 'account', fieldNames: ['id', 'name'] });
    });

    it('should handle extra whitespace', () => {
      const result = parseSoqlFields("SELECT  Id ,  Name  FROM  Account  WHERE Name = 'Test'");
      expect(result).to.deep.equal({ objectName: 'Account', fieldNames: ['Id', 'Name'] });
    });

    it('should handle single field', () => {
      const result = parseSoqlFields('SELECT Id FROM Account LIMIT 10');
      expect(result).to.deep.equal({ objectName: 'Account', fieldNames: ['Id'] });
    });

    it('should handle custom objects', () => {
      const result = parseSoqlFields('SELECT Id, Name FROM Custom_Object__c');
      expect(result).to.deep.equal({ objectName: 'Custom_Object__c', fieldNames: ['Id', 'Name'] });
    });

    it('should handle custom fields', () => {
      const result = parseSoqlFields('SELECT Custom_Field__c FROM Account');
      expect(result).to.deep.equal({ objectName: 'Account', fieldNames: ['Custom_Field__c'] });
    });
  });

  describe('alias handling (D-05)', () => {
    it('should strip field aliases', () => {
      const result = parseSoqlFields('SELECT Name n, Industry i FROM Account');
      expect(result).to.deep.equal({ objectName: 'Account', fieldNames: ['Name', 'Industry'] });
    });
  });

  describe('relationship fields (D-03)', () => {
    it('should filter out dotted relationship fields', () => {
      const result = parseSoqlFields('SELECT Id, Name, Account.Name FROM Contact');
      expect(result).to.deep.equal({ objectName: 'Contact', fieldNames: ['Id', 'Name'] });
    });

    it('should return null when all fields are dotted', () => {
      expect(parseSoqlFields('SELECT Account.Name FROM Contact')).to.be.null;
    });
  });

  describe('complex query skip (D-03)', () => {
    it('should return null for subqueries', () => {
      expect(parseSoqlFields('SELECT Id, (SELECT Id FROM Contacts) FROM Account')).to.be.null;
    });

    it('should return null for COUNT aggregate', () => {
      expect(parseSoqlFields('SELECT COUNT() FROM Account')).to.be.null;
    });

    it('should return null for SUM aggregate', () => {
      expect(parseSoqlFields('SELECT SUM(Amount) FROM Opportunity')).to.be.null;
    });

    it('should return null for GROUP BY', () => {
      expect(parseSoqlFields('SELECT Industry, COUNT(Id) FROM Account GROUP BY Industry')).to.be.null;
    });

    it('should return null for TYPEOF', () => {
      expect(parseSoqlFields('SELECT TYPEOF What WHEN Account THEN Name END FROM Event')).to.be.null;
    });
  });

  describe('edge cases', () => {
    it('should return null for empty string', () => {
      expect(parseSoqlFields('')).to.be.null;
    });

    it('should return null for whitespace-only string', () => {
      expect(parseSoqlFields('   ')).to.be.null;
    });

    it('should handle WHERE clause with SOQL keywords in string literal', () => {
      const result = parseSoqlFields("SELECT Id FROM Account WHERE Name = 'SELECT FROM'");
      expect(result).to.deep.equal({ objectName: 'Account', fieldNames: ['Id'] });
    });

    it('should never throw — returns null for unparseable input', () => {
      expect(parseSoqlFields('not a query at all')).to.be.null;
      expect(parseSoqlFields('INSERT INTO Account')).to.be.null;
    });
  });
});
