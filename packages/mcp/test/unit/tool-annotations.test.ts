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
import { getToolCategory } from '../../src/utils/tool-categories.js';

/**
 * Actual readOnlyHint values declared by each GA tool.
 *
 * This map is the ground truth for the consistency test. When a tool's
 * annotation is changed, this map must be updated too — and if the new
 * value contradicts tool-categories.ts, the test below will fail.
 *
 * Rules enforced:
 *   category='read'              → readOnlyHint must be true
 *   category='write'|'execute'  → readOnlyHint must be false
 *
 * Non-GA tools are excluded. Tools not in tool-categories.ts are excluded.
 */
const GA_TOOL_READONLY_HINTS: Record<string, boolean> = {
  // mcp-provider-dx-core — GA tools
  run_soql_query: true,
  assign_permission_set: false,
  run_apex_test: true,
  run_agent_test: true,
  list_all_orgs: true,
  get_username: true,
  resume_tool_operation: true,
  deploy_metadata: false,
  retrieve_metadata: true,
  salesforce_get_org_info: true,

  // mcp-provider-mobile-web — GA tools
  get_mobile_lwc_offline_analysis: true,
  get_mobile_lwc_offline_guidance: true,
  create_mobile_lwc_app_review: true,
  create_mobile_lwc_barcode_scanner: true,
  create_mobile_lwc_biometrics: true,
  create_mobile_lwc_calendar: true,
  create_mobile_lwc_contacts: true,
  create_mobile_lwc_document_scanner: true,
  create_mobile_lwc_geofencing: true,
  create_mobile_lwc_location: true,
  create_mobile_lwc_nfc: true,
  create_mobile_lwc_payments: true,

  // mcp-provider-code-analyzer — GA tools
  run_code_analyzer: true,
  list_code_analyzer_rules: true,
  describe_code_analyzer_rule: true,
  query_code_analyzer_results: true,
  get_ast_nodes_to_generate_xpath: true,

  // mcp-provider-devops — GA tools only (NON_GA tools excluded)
  detect_devops_center_merge_conflict: true,
  resolve_devops_center_merge_conflict: false,

  // mcp-provider-scale-products — GA tools
  scan_apex_class_for_antipatterns: true,
};

describe('tool-annotations', () => {
  describe('readOnlyHint consistency with tool-categories.ts', () => {
    it('every read-category tool must have readOnlyHint: true', () => {
      const violations: string[] = [];
      for (const [toolName, readOnlyHint] of Object.entries(GA_TOOL_READONLY_HINTS)) {
        const category = getToolCategory(toolName);
        if (category === 'read' && readOnlyHint !== true) {
          violations.push(`${toolName}: category='read' but readOnlyHint=${String(readOnlyHint)}`);
        }
      }
      expect(violations, `Read tools with incorrect readOnlyHint:\n${violations.join('\n')}`).to.be.empty;
    });

    it('every write-or-execute-category tool must have readOnlyHint: false', () => {
      const violations: string[] = [];
      for (const [toolName, readOnlyHint] of Object.entries(GA_TOOL_READONLY_HINTS)) {
        const category = getToolCategory(toolName);
        if ((category === 'write' || category === 'execute') && readOnlyHint !== false) {
          violations.push(`${toolName}: category='${category}' but readOnlyHint=${String(readOnlyHint)}`);
        }
      }
      expect(violations, `Write/execute tools with incorrect readOnlyHint:\n${violations.join('\n')}`).to.be.empty;
    });

    it('no read tool has readOnlyHint: false (explicit negative assertion)', () => {
      const offenders = Object.entries(GA_TOOL_READONLY_HINTS)
        .filter(([toolName, readOnlyHint]) => getToolCategory(toolName) === 'read' && readOnlyHint === false)
        .map(([toolName]) => toolName);
      expect(offenders, `These read tools incorrectly declare readOnlyHint: false: ${offenders.join(', ')}`).to.be.empty;
    });

    it('no write/execute tool has readOnlyHint: true (explicit negative assertion)', () => {
      const offenders = Object.entries(GA_TOOL_READONLY_HINTS)
        .filter(([toolName, readOnlyHint]) => {
          const cat = getToolCategory(toolName);
          return (cat === 'write' || cat === 'execute') && readOnlyHint === true;
        })
        .map(([toolName]) => toolName);
      expect(offenders, `These write/execute tools incorrectly declare readOnlyHint: true: ${offenders.join(', ')}`).to.be.empty;
    });

    it('all tools in the GA annotation map are known to tool-categories.ts', () => {
      const readToolsWithDefaultCategory = Object.entries(GA_TOOL_READONLY_HINTS)
        .filter(([toolName, readOnlyHint]) => {
          const category = getToolCategory(toolName);
          return readOnlyHint === true && category === 'write';
        })
        .map(([toolName]) => toolName);
      expect(
        readToolsWithDefaultCategory,
        `These tools claim readOnlyHint:true but are NOT in tool-categories.ts (defaulting to 'write'):\n` +
        readToolsWithDefaultCategory.join('\n'),
      ).to.be.empty;
    });
  });
});
