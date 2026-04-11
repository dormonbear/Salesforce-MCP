import { McpResource } from '@salesforce/mcp-provider-api';
import type { ResourceMetadata } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import type { ReadResourceResult, ServerNotification, ServerRequest } from '@modelcontextprotocol/sdk/types.js';
import type { Services } from '@salesforce/mcp-provider-api';

export class OrgListResource extends McpResource {
  private readonly services: Services;

  constructor(services: Services) {
    super();
    this.services = services;
  }

  getName(): string {
    return 'salesforce-orgs';
  }

  getUri(): string {
    return 'salesforce://orgs';
  }

  getConfig(): ResourceMetadata {
    return {
      description: 'List of authenticated Salesforce orgs available to this MCP server',
      mimeType: 'application/json',
    };
  }

  async read(
    uri: URL,
    extra: RequestHandlerExtra<ServerRequest, ServerNotification>
  ): Promise<ReadResourceResult> {
    const orgs = await this.services.getOrgService().getAllowedOrgs();
    return {
      contents: [{
        uri: this.getUri(),
        mimeType: 'application/json',
        text: JSON.stringify(orgs, null, 2),
      }],
    };
  }
}
