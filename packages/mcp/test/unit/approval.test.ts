import { expect } from 'chai';
import { buildApprovalMessage } from '../../src/utils/approval.js';

describe('approval', () => {
  describe('buildApprovalMessage', () => {
    it('should build message for DML update operation', () => {
      const message = buildApprovalMessage('salesforce_dml_records', 'OMNI_Live', {
        operation: 'update',
        objectName: 'Payment__c',
        records: [
          { Id: 'a6T001', Status__c: 'Processed' },
          { Id: 'a6T002', Status__c: 'Processed' },
        ],
      });

      expect(message).to.include('salesforce_dml_records');
      expect(message).to.include('OMNI_Live');
      expect(message).to.include('update');
      expect(message).to.include('Payment__c');
      expect(message).to.include('2');
    });

    it('should build message for DML delete operation', () => {
      const message = buildApprovalMessage('salesforce_dml_records', 'OMNI_Live', {
        operation: 'delete',
        objectName: 'Account',
        records: [{ Id: '001xxx' }],
      });

      expect(message).to.include('delete');
      expect(message).to.include('Account');
      expect(message).to.include('1');
    });

    it('should build message for execute_anonymous', () => {
      const message = buildApprovalMessage('salesforce_execute_anonymous', 'OMNI_Live', {
        apexCode: "delete [SELECT Id FROM Account WHERE Name = 'Test'];",
      });

      expect(message).to.include('salesforce_execute_anonymous');
      expect(message).to.include('OMNI_Live');
      expect(message).to.include('delete [SELECT Id FROM Account');
    });

    it('should build message for write_apex', () => {
      const message = buildApprovalMessage('salesforce_write_apex', 'OMNI_Live', {
        operation: 'update',
        className: 'AccountService',
        body: 'public class AccountService {}',
      });

      expect(message).to.include('salesforce_write_apex');
      expect(message).to.include('AccountService');
    });

    it('should truncate records when more than 5', () => {
      const records = Array.from({ length: 10 }, (_, i) => ({ Id: `001${i}`, Name: `Account ${i}` }));
      const message = buildApprovalMessage('salesforce_dml_records', 'prod', {
        operation: 'update',
        objectName: 'Account',
        records,
      });

      expect(message).to.include('10');
      expect(message).to.include('and 5 more');
    });

    it('should handle generic tool with unknown input shape', () => {
      const message = buildApprovalMessage('salesforce_manage_field', 'prod', {
        operation: 'create',
        objectName: 'Account',
        fieldName: 'Rating',
      });

      expect(message).to.include('salesforce_manage_field');
      expect(message).to.include('prod');
    });
  });
});
