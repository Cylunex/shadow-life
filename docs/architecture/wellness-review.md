# 健康与饮食联合复盘

`life.wellness_review` 是只读派生查询；需要同时具有 `life.meal.read` 与
`health.measurement.read`。输入 `to` 为包含的结束日期，`days` 为 7/30/90，默认 7。
当前期及紧邻的等长前期由 Kernel 使用日历日期计算，最多读取 180 天，返回当前期最多 90 行。
没有新建事实表、异步投影、模型调用或外部连接器。

## 共同路径

合同在 `packages/contracts/src/wellness-schemas.ts`；QueryService 校验权限和输入，调用一个
Store 端口。Database 使用单个 SQL 语句取得所有聚合、来源和数据库时点，避免多次请求看到
不一致修订；Kernel 计算周期摘要。HTTP、CLI、MCP 和内置 Agent 共用同一个查询。
MCP 默认个人 profile 以及 daily/health 场景均包含该能力，compact 模式通过 `life.query` 调用。

营养按餐次聚合，健康按当前有效事实聚合，不依赖异步生成的 `health_daily_summaries`。
本地日期保持原记录语义；睡眠使用醒来日期。不会把旅行中不同记录时区重归为一个时区。

## 字段口径

| 数据 | 策略 |
| --- | --- |
| 六项营养 | 热量、蛋白质、脂肪、碳水、纤维、钠；只包含 effective 摄入条目，不读购买/购物清单 |
| 食用比例 | 每项原营养值乘 `consumed_fraction`，未填比例按 1；SQL NUMERIC 日合计舍入 6 位，Kernel BigInt 周期累计 |
| 未知 | 没有已知项则合计 null；有部分项则给已知合计和 known_items；明确零仍是已知 |
| 估算 | `estimate=true` 或 `provenance=estimated` 且该字段有值的条目数；未标记不证明测量准确 |
| 齐全日期均值 | 当天有有效条目、无空餐次、该字段所有条目非 null 才进入；每个字段单独分母；不证明全天没有漏记 |
| 体重 | 每天最后一次有效、非 autofilled、kg 测量/观测；未知时刻使用创建时间，ID 稳定破同值；不将 lb 与 kg 混算 |
| 睡眠 | 每个醒来日最长有效会话，同值按修订和 ID；不叠加多设备会话或小睡；返回选中 ID 和修订 |
| 训练 | 有效执行记录的次数与已知时长合计；时长缺失保持未知，并给有时长的次数；计划不进入 |
| 同日覆盖 | 热量字段齐全且有体重/睡眠的天数，仅描述共同数据覆盖，不是相关系数 |

`current` / `previous` 给各自实际覆盖与均值，不计算容易误读的百分比涨跌。
不存在数据的日期仍在 `days` 中，以 null 和零记录数表示；不会制造零摄入、零睡眠事实。
健康详情可用返回的 ID 查询 `health.get_record`；餐次详情通过日期范围的 `life.search`
分页读取后进入 `life.get_record`。复盘不把未返回的完整餐食正文塞进 Agent 上下文。

## Web 与 Agent

Web 在记录 → 健康、记录 → 食品两个已有工作区呈现同一面板。切换日期立即隐藏旧结果，
过期请求中止；错误显示重试，账号切换重新挂载。表格可横向滚动，整体页面适配窄屏。

Agent 先报告覆盖、再读来源及有效 intentions，按需要读取餐单/库存、实际训练进度以及其他
领域资料，最后才执行用户要求的计划或更正。具体顺序见
[Life operator 工作流](../../skills/life-operator/references/workflows.md#health-and-nutrition-review--grounded-planning)。
不由复盘直接生成诊断、热量缺口、TDEE、自动目标、通知或周期任务。

本轮同时修正 `life.today`：营养合计应用同一食用比例，零热量不能将缺失的宏量营养标为齐全。
历史原始值不变。既有 journey 中 268 kcal 燕麦 + 20 kcal 蔬菜的 0.5 份，现在正确合计 278 kcal。
