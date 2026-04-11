import { type Connection } from '@salesforce/core';
import { type OrgConfigInfo, type SanitizedOrgAuthorization } from './types.js';

export type OrgPermission = 'read-only' | 'full-access' | 'approval-required';
export type PermissionResult = 'allow' | 'deny' | 'needs-approval';
export type ToolCategory = 'read' | 'write' | 'execute';

export interface PermissionService {
  getOrgPermission(orgName: string): OrgPermission;
  canExecuteCategory(orgName: string, category: ToolCategory): PermissionResult;
  getAuthorizedOrgs(): string[];
}

export interface Services {
  getTelemetryService(): TelemetryService;
  getOrgService(): OrgService;
  getConfigService(): ConfigService;
  getPermissionService(): PermissionService;
}

export interface TelemetryService {
  sendEvent(eventName: string, event: TelemetryEvent): void;
}

export type TelemetryEvent = {
  [key: string]: string | number | boolean | null | undefined;
};


export interface OrgService {
  getAllowedOrgUsernames(): Promise<Set<string>>;
  getAllowedOrgs(): Promise<SanitizedOrgAuthorization[]>;
  getConnection(username: string): Promise<Connection>;
  getDefaultTargetOrg(): Promise<OrgConfigInfo | undefined>;
  getDefaultTargetDevHub(): Promise<OrgConfigInfo | undefined>;
  findOrgByUsernameOrAlias(
    allOrgs: SanitizedOrgAuthorization[],
    usernameOrAlias: string
  ): SanitizedOrgAuthorization | undefined;
}

export type StartupFlags = {
  'allow-non-ga-tools': boolean | undefined,
  debug: boolean | undefined
}

export interface ConfigService {
  getDataDir(): string;
  getStartupFlags(): StartupFlags;
}
