# 服务端

服务端负责 Life 的共同业务规则、数据持久化、HTTP 接口和后台处理。先读根目录的
[架构约束](../ARCHITECTURE.md)与[目录设计](../docs/architecture/server-client-layout.md)。

| 目录 | 职责 |
| --- | --- |
| `api/` | HTTP、认证和可信请求上下文，连接共同查询服务与 Executor |
| `worker/` | Outbox 与后台任务处理 |
| `kernel/` | 领域规则、端口、授权效果、幂等与共同 Executor |
| `database/` | PostgreSQL / Drizzle 实现、迁移与持久化回归 |
| `agent-adapter/` | 已有 Agent Runtime 协议适配与兼容 |
| `importers/legacy/` | 旧项目数据盘点、映射、试导入与显式迁移工具 |

公开输入和结果结构来自 [`shared/contracts`](../shared/README.md)。客户端通过 API 执行业务；
数据库、Worker 或 Runtime 适配不能提供绕过共同执行规则的业务成功路径。旧数据迁移工具的操作边界见
[迁移方案](../docs/migration/legacy-project-migration-plan.md)。

## 日常开发

所有 pnpm 命令均从仓库根目录运行，使用根 lockfile 安装一次。API 和 Worker 需要已配置的本地 PostgreSQL；
现有配置项见 [脱敏示例](../.env.example)。真实配置、凭据与运维资料保存在既定的仓库外位置或已忽略本地文件中。

```bash
pnpm setup
pnpm dev:server
```

需要后台处理时在另一终端运行 `pnpm dev:worker`。`pnpm db:migrate` 使用当前配置的本地数据库执行迁移，
运行前必须确认目标。服务端启动不要求同时启动 Web，API 不托管 Web 构建产物。

```bash
pnpm check:server
pnpm test:server
pnpm test:server:offline
```

`check:server` 包含共享 JSON 生成物、边界和相关 TypeScript 检查及服务端测试。
`test:server` 使用现有测试配置；需要数据库的测试必须配备测试库。`test:server:offline` 使用临时本地
PostgreSQL 与合成数据验证服务端，不连接生产数据。共享合同和客户端到 API 的组合行为仍须执行根目录的
`pnpm check` 与 `pnpm test:full:offline`。

## 兼容边界

目录调整不改变 API 路由、命令身份、授权、回执或数据库迁移历史。`agent-adapter/` 只保留已有接入能力，
本次整理不扩展 Agent 编排；相关后续工作由 Losna 接续。CLI 与 MCP 的可执行入口位于 `client/`，它们以 HTTP
调用服务端。运行、部署、签名 APK 和真实模型调用遵守工作区约定，不随开发检查自动执行。
