# Phase 11: Schema Discovery Tool - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-12
**Phase:** 11-schema-discovery-tool
**Areas discussed:** Response format, Cache metadata, Tool description wording, SchemaService injection
**Mode:** --auto (all decisions auto-selected)

---

## Response Format

| Option | Description | Selected |
|--------|-------------|----------|
| Curated summary | Extract fields, relationships, key prefix — optimized for AI context | ✓ |
| Raw API response | Return full DescribeSObjectResult as-is | |
| Configurable depth | Parameter to choose raw vs summary | |

**User's choice:** [auto] Curated summary (recommended default)
**Notes:** Raw DescribeSObjectResult is too verbose for AI context windows. Curated summary focuses on what agents need for query writing.

---

## Cache Metadata

| Option | Description | Selected |
|--------|-------------|----------|
| _meta object | Include source, cachedAt, ageMs, indicator in response | ✓ |
| Header-style | Separate metadata from data using top-level fields | |
| No metadata | Just return data, let agent infer | |

**User's choice:** [auto] _meta object (recommended default — satisfies DISC-05)
**Notes:** Explicit cache transparency helps AI agents understand data freshness.

---

## Tool Description Wording

| Option | Description | Selected |
|--------|-------------|----------|
| Recommend | "Recommended before writing SOQL queries against unfamiliar objects" | ✓ |
| Require | "Always describe objects before querying" | |
| Neutral | "Retrieve schema metadata for a Salesforce object" (no guidance) | |

**User's choice:** [auto] Recommend (recommended default — per DISC-06)
**Notes:** DISC-06 explicitly states "recommends (not forces)".

---

## SchemaService Injection

| Option | Description | Selected |
|--------|-------------|----------|
| Constructor injection | Pass SchemaService alongside Services in tool constructor | ✓ |
| Extend Services interface | Add getSchemaService() to shared Services | |
| Static/global singleton | Access via module-level import | |

**User's choice:** [auto] Constructor injection (recommended default — per Phase 10 D-01)
**Notes:** Keeps SchemaService dx-core internal without modifying shared API package.

---

## Agent's Discretion

- Internal file structure
- Exact response formatting
- Field count summary inclusion
- Test mocking approach

## Deferred Ideas

None.
