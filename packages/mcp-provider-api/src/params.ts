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

import path from 'node:path';
import { z } from 'zod';

/*
 * A collection of canonical shared tool parameters for all MCP provider packages.
 */

/**
 * Validates that a path is absolute and does not contain traversal sequences.
 * Checks URL-encoded variants, Unicode ellipsis characters, and relative paths.
 */
export function sanitizePath(projectPath: string): boolean {
  // Decode URL-encoded sequences
  const decodedProjectPath = decodeURIComponent(projectPath);
  // Normalize Unicode characters
  const normalizedProjectPath = decodedProjectPath.normalize();

  // Check for various traversal patterns
  const hasTraversal =
    normalizedProjectPath.includes('..') ||
    normalizedProjectPath.includes('\u2025') || // Unicode two-dot leader
    normalizedProjectPath.includes('\u2026'); // Unicode horizontal ellipsis

  // `path.isAbsolute` doesn't cover Windows's drive-relative path:
  // https://github.com/nodejs/node/issues/56766
  //
  // we can assume it's a drive-relative path if it starts with `\`.
  const isAbsolute =
    path.isAbsolute(projectPath) && (process.platform === 'win32' ? !projectPath.startsWith('\\') : true);

  return !hasTraversal && isAbsolute;
}

export const baseAbsolutePathParam = z
  .string()
  .refine(sanitizePath, 'Invalid path: Must be an absolute path and cannot contain path traversal sequences');

export const directoryParam = baseAbsolutePathParam.describe(`The directory to run this tool from.
AGENT INSTRUCTIONS:
We need to know where the user wants to run this tool from.
Look at your current Workspace Context to determine this filepath.
ALWAYS USE A FULL PATH TO THE DIRECTORY.
Unless the user explicitly asks for a different directory, or a new directory is created from the action of a tool, use this same directory for future tool calls.
`);

export const usernameOrAliasParam = z.string().describe(`The username or alias for the Salesforce org to run this tool against.

A username follows the <name@domain.com> format.
If the user refers to an org with a string not following that format, it can be a valid alias.

IMPORTANT:
- If it is not clear what the username or alias is, run the #get_username tool to resolve it.
- NEVER guess or make-up a username or alias.
`);

export const optionalUsernameOrAliasParam = z.string().optional().describe(`The username or alias for the Salesforce org to run this tool against.

A username follows the <name@domain.com> format.
If the user refers to an org with a string not following that format, it can be a valid alias.

IMPORTANT:
- If it is not clear what the username or alias is, run the #get_username tool to resolve it.
- NEVER guess or make-up a username or alias.
- If not provided, the tool will use the default target org for the directory.
`);

export const useToolingApiParam = z.boolean().optional().describe('Use Tooling API for the operation');
