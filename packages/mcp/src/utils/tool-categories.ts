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

  // DevOps Center — read tools
  list_devops_center_projects: 'read',
  list_devops_center_work_items: 'read',
  check_devops_center_commit_status: 'read',
  detect_devops_center_merge_conflict: 'read',

  // Code Analyzer — read tools
  run_code_analyzer: 'read',
  list_code_analyzer_rules: 'read',
  describe_code_analyzer_rule: 'read',
  query_code_analyzer_results: 'read',
  get_ast_nodes_to_generate_xpath: 'read',

  // Mobile/Web — read tools
  get_mobile_lwc_offline_analysis: 'read',
  get_mobile_lwc_offline_guidance: 'read',
  create_mobile_lwc_app_review: 'read',
  create_mobile_lwc_ar_space_capture: 'read',
  create_mobile_lwc_barcode_scanner: 'read',
  create_mobile_lwc_biometrics: 'read',
  create_mobile_lwc_calendar: 'read',
  create_mobile_lwc_contacts: 'read',
  create_mobile_lwc_document_scanner: 'read',
  create_mobile_lwc_geofencing: 'read',
  create_mobile_lwc_location: 'read',
  create_mobile_lwc_nfc: 'read',
  create_mobile_lwc_payments: 'read',

  // Scale Products — read tools
  scan_apex_class_for_antipatterns: 'read',

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

  // DevOps Center — write tools
  create_devops_center_work_item: 'write',
  checkout_devops_center_work_item: 'write',
  commit_devops_center_work_item: 'write',
  promote_devops_center_work_item: 'write',
  resolve_devops_center_merge_conflict: 'write',
  resolve_devops_center_deployment_failure: 'write',
  update_devops_center_work_item_status: 'write',
  create_devops_center_pull_request: 'write',

  // Code Analyzer — write tools
  create_custom_rule: 'write',

  // Metadata Enrichment — write tools
  enrich_metadata: 'write',

  // Execute tools
  salesforce_execute_anonymous: 'execute',
};

export function getToolCategory(toolName: string): ToolCategory {
  return toolCategoryMap[toolName] ?? 'write';
}
