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
import sinon from 'sinon';
import { z } from 'zod';
import { SfMcpServer } from '../../src/sf-mcp-server.js';
import type { OrgPermission } from '../../src/utils/org-permissions.js';

// Helper to capture the wrapped callback from registerTool
function captureWrappedCallback(server: SfMcpServer, toolName: string, inputSchema: Record<string, unknown>, cb: Function): Function {
  let wrappedCb: Function | undefined;

  const originalProto = Object.getPrototypeOf(Object.getPrototypeOf(server));
  const stub = sinon.stub(originalProto, 'registerTool').callsFake(
    (...args: unknown[]) => {
      wrappedCb = args[2] as Function;
      return { enable: () => {}, disable: () => {}, update: () => {}, remove: () => {} };
    }
  );

  server.registerTool(toolName, { inputSchema: inputSchema as any }, cb as any);
  stub.restore();

  return wrappedCb!;
}

describe('SfMcpServer middleware', () => {
  const orgPermissions = new Map<string, OrgPermission>([
    ['prod', 'approval-required'],
    ['staging', 'full-access'],
    ['readonly-org', 'read-only'],
  ]);

  let server: SfMcpServer;

  beforeEach(() => {
    server = new SfMcpServer(
      { name: 'test-server', version: '1.0.0' },
      {
        orgPermissions,
        authorizedOrgs: ['prod', 'staging', 'readonly-org'],
      }
    );
  });

  describe('schema (no injection)', () => {
    it('should NOT add a targetOrg param to inputSchema', () => {
      let capturedConfig: any;
      const originalProto = Object.getPrototypeOf(Object.getPrototypeOf(server));
      const stub = sinon.stub(originalProto, 'registerTool').callsFake(
        (...args: unknown[]) => {
          capturedConfig = args[1];
          return { enable: () => {}, disable: () => {}, update: () => {}, remove: () => {} };
        }
      );

      server.registerTool('test_tool', { inputSchema: { query: z.string() } }, async () => ({
        content: [{ type: 'text' as const, text: 'ok' }],
      }));
      stub.restore();

      expect(capturedConfig.inputSchema).to.not.have.property('targetOrg');
      expect(capturedConfig.inputSchema).to.have.property('query');
    });
  });

  describe('permission enforcement (keyed on explicit usernameOrAlias)', () => {
    it('should deny write tool on read-only org', async () => {
      const cb = sinon.stub().resolves({ content: [{ type: 'text', text: 'ok' }] });
      const wrappedCb = captureWrappedCallback(server, 'salesforce_dml_records',
        { operation: z.string(), objectName: z.string(), records: z.array(z.any()), usernameOrAlias: z.string() }, cb);

      const result = await wrappedCb({ usernameOrAlias: 'readonly-org', operation: 'update', objectName: 'Account', records: [] }, {});
      expect(result.isError).to.be.true;
      expect(result.content[0].text).to.include('read-only');
      expect(cb.called).to.be.false;
    });

    it('should allow read tool on read-only org', async () => {
      const cb = sinon.stub().resolves({ content: [{ type: 'text', text: 'query result' }] });
      const wrappedCb = captureWrappedCallback(server, 'salesforce_query_records',
        { query: z.string(), usernameOrAlias: z.string() }, cb);

      const result = await wrappedCb({ usernameOrAlias: 'readonly-org', query: 'SELECT Id FROM Account' }, {});
      expect(result.isError).to.be.undefined;
      expect(cb.calledOnce).to.be.true;
    });

    it('should allow write tool on full-access org without approval', async () => {
      const cb = sinon.stub().resolves({ content: [{ type: 'text', text: 'ok' }] });
      const wrappedCb = captureWrappedCallback(server, 'salesforce_dml_records',
        { operation: z.string(), objectName: z.string(), records: z.array(z.any()), usernameOrAlias: z.string() }, cb);

      const result = await wrappedCb({ usernameOrAlias: 'staging', operation: 'update', objectName: 'Account', records: [] }, {});
      expect(result.isError).to.be.undefined;
      expect(cb.calledOnce).to.be.true;
    });

    it('BUG REGRESSION (wrong-org bleed): explicit usernameOrAlias must reach the tool unchanged, never re-routed', async () => {
      // Multi-org instance. The AI explicitly targets 'readonly-org'. The middleware must NOT
      // inject or default anything — args.usernameOrAlias must arrive at the tool as 'readonly-org'.
      const cb = sinon.stub().resolves({ content: [{ type: 'text', text: 'ok' }] });
      const wrappedCb = captureWrappedCallback(server, 'salesforce_query_records',
        { query: z.string(), usernameOrAlias: z.string() }, cb);

      await wrappedCb({ usernameOrAlias: 'readonly-org', query: 'SELECT Id FROM Account' }, {});
      const callArgs = cb.firstCall.args[0];
      expect(callArgs.usernameOrAlias).to.equal('readonly-org');
    });

    it('should reject usernameOrAlias not in authorized list', async () => {
      const cb = sinon.stub().resolves({ content: [{ type: 'text', text: 'ok' }] });
      const wrappedCb = captureWrappedCallback(server, 'salesforce_query_records',
        { query: z.string(), usernameOrAlias: z.string() }, cb);

      const result = await wrappedCb({ usernameOrAlias: 'unknown-org', query: 'SELECT Id FROM Account' }, {});
      expect(result.isError).to.be.true;
      expect(result.content[0].text).to.include('not authorized');
      expect(cb.called).to.be.false;
    });

    it('should NOT inject or default an org when usernameOrAlias is absent (tool enforces its own requirement)', async () => {
      // Middleware does nothing org-related when no org is provided; it passes through to the
      // tool, whose own requireUsernameOrAlias (real tools) fails loudly. With a stub cb here,
      // it simply executes — and crucially does NOT silently route to any default org.
      const cb = sinon.stub().resolves({ content: [{ type: 'text', text: 'ok' }] });
      const wrappedCb = captureWrappedCallback(server, 'salesforce_query_records',
        { query: z.string(), usernameOrAlias: z.string() }, cb);

      const result = await wrappedCb({ query: 'SELECT Id FROM Account' }, {});
      expect(result.isError).to.be.undefined;
      expect(cb.calledOnce).to.be.true;
      const callArgs = cb.firstCall.args[0];
      expect(callArgs.usernameOrAlias).to.be.undefined;
    });

    it('should let org-less tools run with no org (e.g. list_all_orgs)', async () => {
      const cb = sinon.stub().resolves({ content: [{ type: 'text', text: 'orgs' }] });
      const wrappedCb = captureWrappedCallback(server, 'list_all_orgs', {}, cb);

      const result = await wrappedCb({}, {});
      expect(result.isError).to.be.undefined;
      expect(cb.calledOnce).to.be.true;
    });
  });

  describe('approval-required org', () => {
    it('should fall through to error when elicitation not supported', async () => {
      const cb = sinon.stub().resolves({ content: [{ type: 'text', text: 'ok' }] });
      const wrappedCb = captureWrappedCallback(server, 'salesforce_dml_records',
        { operation: z.string(), objectName: z.string(), records: z.array(z.any()), usernameOrAlias: z.string() }, cb);

      // No elicitation support on mock server, so try/catch should trigger
      const result = await wrappedCb({ usernameOrAlias: 'prod', operation: 'update', objectName: 'Account', records: [] }, {});
      expect(result.isError).to.be.true;
      expect(result.content[0].text).to.include('Elicitation');
      expect(cb.called).to.be.false;
    });
  });

  describe('open mode (empty authorizedOrgs skips the allowlist gate)', () => {
    it('should allow any provided org when authorizedOrgs is empty', async () => {
      const serverOpen = new SfMcpServer(
        { name: 'test', version: '1.0.0' },
        { orgPermissions: new Map(), authorizedOrgs: [] }
      );
      const cb = sinon.stub().resolves({ content: [{ type: 'text', text: 'ok' }] });
      const wrappedCb = captureWrappedCallback(serverOpen, 'salesforce_query_records',
        { query: z.string(), usernameOrAlias: z.string() }, cb);

      const result = await wrappedCb({ usernameOrAlias: 'any-org', query: 'SELECT Id FROM Account' }, {});
      expect(result.isError).to.be.undefined;
      expect(cb.calledOnce).to.be.true;
    });

    it('should allow ALLOW_ALL_ORGS to bypass the allowlist gate', async () => {
      const serverAll = new SfMcpServer(
        { name: 'test', version: '1.0.0' },
        { orgPermissions: new Map(), authorizedOrgs: ['ALLOW_ALL_ORGS'] }
      );
      const cb = sinon.stub().resolves({ content: [{ type: 'text', text: 'ok' }] });
      const wrappedCb = captureWrappedCallback(serverAll, 'salesforce_query_records',
        { query: z.string(), usernameOrAlias: z.string() }, cb);

      const result = await wrappedCb({ usernameOrAlias: 'whatever-org', query: 'SELECT Id FROM Account' }, {});
      expect(result.isError).to.be.undefined;
      expect(cb.calledOnce).to.be.true;
    });
  });

  describe('concurrent tool execution', () => {
    it('should run normal tools concurrently (interleaved)', async () => {
      const executionOrder: string[] = [];

      const cb = async (args: Record<string, unknown>) => {
        const id = args.query as string;
        executionOrder.push(`start-${id}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
        executionOrder.push(`end-${id}`);
        return { content: [{ type: 'text' as const, text: 'ok' }] };
      };

      const wrappedCb = captureWrappedCallback(
        server,
        'salesforce_query_records',
        { query: z.string(), usernameOrAlias: z.string() },
        cb,
      );

      await Promise.all([
        wrappedCb({ usernameOrAlias: 'staging', query: 'q1' }, {}),
        wrappedCb({ usernameOrAlias: 'staging', query: 'q2' }, {}),
      ]);

      expect(executionOrder).to.have.lengthOf(4);
      expect(executionOrder[0]).to.equal('start-q1');
      expect(executionOrder[1]).to.equal('start-q2');
    });

    it('should serialize tools marked as serialized', async () => {
      server.markToolAsSerialized('serialized_tool');
      const executionOrder: string[] = [];

      const cb = async (args: Record<string, unknown>) => {
        const id = args.query as string;
        executionOrder.push(`start-${id}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
        executionOrder.push(`end-${id}`);
        return { content: [{ type: 'text' as const, text: 'ok' }] };
      };

      const wrappedCb = captureWrappedCallback(
        server,
        'serialized_tool',
        { query: z.string(), usernameOrAlias: z.string() },
        cb,
      );

      await Promise.all([
        wrappedCb({ usernameOrAlias: 'staging', query: 'q1' }, {}),
        wrappedCb({ usernameOrAlias: 'staging', query: 'q2' }, {}),
      ]);

      expect(executionOrder).to.deep.equal(['start-q1', 'end-q1', 'start-q2', 'end-q2']);
    });

    it('should preserve correct org for each concurrent call', async () => {
      const capturedArgs: string[] = [];

      const cb = async (args: Record<string, unknown>) => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        capturedArgs.push(args.usernameOrAlias as string);
        return { content: [{ type: 'text' as const, text: 'ok' }] };
      };

      const wrappedCb = captureWrappedCallback(
        server,
        'salesforce_query_records',
        { query: z.string(), usernameOrAlias: z.string() },
        cb,
      );

      await Promise.all([
        wrappedCb({ usernameOrAlias: 'staging', query: 'q1' }, {}),
        wrappedCb({ usernameOrAlias: 'prod', query: 'q2' }, {}),
      ]);

      expect(capturedArgs).to.include('staging');
      expect(capturedArgs).to.include('prod');
    });

    it('should handle 5+ concurrent tool calls without errors', async () => {
      const results: string[] = [];

      const cb = async (args: Record<string, unknown>) => {
        const id = args.query as string;
        await new Promise((resolve) => setTimeout(resolve, 5));
        results.push(id);
        return { content: [{ type: 'text' as const, text: `result-${id}` }] };
      };

      const wrappedCb = captureWrappedCallback(
        server,
        'salesforce_query_records',
        { query: z.string(), usernameOrAlias: z.string() },
        cb,
      );

      const responses = await Promise.all(
        ['q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7'].map((q) =>
          wrappedCb({ usernameOrAlias: 'staging', query: q }, {})
        )
      );

      expect(results).to.have.lengthOf(7);
      expect(new Set(results).size).to.equal(7);
      responses.forEach((r: any) => {
        expect(r.isError).to.be.undefined;
      });
    });
  });

  describe('structuredContent pass-through', () => {
    it('should pass structuredContent from tool callback through wrappedCb unchanged', async () => {
      const structuredData = { totalSize: 5, done: true, records: [{ Id: '001xx' }] };
      const cb = sinon.stub().resolves({
        content: [{ type: 'text', text: JSON.stringify(structuredData) }],
        structuredContent: structuredData,
      });

      const wrappedCb = captureWrappedCallback(server, 'test_structured_tool',
        { query: z.string(), usernameOrAlias: z.string() }, cb);

      const result = await wrappedCb({ usernameOrAlias: 'staging', query: 'test' }, {});

      expect(result.structuredContent).to.deep.equal(structuredData);
      expect(result.content).to.deep.equal([{ type: 'text', text: JSON.stringify(structuredData) }]);
    });

    it('should not include structuredContent when tool returns error', async () => {
      const cb = sinon.stub().resolves({
        isError: true,
        content: [{ type: 'text', text: 'Error occurred' }],
      });

      const wrappedCb = captureWrappedCallback(server, 'test_error_tool',
        { query: z.string(), usernameOrAlias: z.string() }, cb);

      const result = await wrappedCb({ usernameOrAlias: 'staging', query: 'test' }, {});

      expect(result.isError).to.be.true;
      expect(result).to.not.have.property('structuredContent');
    });
  });
});
