# Phase 15: Query History — Discussion Log

**Mode:** Auto (all decisions auto-selected with recommended defaults)
**Date:** 2026-04-12

## Gray Areas Identified

1. Storage model (separate service vs SchemaService)
2. Ring buffer implementation approach
3. Default retention limit and configuration
4. What data to store per entry
5. Recording trigger location
6. Access mechanism (tool vs resource)
7. Tool metadata and naming
8. Disk persistence decision
9. Duplicate handling policy
10. Service lifecycle management

## Auto-Selected Decisions

[auto] Selected all gray areas

[auto] [Storage model] — Q: "Store in SchemaService or separate service?" → Selected: "Separate QueryHistoryService (different eviction semantics)" (recommended default)
[auto] [Ring buffer] — Q: "Ring buffer implementation?" → Selected: "Array-based with modulo index, O(1) push" (recommended default)
[auto] [Retention] — Q: "Default history size?" → Selected: "N=50, configurable via SF_QUERY_HISTORY_LIMIT env var" (recommended default)
[auto] [Stored data] — Q: "What to store per entry?" → Selected: "query, objectName, timestamp, fieldCount (no results)" (recommended default)
[auto] [Recording] — Q: "Where to record queries?" → Selected: "Fire-and-forget in run_soql_query after success" (recommended default)
[auto] [Access] — Q: "How to expose history?" → Selected: "Dedicated ListQueryHistoryMcpTool with optional filters" (recommended default)
[auto] [Tool metadata] — Q: "Tool name and properties?" → Selected: "salesforce_list_query_history, read-only, GA, query toolset" (recommended default)
[auto] [Persistence] — Q: "Persist to disk?" → Selected: "No — in-memory only, resets on restart" (recommended default)
[auto] [Duplicates] — Q: "Allow duplicate queries?" → Selected: "Yes — preserve temporal information" (recommended default)
[auto] [Lifecycle] — Q: "Service instantiation?" → Selected: "Same as SchemaService — created in provideTools(), shared via constructor" (recommended default)
