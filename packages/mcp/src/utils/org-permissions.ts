export type OrgPermission = 'read-only' | 'full-access' | 'approval-required';
export type ToolCategory = 'read' | 'write' | 'execute';
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
