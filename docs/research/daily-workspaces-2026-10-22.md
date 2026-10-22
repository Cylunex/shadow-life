# 其他生活领域项目参考（2026-10-22）

本轮补充家庭库存与维护、周期支出、旅行与打包、稍后阅读和家务管理，接续 [Agent 参考清单](related-projects-2026-10-22.md)。以下依据项目自己的 README / 文档，检索日为 2026-10-22。这里只借鉴交互与领域划分，没有引入项目源码、服务或模型依赖。

本轮“新增”表示新纳入参考，不表示仓库刚发布。GitHub 公共元数据接口返回 rate limit 403，因此没有核实创建日期、最近提交时间和发布频率，也不据此排列活跃度或成熟度。README 声称的能力不等于本地运行验收。

| 方向 | 项目与一手来源 | 借鉴点 | 本轮 Life 对应改进 |
| --- | --- | --- | --- |
| 食品库存 | [garde-manger](https://github.com/floriaaan/garde-manger) | 食品批次、到期日期、共享购物清单与剩余食材 | 在已有批次上集中筛选 7 天内到期、过期、未知日期、用完；不靠购物状态推定库存 |
| 家庭维护 | [CMMS-Home](https://github.com/olafrose/CMMS-Home) | 资产二维码、保修即将结束、维护视图 | 保留已有二维码，增加退货 / 保修窗口与位置搜索；不另建维护调度系统 |
| 家居资料 | [homi](https://github.com/Yuss9/homi) | 房间、设备、保修、说明书关联 | 结合 Life 已有位置路径与文档引用展示期限；其 README 将部分保修 / 文档到期任务列为未完成，不将其描述成现成完整能力 |
| 物品与 Agent | [custodian](https://github.com/happyc0der/custodian) | 家庭库存、维护、召回信息与 MCP | 期限判断由共享 QueryService 输出，Agent 可读；不接入外部召回扫描或自动做安全结论 |
| 周期支出 | [renewlet](https://github.com/zhiyingzzhou/renewlet) | 订阅账期、下次日期、月度 / 年度预算 | 新增预算与周期事项页；未知金额保持未知，计划金额与实际支出分开 |
| 旅行与打包 | [trailune](https://github.com/laddtnov/trailune) | 本地旅程、每趟独立清单、离线访问 | 修复离线导出清单符号；保留 needed / packed / skipped 各自状态，不新增同步承诺 |
| 离线行程 | [Wandercraft](https://github.com/rodionlim/Wandercraft) | 当天行程与入住中的住宿分开显示 | 离线行程增加当晚住宿、结束 / 到达时间，补上旅程日期范围外的预订和交通 |
| 阅读体验 | [particle](https://github.com/crnst8/particle) | 本地全文查找、阅读位置、离线内容 | 沿用原件和阅读修订，补上连续翻页、查询绑定和快速切换资料时的响应竞态处理 |
| 家务周期 | [Donetick](https://github.com/donetick/donetick) | 周期任务、到期日与完成日的区别、日历 | 本月原定期次与调整后的日期同时展示，处理 / 跳过只改变期次，不生成消费事实 |
| 收藏与找回 | [Karakeep](https://github.com/karakeep-app/karakeep) | 全文搜索、移动端资料访问 | 以现有数据库游标恢复 50 条之外的资料访问；不增加嵌入模型或外部检索服务 |

## 本轮取舍

优先补齐现有领域的可用性和数据表达：期限聚合、预算入口、真实分页、完整静态导出。没有新增独立任务控制台、审批步骤、支付通道、外部消息或后台联网扫描。

暂缓的方向：自动扫码 / OCR 入库、召回信息订阅、家庭多成员分工、清单模板库、原生离线资料缓存。它们各自需要采集质量、权限或同步设计，本轮参考清单不能作为已实现证据。

实际改动和验证见 [交付记录](../execution/daily-workspaces-2026-10-22.md)。
