# Agent 精简入口与训练发现交付（2026-10-22）

## 问题与结果

Life 已有按业务术语发现能力的 `agent.discover`，但外部 MCP 在启动列举时仍发送全部具名工具
定义。为没有自行延迟加载工具的客户端新增 `SHADOW_MCP_TOOLSET=compact`：先发现所需能力和
输入 Schema，再经独立只读/写入入口调用。原 `full` 为默认值，现有客户端不用修改调用方式。

个人 profile 另有一处遗漏：`health.workout_progression` 虽已在 registry、HTTP 和 health 场景中，
却未进入个人白名单。已补齐，并增加“哑铃、徒手、组数、次数、训练进度”等术语，区分计划、
实际完成训练和基于既有执行的进度查询。没有改变训练进度计算，也没有新增自动加量功能。

调研覆盖 12 个新增参考项目与 MCP 官方文档，9 个仓库创建于 2026 年；原始链接、维护时间、
许可和取舍见 [参考项目清单](../research/related-projects-2026-10-22.md)。未复制第三方实现。

## 实现范围

- MCP 精简列举只请求 `/api/capabilities` 元数据，按 API 可见能力和固定 profile/scenario 生成入口。
- `agent.discover` 与 `operations.find` 直接保留；`life.query` 接受 capability/input，
  `life.command` 接受 capability/command_id/input；配置并获准时保留本地图片上传。
- 查询拒绝写能力，写入口拒绝只读能力；禁止未知/嵌套分发能力和越过固定配置的调用。
- 所有业务调用仍复用 `LifeClient.call`、合同验证、typed transport 与原 Executor。
  不缓存授权、不追加权限、不修改结构化结果、原始回执或不透明分页游标。
  分发外壳合同同样集中在 `shared/contracts/src/mcp-schemas.ts`，由生成检查校验快照；
  两个分发名称不是新的领域能力，不加入业务 registry。
- 未知写入结果的错误标记具体领域能力，保留原 command_id 和直接可调用的回执恢复指令；
  不自动重试。普通写入继续直接完成，没有新增用户审核页面。
- 文档、配置示例、life-operator 指引与生成能力目录同步更新。

## 目录大小测量

使用真实 API `createApp` + `QueryService` 和合成开发身份，经 LifeClient 分别列举 full 与
compact 工具。环境为个人完整可见权限、未配置媒体目录、未限定 scenario。统计
`Buffer.byteLength(JSON.stringify({tools}))`，包含工具描述、输入 Schema 和 annotations。

| 模式 | 工具数 | UTF-8 JSON 字节 |
| --- | ---: | ---: |
| full | 113 | 195,494 |
| compact | 4 | 3,785 |

初始目录减少 98.06%。初始化指引、消息、业务结果和后续发现的 Schema 不在此指标内；这是
接口大小测量，不是模型 token、整体延迟或成功率评测。发现会增加必要的查询往返。
`client/mcp/test/compact.test.ts` 用实际 API 检查精简目录小于完整目录的十分之一。

## 验证

本机 Node 25.9.0、pnpm 11.25.0、PostgreSQL 16；全部使用合成身份和一次性本机数据库。

| 检查 | 结果 |
| --- | --- |
| `pnpm check` | 合同快照、依赖边界、Android 模块边界、各包 TypeScript 和包测试通过；无数据库环境的集成测试由下项补全 |
| `SHADOW_TEST_PG_BIN=… pnpm test:full:offline` | 382/382 通过，0 失败、0 跳过；工具自动创建/销毁一次性数据库 |
| `SHADOW_TEST_PG_BIN=… pnpm eval:agent:offline` | 19/19 通过，涵盖 18 类合成场景；不调用真实模型，不代表模型回答成功率 |
| 新增 MCP 回归 | 元数据单请求、目录撤权刷新、读写模式拒绝、参数校验、profile/scenario 限制、训练发现、stdio 环境配置 |
| full/compact 共用数据库旅程 | 原图上传与关联、数据库已提交但响应丢失、原命令回执恢复、同命令只提交一次、历史查询和不透明游标均通过 |

本轮未修改 Web/Android UI，未部署服务、更新线上 Gateway、构建 APK、调用真实付费模型、
写入生产生活记录或发送外部消息。精简入口的实际 Host 使用效果需要在后续获准发布后独立验收。
若客户端已有延迟加载工具，继续 `full` 即可；若需回退精简入口，改回 `full` 并重连 MCP。

使用示例和恢复约定见 [Agent 接入](../agents/integration.md)。
