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
import { toolError, classifyError } from '../src/errors.js';

describe('toolError', () => {
  it('returns USER_ERROR by default', () => {
    const result = toolError('Something failed');
    expect(result).toEqual({
      isError: true,
      content: [{ type: 'text', text: '[USER_ERROR] Something failed' }],
    });
  });

  it('returns SYSTEM_ERROR when category is system', () => {
    const result = toolError('Something failed', { category: 'system' });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({
      type: 'text',
      text: '[SYSTEM_ERROR] Something failed',
    });
  });

  it('appends recovery hint when provided', () => {
    const result = toolError('Bad query', { recovery: 'Check field names.' });
    expect(result.content[0]).toEqual({
      type: 'text',
      text: '[USER_ERROR] Bad query\n\n[RECOVERY] Check field names.',
    });
  });

  it('combines system category with recovery hint', () => {
    const result = toolError('Connection lost', {
      category: 'system',
      recovery: 'Retry in a few seconds.',
    });
    expect(result.content[0]).toEqual({
      type: 'text',
      text: '[SYSTEM_ERROR] Connection lost\n\n[RECOVERY] Retry in a few seconds.',
    });
  });

  it('throws Error for empty message', () => {
    expect(() => toolError('')).toThrow('toolError: message cannot be empty');
  });
});

describe('classifyError', () => {
  describe('user errors', () => {
    it.each([
      'NamedOrgNotFoundError',
      'NoOrgFound',
      'InvalidProjectWorkspace',
      'INVALID_FIELD',
      'MALFORMED_QUERY',
      'NOT_FOUND',
      'DomainNotFoundError',
      'INSUFFICIENT_ACCESS',
    ])('classifies %s as user error', (name) => {
      const error = new Error('test');
      error.name = name;
      expect(classifyError(error)).toBe('user');
    });
  });

  describe('system errors', () => {
    it.each([
      'ECONNREFUSED',
      'ETIMEDOUT',
      'INVALID_SESSION_ID',
      'socket hang up',
    ])('classifies message containing "%s" as system error', (pattern) => {
      const error = new Error(`Something went wrong: ${pattern}`);
      expect(classifyError(error)).toBe('system');
    });
  });

  it('defaults to user for unknown errors', () => {
    const error = new Error('some random error');
    expect(classifyError(error)).toBe('user');
  });

  it('handles error with no message gracefully', () => {
    const error = new Error();
    error.name = 'UnknownError';
    expect(classifyError(error)).toBe('user');
  });
});
