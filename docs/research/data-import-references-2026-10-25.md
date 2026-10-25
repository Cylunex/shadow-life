# 定期账单导入与生活数据参考（2026-10-25）

本轮范围是 Life 的数据与接口。Agent 编排、提示词与交互继续由 Losna 负责；不扩展 Web、Android 或运行时。以下是设计取舍，执行与测试结果以本轮交付记录为准。

## 已核对的参考

检索日期为 2026-10-25。仓库状态与许可证来自 GitHub 仓库 API，维护时间为 `pushed_at`，不代表正式发行时间。参考文档和实现用于核对设计，没有复制第三方源码。

| 项目与一手来源 | 本轮核对内容 | 适用点与限制 |
| --- | --- | --- |
| [食记](https://github.com/KazeLiu/food-journal-app)；[架构与数据](https://github.com/KazeLiu/food-journal-app/blob/main/docs/03-architecture-and-data.md) | 食品资料与实际进食分开；营养值允许缺失并记录来源；历史实际食用值保留当时基准快照；饮食与运动分别汇总 | 延续 Life 的事实边界。食品资料修改不应静默重算历史；没有单位换算关系不能猜重量。此仓库 API 未给出许可证，不能视作允许复制代码 |
| [Personal-Bill](https://github.com/zhu123279/Personal-Bill)；[账单服务](https://github.com/zhu123279/Personal-Bill/blob/main/backend/src/services/billService.js)；[支付宝解析](https://github.com/zhu123279/Personal-Bill/blob/main/backend/src/parsers/alipayParser.js)；[微信解析](https://github.com/zhu123279/Personal-Bill/blob/main/backend/src/parsers/wechatParser.js) | 中文字段映射、导出说明行之后的真实表头、交易号和商家订单号、预览查重、分类与多条件查询 | 借鉴导出文件结构和来源保留。其退款净额合并与时间金额相似去重不直接采用，理由见下文。MIT |
| [Actual Budget](https://github.com/actualbudget/actual)；[官方 API](https://actualbudget.org/docs/api/reference/)；[导入用途区分](https://actualbudget.org/docs/api/) | 交易导入和整库迁移分开；`imported_id` 避免重复；无 ID 时才考虑相似匹配；支持试运行和新增/更新/错误结果 | 定期导入必须以稳定外部身份为主，且把相似提示与确定重复区分。官方 API 是 Node 包，不把它描述成 HTTP REST 接口。MIT |
| [Firefly III Data Importer](https://github.com/firefly-iii/data-importer)；[v3 配置合同](https://github.com/firefly-iii/data-importer/blob/main/resources/schemas/v3.json) | 导入配置有版本、列角色、字段映射、日期范围、唯一列及重复检测策略 | Life 保存解析器版本、来源平台和账号范围；后续映射配置可版本化。无需引入其部署、银行授权或整套工作流。AGPL-3.0 |
| [Mealie](https://github.com/mealie-recipes/mealie)；[官方 API 说明](https://mealie.io/documentation/getting-started/api-usage/) | 菜谱、计划和购物清单通过 API 连接；查询具有筛选、排序、分页及数量信息 | 借鉴后台可独立使用、有界分页和明确过滤条件，补足导入历史查询。Life 延续自身严格合同，不开放任意查询表达式或无界返回。AGPL-3.0 |
| [Grocy](https://github.com/grocy/grocy/blob/master/README.md) | 家庭食材与物品管理，前端功能使用共同 REST API | 食品库存、购买与消耗应继续复用共同业务入口；导入订单不能直接产生已吃或已消耗事实。MIT |
| [OpenNutriTracker](https://github.com/simonoppowa/OpenNutriTracker/blob/main/README.md) | 饮食、宏量与微量营养记录；公式依据可追溯，数据保存在设备 | 后续加强字段来源、单位与可导出性；不照搬默认能量目标、热量余额或另一套健康模型。GPL-3.0 |

上述七个仓库在核对时均未归档。最近推送的 UTC 日期分别为：食记 2026-10-22、Personal-Bill 2026-09-18、Actual 2026-10-25、Firefly III importer 2026-10-22、Mealie 2026-10-25、Grocy 2026-09-16、OpenNutriTracker 2026-10-24。活跃程度不等同于数据正确性，关键规则仍需本项目回归验证。

## 本期选择

### 1. 继续增强现有账单入口

Life 已有 `money.stage_import`、`money.resolve_import_candidate`、`money.import_review` 与 `money.import_month`，因此扩展现有合同、解析器和事务，不建立第二条导入写入路径。美团、京东、淘宝作为明确来源解析，保留原始行、平台、来源账号范围和解析版本；通用 CSV、JSON、Markdown 仍使用原入口。

来源账号是用户对一份来源数据的稳定分组标识，不是登录凭据。相同平台的多个账号不能仅凭碰巧相同的订单号互相去重；切换月份或重新导出也不应改变原交易身份。

### 2. 定期重导的身份与并发

文件哈希只识别同一份输入，不能覆盖重排、字段增删或时间范围重叠的导出。记录级判断应优先使用来源范围内的外部交易/订单身份，跨批次检查待处理和已确认候选，并在真正写入时再次保证并发安全。

确定重复、疑似重复和同身份但内容不同须能区分。没有稳定外部 ID 时，金额、日期和商户相同不足以证明同一笔交易；同一天两次同额购买是合法情况。不能为了去重而覆盖用户手工修订，也不能由重新导入自动复活已作废记录。

### 3. 退款、付款与订单状态分别保留

Personal-Bill 的支付宝解析会把相同商家订单号下的支出与退款合成净额，净额小于等于零时不保留该订单。Life 保持自己的交易与退款关系：原支出、退款发生日期、退款金额及来源分别可追溯，统计时再计算净支出。仅有订单状态变化不能制造一笔新收入或完整退款。

外卖订单只证明购买来源，不能证明已进食、份量或营养。电商订单也不自动生成物品已使用或库存已消耗事实。支付平台流水与电商订单可能描述同一笔付款，跨来源的相似关系只能提供线索，不能未经可靠关联就合并或抵扣。

### 4. 历史与月度统计面向实际全量数据

新增 `money.import_history` 读取导入批次，支持有界分页与来源等筛选；批次详情继续使用 `money.import_review`。月度统计应在数据库中对全部符合条件的记录聚合，而非把展示页上的一小段批次或候选相加。页面大小不得改变月统计，金额仍保持精确十进制与币种语义。

所有读取均受账号隔离和权限控制；所有写入继续由 Executor 产生操作回执与事件。普通导入不新增独立审批页面；已有候选处理只用于表达缺失事实、冲突或退款关联。

饮食数据复查同时修正今日与健康饮食复盘的统计口径：已删除餐次不计入餐数、营养或覆盖；同日仍有未录入食物的有效餐次时，今日接口不再声称宏量营养完整。

## 后续数据方向

- **营养资料质量**：继续审查每个营养字段的未知与零值、份量换算、历史快照和来源；食品库、菜谱和实际餐次各自维护事实，不能由订单猜测。
- **导出格式覆盖**：本期的文本解析不是 XLS/XLSX、PDF 或图片识别能力。若未来支持这些格式，应增加独立受限解码层和合成样本，不能把扩展名当作平台真实性证明。
- **可配置映射**：参考 Firefly III，把新增来源的别名和规则写成有版本配置；只有真实字段变体需要时再引入，避免现在另做复杂规则平台。
- **对账与跨来源关系**：保留外部交易号和商家订单号各自语义；后续可以在有明确关系证据时连接平台订单与支付流水，不凭商户、日期和金额直接合并。
- **分类与资产**：Personal-Bill 的关键词分类和资产快照可作为后续研究；本期不借账单改进扩大到资产估值或自动生成财务结论。

Agent、Losna 接入、线上数据导入、部署、APK 与定时任务均不属于本轮研究落地范围。“后续定期导入”是当前接口要可靠支持的使用场景，不代表本轮创建了定时导入任务。
