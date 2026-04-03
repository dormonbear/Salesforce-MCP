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

import { McpServer, RegisteredTool, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  CallToolResult,
  Implementation,
  ServerNotification,
  ServerRequest,
  ToolAnnotations,
} from '@modelcontextprotocol/sdk/types.js';
import { ServerOptions } from '@modelcontextprotocol/sdk/server/index.js';
import { RequestHandlerExtra } from '@modelcontextprotocol/sdk/shared/protocol.js';
import { Logger } from '@salesforce/core';
import { z, ZodRawShape } from 'zod';
import { Telemetry } from './telemetry.js';
import { RateLimiter, RateLimitConfig, createRateLimiter } from './utils/rate-limiter.js';
import { OrgPermission, canExecute } from './utils/org-permissions.js';
import { getToolCategory } from './utils/tool-categories.js';
import { buildApprovalMessage, APPROVAL_SCHEMA } from './utils/approval.js';

type ToolMethodSignatures = {
  tool: McpServer['tool'];
  connect: McpServer['connect'];
  registerTool: McpServer['registerTool'];
};

/**
 * Extended server options that include telemetry and rate limiting
 */
export type SfMcpServerOptions = ServerOptions & {
  /** Optional telemetry instance for tracking server events */
  telemetry?: Telemetry;
  /** Optional rate limiting configuration */
  rateLimit?: Partial<RateLimitConfig>;
  /** Org permission map: alias -> permission level */
  orgPermissions?: Map<string, OrgPermission>;
  /** Allowlist of authorized org aliases. Empty means all orgs are allowed. */
  authorizedOrgs?: string[];
  /** Default org alias when targetOrg is not provided */
  defaultOrg?: string;
};

/**
 * A server implementation that extends the base MCP server with telemetry and rate limiting capabilities.
 *
 * The method overloads for `tool` are taken directly from the source code for the original McpServer. They're
 * copied here so that the types don't get lost.
 *
 * @extends {McpServer}
 */
export class SfMcpServer extends McpServer implements ToolMethodSignatures {
  private logger = Logger.childFromRoot('mcp-server');

  /** Optional telemetry instance for tracking server events */
  private telemetry?: Telemetry;

  /** Rate limiter for controlling tool call frequency */
  private rateLimiter?: RateLimiter;

  /** Org permission map: alias -> permission level */
  private orgPermissions: Map<string, OrgPermission>;

  /** Allowlist of authorized org aliases. Empty set means all orgs are allowed. */
  private authorizedOrgs: Set<string>;

  /** Default org alias when targetOrg is not provided */
  private defaultOrg: string | undefined;

  /**
   * Creates a new SfMcpServer instance
   *
   * @param {Implementation} serverInfo - The server implementation details
   * @param {SfMcpServerOptions} [options] - Optional server configuration including telemetry and rate limiting
   */
  public constructor(serverInfo: Implementation, options?: SfMcpServerOptions) {
    super(serverInfo, options);
    this.telemetry = options?.telemetry;
    // Initialize rate limiter if configuration is provided
    if (options?.rateLimit !== undefined) {
      this.rateLimiter = createRateLimiter(options.rateLimit);
      this.logger.debug('Rate limiter initialized', options.rateLimit);
    }
    this.orgPermissions = options?.orgPermissions ?? new Map();
    this.authorizedOrgs = new Set(options?.authorizedOrgs ?? []);
    this.defaultOrg = options?.defaultOrg;
    this.server.oninitialized = (): void => {
      const clientInfo = this.server.getClientVersion();
      if (clientInfo) {
        this.telemetry?.addAttributes({
          clientName: clientInfo.name,
          clientVersion: clientInfo.version,
        });
      }
      this.telemetry?.sendEvent('SERVER_START_SUCCESS');
    };
  }

  public registerTool<InputArgs extends ZodRawShape, OutputArgs extends ZodRawShape>(
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: InputArgs;
      outputSchema?: OutputArgs;
      annotations?: ToolAnnotations;
    },
    cb: ToolCallback<InputArgs>
  ): RegisteredTool {
    // Inject targetOrg into inputSchema
    const injectedInputSchema = {
      ...(config.inputSchema ?? {}),
      targetOrg: z.string().optional().describe('Target org alias or username'),
    } as unknown as InputArgs & { targetOrg: ReturnType<typeof z.string> };

    const configWithTargetOrg = { ...config, inputSchema: injectedInputSchema };

    const wrappedCb = async (
      args: Record<string, unknown>,
      extra: RequestHandlerExtra<ServerRequest, ServerNotification>
    ): Promise<CallToolResult> => {
      this.logger.debug(`Tool ${name} called`);

      // --- Permission middleware (runs before rate limiting) ---
      const targetOrg = (args.targetOrg as string | undefined) ?? this.defaultOrg;
      delete args.targetOrg;

      if (!targetOrg) {
        return {
          isError: true,
          content: [{ type: 'text', text: 'No target org specified and no default org configured.' }],
        };
      }

      if (this.authorizedOrgs.size > 0 && !this.authorizedOrgs.has(targetOrg)) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Org "${targetOrg}" is not authorized. Only configured orgs are allowed.` }],
        };
      }

      const category = getToolCategory(name);
      const permissionResult = canExecute(this.orgPermissions, targetOrg, category);

      if (permissionResult === 'deny') {
        return {
          isError: true,
          content: [{ type: 'text', text: `Operation denied: org "${targetOrg}" is read-only.` }],
        };
      }

      if (permissionResult === 'needs-approval') {
        try {
          const message = buildApprovalMessage(name, targetOrg, args);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const elicitResult = await (this.server as any).createElicitation({
            message,
            requestedSchema: APPROVAL_SCHEMA,
          });

          if (!elicitResult?.content?.approved) {
            return {
              isError: true,
              content: [{ type: 'text', text: 'Operation cancelled: approval was not granted.' }],
            };
          }
        } catch (err) {
          return {
            isError: true,
            content: [{ type: 'text', text: `Elicitation not supported by this client. Cannot request approval for protected org "${targetOrg}".` }],
          };
        }
      }

      // Inject resolved org as usernameOrAlias for downstream tools
      args.usernameOrAlias = targetOrg;
      // --- End permission middleware ---

      // Check rate limit before executing tool
      if (this.rateLimiter) {
        const rateLimitResult = this.rateLimiter.checkLimit();

        if (!rateLimitResult.allowed) {
          this.logger.warn(`Tool ${name} rate limited. Retry after: ${rateLimitResult.retryAfter ?? 0}ms`);

          this.telemetry?.sendEvent('TOOL_RATE_LIMITED', {
            name,
            retryAfter: rateLimitResult.retryAfter,
            remaining: rateLimitResult.remaining,
          });

          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Rate limit exceeded. Too many tool calls. Please wait ${Math.ceil(
                  (rateLimitResult.retryAfter ?? 0) / 1000
                )} seconds before trying again.`,
              },
            ],
          };
        }

        this.logger.debug(`Tool ${name} rate check passed. Remaining: ${rateLimitResult.remaining}`);
      }

      const startTime = Date.now();
      const result = await cb(args as unknown as InputArgs, extra);
      const runtimeMs = Date.now() - startTime;

      this.logger.debug(`Tool ${name} completed in ${runtimeMs}ms`);
      if (result.isError) this.logger.debug(`Tool ${name} errored`);

      // Calculate response character count for token usage (never let telemetry instrumentation fail a tool call)
      let responseCharCount = 0;
      try {
        responseCharCount = this.calculateResponseCharCount(result);
      } catch (err) {
        // never let telemetry instrumentation fail a tool call
      }

      this.telemetry?.sendEvent('TOOL_CALLED', {
        name,
        runtimeMs,
        // `isError`:
        // Whether the tool call ended in an error.
        //
        // If not set, this is assumed to be false (the call was successful).
        //
        // https://modelcontextprotocol.io/specification/2025-06-18/schema#calltoolresult
        isError: result.isError ?? false,
        responseCharCount: responseCharCount.toString(),
        targetOrg: targetOrg ?? '',
      });

      this.telemetry?.sendPdpEvent({
        eventName: 'salesforceMcp.executed',
        productFeatureId: 'aJCEE0000007Uiv4AE',  // DX MCP Server
        componentId: name, // MCP tool name
      });

      return result;
    };

    const tool = McpServer.prototype.registerTool.call(
      this,
      name,
      configWithTargetOrg,
      wrappedCb as ToolCallback<typeof injectedInputSchema>
    ) as RegisteredTool;
    return tool;
  }

  /**
   * Calculates the total character count from tool result content and structured output.
   * Used for token usage. Accounts for both:
   * - content: text (and other) content items
   * - structuredContent: structured tool output when the tool defines an outputSchema
   *
   * @see https://modelcontextprotocol.io/specification/2025-11-25/server/tools#output-schema
   * @param result - The CallToolResult from tool execution
   * @returns Total character count across text content and structured content
   */
  private calculateResponseCharCount(result: CallToolResult): number {
    let total = 0;

    // Plain text (and other) content items
    if (result.content && Array.isArray(result.content)) {
      total += result.content
        .filter((item): item is { type: 'text'; text: string } => item.type === 'text')
        .reduce((sum, item) => sum + item.text.length, 0);
    }

    // Structured content (JSON object per outputSchema)
    const structured = (result as CallToolResult & { structuredContent?: unknown }).structuredContent;
    if (structured !== undefined && structured !== null && typeof structured === 'object') {
      try {
        total += JSON.stringify(structured).length;
      } catch {
        // ignore serialization errors
      }
    }

    return total;
  }
}
