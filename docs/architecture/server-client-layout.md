# 单仓服务端与客户端组织

Life 保留一个 Git 仓库、一套 pnpm workspace 和一份根 lockfile，把服务端、客户端与共享合同分别放在
`server/`、`client/` 和 `shared/`。这样日常开发可以按侧启动和检查，共同业务协议与跨端验证仍在同一仓库内完成。
本次调整改变代码位置和开发入口，不改变公开 API、数据语义或已有运行时信任边界。

## 目录与职责

```text
server/
  api/                HTTP、认证、会话、共同查询与命令入口
  worker/             Outbox 与后台任务
  mcp/                服务端 MCP 工具入口，经 HTTP 调用 Life API
  kernel/             业务规则、端口和 Executor
  database/           PostgreSQL 实现、迁移和持久化测试
  agent-adapter/      已有 Runtime 协议兼容
  importers/legacy/   旧项目盘点、映射与迁移工具
client/
  web/                React / Vite 浏览器客户端
  android/            Kotlin / Compose，独立 Gradle 工程
  cli/                HTTP 命令行客户端
shared/
  contracts/          公共合同源定义与生成器
scripts/              根开发与验证入口
docs/                 架构、使用与交付记录
```

`@shadow/*` 包名保留，目录名与包名承担不同职责。根目录执行一次 `pnpm setup`，各分区不新增独立 lockfile。
这里的分侧开发与检查不是独立仓库或独立生产依赖安装方案；运行产物、依赖裁剪和部署打包另按现有发布流程处理。

## 执行与依赖边界

所有公开结构由 `shared/contracts/src` 定义。合同不依赖服务端或客户端实现；`server/kernel` 依赖合同与端口，
不依赖 HTTP、数据库框架或 Agent Runtime。`server/database` 实现持久化端口，API 负责认证并构造可信上下文，
通过共同 QueryService / Executor 进入业务。

Web、Android 和 CLI 经 HTTP 使用该路径，不直接调用数据库或导入服务端业务实现。
`server/mcp` 是服务端工具入口，供外部 Runtime 经 MCP 访问 Life；它继续通过 HTTP 调用 Life API，
不直连数据库、不导入其他服务端业务实现，也不承担 Agent 编排。客户端本地队列、显示状态与重试不能产生独立的业务成功结果。
Worker 沿用服务端的事务、Outbox 和任务规则，不能建立另一条业务写入成功路径。

API 与 Web 分别启动。API 提供浏览器会话、业务接口和受保护资源，不托管或嵌入 Web 构建产物；Web 使用自己的
开发服务和构建。已有同源会话与开发代理继续适用，真实部署路由、端点和秘密仍仅保存在仓库外运维资料中。

`server/importers/legacy` 保持显式迁移工具身份，不成为运行期旧服务代理。`server/agent-adapter` 保留已有
Runtime 兼容，本次目录整理不扩展 Agent 编排或模型调用；Agent 后续工作由 Losna 接续。

## 开发与验证入口

以下命令均从仓库根目录执行：

| 任务 | 命令 | 范围 |
| --- | --- | --- |
| 安装 | `pnpm setup` | 根 workspace，使用已有 lockfile |
| API 开发 | `pnpm dev:server` | API 进程，需要本地数据库与运行配置 |
| Web 开发 | `pnpm dev:client` | Web 开发服务，与 API 分开启动 |
| 后台处理 | `pnpm dev:worker` | Worker 进程，需要本地数据库与运行配置 |
| MCP 工具入口 | `pnpm mcp` | 服务端 MCP 进程，需要 Life API 地址与既有鉴权配置 |
| 共享检查 | `pnpm check:shared` | shared JSON 生成物、合同类型与测试 |
| 服务端检查 | `pnpm check:server` | shared 生成物、边界、服务端及合同类型、服务端测试 |
| 客户端检查 | `pnpm check:client` | 完整合同生成物、边界、客户端及合同类型、客户端范围测试 |
| 服务端测试 | `pnpm test:server` | 包括 MCP 及其 API 组合测试；数据库测试需测试库 |
| 客户端测试 | `pnpm test:client` | 客户端范围，排除显式列出的跨层组合测试 |
| 服务端隔离回归 | `pnpm test:server:offline` | 临时本地 PostgreSQL 与合成数据 |
| 全量检查 | `pnpm check` | 全 workspace 的生成物、边界、类型与包测试 |
| 全量隔离回归 | `pnpm test:full:offline` | 全部发现的测试及跨端集成场景，使用临时 PostgreSQL |
| Web 构建 | `pnpm build:client` | 只构建 Web |

Android 使用独立 Gradle 工作流，见 [Android 开发与验证](../../client/android/README.md)。pnpm 范围检查中的
Android 边界或合同检查不能替代 Kotlin 编译、Android 单测或设备验收。签名 APK 与部署不随日常检查触发。

普通测试命令使用当前测试配置；缺少测试数据库时，数据库测试不能提供完整验证证据。需要验证迁移、并发、
数据查询或持久化流程时，使用适当的隔离数据库命令。这里的 offline 指本地临时库与合成场景，不调用生产服务
或真实模型，也不代表机器无需安装 PostgreSQL 工具。

## 合同生成与兼容

生成器提供两个范围：默认完整范围同时处理 `shared/contracts/generated` 和 Android 模型、资源；
`--scope shared` 只处理共享 JSON，不访问客户端生成文件。

```bash
# 服务端日常检查所需的共享产物
pnpm --filter @shadow/contracts generate:shared
pnpm --filter @shadow/contracts check-generated:shared

# 修改公开合同后的完整生成与校验
pnpm --filter @shadow/contracts generate
pnpm check:contracts
```

公开合同是各侧共同承诺。字段增删、缺省值、空值、错误结构与分页行为均须考虑已有调用方；规范化输入变化还可能
影响原命令的幂等指纹与重试恢复。只更新服务端 JSON 快照不足以证明 Android、Web、CLI 和 MCP 继续兼容。
合同变化应运行完整生成、全量检查和隔离集成回归，并按改动范围补充 Android Gradle 验证。

## 跨端测试归属

测试随所属包保留在 `test/` 目录。MCP 测试位于 `server/mcp/test`，与根脚本中的 MCP 组合 fixture 一起纳入
服务端及完整套件。位于 Web 客户端但同时使用服务端实现的组合测试，由根测试发现脚本明确标为 integration；
`test:client` 排除这些场景，完整套件继续包含它们。测试目录位置不代表可以在客户端或 MCP 生产代码中
跨边界导入服务端业务实现。

单侧实现改动可先运行对应检查，公共合同、HTTP 交互、命令恢复和跨端数据展示改动还需完整验证。
目录重组本身也应核对迁移路径、生成物、测试发现与导入工具，使“测试没有发现旧路径”不会被误认成通过。
初次分区交付见 [拆分交付记录](../execution/server-client-layout-2026-10-25.md)，后续 MCP 归属以本设计为准；
本设计只定义运行与验证方式。

更多入口：[服务端](../../server/README.md)、[客户端](../../client/README.md)、[共享合同](../../shared/README.md)、
[共同架构约束](../../ARCHITECTURE.md)。
