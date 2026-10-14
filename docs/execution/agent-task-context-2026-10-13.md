# 任务上下文、Web 来源与离线评测交付（2026-10-13）

实施基线为干净的 Life `95272ac`。首批 P1、P2、P3 已实现，使用现有合同、QueryService、
Executor、个人 MCP 配置、来源修订规则和 Host 回执。没有数据库迁移或新事实表。
Foliant 和本地实际运维配置未修改。

## 实现与使用入口

- `agent.context` 同时用于 HTTP、CLI、MCP 和内置助手；明确场景、字面查询词、日期或来源引用
  决定查询，Host 不进行自然语言分类。权限过滤先于排序限量，数据库一次语句返回同快照的
  当前记录、相关记忆、覆盖数量和时点。金钱为十进制字符串，原币种独立。
- concise/detailed、条目限制和实际 UTF-8 JSON 字节预算均有公共合同；过大记录按整条处理，
  保留来源、覆盖和继续读取元数据。日期端点不能缺一，纯日期不制造午夜。
- Web 依据 Host 成功查询结果展示“本次查询的来源”，点击进入既有详情；Library 可展开
  指定历史修订。模型文本不能生成可信来源或已保存徽标。来源打开和 Run 事件恢复均重新验证。
- `pnpm eval:agent:offline` 和 `pnpm test:full:offline` 自动建立并销毁本机 PostgreSQL；
  未使用生产 DSN、生产账户、真实 Runtime 或付费模型。
- 真实模型观察有独立 opt-in 入口；未指定 `--allow-model`、模型名和 Runtime 地址时退出 78，
  不创建集群或调用模型。现有 `pnpm eval:agent` 三类烟雾入口保持兼容。

[中文接入说明](../agents/integration.md) 与 [设计和边界](../architecture/agent-task-context.md)
描述了各场景类型、偏好筛选、日期口径、预算、来源和后续范围。

## 基线与评测口径

先于新增查询实现，在合成午餐和无关 `travel.seat` 偏好上运行已有 `life.search + agent.memories`：
2 次读取，匹配 1/1，输出 639 字节；搜索没有精确修订来源，记忆返回无关旅行偏好。
[原始基线 JSON](fixtures/agent-context-baseline-2026-10-13.json) 保留该次测量。

新版相同历史午餐条件能返回精确 ref，daily 查询排除 travel.seat；随后扩大到 18 类不变量。
[原始离线 JSON](fixtures/agent-context-offline-2026-10-13.json) 包含每类耗时、调用和字节。
这两份报告的样例数量不同，因此不据它们推断性能提升或真实模型成功率。

| 指标 | 本次合成数据结果与定义 |
| --- | --- |
| 精确检索匹配 | 5/5，五个指定对象目标；其余场景验证边界/分页/未知语义，不能把 18 当作模型回答样本 |
| 来源有效率 | 94/94，所有成功上下文的来源出现次数；每批最多 20 refs，经独立当前读取核验（含重复出现） |
| 禁止数据泄漏 | 0，权限撤回、跨账户和固定场景输出有显式断言与计数 |
| 过时来源进入成功结果 | 0，独立来源核验与更正/作废后的拒绝断言 |
| 上下文读取请求 | 43；包括 MCP、Host 与直接权限测试的 QueryService 调用，不含夹具写入 |
| 核验读取 | 28，独立于上述请求的来源验证读取 |
| MCP framing 调用 | 41，经过真实 JSON-RPC server、LifeClient、HTTP 和 QueryService；包含超时写入 |
| 成功上下文 JSON 总字节 | 72289；不是 token 估算，单次最大预算另由合同验证 |
| 调用错误 | QueryService 7、MCP 8，均为用例要求的拒绝/失败/超时，二者有重叠；无意外失败 |
| 耗时 | 按类记录在 JSON；包含验证开销，不设置机器性能门槛 |

可控 Runtime 只证明工具、Host、来源和回执路径，报告中 model/real_model_success_rate 为 null。
真实模型观察只运行两类合成任务，报告声明模型名、工具调用、Host run 与 Runtime 请求数量。
当前 Runtime Adapter 不提供 provider 调用遥测，provider_model_calls 为 null；不猜真实模型调用数，
不把终态、工具命中或 Runtime 请求数等同于回答成功率。

## 18 类验收证据

所有场景通过；测试走真实 QueryService，主读取走 MCP JSON-RPC 与 HTTP。新会话和恢复用例
额外走真实 AgentRepository 和 Host 事件。

| 场景 | 实际断言 |
| --- | --- |
| 新会话历史午餐 | 指定日期命中精确 meal ref；新线程只有本次用户消息；Host 来源事件无写入回执 |
| 饭店购买与进餐 | 未支付购买无金额且不制造 meal；另一条购买/付款日期分开查询 |
| 账目更正 | 当前修订金额为字符串 12.340000；旧 ref 返回统一不可用 |
| 作废账目 | 作废事实不进入上下文或有效总额；保留其他真实支付的权威总额 |
| Library 历史修订 | revision=1 返回旧正文，未替换成 revision=2 正文 |
| 证据失效 | 旧 meal 修订和未注册算法不注入聚合；两个 Run 恢复入口去除失效来源 |
| 偏好更新/归档 | daily 只取其显式键，不注入 travel；更新仅当前值，归档不返回 |
| 权限撤回 | 不返回不可读 Library 标题/来源或 travel 偏好；显式隐藏引用不泄漏 |
| 不同账户 | 别人记录不返回，refs 和 operations receipt 不能跨账户读取 |
| MCP 固定场景 | travel 进程覆盖请求中的 spending/authorized；真实调用不能读取 meal |
| 多币种 | CNY 0.100000 与 USD 123.456789 分开，source_scale 保留，权威统计按币种分组 |
| 跨时区/纯日期 | 上海次日时间在洛杉矶查询前一日；纯日期 occurred_at 为 null；单端日期拒绝 |
| 未同步健康/睡眠 | 空匹配保留 unknown，结果没有 steps=0/sleep_minutes=0 |
| 查询失败 | 合成表暂不可读时工具显式失败，未转换成成功空结果 |
| 无依据问题 | 不存在的火星午餐没有记录或偏好，不生成业务事实 |
| 大记录集 | 65 条已保存记录，每页 7 条，有效总匹配/排序/继续偏移，无重复或遗漏 |
| 中文/多字节 | 2048 字节结果可解析、完整且有截断说明；宽预算 emoji 摘录符合合同；长偏好有遗漏计数 |
| 提交后超时/断线 | Host 恢复仅一条回执；同 command_id 重放不增加写入，新 key 不能绕过失效租约；MCP 超时指引保留原 key |

补充数据库回归以两条并发连接验证语句快照：校验 revision=1 时仍返回 revision=1 的标题/值，
不会在并发更正后混入 revision=2。现有 Context Pack 到期与权限测试继续通过。
kernel 还扫描接近预算边界的情况，确保没有内容可容纳时继续偏移仍前进。
Web 回归验证 Host 权威、来源去重、保存状态分离和 Library 历史详情路由。

## 验证与发布边界

本机 Node 24.19.0、pnpm 11.25.0、UTF-8 PostgreSQL 16。最终检查包括：

- `pnpm check`：合同生成、依赖边界、Android 模块边界、全部 TypeScript 与包测试通过。
- `pnpm --filter @shadow/web build`：通过；仍有既有大 bundle 提示，不视为发布证据。
- `pnpm --filter @shadow/mcp test`：19 通过、3 数据库门控跳过；隔离 full run 中全部 MCP 测试通过。
- `pnpm test:full:offline` 内的原 `pnpm test:full`：322 通过，0 失败、0 跳过。
- `pnpm eval:agent:offline`：18 类/19 个 Node 测试通过，合成不变量全部通过。
- `pnpm eval:agent:model` 未带 opt-in：按预期拒绝，未调用真实模型。
- 本机可丢弃数据库/可控 Runtime 的 Web 浏览器验证：发送历史查询、展开来源、点击原有餐次详情成功。
  临时页面、API 与集群已关闭；不使用生产服务。

首批交付 Web、MCP 与内置 Agent 的源码和隔离验证。生产发布、Gateway 刷新、真实模型验收、
Android 来源页面/设备验收与 APK 均未执行。Library 网页离线原件、时间化偏好、长会话压缩和
Hermes/OpenClaw 升级仍在后续路线图，不能由本次测试通过推断为已发布。
