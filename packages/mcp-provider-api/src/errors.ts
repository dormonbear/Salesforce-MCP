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

import { CallToolResult } from '@modelcontextprotocol/sdk/types.js';

export type ErrorCategory = 'user' | 'system';

export interface ToolErrorOptions {
  recovery?: string;
  category?: ErrorCategory;
}

export function toolError(message: string, options?: ToolErrorOptions): CallToolResult {
  if (!message) throw new Error('toolError: message cannot be empty');
  const { recovery, category = 'user' } = options ?? {};
  const prefix = category === 'system' ? '[SYSTEM_ERROR]' : '[USER_ERROR]';
  let text = `${prefix} ${message}`;
  if (recovery) {
    text += `\n\n[RECOVERY] ${recovery}`;
  }
  return { isError: true, content: [{ type: 'text', text }] };
}

const USER_ERROR_NAMES = [
  'NamedOrgNotFoundError',
  'NoOrgFound',
  'InvalidProjectWorkspace',
  'INVALID_FIELD',
  'MALFORMED_QUERY',
  'NOT_FOUND',
  'DomainNotFoundError',
  'INSUFFICIENT_ACCESS',
];

const SYSTEM_ERROR_PATTERNS = [
  'ECONNREFUSED',
  'ETIMEDOUT',
  'socket hang up',
  'INVALID_SESSION_ID',
];

export function classifyError(error: Error): ErrorCategory {
  if (USER_ERROR_NAMES.includes(error.name)) return 'user';
  if (SYSTEM_ERROR_PATTERNS.some((p) => error.message?.includes(p))) return 'system';
  return 'user';
}
