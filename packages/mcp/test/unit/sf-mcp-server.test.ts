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
        defaultOrg: 'staging',
      }
    );
  });

  describe('schema injection', () => {
    it('should add targetOrg to inputSchema', () => {
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

      expect(capturedConfig.inputSchema).to.have.property('targetOrg');
    });
  });

  describe('permission enforcement', () => {
    it('should deny write tool on read-only org', async () => {
      const cb = sinon.stub().resolves({ content: [{ type: 'text', text: 'ok' }] });
      const wrappedCb = captureWrappedCallback(server, 'salesforce_dml_records',
        { operation: z.string(), objectName: z.string(), records: z.array(z.any()) }, cb);

      const result = await wrappedCb({ targetOrg: 'readonly-org', operation: 'update', objectName: 'Account', records: [] }, {});
      expect(result.isError).to.be.true;
      expect(result.content[0].text).to.include('read-only');
      expect(cb.called).to.be.false;
    });

    it('should allow read tool on read-only org', async () => {
      const cb = sinon.stub().resolves({ content: [{ type: 'text', text: 'query result' }] });
      const wrappedCb = captureWrappedCallback(server, 'salesforce_query_records',
        { query: z.string() }, cb);

      const result = await wrappedCb({ targetOrg: 'readonly-org', query: 'SELECT Id FROM Account' }, {});
      expect(result.isError).to.be.undefined;
      expect(cb.calledOnce).to.be.true;
    });

    it('should allow write tool on full-access org without approval', async () => {
      const cb = sinon.stub().resolves({ content: [{ type: 'text', text: 'ok' }] });
      const wrappedCb = captureWrappedCallback(server, 'salesforce_dml_records',
        { operation: z.string(), objectName: z.string(), records: z.array(z.any()) }, cb);

      const result = await wrappedCb({ targetOrg: 'staging', operation: 'update', objectName: 'Account', records: [] }, {});
      expect(result.isError).to.be.undefined;
      expect(cb.calledOnce).to.be.true;
    });

    it('should use default org when targetOrg is not provided', async () => {
      const cb = sinon.stub().resolves({ content: [{ type: 'text', text: 'ok' }] });
      const wrappedCb = captureWrappedCallback(server, 'salesforce_query_records',
        { query: z.string() }, cb);

      await wrappedCb({ query: 'SELECT Id FROM Account' }, {});
      const callArgs = cb.firstCall.args[0];
      expect(callArgs.usernameOrAlias).to.equal('staging');
    });

    it('should reject targetOrg not in authorized list', async () => {
      const cb = sinon.stub().resolves({ content: [{ type: 'text', text: 'ok' }] });
      const wrappedCb = captureWrappedCallback(server, 'salesforce_query_records',
        { query: z.string() }, cb);

      const result = await wrappedCb({ targetOrg: 'unknown-org', query: 'SELECT Id FROM Account' }, {});
      expect(result.isError).to.be.true;
      expect(result.content[0].text).to.include('not authorized');
      expect(cb.called).to.be.false;
    });

    it('should map targetOrg to usernameOrAlias in args', async () => {
      const cb = sinon.stub().resolves({ content: [{ type: 'text', text: 'ok' }] });
      const wrappedCb = captureWrappedCallback(server, 'salesforce_query_records',
        { query: z.string() }, cb);

      await wrappedCb({ targetOrg: 'prod', query: 'SELECT Id FROM Account' }, {});
      const callArgs = cb.firstCall.args[0];
      expect(callArgs.usernameOrAlias).to.equal('prod');
      expect(callArgs).to.not.have.property('targetOrg');
    });

    it('should error when no target org and no default', async () => {
      const serverNoDefault = new SfMcpServer(
        { name: 'test', version: '1.0.0' },
        { orgPermissions: new Map(), authorizedOrgs: [], defaultOrg: undefined }
      );
      const cb = sinon.stub().resolves({ content: [{ type: 'text', text: 'ok' }] });
      const wrappedCb = captureWrappedCallback(serverNoDefault, 'salesforce_query_records',
        { query: z.string() }, cb);

      const result = await wrappedCb({ query: 'SELECT Id FROM Account' }, {});
      expect(result.isError).to.be.true;
      expect(result.content[0].text).to.include('No target org');
    });
  });

  describe('approval-required org', () => {
    it('should fall through to error when elicitation not supported', async () => {
      const cb = sinon.stub().resolves({ content: [{ type: 'text', text: 'ok' }] });
      const wrappedCb = captureWrappedCallback(server, 'salesforce_dml_records',
        { operation: z.string(), objectName: z.string(), records: z.array(z.any()) }, cb);

      // No elicitation support on mock server, so try/catch should trigger
      const result = await wrappedCb({ targetOrg: 'prod', operation: 'update', objectName: 'Account', records: [] }, {});
      expect(result.isError).to.be.true;
      expect(result.content[0].text).to.include('Elicitation');
      expect(cb.called).to.be.false;
    });
  });

  describe('backward compatibility', () => {
    it('should work with empty authorizedOrgs (skip validation)', async () => {
      const serverOpen = new SfMcpServer(
        { name: 'test', version: '1.0.0' },
        { orgPermissions: new Map(), authorizedOrgs: [], defaultOrg: 'my-org' }
      );
      const cb = sinon.stub().resolves({ content: [{ type: 'text', text: 'ok' }] });
      const wrappedCb = captureWrappedCallback(serverOpen, 'salesforce_query_records',
        { query: z.string() }, cb);

      const result = await wrappedCb({ query: 'SELECT Id FROM Account' }, {});
      expect(result.isError).to.be.undefined;
      expect(cb.calledOnce).to.be.true;
    });
  });
});
