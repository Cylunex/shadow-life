# Shadow Life 开发导航

- 先读 `ARCHITECTURE.md` 与 `docs/execution/rebuild-status.md`。
- 目录与分侧命令见 `docs/architecture/server-client-layout.md`；入口分别为 `server/README.md`、`client/README.md` 和 `shared/README.md`。共用根 pnpm workspace 与 lockfile，不在分区内维护另一套安装锁。
- 公开合同只在 `shared/contracts/src` 维护；生成物由 `pnpm check:contracts` 校验。
- `pnpm check:shared` 与服务端检查使用生成器的 shared 范围；公共合同变更仍须完整生成、执行 `pnpm check` 和跨端完整回归，不能用 shared 范围替代 Android 生成物检查。
- 业务规则属于 `server/kernel`，不得依赖 HTTP、数据库实现或 Agent Runtime。
- API、CLI、Worker 和 Agent 入口必须调用同一个 Executor，不能另写业务成功路径；CLI、MCP、Web 和 Android 通过 HTTP 到达共同执行器，客户端不得直连数据库或导入服务端业务实现。
- API、Worker、数据库、旧数据迁移与现有 Agent Runtime 适配位于 `server/`；API 不嵌入 Web。`client/` 包含 Web、Android、CLI 和 MCP，Android 使用独立 Gradle 工作流。
- 普通领域内写入直接执行；只有真实高影响后果才在执行点请求确认。
- 开发命令不得连接生产、部署服务、构建签名 APK或调用付费模型。

- Agent 使用与接入入口：`docs/agents/integration.md` 和 `skills/life-operator/SKILL.md`。
- MCP 适配器唯一实现位于 `client/mcp/src`；运行时启动脚本只负责传入配置，不复制能力白名单或业务调用代码。
