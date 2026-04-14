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

import { McpProvider, McpResource, McpResourceTemplate, McpTool, type Services } from '@dormon/mcp-provider-api';
import { OrgListResource } from './resources/org-list-resource.js';
import { OrgPermissionsResource } from './resources/org-permissions-resource.js';
import { SchemaService, QueryHistoryService } from './schema/index.js';
import { AssignPermissionSetMcpTool } from './tools/assign_permission_set.js';
import { CreateOrgSnapshotMcpTool } from './tools/create_org_snapshot.js';
import { CreateScratchOrgMcpTool } from './tools/create_scratch_org.js';
import { DeleteOrgMcpTool } from './tools/delete_org.js';
import { DeployMetadataMcpTool } from './tools/deploy_metadata.js';
import { GetOrgInfoMcpTool } from './tools/get_org_info.js';
import { GetUsernameMcpTool } from './tools/get_username.js';
import { ListAllOrgsMcpTool } from './tools/list_all_orgs.js';
import { OrgOpenMcpTool } from './tools/open_org.js';
import { QueryOrgMcpTool } from './tools/run_soql_query.js';
import { ResumeMcpTool } from './tools/resume_tool_operation.js';
import { RetrieveMetadataMcpTool } from './tools/retrieve_metadata.js';
import { TestAgentsMcpTool } from './tools/run_agent_test.js';
import { TestApexMcpTool } from './tools/run_apex_test.js';
import { DescribeObjectMcpTool } from './tools/describe_object.js';
import { ListQueryHistoryMcpTool } from './tools/list_query_history.js';

export {
  usernameOrAliasParam,
  directoryParam,
  baseAbsolutePathParam,
  sanitizePath,
  optionalUsernameOrAliasParam,
  useToolingApiParam,
} from '@dormon/mcp-provider-api';

export class DxCoreMcpProvider extends McpProvider {
  private schemaService?: SchemaService;
  private queryHistoryService?: QueryHistoryService;
  private sigTermRegistered = false;

  public getName(): string {
    return 'DxCoreMcpProvider';
  }

  public getSchemaService(): SchemaService | undefined {
    return this.schemaService;
  }

  public getQueryHistoryService(): QueryHistoryService | undefined {
    return this.queryHistoryService;
  }

  public provideResources(services: Services): Promise<(McpResource | McpResourceTemplate)[]> {
    return Promise.resolve([
      new OrgListResource(services),
      new OrgPermissionsResource(services),
    ]);
  }

  public async provideTools(services: Services): Promise<McpTool[]> {
    // Create SchemaService singleton with disk persistence
    const dataDir = services.getConfigService().getDataDir();
    const schemaService = new SchemaService({ dataDir });
    this.schemaService = schemaService;

    // Hydrate cache from disk (discards TTL-expired entries)
    await schemaService.loadFromDisk();

    // Create QueryHistoryService singleton (in-memory, per-process)
    const queryHistoryService = new QueryHistoryService();
    this.queryHistoryService = queryHistoryService;

    // Register SIGTERM handler for graceful shutdown (once only)
    if (!this.sigTermRegistered) {
      this.sigTermRegistered = true;
      process.on('SIGTERM', () => {
        void schemaService.shutdown();
      });
    }

    return [
      new AssignPermissionSetMcpTool(services),
      new CreateOrgSnapshotMcpTool(services),
      new CreateScratchOrgMcpTool(services),
      new DeleteOrgMcpTool(services),
      new DeployMetadataMcpTool(services),
      new GetOrgInfoMcpTool(services),
      new GetUsernameMcpTool(services),
      new ListAllOrgsMcpTool(services),
      new OrgOpenMcpTool(services),
      new QueryOrgMcpTool(services, schemaService, queryHistoryService),
      new ResumeMcpTool(services),
      new RetrieveMetadataMcpTool(services),
      new TestAgentsMcpTool(services),
      new TestApexMcpTool(services),
      new DescribeObjectMcpTool(services, schemaService),
      new ListQueryHistoryMcpTool(services, queryHistoryService),
    ];
  }
}
