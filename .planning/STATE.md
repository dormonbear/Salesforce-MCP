---
gsd_state_version: 1.0
milestone: v1.2
milestone_name: MCP Best Practices Alignment
status: active
stopped_at: Phase 6 complete — all 3 plans executed, 23 GA tools annotated, consistency test passing
last_updated: "2026-04-11T12:00:00.000Z"
last_activity: 2026-04-11 — Phase 6 complete, ready for Phase 7
progress:
  total_phases: 4
  completed_phases: 1
  total_plans: 3
  completed_plans: 3
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-04-11)

**Core value:** AI agents can safely and efficiently interact with Salesforce orgs through well-defined, permission-controlled MCP tools.
**Current focus:** Phase 7 — Error Recovery

## Current Position

Phase: 7 of 9 (Error Recovery)
Plan: — (not yet planned)
Status: Ready to plan
Last activity: 2026-04-11 — Phase 6 complete, ready for Phase 7

Progress: [██░░░░░░░░] 25%

## Performance Metrics

**Velocity:**

- Total plans completed: 3 (v1.2)

## Accumulated Context

### Decisions

- [v1.0 Phase 1]: Resolve orgs at startup — eliminates per-call config reads that caused race conditions
- [v1.1 Phase 5]: Targeted serialization for lwc-experts only — all other 47+ tools run in full parallel
- [v1.2 Research]: Do NOT upgrade SDK to 1.29.0 — ZodRawShapeCompat signature change, zero functional benefit
- [v1.2 Roadmap]: OUT-02 middleware test is prerequisite for OUT-01 — add pass-through test before any outputSchema work
- [v1.2 Roadmap]: DISC-03 wiring is prerequisite for DISC-01/02 — implementation and wiring ship together in Phase 9
- [Phase 06-01]: retrieve_metadata gets readOnlyHint:true — org-side read classification, local filesystem writes are not counted
- [Phase 06-01]: assign_permission_set gets idempotentHint:true — assigning same perm set twice is a no-op
- [Phase 06-01]: deploy_metadata gets openWorldHint:true — deploys to external org network, corrected from pre-existing false
- [Phase 06-02]: run_code_analyzer readOnlyHint fixed to true — writes temp results file but does not modify Salesforce org state
- [Phase 06-02]: sfDevopsDetectConflict openWorldHint:true — calls DevOps Center API
- [Phase 06-02]: title removed from enable_tools annotations block — title belongs at config root not inside annotations

### Pending Todos

None.

### Blockers/Concerns

None.

## Session Continuity

Last session: 2026-04-11T12:00:00.000Z
Stopped at: Phase 6 complete — all 3 plans executed successfully
Resume file: None
