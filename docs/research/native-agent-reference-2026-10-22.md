# Android 与 Agent 新参考 · 2026-10-22

本轮新增 11 个此前两份研究未列出的项目。检索日期为 2026-10-22；下面记录 GitHub API 的 `created_at` / `pushed_at`（UTC 日期），不是应用发布日期。4 个仓库创建于 2026 年；其余是新加入本项目参考范围的已有项目。README 描述不等于本机运行验收，最近推送也不等于质量保证。

通过 GitHub 连接器读取仓库元数据及默认分支 README；只借鉴设计，没有引入第三方代码、运行时或新依赖。FastMCP 的规范说明另核对 [Tool Search](https://gofastmcp.com/servers/transforms/tool-search)；MCP 错误与工具合同参考 [官方 Tools 规范](https://modelcontextprotocol.io/specification/2025-06-18/server/tools)。

| 项目 | 创建 / 最近推送 | 许可证 | 已核对的设计 | Life 的取舍 |
| --- | --- | --- | --- | --- |
| [lukaszwatral/ShelfMate](https://github.com/lukaszwatral/ShelfMate) | 2025-10-09 / 2026-01-04 | MIT | 分层位置、条码/NFC、离线 SQLite 与期限提醒 | 借鉴位置检索与明确的加载范围；本轮补原生物品位置筛选，未接入 NFC/条码。 |
| [bogdro/ExpiryWatcher](https://github.com/bogdro/ExpiryWatcher) | 2026-07-25 / 2026-08-08 | GPL-3.0 | 按期限排序、每批次重新录入到期日、可配置提前提醒 | 借鉴批次与日期独立；本轮增加期限筛选和未知日期状态，不推定扫码即确认库存。 |
| [lorenzovngl/FoodExpirationDates](https://github.com/lorenzovngl/FoodExpirationDates) | 2023-03-02 / 2026-10-20 | MIT | Compose 食品期限列表、开封日期、条码与通知 | 借鉴临期信息优先与折叠录入；本轮把库存提前展示，复用服务端期限判断。 |
| [nkuppan/expensemanager](https://github.com/nkuppan/expensemanager) | 2022-09-14 / 2026-10-22 | Apache-2.0 | Compose 月度预算、分类筛选、日期分组与明确空状态 | 本轮补月份切换、预算原额口径与固定编辑身份；不接入汇率转换。 |
| [sanandmv7/itinerary_planner](https://github.com/sanandmv7/itinerary_planner) | 2025-10-26 / 2026-08-20 | GPL-3.0 | 原生行程、活动开始/结束时间、费用规划 | 本轮补离线开始/结束时间、跨夜住宿与日期范围外安排；计划不代表实际入住。 |
| [mcp-shark/lazy-tool](https://github.com/mcp-shark/lazy-tool) | 2026-03-29 / 2026-05-10 | MIT | 先搜索再调用、具名/检索两种入口、按需工具目录 | 借鉴基于具体任务的检索；本轮增强业务术语、读查询排序与可执行 Schema 恢复提示，保留现有 full/compact。 |
| [iSoron/uhabits](https://github.com/iSoron/uhabits) | 2014-11-08 / 2026-10-22 | GPL-3.0 | 灵活习惯日程、通知操作、桌面小组件、离线记录 | 后续方向：今日训练/待办小组件。先保证账号隔离、陈旧数据标记和幂等写入，再扩展桌面入口。 |
| [PrefectHQ/fastmcp](https://github.com/PrefectHQ/fastmcp) | 2024-11-30 / 2026-10-22 | Apache-2.0 | 按需工具搜索、BM25/正则策略、权限可见性与调用一致 | 借鉴确定性检索和权限先过滤；不迁移运行时或引入向量库。 |
| [readest/readest](https://github.com/readest/readest) | 2024-10-12 / 2026-10-22 | AGPL-3.0 | 跨端阅读进度、全文搜索、标注、TalkBack 等无障碍支持 | 后续方向：原生资料阅读位置恢复和大字体/读屏验收；不把整个电子书引擎并入生活事实库。 |
| [context-labs/whip](https://github.com/context-labs/whip) | 2026-08-20 / 2026-10-19 | Apache-2.0 | 有界读取长输出、可观察执行轨迹、跨窗口任务连续性 | 后续方向：Android 助手来源与回执的可点击呈现；沿用 Life 既有任务、来源和恢复机制，不复制多 Agent 控制面。 |
| [jinjin-programm/FoodExpiryApp](https://github.com/jinjin-programm/FoodExpiryApp) | 2026-02-09 / 2026-04-26 | 未识别 | 食品库存到购物/食谱的衔接，README 区分已发布 MVP 与进行中的模型工作 | 后续方向：临期库存带入餐单候选。保留明确份量与库存确认，未引用未验证的本地模型质量；无已识别许可证，不复制源码。 |

## 本轮落地

- Android 食品库存与物品售后展示服务端的日期、时区、期限状态和加载范围。库存录入默认收起，支持临期/已过期/未知/用完筛选；校正保留备注、原批次与修订，恢复编辑不变成新批次。
- Android 预算、周期事项可切换月份；预算编辑固定分类，区分支出原额与退款，展示截断范围；周期事项显示原定与调整日期、金额未知、待处理/全部状态。
- Android 离线行程补齐跨夜住宿、出发/到达、范围外安排、未定开始时间、确认号与清单状态；输出保持独立 HTML、纯文本转义。
- Agent 新增物品售后、预算、周期事项术语，中英文短语与多条匹配提高具体任务排名；查看类表达优先返回对应读取工具。具体能力名仍优先，权限/场景先过滤。
- 参数错误在 full/compact 两种 MCP 中返回 `recovery.schema_lookup`，可直接调用 `agent.discover` 读取具体合同，不自动重发写命令。

## 继续优化的顺序

1. 原生资料阅读位置与来源跳转：以稳定资料 ID 和修订定位，账号切换清除旧状态，历史原件不可用时明确说明。
2. Android 小组件与无障碍：先做只读今日训练/近期事项、加载时间、隐藏敏感内容；覆盖 TalkBack、大字号、横屏与窄屏。
3. 临期库存辅助餐单：先返回有来源的候选材料和购物缺口，用户保存餐单后仍不自动扣库存或记摄入。
4. Agent 大结果阅读与实测：沿用已有游标/来源和离线基线，再针对真实客户端测量工具选择、恢复成功率和上下文大小，不能用目录字节缩减替代真实模型效果。

验证与交付边界见 [本轮交付记录](../execution/native-agent-daily-2026-10-22.md)。
