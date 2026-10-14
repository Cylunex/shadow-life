# Agent 任务上下文与回答来源

本次 P1、P2、P3 在现有能力目录、QueryService、Executor、个人 MCP 配置和 Run 事件之上增加
`agent.context`。不新建记忆服务、事实表或保存回执。HTTP、typed transport、CLI、MCP 和内置
Agent 调用同一个 kernel 查询；Web 使用该查询的 Host 工具结果。

## 输入与选择规则

至少给出一个场景、非空查询词、完整日期范围、对象引用或明确记忆键。
`from_on` 与 `to_on_exclusive` 必须成对，采用左闭右开日期范围。没有日期条件时不限制业务日，
也不补服务器当天。默认时区是 `Asia/Shanghai`；其他 IANA 时区可显式指定。

`query` 是数据库大小写不敏感的字面子串：匹配名字、备注和领域可检索正文；`%`、`_` 不作
SQL 通配符。Host 不解释“昨天”等自然语言，不做关键词领域路由；Agent 负责选择明确条件。
查询词、日期、引用和场景对记录取交集。对象引用包含类型、稳定 ID 和精确修订。

| 场景 | 第一版检索的事实类型 |
| --- | --- |
| daily | meal、purchase、health_measurement |
| spending | purchase、money_entry |
| health | health_measurement、health_workout |
| travel | trip |
| library | library_item |
| planning | meal、purchase、money_entry（已有实际记录，不能当作计划完成） |

未指定场景时，选择当前可读的七类事实。物品、项目、餐单、预订、设备睡眠投影等完整领域
集合仍由其原有专用工具读取，本入口不声称覆盖生活数据库的一切事实。
场景目录增加共同的上下文入口，并为 daily/planning 补充对应的既有详情读取工具。

kernel 先按真实 effects 与个人 profile 得出可读类型，再按场景缩小。MCP 的 LifeClient 在每次
真实 `tools/call` 中覆盖进程配置的 profile/scenario，调用参数不能扩大固定配置。
场景和 profile 都不授予 API 权限。购买金额仅在有 Money 读取权限时投影；Money 的人类标题
复用已有 `moneyTitle`，只有获准读取购买信息时才用关联购买名称。

## 一致性与来源

数据库端一次 SQL 语句读取获准事实、有界摘要、精确匹配数量、记忆和 `as_of`，全部处于同一个
MVCC 快照。`as_of` 使用数据库语句开始时间，不把另一时点的时钟或统计混入查询。
共享的 `agentRefsAvailable` 沿用现有语义：普通事实必须是当前有效修订，购买/金额的父记录须为
confirmed，Health 须有效，共享旅程须仍有访问关系；Library 允许仍有效条目的不可变历史修订。

显式指定的隐藏、跨账户、作废、已删除、旧修订或超出场景范围的引用均返回相同的 unavailable /
not_found，整次请求不返回部分来源，不暴露不可读对象标题或数量。短期 Context Pack 的线程、
过期和撤销检查继续使用原入口及 Run 启动检查，稳定业务引用本身不增加另一套 TTL。

时间戳事实按所选时区取得查询日；纯日期事实保留原业务日期与 `occurred_at=null`。
旅程用 starts_on；Library 用修订 document_date，缺失时用所选时区的创建日。记录同时保留原时区。
Library 的正文和引用严格按指定修订，条目标题是当前可读的展示元数据，不声称历史标题。

每条记录带领域、摘要标题、业务日、源类型、精确修订及已有详情工具参数。
金钱保留数据库十进制字符串和币种，detailed 的 Money facts 还保留 source_scale。
结果没有支出总额；需要总额时使用既有权威统计工具，按币种分别展示。
购买、支付和实际摄入是三个事实，发生/付款日独立；缺失营养、睡眠、支付或处理证据保持未知。
数据库读取失败返回显式错误，不转换成空列表或零值。只读 POST 不返回写入结果未知的成功暗示。

## 显式记忆

仍使用 user_memories 与当前记忆写入合同，最多返回 20 项；不保存模型推断。
偏好按以下确定性规则选择，并先检查证据权限和当前修订：

- `memory_keys` 精确匹配；或者 `query` 匹配键/值的字面子串；或者键为场景名及 `场景名.` 前缀。
- 指定场景时，只返回该场景键；聚合可以因其证据与当前已筛选记录相交而相关。
- 有 `daily.`、`spending.`、`health.`、`travel.`、`library.`、`planning.` 前缀的偏好，必须有
  对应领域的读取权限。无领域前缀的用户显式偏好仍属于现有 Agent 个人记忆，不能自动猜领域。
- 已归档或已更新值不重复返回。证据不足、过时或权限撤回的项不返回。
- 已有 meal-count-v1 聚合须保持注册算法、独立 meal 证据和 Host 算出的值；SQL 使用 kernel 的
  同一算法描述。该计数只针对被明确选择的证据，绝不是一段期间的全部餐次统计。

内置 Agent 原有 personalContext/history/contextPack 字段保持兼容；新增指引要求任务历史优先用
`agent.context` 查询。此批没有改写最近 50 条消息的恢复协议，也没有暗中删掉旧启动输入。

## 有界结果与继续读取

默认 concise、20 条、16000 字节；最多 50 条，预算 2048–65536 UTF-8 JSON 字节。
SQL 标题取前 150 个 Unicode 字符，detailed 摘要取前 1000 个 Unicode 字符，保证在合同的
300/2000 UTF-16 长度上限内；完整正文通过详情读取。长偏好在数据库投影时按预算排除。

kernel 对最终序列化 JSON（含 result_bytes 自身）计算字节，只移除完整记录/记忆项，不切 JSON、
引用、标题或金额字段。coverage.matched_records 是完整授权筛选集合的一次 SQL count；
returned_records 仅是本页实际返回数量。matched_memories 是有效相关集合的 count。
complete 只在首个页面且无遗漏时为 true；空成功只证明所选范围及类型无匹配，不证明未同步数据为零。

`continuation.next_offset` 要连同原过滤参数再提交，每页都重新校验当前状态。结果按业务日、类型、
ID、修订倒序。分页不承诺跨页固定快照；并发更正可改变下一页，应重读并按来源去重。
超过 10000 偏移明确报告 offset_limit。单条记录连元数据都无法进入预算时会跳过该条并报告
oversized_record，继续偏移可前进；要读取它，应换 concise 或增大预算后重查原页。
所有截断仍保留覆盖和继续读取信息。

## Web 与 Host 信任边界

Runtime 不能发送可信 `tool.result`；Host 完成查询后发带 `authority=host` 的事件。
Web 验证完整结果合同，仅从本次运行成功事件生成“依据记录 · 本次查询的来源”。没有逐句
答案引用时明确写“回答未提供逐句引用”，不标成每一条都被答案使用。来源读取不产生保存徽标。

点击来源先重新验证同一引用，随后打开既有领域详情；Library 的 source_revision 打开对应
不可变历史正文。记录变更/不可见时隐藏其原摘要并给出重新查询或打开最新记录的正常路径；
详情仍按服务器权限校验。结果截断有简短提示。用户无需输入 ID、预算或确认检索。

断线恢复读取两个既有 Run 事件入口时，Host 重新检查上下文全部领域权限、来源修订和记忆
状态/修订。一项失效即将该查询事件替换为不含来源的 unavailable 提示；不重写保存的历史事件。
既有消息文字仍是历史对话，不升级为当前事实证明。Web 换会话/可见能力集合时清空当前来源。
本次页面只展示当前浏览器运行和恢复得到的来源，不把历史消息文本转换为来源列表。

## 隔离评测与后续

`pnpm eval:agent:offline` 自动建销毁本机 UTF-8 PostgreSQL 集群，忽略外部 TEST_DATABASE_URL，
虚构账户/记录通过 Executor 建立；真实 QueryService、HTTP、MCP JSON-RPC 和 Host 事件参与评测。
18 类场景及指标口径见 [交付证据](../execution/agent-task-context-2026-10-13.md)。
`pnpm test:full:offline` 用同一隔离方式执行原 `pnpm test:full`。
可以用 SHADOW_TEST_PG_BIN 指定本机 PostgreSQL 工具目录。

`pnpm eval:agent:model --allow-model` 为单独的 opt-in 观察命令，需要显式模型名和 Runtime 地址；
它也只建合成数据库，报告两类样例的原答案、检索匹配、工具调用和 Runtime 请求数。
模型身份为调用者声明；当前 Adapter 没有 provider 调用遥测，provider_model_calls 明确为 null。
不将 Runtime 请求数冒充模型调用数，也不将检索匹配冒充答案正确率。本次未执行该命令。

Android 来源页面、真实模型验收、生产发布、Gateway 刷新和 Hermes/OpenClaw 升级分别安排。
Library 网页离线原件、时间化偏好和长会话压缩仅保留后续路线图。
