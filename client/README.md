# 客户端

Web、Android、CLI 和 MCP 都通过 Life HTTP API 读取数据、提交命令和恢复回执。客户端可以管理显示状态、
本地队列与传输重试，业务成功以共同 Executor 的结果为准。目录边界见[架构说明](../ARCHITECTURE.md)。

| 目录 | 职责 |
| --- | --- |
| `web/` | React / Vite 浏览器应用，使用服务端浏览器会话 |
| `android/` | Kotlin / Jetpack Compose 原生应用，独立 Gradle 项目 |
| `cli/` | 面向 HTTP API 的命令行客户端 |
| `mcp/` | 面向 HTTP API 的 MCP 适配器，唯一实现位于 `mcp/src` |

TypeScript 客户端依赖 [`@shadow/contracts`](../shared/README.md)，Android 使用同源生成的合同模型与资源。
客户端不直接导入 `server/kernel`、`server/database` 或数据库驱动，不复制授权、金额处理或写入成功规则。
MCP 归类为客户端是因为它通过 HTTP 访问 Life；它不承担服务端 Agent Runtime 的职责。

## 日常开发

先在仓库根目录运行 `pnpm setup`。所有 TypeScript 客户端使用根 pnpm workspace 与 lockfile，下面的命令
也从根目录执行：

```bash
pnpm dev:client
pnpm check:client
pnpm test:client
pnpm build:client
```

`dev:client` 启动 Web 的 Vite 服务；联调时在另一终端运行 `pnpm dev:server`，由现有开发代理转发 API 请求。
`build:client` 只构建 Web。API 服务不内嵌 Web，部署路由和真实端点保存在仓库外的运维配置中。

`check:client` 校验完整合同生成物、边界和相关 TypeScript 类型，并运行客户端范围测试。
`test:client` 不包含需要服务端实现的跨端组合测试；这些测试保留在完整套件中。改动 HTTP 交互、公共合同或
跨端恢复流程后，执行 `pnpm check` 和 `pnpm test:full:offline`。

CLI 包入口为 `pnpm --filter @shadow/cli start`，后接所需命令参数；MCP 入口是 `pnpm mcp`。
鉴权与既有接入方式见 [Agent / MCP 使用说明](../docs/agents/integration.md)，不要把凭据写入命令示例或提交文件。

## Android

Android 使用自身 Gradle 模块与 Android SDK，pnpm 的客户端检查不等同于 Android 编译或设备验收。
JDK、SDK、编译任务和本地配置入口见 [Android README](android/README.md)。公开合同变更需更新其生成物并完成
适用的 Gradle 验证。签名 APK 构建和发布仍需用户明确要求。
