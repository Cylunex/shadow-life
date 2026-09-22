# Shadow Life 开发导航

- 先读 `ARCHITECTURE.md` 与 `docs/execution/rebuild-status.md`。
- 公开合同只在 `packages/contracts/src` 维护；生成物由 `pnpm check:contracts` 校验。
- 业务规则属于 `packages/kernel`，不得依赖 HTTP、数据库实现或 Agent Runtime。
- API、CLI、Worker 和 Agent 入口必须调用同一个 Executor，不能另写业务成功路径。
- 普通领域内写入直接执行；只有真实高影响后果才在执行点请求确认。
- 开发命令不得连接生产、部署服务、构建签名 APK或调用付费模型。

- Agent 使用与接入入口：`docs/agents/integration.md` 和 `skills/life-operator/SKILL.md`。
- MCP 适配器唯一实现位于 `apps/mcp/src`；运行时启动脚本只负责传入配置，不复制能力白名单或业务调用代码。
