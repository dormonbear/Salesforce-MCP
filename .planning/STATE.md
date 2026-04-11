---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Eliminate process.chdir() and Enable Tool Parallelism
status: defining_requirements
last_updated: "2026-04-11"
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-04-11 — Milestone v1.1 started

## Accumulated Context

### Roadmap Evolution

- v1.0 Phase 1 completed: Eliminate per-call .sf/config.json reads and resolve orgs at startup

### Key Technical Findings

- `process.chdir()` is called in 14 tools, mutating global CWD state
- `@salesforce/core` ConfigAggregator uses `process.cwd()` as cache key for `.sf/config.json`
- `sf-mcp-server.ts` middleware already validates targetOrg against authorizedOrgs (Layer 1)
- `auth.ts getConnection()` re-validates by reading config on every call (Layer 2) — this is redundant and causes the race
- `DEFAULT_TARGET_ORG` / `DEFAULT_TARGET_DEV_HUB` are static after startup — no need to re-resolve per call
- A prior TDD fix (Mutex serialization + scoped clearInstance) is in place but treats symptoms, not root cause
- v1.0 Phase 1 resolved the root cause; process.chdir() elimination is now safe to proceed
