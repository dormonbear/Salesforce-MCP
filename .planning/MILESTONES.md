# Milestones

## v1.0: Fix Concurrent Org Race Condition

**Status:** Complete
**Completed:** 2026-04-09

### Phases
- Phase 1: Eliminate per-call .sf/config.json reads and resolve orgs at startup

### Key Outcomes
- `resolveSymbolicOrgs()` resolves DEFAULT_TARGET_ORG / DEFAULT_TARGET_DEV_HUB once at startup
- `getConnection()` simplified — removed redundant per-call config reads via `getAllAllowedOrgs()` + `findOrgByUsernameOrAlias()`
- 8 new tests, 0 regressions
- Root cause of concurrent org race condition eliminated
