# Roadmap

## Milestone 1: Fix Concurrent Org Race Condition

### Phase 1: Eliminate per-call .sf/config.json reads and resolve orgs at startup

- **Goal:** Remove the root cause of the concurrent org race condition by resolving symbolic org names (DEFAULT_TARGET_ORG, DEFAULT_TARGET_DEV_HUB) once at startup, eliminating the redundant per-call config reads in `getConnection()` that depend on `process.cwd()`.
- **Depends on:** None
- **Plans:** Not yet planned


