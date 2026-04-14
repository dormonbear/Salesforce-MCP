import { expect } from 'chai';
import {
  parseOrgPermissions,
  getOrgPermission,
  canExecute,
  type OrgPermission,
} from '../../src/utils/org-permissions.js';
import type { ToolCategory } from '../../src/utils/tool-categories.js';

describe('org-permissions', () => {
  describe('parseOrgPermissions', () => {
    it('should parse comma-separated alias:permission pairs', () => {
      const result = parseOrgPermissions('OMNI_Live:approval-required,OMNI_Staging:full-access');
      expect(result.get('OMNI_Live')).to.equal('approval-required');
      expect(result.get('OMNI_Staging')).to.equal('full-access');
    });

    it('should handle single entry', () => {
      const result = parseOrgPermissions('OMNI_Live:read-only');
      expect(result.size).to.equal(1);
      expect(result.get('OMNI_Live')).to.equal('read-only');
    });

    it('should return empty map for empty string', () => {
      const result = parseOrgPermissions('');
      expect(result.size).to.equal(0);
    });

    it('should return empty map for undefined', () => {
      const result = parseOrgPermissions(undefined);
      expect(result.size).to.equal(0);
    });

    it('should throw on invalid permission value', () => {
      expect(() => parseOrgPermissions('OMNI_Live:invalid')).to.throw('Invalid permission');
    });

    it('should trim whitespace', () => {
      const result = parseOrgPermissions(' OMNI_Live : approval-required , OMNI_Staging : full-access ');
      expect(result.get('OMNI_Live')).to.equal('approval-required');
      expect(result.get('OMNI_Staging')).to.equal('full-access');
    });
  });

  describe('getOrgPermission', () => {
    it('should return configured permission for known org', () => {
      const permissions = parseOrgPermissions('OMNI_Live:read-only');
      expect(getOrgPermission(permissions, 'OMNI_Live')).to.equal('read-only');
    });

    it('should default to full-access for unknown org', () => {
      const permissions = parseOrgPermissions('OMNI_Live:read-only');
      expect(getOrgPermission(permissions, 'OMNI_Dev')).to.equal('full-access');
    });
  });

  describe('canExecute', () => {
    const permissions = parseOrgPermissions(
      'prod:approval-required,staging:full-access,readonly-org:read-only'
    );

    it('should allow read on read-only org', () => {
      expect(canExecute(permissions, 'readonly-org', 'read')).to.equal('allow');
    });

    it('should deny write on read-only org', () => {
      expect(canExecute(permissions, 'readonly-org', 'write')).to.equal('deny');
    });

    it('should deny execute on read-only org', () => {
      expect(canExecute(permissions, 'readonly-org', 'execute')).to.equal('deny');
    });

    it('should allow read on full-access org', () => {
      expect(canExecute(permissions, 'staging', 'read')).to.equal('allow');
    });

    it('should allow write on full-access org', () => {
      expect(canExecute(permissions, 'staging', 'write')).to.equal('allow');
    });

    it('should allow execute on full-access org', () => {
      expect(canExecute(permissions, 'staging', 'execute')).to.equal('allow');
    });

    it('should allow read on approval-required org', () => {
      expect(canExecute(permissions, 'prod', 'read')).to.equal('allow');
    });

    it('should need approval for write on approval-required org', () => {
      expect(canExecute(permissions, 'prod', 'write')).to.equal('needs-approval');
    });

    it('should need approval for execute on approval-required org', () => {
      expect(canExecute(permissions, 'prod', 'execute')).to.equal('needs-approval');
    });

    it('should allow write on unconfigured org (defaults to full-access)', () => {
      expect(canExecute(permissions, 'unknown-org', 'write')).to.equal('allow');
    });
  });
});
