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
import { ConfigAggregator } from '@salesforce/core';
import { getDefaultTargetOrg, getDefaultTargetDevHub } from '../../src/utils/auth.js';

describe('auth clearInstance concurrency', () => {
  const sandbox = sinon.createSandbox();
  let clearInstanceStub: sinon.SinonStub;

  beforeEach(() => {
    clearInstanceStub = sandbox.stub(ConfigAggregator, 'clearInstance').resolves();
    sandbox.stub(ConfigAggregator, 'create').resolves({
      getInfo: () => ({ value: undefined, path: undefined, key: 'target-org', location: undefined }),
    } as unknown as ConfigAggregator);
  });

  afterEach(() => {
    sandbox.restore();
  });

  it('getDefaultTargetOrg should call clearInstance with the current working directory, not without args', async () => {
    const cwd = process.cwd();

    await getDefaultTargetOrg();

    expect(clearInstanceStub.calledOnce).to.be.true;
    // Must pass the current path to avoid clearing ALL cached ConfigAggregator instances.
    // Clearing all instances causes race conditions during concurrent tool execution.
    expect(clearInstanceStub.firstCall.args[0]).to.equal(cwd);
  });

  it('getDefaultTargetDevHub should call clearInstance with the current working directory, not without args', async () => {
    const cwd = process.cwd();

    await getDefaultTargetDevHub();

    expect(clearInstanceStub.calledOnce).to.be.true;
    expect(clearInstanceStub.firstCall.args[0]).to.equal(cwd);
  });
});
