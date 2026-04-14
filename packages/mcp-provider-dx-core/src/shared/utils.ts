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

/* eslint-disable no-console */

import path from 'node:path';
import type { Connection } from '@salesforce/core';
import { type ToolTextResponse } from './types.js';

/**
 * Returns a single-line header identifying the org a tool connected to.
 * Prepend this to tool responses so callers can verify the target org.
 *
 * Example: "Connected to: user@example.com @ https://example.my.salesforce.com (orgId: 00Dxx)"
 */
export function connectionHeader(connection: Connection): string {
  const username = connection.getUsername() ?? 'unknown';
  const orgId = connection.getAuthInfoFields().orgId ?? 'unknown';
  return `Connected to: ${username} @ ${connection.instanceUrl} (orgId: ${orgId})`;
}

/**
 * Formats a user-facing error message listing the allowed orgs.
 * Used by requireUsernameOrAlias and tools' zero-org error branches.
 */
export function formatAllowedOrgsError(allowedOrgs: string[]): string {
  if (allowedOrgs.length === 0) {
    return 'No allowed orgs configured for this MCP server. Check the server startup --orgs config.';
  }
  return `Missing or invalid usernameOrAlias. Allowed orgs for this server: ${allowedOrgs.join(', ')}. Ask the user which org to target.`;
}

/**
 * Thrown when a tool receives no usernameOrAlias or one not in the allowed list.
 * Carries the allowed org list so callers can format actionable error messages.
 */
export class MissingUsernameOrAliasError extends Error {
  public constructor(public readonly allowedOrgs: string[]) {
    super(formatAllowedOrgsError(allowedOrgs));
    this.name = 'MissingUsernameOrAliasError';
  }
}

/**
 * Validates that `provided` is non-empty and present in `allowed`.
 *
 * @param allowed - the org aliases/usernames this MCP server is configured for
 * @param provided - the usernameOrAlias passed by the caller (may be undefined)
 * @returns the validated usernameOrAlias string
 * @throws MissingUsernameOrAliasError when validation fails
 */
export function requireUsernameOrAlias(allowed: string[], provided: string | undefined): string {
  if (!provided || provided.trim() === '') {
    throw new MissingUsernameOrAliasError(allowed);
  }
  if (!allowed.includes(provided)) {
    throw new MissingUsernameOrAliasError(allowed);
  }
  return provided;
}

// TODO: break into two helpers? One for errors and one for success?
export function textResponse(text: string, isError: boolean = false): ToolTextResponse {
  if (text === '') throw new Error('textResponse error: "text" cannot be empty');
  return {
    isError,
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}

export function sanitizePath(projectPath: string): boolean {
  // Decode URL-encoded sequences
  const decodedProjectPath = decodeURIComponent(projectPath);
  // Normalize Unicode characters
  const normalizedProjectPath = decodedProjectPath.normalize();

  // Check for various traversal patterns
  const hasTraversal =
    normalizedProjectPath.includes('..') ||
    normalizedProjectPath.includes('\u2025') || // Unicode horizontal ellipsis
    normalizedProjectPath.includes('\u2026'); // Unicode vertical ellipsis

  // `path.isAbsolute` doesn't cover Windows's drive-relative path:
  // https://github.com/nodejs/node/issues/56766
  //
  // we can assume it's a drive-relative path if it's starts with `\`.
  const isAbsolute =
    path.isAbsolute(projectPath) && (process.platform === 'win32' ? !projectPath.startsWith('\\') : true);

  return !hasTraversal && isAbsolute;
}
