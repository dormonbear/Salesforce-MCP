import { McpResourceTemplate } from '@salesforce/mcp-provider-api';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ResourceMetadata } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ReadResourceResult, ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Variables } from '@modelcontextprotocol/sdk/shared/uriTemplate.js';
import type { Services } from '@salesforce/mcp-provider-api';

export class OrgPermissionsResource extends McpResourceTemplate {
  private readonly services: Services;

  constructor(services: Services) {
    super();
    this.services = services;
  }

  getName(): string {
    return 'salesforce-org-permissions';
  }

  getTemplate(): ResourceTemplate {
    return new ResourceTemplate('salesforce://orgs/{orgName}/permissions', {
      list: async () => {
        const orgs = this.services.getPermissionService().getAuthorizedOrgs();
        return {
          resources: orgs.map(org => ({
            uri: `salesforce://orgs/${org}/permissions`,
            name: `${org}-permissions`,
            description: `Permission levels for org: ${org}`,
            mimeType: 'application/json',
          })),
        };
      },
      complete: {
        orgName: async (value: string) => {
          const orgs = this.services.getPermissionService().getAuthorizedOrgs();
          return orgs.filter(org => org.startsWith(value));
        },
      },
    });
  }

  getConfig(): ResourceMetadata {
    return {
      description: 'Permission levels (read/write/execute) for a specific Salesforce org',
      mimeType: 'application/json',
    };
  }

  async read(
    uri: URL,
    variables: Variables,
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>
  ): Promise<ReadResourceResult> {
    const orgName = variables.orgName as string;
    const permissionService = this.services.getPermissionService();
    const permissions = {
      org: orgName,
      permission: permissionService.getOrgPermission(orgName),
      categories: {
        read: permissionService.canExecuteCategory(orgName, 'read'),
        write: permissionService.canExecuteCategory(orgName, 'write'),
        execute: permissionService.canExecuteCategory(orgName, 'execute'),
      },
    };
    return {
      contents: [{
        uri: uri.href,
        mimeType: 'application/json',
        text: JSON.stringify(permissions, null, 2),
      }],
    };
  }
}
