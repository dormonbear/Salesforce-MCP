import { expect } from 'chai';
import { getToolCategory } from '../../src/utils/tool-categories.js';

describe('tool-categories', () => {
  describe('getToolCategory', () => {
    // Read tools
    it('should classify run_soql_query as read', () => {
      expect(getToolCategory('run_soql_query')).to.equal('read');
    });

    it('should classify salesforce_query_records as read', () => {
      expect(getToolCategory('salesforce_query_records')).to.equal('read');
    });

    it('should classify salesforce_aggregate_query as read', () => {
      expect(getToolCategory('salesforce_aggregate_query')).to.equal('read');
    });

    it('should classify salesforce_describe_object as read', () => {
      expect(getToolCategory('salesforce_describe_object')).to.equal('read');
    });

    it('should classify salesforce_search_all as read', () => {
      expect(getToolCategory('salesforce_search_all')).to.equal('read');
    });

    it('should classify salesforce_search_objects as read', () => {
      expect(getToolCategory('salesforce_search_objects')).to.equal('read');
    });

    it('should classify salesforce_read_apex as read', () => {
      expect(getToolCategory('salesforce_read_apex')).to.equal('read');
    });

    it('should classify salesforce_read_apex_trigger as read', () => {
      expect(getToolCategory('salesforce_read_apex_trigger')).to.equal('read');
    });

    it('should classify salesforce_get_org_info as read', () => {
      expect(getToolCategory('salesforce_get_org_info')).to.equal('read');
    });

    // Write tools
    it('should classify salesforce_dml_records as write', () => {
      expect(getToolCategory('salesforce_dml_records')).to.equal('write');
    });

    it('should classify salesforce_write_apex as write', () => {
      expect(getToolCategory('salesforce_write_apex')).to.equal('write');
    });

    it('should classify salesforce_write_apex_trigger as write', () => {
      expect(getToolCategory('salesforce_write_apex_trigger')).to.equal('write');
    });

    it('should classify salesforce_manage_object as write', () => {
      expect(getToolCategory('salesforce_manage_object')).to.equal('write');
    });

    it('should classify salesforce_manage_field as write', () => {
      expect(getToolCategory('salesforce_manage_field')).to.equal('write');
    });

    it('should classify salesforce_manage_field_permissions as write', () => {
      expect(getToolCategory('salesforce_manage_field_permissions')).to.equal('write');
    });

    it('should classify salesforce_manage_debug_logs as write', () => {
      expect(getToolCategory('salesforce_manage_debug_logs')).to.equal('write');
    });

    // Execute tools
    it('should classify salesforce_execute_anonymous as execute', () => {
      expect(getToolCategory('salesforce_execute_anonymous')).to.equal('execute');
    });

    // Default (unknown tools)
    it('should default unknown tools to write (safe-by-default)', () => {
      expect(getToolCategory('unknown_tool_xyz')).to.equal('write');
    });

    // DX tools
    it('should classify get_username as read', () => {
      expect(getToolCategory('get_username')).to.equal('read');
    });

    it('should classify list_all_orgs as read', () => {
      expect(getToolCategory('list_all_orgs')).to.equal('read');
    });

    it('should classify deploy_metadata as write', () => {
      expect(getToolCategory('deploy_metadata')).to.equal('write');
    });

    it('should classify create_scratch_org as write', () => {
      expect(getToolCategory('create_scratch_org')).to.equal('write');
    });
  });
});
