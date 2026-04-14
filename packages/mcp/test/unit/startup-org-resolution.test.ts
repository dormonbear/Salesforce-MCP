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
import { AuthInfo, ConfigAggregator, Connection, StateAggregator } from '@salesforce/core';
import { resolveSymbolicOrgs, getConnection } from '../../src/utils/auth.js';
import Cache from '../../src/utils/cache.js';

describe('startup org resolution', () => {
  const sandbox = sinon.createSandbox();

  afterEach(() => {
    sandbox.restore();
  });

  describe('resolveSymbolicOrgs', () => {
    it('should resolve DEFAULT_TARGET_ORG to actual username', async () => {
      sandbox.stub(ConfigAggregator, 'create').resolves({
        getInfo: (prop: string) => {
          if (prop === 'target-org') {
            return { value: 'resolved-user@example.com', path: '/some/path', key: 'target-org', location: 'Local' };
          }
          return { value: undefined, path: undefined, key: prop, location: undefined };
        },
      } as unknown as ConfigAggregator);

      const orgs = new Set(['DEFAULT_TARGET_ORG', 'explicit-user@example.com']);
      const resolved = await resolveSymbolicOrgs(orgs);

      expect(resolved.has('DEFAULT_TARGET_ORG')).to.be.false;
      expect(resolved.has('resolved-user@example.com')).to.be.true;
      expect(resolved.has('explicit-user@example.com')).to.be.true;
    });

    it('should resolve DEFAULT_TARGET_DEV_HUB to actual username', async () => {
      sandbox.stub(ConfigAggregator, 'create').resolves({
        getInfo: (prop: string) => {
          if (prop === 'target-dev-hub') {
            return { value: 'devhub-user@example.com', path: '/some/path', key: 'target-dev-hub', location: 'Global' };
          }
          return { value: undefined, path: undefined, key: prop, location: undefined };
        },
      } as unknown as ConfigAggregator);

      const orgs = new Set(['DEFAULT_TARGET_DEV_HUB']);
      const resolved = await resolveSymbolicOrgs(orgs);

      expect(resolved.has('DEFAULT_TARGET_DEV_HUB')).to.be.false;
      expect(resolved.has('devhub-user@example.com')).to.be.true;
    });

    it('should resolve both DEFAULT_TARGET_ORG and DEFAULT_TARGET_DEV_HUB', async () => {
      sandbox.stub(ConfigAggregator, 'create').resolves({
        getInfo: (prop: string) => {
          if (prop === 'target-org') {
            return { value: 'org-user@example.com', path: '/some/path', key: 'target-org', location: 'Local' };
          }
          if (prop === 'target-dev-hub') {
            return { value: 'hub-user@example.com', path: '/some/path', key: 'target-dev-hub', location: 'Global' };
          }
          return { value: undefined, path: undefined, key: prop, location: undefined };
        },
      } as unknown as ConfigAggregator);

      const orgs = new Set(['DEFAULT_TARGET_ORG', 'DEFAULT_TARGET_DEV_HUB']);
      const resolved = await resolveSymbolicOrgs(orgs);

      expect(resolved.has('DEFAULT_TARGET_ORG')).to.be.false;
      expect(resolved.has('DEFAULT_TARGET_DEV_HUB')).to.be.false;
      expect(resolved.has('org-user@example.com')).to.be.true;
      expect(resolved.has('hub-user@example.com')).to.be.true;
    });

    it('should keep symbolic value if resolution fails (graceful degradation)', async () => {
      sandbox.stub(ConfigAggregator, 'create').resolves({
        getInfo: () => ({ value: undefined, path: undefined, key: 'target-org', location: undefined }),
      } as unknown as ConfigAggregator);

      const orgs = new Set(['DEFAULT_TARGET_ORG']);
      const resolved = await resolveSymbolicOrgs(orgs);

      // When resolution fails, the symbolic value is kept
      expect(resolved.has('DEFAULT_TARGET_ORG')).to.be.true;
    });

    it('should not modify ALLOW_ALL_ORGS or explicit usernames', async () => {
      sandbox.stub(ConfigAggregator, 'create').resolves({
        getInfo: () => ({ value: undefined, path: undefined, key: 'target-org', location: undefined }),
      } as unknown as ConfigAggregator);

      const orgs = new Set(['ALLOW_ALL_ORGS', 'explicit@example.com']);
      const resolved = await resolveSymbolicOrgs(orgs);

      expect(resolved.has('ALLOW_ALL_ORGS')).to.be.true;
      expect(resolved.has('explicit@example.com')).to.be.true;
      expect(resolved.size).to.equal(2);
    });

    it('should handle ConfigAggregator.create() failure gracefully', async () => {
      sandbox.stub(ConfigAggregator, 'create').rejects(new Error('Config file not found'));

      const orgs = new Set(['DEFAULT_TARGET_ORG', 'user@example.com']);
      const resolved = await resolveSymbolicOrgs(orgs);

      // On failure, keep the symbolic value
      expect(resolved.has('DEFAULT_TARGET_ORG')).to.be.true;
      expect(resolved.has('user@example.com')).to.be.true;
    });
  });

  describe('getConnection (simplified)', () => {
    let mockStateAggregator: { aliases: { getUsername: sinon.SinonStub } };

    beforeEach(() => {
      // Mock StateAggregator to return null for unknown aliases (passthrough)
      mockStateAggregator = { aliases: { getUsername: sandbox.stub().returns(null) } };
      sandbox.stub(StateAggregator, 'getInstance').resolves(mockStateAggregator as unknown as StateAggregator);
    });

    it('should directly create AuthInfo and Connection without calling getAllAllowedOrgs', async () => {
      const mockAuthInfo = { getUsername: () => 'user@example.com' };
      const mockConnection = { getUsername: () => 'user@example.com' };

      const authInfoCreateStub = sandbox.stub(AuthInfo, 'create').resolves(mockAuthInfo as unknown as AuthInfo);
      const connectionCreateStub = sandbox.stub(Connection, 'create').resolves(mockConnection as unknown as Connection);

      // Ensure getAllAllowedOrgs-related stubs are NOT called
      const listAllAuthStub = sandbox.stub(AuthInfo, 'listAllAuthorizations');

      const connection = await getConnection('user@example.com');

      expect(authInfoCreateStub.calledOnce).to.be.true;
      expect(authInfoCreateStub.firstCall.args[0]).to.deep.equal({ username: 'user@example.com' });
      expect(connectionCreateStub.calledOnce).to.be.true;
      expect(connectionCreateStub.firstCall.args[0]).to.deep.equal({ authInfo: mockAuthInfo });

      // getAllAllowedOrgs calls listAllAuthorizations — it should NOT be called
      expect(listAllAuthStub.called).to.be.false;
    });

    it('should resolve aliases to actual usernames before creating AuthInfo', async () => {
      // Simulate alias "my-alias" resolving to "real-user@example.com"
      mockStateAggregator.aliases.getUsername.withArgs('my-alias').returns('real-user@example.com');

      const mockAuthInfo = { getUsername: () => 'real-user@example.com' };
      const mockConnection = { getUsername: () => 'real-user@example.com' };

      const authInfoCreateStub = sandbox.stub(AuthInfo, 'create').resolves(mockAuthInfo as unknown as AuthInfo);
      sandbox.stub(Connection, 'create').resolves(mockConnection as unknown as Connection);

      await getConnection('my-alias');

      // Should pass the resolved username, not the alias
      expect(authInfoCreateStub.firstCall.args[0]).to.deep.equal({ username: 'real-user@example.com' });
    });

    it('should reject with meaningful error when AuthInfo.create fails', async () => {
      sandbox.stub(AuthInfo, 'create').rejects(new Error('No authorization found for user@unknown.com'));

      try {
        await getConnection('user@unknown.com');
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as Error).message).to.include('user@unknown.com');
      }
    });
  });
});
