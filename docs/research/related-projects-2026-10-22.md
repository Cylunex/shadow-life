# 相关项目调研与本轮优化（2026-10-22）

本轮扩展至 12 个参考项目，覆盖餐单/库存、营养、健康、财务、旅行、个人工作台、资料检索和
Agent 工具接入；其中 9 个 GitHub 仓库创建于 2026 年。创建时间不是产品首发时间。
下表根据项目原仓库 README、公开文档和 GitHub API 元数据整理；“最近推送”是 API 的
`pushed_at`（UTC 日期），不等同于正式发布或经过验证的稳定性。没有安装运行这些项目，
不以星数或项目自述证明质量。本轮借鉴接口设计，未复制第三方实现或增加外部运行依赖。

## 新增参考清单

每个项目链接均为一手仓库，创建日期/推送日期/许可证可通过
`https://api.github.com/repos/<owner>/<repo>` 复核；核验时间为本页日期。

| 项目 | 创建 / 最近推送 | 许可证 | 已查到的相关能力 | 对 Life 的取舍 |
| --- | --- | --- | --- | --- |
| [YAMP](https://github.com/caseyWebb/yet-another-meal-planner) | 2026-06-08 / 2026-10-05 | AGPL-3.0 | 以食谱、近期餐食、偏好、库存和临期食材组织周餐单；确定性 Worker 管理数据 | 优先借鉴临期食材到餐单/购物缺口的衔接；保留 Life 计划、购买、库存、实际摄入的独立事实，不接入其购物车写入 |
| [nutrition-mcp](https://github.com/RootMePLS/nutrition-mcp) | 2026-08-04 / 2026-08-12 | MIT | 餐食事件版本、标签版本快照、重复餐食与补剂摄入、独立证据 | 借鉴“复用明确标签版本”的可追溯记录；Life 已有修订和原件，优先补工作流和评测，不新造营养事实存储 |
| [nutriLog](https://github.com/subtlesayak/nutriLog) | 2026-08-08 / 2026-08-08 | MIT | 餐食检索、目标进展、饮水、体重趋势、按日期汇总和 CSV 导入 | 借鉴反复出现的餐食变体检索与导入去重；本轮未验证其托管服务。元数据的推送时间早于创建数小时，不据此判断维护活跃度 |
| [wellness-nourish](https://github.com/davidmosiah/wellness-nourish) | 2026-05-05 / 2026-10-17 | MIT | 条码/标签/照片辅助、食物提供方、离线 fixtures、地域食物评测 | 借鉴中文餐食、标签缺项、份量估计的可重复测试集；第三方食物数据应保存来源，不能用其估值填平未知营养 |
| [quantified-self-mcp](https://github.com/Thecimal/quantified-self-mcp) | 2026-08-25 / 2026-10-22 | MIT | 本地个人健康查询、来源与证据、私密字段的读取投影 | 借鉴健康查询的来源/覆盖说明与本机诊断；Life 已有 owner/effects 过滤和数据来源，不另建 SQLite 镜像 |
| [HealthClaw](https://github.com/HC-Guo/HealthClaw) | 2026-03-22 / 2026-07-27 | MIT | 多设备健康材料、分层记忆、领域工作流与任务经验 | 借鉴区分长期明确事实、工作流和近期经验；Life 已有 intentions/tasks/learning，不自动把模型推断升级为偏好，不引入医疗推断或手机控制 |
| [Finlynq](https://github.com/finlynq/finlynq) | 2026-04-28 / 2026-10-19 | AGPL-3.0 | 第一方财务 MCP、导入与多客户端接入文档 | 借鉴同一份账目在 UI 与 Agent 的一致读回和连接说明；继续使用 Life 十进制金额、分币种统计和原命令回执 |
| [Travel-Agent](https://github.com/suzangyawali/Travel-Agent) | 2026-07-17 / 2026-07-17 | 未声明 | 天气/航空数据工具与行程生成，明确部分上游失败和票价边界 | 借鉴将外部候选与实际预订/到访区分。只参考公开设计，不复制代码；当前更适合作为原型参考 |
| [LifeOS](https://github.com/thato899/lifeos) | 2026-08-30 / 2026-08-30 | MIT | WebMCP 工作台、可检查的工具目录、UI 与工具共用 service | 验证 Life 的统一 Executor 方向；暂不新增依赖实验浏览器能力的入口或复制其普通写入审批机制 |
| [PMCP](https://github.com/Consiliency/pmcp) | 2025-12-27 / 2026-10-21 | MIT | 渐进发现，search/describe 与工具执行分离，减少初始工具目录 | 本轮采用“发现后调用”的小入口，但只封装 Life 当前能力，不引入通用网关、任意代码执行或自动安装服务器 |
| [MCPorter](https://github.com/openclaw/mcporter) | 2025-11-05 / 2026-10-21 | MIT | MCP 的 CLI/TypeScript 调用、发现、签名和配置诊断 | 借鉴明确的 schema 和机器可读结果。其仓库已从 steipete 跳转到 openclaw；Life 继续共用 typed transport，不增加另一条写入路径 |
| [QMD](https://github.com/tobi/qmd) | 2025-12-08 / 2026-10-15 | MIT | 本地 BM25/向量检索、重排、先搜索后取全文、元数据过滤 | 借鉴 Library 先片段后精确修订全文和分阶段检索评测；全文/向量索引须先做权限、旧修订、中文召回和资源成本验证，不能直接替换事实查询 |

已有的 [wger](https://github.com/wger-project/wger)、[Tandoor](https://github.com/TandoorRecipes/recipes)、
[Grocy](https://github.com/grocy/grocy)、[Homebox](https://github.com/sysadminsmedia/homebox) 和
[Super Productivity](https://github.com/super-productivity/super-productivity) 继续作为成熟业务对照，
见 [9 月日常领域调研](../execution/daily-domains-2026-09-24.md)。这些不计入本轮 12 个新增参考。

## 本轮实际实现

[MCP 官方客户端最佳实践](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/docs/2026-07-28/develop/clients/client-best-practices.mdx)
介绍由 Host 延迟装载工具定义，适用于较大的工具集合。Life 的内置模型适配器已经按发现加载工具，
但外部 MCP 的 `tools/list` 仍交付所有具名工具 Schema。因此为缺少此类 Host 功能的客户端增加
可选精简工具集；具备延迟加载功能的客户端可以继续完整模式。

| 改进 | 实现与边界 |
| --- | --- |
| MCP 初始目录缩小 | `SHADOW_MCP_TOOLSET=compact`；四个常驻入口，按需通过 `agent.discover` 取具体 Schema；默认 full 保持兼容 |
| 避免读取全量 Schema | 精简列举只读 `/api/capabilities` 元数据，不产生旧 API 的逐工具 schema 请求 |
| 保留可预测执行 | `life.query` / `life.command` 在本地检查读写模式与 profile/scenario，随后使用同一 LifeClient、公开合同和 Executor；单次一个调用，不执行任意代码 |
| 保留恢复与证据 | 原始结构化结果、修订、游标、图片上传和命令回执不被包装改写；`operations.find` 始终作为直接恢复入口（须有权限） |
| 训练 Agent 可用性 | 补回个人 profile 遗漏的 `health.workout_progression`；增加哑铃、徒手、组数、次数、训练进度等业务术语；区分菜单、实际完成组和时长进度规则 |

测量与使用方法见 [Agent 接入](../agents/integration.md)，验证见
[本轮交付记录](../execution/agent-compact-2026-10-22.md)。没有更换模型、增加 paid API 或运行时网关。

## 后续优化优先级

以下是调研后的建议，未作为本轮已实现功能，也不自动创建定时任务。

1. **临期食材 → 可做餐单 → 购物缺口**：在现有 meal planning / food stock 中展示可解释候选；库存单位不兼容或覆盖不全保持未知，推荐不扣库存。参考 YAMP。
2. **常吃食物与标签版本复用**：补中文品牌饮品、半份、混合餐、缺失宏量营养的离线样例；先查现有目录，再用明确份量记录。参考 nutrition-mcp、wellness-nourish。
3. **Library 中文检索评测**：在现有合成数据加入同义改写、关键词冲突、长网页和历史修订；先测字面检索，再比较 BM25，最后决定是否需要 embedding。参考 QMD。
4. **Agent 完整任务评测**：覆盖一句话记录、中文更正、重复提交、断线恢复、训练菜单与实际组数；分别统计工具发现、输入正确、回执核对，真实模型与离线检查单独报告。参考 LifeOS 与 wellness-nourish。
5. **外部旅行资料的时效性**：在候选材料标明来源、查询日期、可用性和是否实时价格，再关联既有旅程，不能由检索结果自动产生预订。参考 Travel-Agent。

这些方向优先沿已有业务合同增量完善。Life 已具备事实修订、共同执行器、来源、恢复和个人 Agent
底座；新增基础设施应由实际召回质量、使用流程或性能数据证明必要性。
