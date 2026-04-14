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
import { sep } from 'node:path';
import { expect } from 'chai';
import sinon from 'sinon';
import type { Connection } from '@salesforce/core';
import { textResponse, sanitizePath, connectionHeader, requireUsernameOrAlias, formatAllowedOrgsError, MissingUsernameOrAliasError } from '../../src/shared/utils.js';

describe('utilities tests', () => {
  // Common test setup
  const sandbox = sinon.createSandbox();
  afterEach(() => {
    // Clean up common stubs
    sandbox.restore();
  });

  describe('textResponse', () => {
    it('should return a properly formatted response object with default isError=false', () => {
      const message = 'Test message';
      const result = textResponse(message);

      expect(result).to.deep.equal({
        isError: false,
        content: [
          {
            type: 'text',
            text: message,
          },
        ],
      });
    });

    it('should return a response object with isError=true when specified', () => {
      const errorMessage = 'Error occurred';
      const result = textResponse(errorMessage, true);

      expect(result).to.deep.equal({
        isError: true,
        content: [
          {
            type: 'text',
            text: errorMessage,
          },
        ],
      });
    });

    it('should throw an error when given an empty string', () => {
      expect(() => textResponse('')).to.throw('textResponse error: "text" cannot be empty');
    });

    it('should handle very long string input', () => {
      const longString = 'a'.repeat(1000);
      const result = textResponse(longString);

      expect(result.content[0].text).to.equal(longString);
      expect(result.content[0].text.length).to.equal(1000);
      expect(result.isError).to.be.false;
    });
  });

  describe('connectionHeader', () => {
    function makeConnection(username: string, instanceUrl: string, orgId: string): Connection {
      return {
        getUsername: () => username,
        instanceUrl,
        getAuthInfoFields: () => ({ orgId }),
      } as unknown as Connection;
    }

    it('should include username, instanceUrl, and orgId', () => {
      const conn = makeConnection('user@staging.example.com', 'https://staging.my.salesforce.com', '00Dp0000STAGING');
      const header = connectionHeader(conn);
      expect(header).to.equal(
        'Connected to: user@staging.example.com @ https://staging.my.salesforce.com (orgId: 00Dp0000STAGING)',
      );
    });

    it('should use "unknown" when orgId is undefined', () => {
      const conn = makeConnection('user@live.example.com', 'https://live.my.salesforce.com', undefined as unknown as string);
      const header = connectionHeader(conn);
      expect(header).to.contain('orgId: unknown');
    });

    it('should distinguish two different orgs with same-looking data', () => {
      const live = makeConnection('user@live.example.com', 'https://live.my.salesforce.com', '00D_LIVE');
      const staging = makeConnection('user@staging.example.com', 'https://staging.my.salesforce.com', '00D_STAGING');
      expect(connectionHeader(live)).to.not.equal(connectionHeader(staging));
    });
  });

  describe('sanitizePath', () => {
    it('should return true for valid absolute paths', () => {
      if (process.platform === 'win32') {
        expect(sanitizePath('C:\\Users\\johndoe\\projects\\ebikes-lwc')).to.be.true;
      } else {
        // unix-like paths
        expect(sanitizePath('/Users/johndoe/projects/ebikes-lwc')).to.be.true;
        expect(sanitizePath('/Users/johndoe/projects/dreamhouse')).to.be.true;
      }
    });

    it('should return false for relative paths', () => {
      if (process.platform === 'win32') {
        // drive-relative path
        expect(sanitizePath('\\Users\\johndoe\\projects\\ebikes-lwc')).to.be.false;
      } else {
        expect(sanitizePath('relative/path/to/ebikes')).to.be.false;
        expect(sanitizePath('./relative/path/to/ebikes')).to.be.false;
      }
    });

    it('should detect path traversal attempts', () => {
      if (process.platform === 'win32') {
        expect(sanitizePath('C:\\Users\\johndoe\\projects\\ebikes-lwc\\..\\dreamhouse-lwc')).to.be.false;
        expect(sanitizePath('C:\\Users\\johndoe\\projects\\ebikes-lwc\\..')).to.be.false;
      } else {
        expect(sanitizePath('/Users/johndoe/projects/ebikes-lwc/../dreamhouse')).to.be.false;
        expect(sanitizePath('/Users/johndoe/projects/ebikes-lwc/..')).to.be.false;
      }
    });

    it('should handle URL-encoded sequences', () => {
      expect(sanitizePath(`${sep}path${sep}%2e%2e${sep}file`)).to.be.false;
    });

    it('should handle Unicode characters', () => {
      if (process.platform === 'win32') {
        expect(sanitizePath('C:\\Users\\johndoe\\projects\\ebikes-lwc\u2025')).to.be.false;
        expect(sanitizePath('C:\\Users\\johndoe\\projects\\ebikes-lwc\u2026')).to.be.false;
        expect(sanitizePath('C:\\Users\\johndoe\\projects\\ebikes-lwc\u00e9')).to.be.true;
      } else {
        expect(sanitizePath('/Users/johndoe/projects/ebikes-lwc/\u2025')).to.be.false;
        expect(sanitizePath('/Users/johndoe/projects/ebikes-lwc/\u2026')).to.be.false;
        expect(sanitizePath('/Users/johndoe/projects/ebikes-lwc/\u00e9')).to.be.true;
        expect(sanitizePath(`${sep}valid${sep}path\u00e9`)).to.be.true;
      }
    });

    it('should handle mixed path separators', () => {
      expect(sanitizePath('/path\\subpath/file')).to.be.true;
      expect(sanitizePath('\\path/..\\file')).to.be.false;
    });
  });

  describe('formatAllowedOrgsError', () => {
    it('should format a message listing all allowed orgs', () => {
      const msg = formatAllowedOrgsError(['A', 'B', 'C']);
      expect(msg).to.equal(
        'Missing or invalid usernameOrAlias. Allowed orgs for this server: A, B, C. Ask the user which org to target.',
      );
    });

    it('should handle empty allowed orgs list', () => {
      const msg = formatAllowedOrgsError([]);
      expect(msg).to.include('No allowed orgs configured');
    });
  });

  describe('MissingUsernameOrAliasError', () => {
    it('should carry the allowedOrgs list', () => {
      const err = new MissingUsernameOrAliasError(['A', 'B']);
      expect(err).to.be.instanceOf(Error);
      expect(err.allowedOrgs).to.deep.equal(['A', 'B']);
    });
  });

  describe('requireUsernameOrAlias', () => {
    function catchError(fn: () => unknown): MissingUsernameOrAliasError {
      try {
        fn();
      } catch (e) {
        if (e instanceof MissingUsernameOrAliasError) return e;
        throw e;
      }
      throw new Error('Expected MissingUsernameOrAliasError but no error was thrown');
    }

    it('requireUsernameOrAlias([], undefined) throws with "No allowed orgs configured"', () => {
      const err = catchError(() => requireUsernameOrAlias([], undefined));
      expect(err).to.be.instanceOf(MissingUsernameOrAliasError);
      expect(err.message).to.include('No allowed orgs configured');
    });

    it('requireUsernameOrAlias(["A","B"], undefined) throws listing A, B and ask instruction', () => {
      const err = catchError(() => requireUsernameOrAlias(['A', 'B'], undefined));
      expect(err).to.be.instanceOf(MissingUsernameOrAliasError);
      expect(err.message).to.include('A');
      expect(err.message).to.include('B');
      expect(err.message).to.include('Ask the user');
    });

    it('requireUsernameOrAlias(["A","B"], "C") throws; message mentions allowed orgs', () => {
      const err = catchError(() => requireUsernameOrAlias(['A', 'B'], 'C'));
      expect(err).to.be.instanceOf(MissingUsernameOrAliasError);
      // Message should list the allowed orgs so the caller knows valid options
      expect(err.message).to.include('A');
      expect(err.message).to.include('B');
    });

    it('requireUsernameOrAlias(["A","B"], "A") returns "A"', () => {
      const result = requireUsernameOrAlias(['A', 'B'], 'A');
      expect(result).to.equal('A');
    });
  });
});
