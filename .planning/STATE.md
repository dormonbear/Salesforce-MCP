---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
last_updated: "2026-04-09T06:04:38.676Z"
progress:
  total_phases: 1
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State

## Current Focus

- Milestone 1, Phase 1: Eliminate per-call .sf/config.json reads
- Status: PLANNED — ready for execution

## Accumulated Context

### Roadmap Evolution

- Phase 1 added: Eliminate per-call .sf/config.json reads and resolve orgs at startup

### Key Technical Findings

- `process.chdir()` is called in 13+ tools, mutating global CWD state
- `@salesforce/core` ConfigAggregator uses `process.cwd()` as cache key for `.sf/config.json`
- `sf-mcp-server.ts` middleware already validates targetOrg against authorizedOrgs (Layer 1)
- `auth.ts getConnection()` re-validates by reading config on every call (Layer 2) — this is redundant and causes the race
- `DEFAULT_TARGET_ORG` / `DEFAULT_TARGET_DEV_HUB` are static after startup — no need to re-resolve per call
- A prior TDD fix (Mutex serialization + scoped clearInstance) is in place but treats symptoms, not root cause
