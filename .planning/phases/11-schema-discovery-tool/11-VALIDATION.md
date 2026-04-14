---
phase: 11
slug: schema-discovery-tool
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-12
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Mocha + Chai + Sinon (with nyc coverage) |
| **Config file** | `packages/mcp-provider-dx-core/.mocharc.json` |
| **Quick run command** | `cd packages/mcp-provider-dx-core && npx mocha "test/unit/schema/describe-object*.test.ts"` |
| **Full suite command** | `cd packages/mcp-provider-dx-core && yarn test` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `cd packages/mcp-provider-dx-core && npx mocha "test/unit/schema/describe-object*.test.ts"`
- **After every plan wave:** Run `cd packages/mcp-provider-dx-core && yarn test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 1 | DISC-04 | — | N/A | unit | `npx mocha "test/unit/schema/describe-object.test.ts" --grep "curated fields"` | ❌ W0 | ⬜ pending |
| 11-01-02 | 01 | 1 | DISC-04 | — | N/A | unit | `npx mocha "test/unit/schema/describe-object.test.ts" --grep "error handling"` | ❌ W0 | ⬜ pending |
| 11-01-03 | 01 | 1 | DISC-05 | — | N/A | unit | `npx mocha "test/unit/schema/describe-object.test.ts" --grep "cache hit"` | ❌ W0 | ⬜ pending |
| 11-01-04 | 01 | 1 | DISC-05 | — | N/A | unit | `npx mocha "test/unit/schema/describe-object.test.ts" --grep "cache miss"` | ❌ W0 | ⬜ pending |
| 11-01-05 | 01 | 1 | DISC-06 | — | N/A | unit | `npx mocha "test/unit/schema/describe-object.test.ts" --grep "description"` | ❌ W0 | ⬜ pending |
| 11-01-06 | 01 | 1 | ALL | — | N/A | unit | `npx mocha "test/unit/schema/describe-object.test.ts" --grep "output schema"` | ❌ W0 | ⬜ pending |
| 11-01-07 | 01 | 1 | ALL | — | N/A | unit | Existing `test/e2e/tool-registration.test.ts` | ✅ Existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/unit/schema/describe-object.test.ts` — stubs for DISC-04, DISC-05, DISC-06
- [ ] Mock fixtures for DescribeSObjectResult (Account with 30+ fields, childRelationships, lookups)

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
