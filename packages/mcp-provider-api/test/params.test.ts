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

import { describe, it, expect } from 'vitest';
import {
  sanitizePath,
  directoryParam,
  usernameOrAliasParam,
  optionalUsernameOrAliasParam,
} from '../src/params.js';

describe('sanitizePath', () => {
  it('returns true for valid absolute paths', () => {
    expect(sanitizePath('/valid/abs/path')).toBe(true);
  });

  it('returns false for paths with ".." traversal', () => {
    expect(sanitizePath('/with/../traversal')).toBe(false);
  });

  it('returns false for relative paths', () => {
    expect(sanitizePath('relative/path')).toBe(false);
  });

  it('returns false for paths with Unicode ellipsis \\u2026', () => {
    expect(sanitizePath('/with/\u2026/ellipsis')).toBe(false);
  });

  it('returns false for URL-encoded traversal sequences', () => {
    expect(sanitizePath('/url%2F..%2Fencoded')).toBe(false);
  });
});

describe('directoryParam', () => {
  it('succeeds for valid absolute path', () => {
    expect(() => directoryParam.parse('/valid/path')).not.toThrow();
  });

  it('throws ZodError for path with ".." traversal', () => {
    expect(() => directoryParam.parse('/bad/../path')).toThrow();
  });

  it('throws ZodError for non-absolute path', () => {
    expect(() => directoryParam.parse('not/absolute')).toThrow();
  });
});

describe('usernameOrAliasParam (required)', () => {
  it('succeeds for empty string (z.string() allows it)', () => {
    expect(() => usernameOrAliasParam.parse('')).not.toThrow();
  });

  it('throws for undefined', () => {
    expect(() => usernameOrAliasParam.parse(undefined)).toThrow();
  });

  it('succeeds for valid username', () => {
    expect(() => usernameOrAliasParam.parse('user@example.com')).not.toThrow();
  });
});

describe('optionalUsernameOrAliasParam (optional)', () => {
  it('succeeds for undefined', () => {
    expect(() => optionalUsernameOrAliasParam.parse(undefined)).not.toThrow();
  });

  it('succeeds for valid username', () => {
    expect(() => optionalUsernameOrAliasParam.parse('user@ex.com')).not.toThrow();
  });
});
