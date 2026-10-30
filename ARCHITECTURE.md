# Shadow Life architecture

Shadow Life is a new product kernel. It does not import or proxy the legacy Shadow services at runtime.

The single repository has three source areas: `server/` owns the API, background processing, MCP tooling, business
kernel, database and migration tools; `client/` owns Web, Android and CLI; `shared/` owns public contracts. Package
names remain `@shadow/*`. A single root pnpm workspace and lockfile support scoped development and checks;
the layout does not create independently installed repositories. See [the layout guide](docs/architecture/server-client-layout.md).

The dependency direction is fixed. Arrows point to dependencies:

```text
server/api -> server/kernel -> shared/contracts
server/api -> server/database -> server/kernel
server/api -> server/agent-adapter -> shared/contracts
server/worker -> server/database
server/mcp -> shared/contracts
client/web / client/cli -> shared/contracts
client/android -> generated contract models
```

`shared/contracts` owns public input, result, error and capability schemas. `server/kernel` owns authorization
effects, idempotency and workflows through ports. `server/database` implements those ports with PostgreSQL and
Drizzle. The API constructs trusted request context and calls the kernel Executor. Web, Android, CLI and the
server-side MCP entry point use HTTP to reach that same execution path; clients and MCP do not import database or
kernel implementations. MCP provides tools to external runtimes and does not perform Agent orchestration.
No entry point implements a second business-success path.

The API runs independently of the Web development server and does not embed the Web bundle. Browser session,
authentication and protected asset endpoints remain API responsibilities. The worker owns background processing;
`server/importers/legacy` is explicit migration tooling, not a runtime proxy. The existing `server/agent-adapter`
preserves Runtime compatibility; the directory reorganization does not introduce Agent orchestration work.

Contract changes retain compatibility across HTTP and all clients. The shared generator scope only emits or
checks shared JSON snapshots. The default scope also generates Android models and resources; changes to public
contracts require full generation and cross-side verification. Integration tests that exercise both clients and
server adapters remain in the full suite even when excluded from a side's isolated test scope.

Every write capability follows the same transaction protocol. Meals, purchases, refunds, budgets, health,
travel and library facts commit with an Operation receipt and Outbox event. Missing payment does not block a
meal. A purchase or receipt alone never proves that a meal occurred. Corrections require an expected revision
and preserve the prior snapshot.

Ordinary money writes use CNY with two decimal places. Explicit foreign-entry writes and historical imports
retain NUMERIC(24,6), source scale and ISO currency; conversions and allocations are separate relationships.
Generic correction cannot change amount or currency while those relationships exist. Every summary groups by
currency without converting through JavaScript numbers. Date-only legacy facts remain date-only; the importer never manufactures midnight timestamps.

Development authentication is deliberately explicit: `dev:` bearer tokens are accepted only when
`SHADOW_DEV_AUTH=true`, and production startup rejects that setting. Production verifies issuer, audience,
signature and expiry through OIDC JWKS, derives subject/client/effects from claims, and applies a server-owned
Health/Ledger write epoch. Request bodies never choose their owner or permissions.

消耗品购买关联、实际使用和估算边界见 [消耗品使用](docs/architecture/consumable-usage.md)。
Agent 业务术语、权限过滤发现、场景工具包和合同快照见 [业务语义与能力目录](docs/architecture/agent-semantic-catalog.md)。
Agent 任务上下文、来源和离线评测见 [任务上下文设计](docs/architecture/agent-task-context.md)。
个人意图、规划材料、跨 Agent 检查点、变化消费与经验见 [个人 Agent 数据底座](docs/architecture/personal-agent-foundation.md)。
网页原件、受限正文提取与助手事件分页、活动及恢复见 [网页快照与运行恢复](docs/architecture/web-snapshots-and-run-recovery.md)。

健康与饮食的联合复盘、覆盖口径和共同 Agent 查询见 [健康与饮食复盘](docs/architecture/wellness-review.md)。

账目省略字段保留、显式清空、时间一致性与兼容边界见 [账目局部更正](docs/architecture/money-corrections.md)。

Android 自动采集、应用使用、订单与活动整理、录音地点及分层回顾的拟议设计见
[Android 自动采集与生活回顾](docs/architecture/android-life-capture.md)（设计稿，尚未实现）。
