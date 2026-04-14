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
import { extractRelationshipEdges } from '../../../src/schema/relationship-edges.js';
import type { RelationshipEdge } from '../../../src/schema/types.js';
import { SchemaService } from '../../../src/schema/schema-service.js';
import { SchemaEntryType, type FullDescribeEntry } from '../../../src/schema/types.js';

describe('extractRelationshipEdges', () => {
  it('should extract outbound lookup edges from fields with referenceTo', () => {
    const data = {
      fields: [
        { name: 'AccountId', referenceTo: ['Account'], relationshipName: 'Account' },
      ],
      childRelationships: [],
    };
    const edges = extractRelationshipEdges('Contact', data);
    expect(edges).to.deep.include({
      from: 'Contact',
      to: 'Account',
      via: 'AccountId',
      type: 'lookup',
    });
  });

  it('should extract inbound child edges with cascadeDelete=false as lookup', () => {
    const data = {
      fields: [],
      childRelationships: [
        { childSObject: 'Contact', field: 'AccountId', relationshipName: 'Contacts', cascadeDelete: false },
      ],
    };
    const edges = extractRelationshipEdges('Account', data);
    expect(edges).to.deep.include({
      from: 'Contact',
      to: 'Account',
      via: 'AccountId',
      type: 'lookup',
    });
  });

  it('should extract inbound child edges with cascadeDelete=true as master-detail', () => {
    const data = {
      fields: [],
      childRelationships: [
        { childSObject: 'OpportunityLineItem', field: 'OpportunityId', relationshipName: 'OpportunityLineItems', cascadeDelete: true },
      ],
    };
    const edges = extractRelationshipEdges('Opportunity', data);
    expect(edges).to.deep.include({
      from: 'OpportunityLineItem',
      to: 'Opportunity',
      via: 'OpportunityId',
      type: 'master-detail',
    });
  });

  it('should create one edge per target for polymorphic lookups', () => {
    const data = {
      fields: [
        { name: 'WhoId', referenceTo: ['Contact', 'Lead'], relationshipName: 'Who' },
      ],
      childRelationships: [],
    };
    const edges = extractRelationshipEdges('Task', data);
    expect(edges).to.have.lengthOf(2);
    expect(edges).to.deep.include({ from: 'Task', to: 'Contact', via: 'WhoId', type: 'lookup' });
    expect(edges).to.deep.include({ from: 'Task', to: 'Lead', via: 'WhoId', type: 'lookup' });
  });

  it('should skip fields with null relationshipName', () => {
    const data = {
      fields: [
        { name: 'FormulaRef', referenceTo: ['Account'], relationshipName: null },
      ],
      childRelationships: [],
    };
    const edges = extractRelationshipEdges('Contact', data);
    expect(edges).to.have.lengthOf(0);
  });

  it('should skip childRelationships with null relationshipName', () => {
    const data = {
      fields: [],
      childRelationships: [
        { childSObject: 'Task', field: 'WhatId', relationshipName: null, cascadeDelete: false },
      ],
    };
    const edges = extractRelationshipEdges('Account', data);
    expect(edges).to.have.lengthOf(0);
  });

  it('should return empty array for empty fields', () => {
    const data = { fields: [], childRelationships: [] };
    const edges = extractRelationshipEdges('Account', data);
    expect(edges).to.be.an('array').with.lengthOf(0);
  });

  it('should handle missing fields/childRelationships gracefully', () => {
    const data = {};
    const edges = extractRelationshipEdges('Account', data);
    expect(edges).to.be.an('array').with.lengthOf(0);
  });

  it('should handle self-referencing relationships', () => {
    const data = {
      fields: [
        { name: 'ParentId', referenceTo: ['Account'], relationshipName: 'Parent' },
      ],
      childRelationships: [],
    };
    const edges = extractRelationshipEdges('Account', data);
    expect(edges).to.deep.include({
      from: 'Account',
      to: 'Account',
      via: 'ParentId',
      type: 'lookup',
    });
  });

  it('should combine outbound and inbound edges from full describe', () => {
    const data = {
      fields: [
        { name: 'OwnerId', referenceTo: ['User'], relationshipName: 'Owner' },
        { name: 'ParentId', referenceTo: ['Account'], relationshipName: 'Parent' },
        { name: 'Name', referenceTo: [], relationshipName: null },
      ],
      childRelationships: [
        { childSObject: 'Contact', field: 'AccountId', relationshipName: 'Contacts', cascadeDelete: false },
        { childSObject: 'Opportunity', field: 'AccountId', relationshipName: 'Opportunities', cascadeDelete: false },
        { childSObject: 'Task', field: 'WhatId', relationshipName: null, cascadeDelete: false },
      ],
    };
    const edges = extractRelationshipEdges('Account', data);
    // 2 outbound (OwnerId→User, ParentId→Account) + 2 inbound (Contact, Opportunity) = 4
    // Task skipped (null relationshipName), Name skipped (empty referenceTo)
    // ParentId→Account is self-referencing: from='Account' AND to='Account'
    expect(edges).to.have.lengthOf(4);
    expect(edges.filter((e: RelationshipEdge) => e.from === 'Account')).to.have.lengthOf(2); // outbound
    expect(edges.filter((e: RelationshipEdge) => e.to === 'Account')).to.have.lengthOf(3);   // inbound (2 children + self-ref)
  });
});

describe('SchemaService relationship wrappers', () => {
  it('should store and retrieve relationship edges', () => {
    const svc = new SchemaService();
    const edges: RelationshipEdge[] = [
      { from: 'Contact', to: 'Account', via: 'AccountId', type: 'lookup' },
    ];
    svc.setRelationships('orgA', 'Account', edges);
    const result = svc.getRelationships('orgA', 'Account');
    expect(result).to.deep.equal(edges);
  });

  it('should return undefined when no edges cached', () => {
    const svc = new SchemaService();
    expect(svc.getRelationships('orgA', 'Account')).to.be.undefined;
  });

  it('should not collide with FullDescribeEntry for the same object', () => {
    const svc = new SchemaService();
    const describeEntry: FullDescribeEntry = {
      type: SchemaEntryType.FullDescribe,
      data: { name: 'Account', fields: [] },
      cachedAt: Date.now(),
    };
    svc.set('orgA', 'Account', describeEntry);

    const edges: RelationshipEdge[] = [
      { from: 'Contact', to: 'Account', via: 'AccountId', type: 'lookup' },
    ];
    svc.setRelationships('orgA', 'Account', edges);

    // Both should coexist
    expect(svc.get('orgA', 'Account')).to.deep.equal(describeEntry);
    expect(svc.getRelationships('orgA', 'Account')).to.deep.equal(edges);
  });

  it('should be case-insensitive on objectName', () => {
    const svc = new SchemaService();
    const edges: RelationshipEdge[] = [
      { from: 'Contact', to: 'Account', via: 'AccountId', type: 'lookup' },
    ];
    svc.setRelationships('orgA', 'Account', edges);
    expect(svc.getRelationships('orgA', 'account')).to.deep.equal(edges);
    expect(svc.getRelationships('orgA', 'ACCOUNT')).to.deep.equal(edges);
  });
});
