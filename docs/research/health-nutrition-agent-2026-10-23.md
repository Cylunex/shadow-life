# 健康、饮食与 Agent 数据整合参考（2026-10-23）

本轮核对 15 个一手仓库的 README 与 GitHub 仓库元数据，其中 10 个创建于 2026 年。
“新”分别指本次补充参考和仓库创建年份，不把检索日期当作发布日期。日期为 GitHub UTC 日期；
最近推送可能发生在非默认分支，不代表稳定版本发布。没有运行这些第三方项目，功能描述来自
其文档，不等同于实际验收。未复制第三方实现、安装连接器或上传个人数据。

## 来源与维护情况

元数据来自各仓库的 `https://api.github.com/repos/<owner>/<repo>`；功能核对使用默认分支 README。

| 仓库 | 创建 / 最近推送 | GitHub 许可标识 |
| --- | --- | --- |
| [TraceApps/nutritrace](https://github.com/TraceApps/nutritrace) | 2026-04-09 / 2026-10-23 | AGPL-3.0 |
| [CodeWithCJ/SparkyFitness](https://github.com/CodeWithCJ/SparkyFitness) | 2025-06-21 / 2026-10-23 | NOASSERTION |
| [akutishevsky/nutrition-mcp](https://github.com/akutishevsky/nutrition-mcp) | 2026-03-08 / 2026-10-10 | MIT |
| [andreyvgavrilov/food_database](https://github.com/andreyvgavrilov/food_database) | 2026-06-06 / 2026-06-07 | 未声明 |
| [nbaradar/garmin-mcp](https://github.com/nbaradar/garmin-mcp) | 2026-08-03 / 2026-08-03 | 未声明 |
| [jonathan249/health-mcp](https://github.com/jonathan249/health-mcp) | 2026-06-12 / 2026-06-12 | MIT |
| [JuneYaooo/mediwise-health-suite](https://github.com/JuneYaooo/mediwise-health-suite) | 2026-03-08 / 2026-09-13 | MIT |
| [coroslab/COROS-MCP](https://github.com/coroslab/COROS-MCP) | 2026-06-18 / 2026-10-19 | 未声明 |
| [sattva2020/myhealth-mcp](https://github.com/sattva2020/myhealth-mcp) | 2026-05-12 / 2026-05-29 | Apache-2.0 |
| [the-momentum/open-wearables](https://github.com/the-momentum/open-wearables) | 2025-10-30 / 2026-10-23 | MIT |
| [timo-reymann/mealie-mcp-server](https://github.com/timo-reymann/mealie-mcp-server) | 2026-06-20 / 2026-10-22 | MIT |
| [davidmosiah/delx-wellness](https://github.com/davidmosiah/delx-wellness) | 2026-05-03 / 2026-10-08 | MIT |
| [actualbudget/actual](https://github.com/actualbudget/actual) | 2022-04-29 / 2026-10-21 | MIT |
| [usememos/memos](https://github.com/usememos/memos) | 2021-12-08 / 2026-10-22 | MIT |
| [go-vikunja/vikunja](https://github.com/go-vikunja/vikunja) | 2018-11-28 / 2026-10-23 | AGPL-3.0 |

许可补充：SparkyFitness README 明确为 **source-available、非商业许可，商用需许可**；
GitHub 的 NOASSERTION 不代表没有限制。MyHealth 使用多许可结构，Apache-2.0 只是核心代码口径，
测试数据等另有许可。未声明许可的项目只参考公开设计。

## 健康和饮食：值得借鉴什么

| 项目 | 核对到的设计 | Life 的采用与边界 |
| --- | --- | --- |
| NutriTrace | 饮食、身体指标、设备同步、助手和 MCP 共用数据；近期 release 也记录 MCP 录入与界面保存重复的问题 | 本轮做统一复盘和浏览器/Agent 共同查询，沿用同一 Executor；不引入新同步存储 |
| SparkyFitness | 营养、活动、睡眠、心情和身体测量在同一产品内 | 借鉴联合阅读体验；不复制受非商业许可限制的代码，也不引入泛化健康评分 |
| akutishevsky/nutrition-mcp | 营养来源、常吃餐食、历史汇总、导入、糖/纤维/钠等扩展字段 | 先用 Life 已有纤维、钠字段，逐项覆盖和估算数量；外部食品查询作为后续独立适配 |
| food_database | USDA 食材检索和确定性配方营养计算，Agent 与 MCP 共用工具 | 本轮在确定性服务端按食用比例汇总；后续食品数据库需注明来源版本、单位与适用地区 |
| nbaradar/garmin-mcp | 一次日快照、精简默认结果、按指标保留错误、睡眠归醒来日 | 本轮一次查询返回有界周期摘要，保留未知和主睡眠来源；不依赖非官方 Garmin 登录接口 |
| jonathan249/health-mcp | 有界日期区间、逐日成功/错误、缓存重叠历史读取 | 本轮限制为 7/30/90 天；不使用可能过期的跨请求健康缓存 |
| MediWise | 未解析营养存 NULL、汇总排除不完整日期；记录、导入及就医材料流程 | 本轮按营养字段分别计算齐全日期均值，未知不写零；Life 不因资料不全增加审核流程 |
| COROS-MCP | 官方运动/健康工具和 Agent 使用文档，可共同查看睡眠与训练 | 借鉴工具配工作流；本轮区分实际训练和计划，不向外部账号写训练日程 |
| MyHealth MCP | FHIR、个人数据授权和来源审计的设计文档 | README 明确仍是 pre-implementation；仅列中长期交换格式参考，不称作可直接使用的服务 |
| Open Wearables | 统一设备数据、来源优先级、覆盖矩阵、同步状态和 MCP | Life 已有来源与有效事实；本轮从有效事实读取，避免依赖异步日投影的新鲜度 |
| mealie-mcp-server | 有界复合查询、餐单嵌入食谱、按需细节和修订保护 | 借鉴“先摘要，再查原记录”；未来把临期库存、营养与购物缺口串联，计划不变成已吃事实 |
| delx-wellness | 连接器注册表、Hermes/OpenClaw 日常 operator、合成数据演示 | 本轮给 Life operator 增加复盘工作流；其示例 readiness 规则不作为医学或个人健康结论 |

## 其他方向

- [Actual](https://github.com/actualbudget/actual)：本地优先预算与跨设备同步。后续优先优化现有预算、
  导入去重和账户对账；餐饮支出继续与实际摄入分开，避免“买了就算吃了”。
- [Memos](https://github.com/usememos/memos)：个人时间线、日常短记和标签。后续可将明确的饮食感受、
  身体感受与当天记录显式关联；模型总结不能自动变为用户自述。
- [Vikunja](https://github.com/go-vikunja/vikunja)：个人任务管理和公开 API。后续把明确的下一步存入
  Life 已有项目行动项，完成状态仍需执行事实；不再建立另一个任务控制面。

这些方向本轮完成了对照与排序，没有声称已实现三套产品的功能。

## 本轮落地

1. `life.wellness_review`：7/30/90 天当前期和等长前期，一个 SQL 语句的一致快照；
   6 项营养、逐字段覆盖/估算数量、每天最后一次有效 kg 体重、醒来日主睡眠、实际训练。
2. 不完整营养日不混入该字段的齐全日期均值；空白日未知，明确的零保留为零。
   “字段齐全”只描述已记录条目，不声称当天没有漏记。
3. 首页营养与新查询统一应用食用比例，修正零热量掩盖缺失宏量营养的问题。
4. Web 健康/食品入口展示周期对照、逐日证据、重试和真实覆盖。
5. 共同合同、HTTP、CLI、内置 Agent、完整/精简 MCP、个人 profile 和业务术语发现沿用同一服务。
   补充 operator 工作流：先复盘，再查来源、有效目标和库存，最后才执行用户要求的计划或更正。

## 后续优先级

- P1：让 Android 有同等复盘入口；本轮新增入口仅在 Web，Android 可继续使用既有饮食/健康页面。
- P1：营养缺项的精确来源补全：先读标签和食品目录，只更正有依据的字段，不批量猜值。
- P1：在已有 intentions、meal_planning、food_stock 上整合“下周吃什么”；包含临期食材、明确偏好、
  份量及购物缺口，保留用户可直接编辑的普通计划。
- P2：增加糖、饱和脂肪等字段前，先评估实际来源覆盖与旧数据迁移；不靠扩字段制造完整感。
- P2：更深入的饮食/睡眠/训练关联分析需先处理时区、采样覆盖、混杂因素和可重复评测；
  本轮仅提供同日覆盖，未实现相关系数、因果、TDEE 或自动热量目标。
