# Shadow Life architecture

Shadow Life is a new product kernel. It does not import or proxy the legacy Shadow services at runtime.

The dependency direction is fixed:

```text
contracts <- kernel <- database <- api / worker
                    <- agent-adapter
contracts <- cli / web
```

`contracts` owns public input, result, error and capability schemas. `kernel` owns authorization effects,
idempotency and workflows through ports. `database` implements those ports with PostgreSQL and Drizzle.
Transport packages construct trusted request context and call the kernel Executor. They never implement a
second write path.

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
