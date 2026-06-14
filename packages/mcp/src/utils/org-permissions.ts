import type { ToolCategory } from './tool-categories.js';

export type OrgPermission = 'read-only' | 'full-access' | 'approval-required';
export type PermissionResult = 'allow' | 'deny' | 'needs-approval';

const VALID_PERMISSIONS: Set<string> = new Set(['read-only', 'full-access', 'approval-required']);

export function parseOrgPermissions(envValue: string | undefined): Map<string, OrgPermission> {
  const permissions = new Map<string, OrgPermission>();
  if (!envValue || envValue.trim() === '') return permissions;

  for (const pair of envValue.split(',')) {
    const [alias, permission] = pair.split(':').map((s) => s.trim());
    if (!alias || !permission) continue;
    if (!VALID_PERMISSIONS.has(permission)) {
      throw new Error(
        `Invalid permission "${permission}" for org "${alias}". Valid values: ${[...VALID_PERMISSIONS].join(', ')}`
      );
    }
    permissions.set(alias, permission as OrgPermission);
  }

  return permissions;
}

/**
 * Expand a permission map so a permission configured for ANY identifier of an org (an alias
 * or the username) applies to ALL of that org's identifiers.
 *
 * Without this, ORG_PERMISSIONS configured by alias (e.g. `V_Staging:read-only`) is bypassed
 * when a caller passes the resolved username instead — getOrgPermission misses the map and
 * defaults to full-access, silently dropping the read-only/approval protection.
 */
export function expandOrgPermissions(
  permissions: Map<string, OrgPermission>,
  orgIdentities: ReadonlyArray<{ username?: string; aliases?: string[] | null }>
): Map<string, OrgPermission> {
  const expanded = new Map(permissions);
  for (const org of orgIdentities) {
    const ids = [org.username, ...(org.aliases ?? [])].filter((id): id is string => Boolean(id));
    const configured = ids.map((id) => permissions.get(id)).find((p) => p !== undefined);
    if (configured) {
      for (const id of ids) expanded.set(id, configured);
    }
  }
  return expanded;
}

export function getOrgPermission(permissions: Map<string, OrgPermission>, alias: string): OrgPermission {
  return permissions.get(alias) ?? 'full-access';
}

export function canExecute(
  permissions: Map<string, OrgPermission>,
  alias: string,
  category: ToolCategory
): PermissionResult {
  const permission = getOrgPermission(permissions, alias);

  if (category === 'read') return 'allow';

  switch (permission) {
    case 'full-access':
      return 'allow';
    case 'read-only':
      return 'deny';
    case 'approval-required':
      return 'needs-approval';
  }
}
