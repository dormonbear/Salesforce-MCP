export type ToolCategory = 'read' | 'write' | 'execute';

const toolCategoryMap: Record<string, ToolCategory> = {
  // Read tools
  run_soql_query: 'read',
  salesforce_query_records: 'read',
  salesforce_aggregate_query: 'read',
  salesforce_describe_object: 'read',
  salesforce_search_all: 'read',
  salesforce_search_objects: 'read',
  salesforce_read_apex: 'read',
  salesforce_read_apex_trigger: 'read',
  salesforce_get_org_info: 'read',
  get_username: 'read',
  list_all_orgs: 'read',
  retrieve_metadata: 'read',
  run_apex_test: 'read',
  run_agent_test: 'read',
  open_org: 'read',
  resume_tool_operation: 'read',

  // Write tools
  salesforce_dml_records: 'write',
  salesforce_write_apex: 'write',
  salesforce_write_apex_trigger: 'write',
  salesforce_manage_object: 'write',
  salesforce_manage_field: 'write',
  salesforce_manage_field_permissions: 'write',
  salesforce_manage_debug_logs: 'write',
  deploy_metadata: 'write',
  create_scratch_org: 'write',
  delete_org: 'write',
  assign_permission_set: 'write',
  create_org_snapshot: 'write',

  // Execute tools
  salesforce_execute_anonymous: 'execute',
};

export function getToolCategory(toolName: string): ToolCategory {
  return toolCategoryMap[toolName] ?? 'write';
}
