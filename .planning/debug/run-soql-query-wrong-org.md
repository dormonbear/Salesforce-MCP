---
status: fixing
trigger: "run_soql_query 传 usernameOrAlias=OMNI_Staging 时返回数据与 OMNI_Live 完全一致"
created: 2026-04-14T00:00:00Z
updated: 2026-04-14T10:00:00Z
---

## Current Focus

hypothesis: 假设 D 被推翻（新证据：Live=23条, Staging=7条，数据不一致）。真实根因：get_username 工具读取 ~/.sf/config.json 中 target-org=OMNI_Admin，向 AI 推荐了 omni.admin@yingfu.com（Live 的 admin user），并指示 AI 将其用于后续所有工具调用。AI 后续调用 run_soql_query 时使用了 OMNI_Admin（Live），而非用户期望的 OMNI_Staging。
test: /tmp/repro-get-username.mjs 已实锤——suggestUsername() 返回 omni.admin@yingfu.com (OMNI_Admin)，reasoning="it is the default (Global) target org"
expecting: 修复 get_username 的 suggestUsername 逻辑：当有多个 allowed orgs 时，如果 defaultTargetOrg 对应的 org 不在 allowedOrgs 中，应该展示所有 allowed orgs 让用户/AI 选择，而不是静默推荐一个基于全局 config 的 org
next_action: 修复 get_username.ts 的 suggestUsername 函数，然后写失败单元测试验证

## Symptoms

expected: 传 usernameOrAlias=OMNI_Staging 时，run_soql_query 连到 Staging org
actual: 传 OMNI_Live 和 OMNI_Staging 返回相同的 23 条记录（相同 Id）
errors: 无报错
reproduction: 见原始 bug 报告

## Eliminated

- hypothesis: 假设 A（alias 串用）—— findOrgByUsernameOrAlias 代码正确，aliases 字段由 AuthInfo.listAllAuthorizations() 正确填充为数组
  evidence: 直接调用 AuthInfo.listAllAuthorizations() 验证，OMNI_Staging→['OMNI_Staging'], OMNI_Live→['OMNI_Live']，每个 org 有且仅有一个 alias，无交叉
  timestamp: 2026-04-14T08:00:00Z

- hypothesis: 假设 B（Cache 过期）—— 不是根因
  evidence: Cache 在每次 getConnection 调用时通过 getAllAllowedOrgs() 重新从 AuthInfo.listAllAuthorizations() 加载，不是固定缓存；且 allowedOrgs Set 在启动时正确写入
  timestamp: 2026-04-14T08:00:00Z

- hypothesis: 假设 C（AuthInfo 文件污染）—— 排除
  evidence: ~/.sfdx/dormon.zhou@ef.cn.json (orgId=00D28000000bkxyEAA, instanceUrl=english1.my) 和 ~/.sfdx/dormon.zhou@ef.cn.staging.json (orgId=00Dp0000000E0zWEAS, instanceUrl=english1--stg.sandbox.my) 数据完全正确，两个 org 指向不同 instanceUrl
  timestamp: 2026-04-14T08:00:00Z

- hypothesis: 假设 D（Staging 是 Live 的 sandbox 刷新，数据天然一致）—— 推翻
  evidence: sf CLI 直接对照：Live=23条, Staging=7条，数据完全不同。且 Staging 没有 Status__c 字段，/tmp/repro-org-routing.mjs 运行时查询 Status__c 报错 "No such column"，证明连 Staging 时查询必定失败；用户拿到 23 条成功结果说明连的一定是 Live
  timestamp: 2026-04-14T10:00:00Z

- hypothesis: run_soql_query 路由逻辑自身有 bug（假设 A/B）—— 排除
  evidence: /tmp/repro-org-routing.mjs 实锤——getConnection("OMNI_Staging") 正确返回 dormon.zhou@ef.cn.staging @ english1--stg.sandbox.my.salesforce.com。路由链路无误
  timestamp: 2026-04-14T10:00:00Z

## Evidence

- timestamp: 2026-04-14T08:00:00Z
  checked: ~/.sfdx/alias.json
  found: 正确映射 OMNI_Live→dormon.zhou@ef.cn, OMNI_Staging→dormon.zhou@ef.cn.staging
  implication: alias 系统本身正确

- timestamp: 2026-04-14T08:00:00Z
  checked: AuthInfo.listAllAuthorizations() 实际返回值
  found: 每个 org 的 aliases 字段正确填充为单元素数组，如 {username: "dormon.zhou@ef.cn.staging", aliases: ["OMNI_Staging"]}
  implication: findOrgByUsernameOrAlias 能正确区分两个 org，路由逻辑无缺陷

- timestamp: 2026-04-14T08:00:00Z
  checked: ~/.claude/.mcp.json MCP 启动配置
  found: --orgs OMNI_Admin,OMNI_Staging,SFOA_Live（无 OMNI_Live）
  implication: OMNI_Live 被 filterAllowedOrgs 拦截，传 OMNI_Live 应该报错而非返回数据

- timestamp: 2026-04-14T08:00:00Z
  checked: orgId 对比
  found: OMNI_Live orgId=00D28000000bkxyEAA, OMNI_Staging orgId=00Dp0000000E0zWEAS — 两个是不同的 org
  implication: 假设 D 成立的前提成立——Staging 是 Live 的 sandbox 刷新，两个 org 里的业务数据（Vendor_Contract_Update__c 记录及 Id）天然一致

- timestamp: 2026-04-14T08:00:00Z
  checked: Staging 写操作验证（Step 1）
  found: 网络连接失败 ECONNRESET（english1--stg.sandbox.my.salesforce.com），无法通过新建唯一记录来实验性排除假设 D
  implication: （当时）无法完全排除 bug，但结合以上证据假设 D 最可能——已被后续证据推翻

- timestamp: 2026-04-14T10:00:00Z
  checked: sf CLI 直接对照查询（/tmp/q-live.json, /tmp/q-stg.json）
  found: Live=23条, Staging=7条，数据完全不同。假设 D 被推翻
  implication: bug 真实存在，AI 在某次会话中确实连接了 Live 而非 Staging

- timestamp: 2026-04-14T10:00:00Z
  checked: Staging 的 Vendor_Contract_Update__c 字段结构
  found: /tmp/repro-org-routing.mjs 查询 Status__c 字段时 Staging 报错 "No such column 'Status__c'"；Live 有该字段。用户当时查询带 Status__c WHERE 条件并得到 23 条成功结果，说明连的一定是 Live
  implication: 强确定性证据——连 Staging 时该查询不可能成功返回数据

- timestamp: 2026-04-14T10:00:00Z
  checked: ~/.sf/config.json
  found: {"target-dev-hub": "V_Prod", "target-org": "OMNI_Admin"}，全局默认 target-org 是 OMNI_Admin（Live 的 admin user）
  implication: get_username 工具会基于此推荐 OMNI_Admin 给 AI

- timestamp: 2026-04-14T10:00:00Z
  checked: get_username.ts suggestUsername() + /tmp/repro-get-username.mjs 实际运行
  found: 当 allAllowedOrgs.length > 1 且 defaultTargetOrg.value="OMNI_Admin" 时，suggestUsername 返回 {suggestedUsername: "omni.admin@yingfu.com", aliasForReference: "OMNI_Admin", reasoning: "it is the default (Global) target org"}。工具响应文本明确指示 AI "UNLESS THE USER SPECIFIES OTHERWISE, use this username for usernameOrAlias in future Tool calls"
  implication: AI 在调用 get_username 后被强制绑定到 OMNI_Admin（Live），后续 run_soql_query 即使用户说"查 Staging"，AI 也可能沿用 OMNI_Admin

## Resolution

root_cause: get_username 工具的 suggestUsername 逻辑存在缺陷：当多个 allowed orgs 存在时（allAllowedOrgs.length > 1），它读取全局 ~/.sf/config.json 中的 target-org（OMNI_Admin = Live admin user）并将其推荐给 AI，同时通过响应文本强制指示 AI "UNLESS THE USER SPECIFIES OTHERWISE, use this username for usernameOrAlias in future Tool calls"。AI 因此在后续 run_soql_query 调用中传入了 omni.admin@yingfu.com（Live），而非用户期望的 OMNI_Staging。run_soql_query 和 getConnection 的路由逻辑本身完全正确。
fix: |
  1. suggestUsername 新增 allAllowedOrgs.length > 1 分支：不自动绑定到全局 target-org，而是将所有可用 org 列表放入 reasoning，设 suggestedUsername=undefined，要求 AI 向用户确认选择哪个 org。
  2. formatAllowedOrgsList 辅助函数：格式化 alias (username) 列表供 AI 展示。
  3. exec() 中当 suggestedUsername 为 undefined 时，把 reasoning（含 org 列表）传递给 AI，而非只返回固定的"No suggested username"错误文本。
verification: |
  - 4 个单元测试全部通过（包含 2 个 BUG REGRESSION 测试）
  - 全量 unit 测试 17 passing，0 failing
  - /tmp/repro-get-username.mjs 在修复后会返回 suggestedUsername=undefined，reasoning 包含所有 3 个 allowed orgs 列表
files_changed:
  - packages/mcp-provider-dx-core/src/tools/get_username.ts
  - packages/mcp-provider-dx-core/test/unit/get_username.test.ts
