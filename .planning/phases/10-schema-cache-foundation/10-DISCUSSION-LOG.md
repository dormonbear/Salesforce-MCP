# Phase 10: Schema Cache Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-12
**Phase:** 10-schema-cache-foundation
**Areas discussed:** Service Architecture, Dependency Strategy

---

## Service Architecture

| Option | Description | Selected |
|--------|-------------|----------|
| dx-core 内部模块 | SchemaService 作为 dx-core 私有模块，不修改 mcp-provider-api 的 Services 接口。只有 dx-core 的工具能直接访问。保持 API 边界干净。 | ✓ |
| 添加到 Services 接口 | 在 mcp-provider-api 的 Services 接口上添加 getSchemaService()，所有 provider 都可访问。未来其他 provider 可能需要 schema 信息。 | |
| Claude 决定 | Claude 根据代码结构和未来扩展性自行判断最佳方案 | |

**User's choice:** dx-core 内部模块（推荐）
**Notes:** Keeps API boundary clean. Only dx-core tools need schema access for now.

---

## Dependency Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| 使用 lru-cache 包 | 成熟的 npm 包，久经考验，支持 TTL+LRU+size-based eviction，零 bug 风险。新增一个生产依赖。 | ✓ |
| 手写 Map + TTL | 不引入新依赖，用 Map + setTimeout/检查时间戳实现。代码量小但需要自己处理 edge case（并发清理、内存泄漏等）。 | |
| Claude 决定 | Claude 根据项目现有依赖风格和复杂度判断 | |

**User's choice:** 使用 lru-cache 包（推荐）
**Notes:** Proven library, handles TTL and LRU eviction correctly out of the box.

---

## Claude's Discretion

- Internal module structure and file organization
- Test strategy details
- Class-based vs functional API style

## Deferred Ideas

None.
