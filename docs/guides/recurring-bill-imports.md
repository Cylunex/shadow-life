# 定期账单导入与数据接口

## 入口与来源

账单仍通过 `money.stage_import` 和 `money.resolve_import_candidate` 进入同一个 Executor。写入返回操作回执，账目、来源和事件在同一事务提交。导入订单不生成餐次、营养、实际使用或库存消耗事实。

`money.stage_import` 的文本格式为 `csv`、`json` 或 `markdown`。平台可省略，由完整表头识别；也可明确指定 `generic`、`meituan`、`jd`、`taobao`、`alipay`、`wechat`。这些是文本导出适配，不是 XLS/XLSX、PDF 或图片读取能力。

新增可选 `source_account` 是稳定的来源账号标签，省略时服务端使用 `default`，不是登录凭据。后续月份继续使用同一个标签；同平台另一个账号使用不同标签。文件名不参与交易身份。原有未提供标签的命令保持原输入结构，避免升级后重试改变命令指纹。

每次最多 500 个原始数据行，内容最多 900,000 个字符。超限应按原始交易/完整订单分批，淘宝同一订单的商品续行不能拆开。CSV 要先解码为文本；接口不根据本机编码或文件扩展名猜测内容。

示例请求：

```http
POST /api/commands/money.stage_import
Content-Type: application/json
```

```json
{
  "protocol": "shadow.command",
  "capability": "money.stage_import",
  "command_id": "cmd_import_example_202610",
  "input": {
    "format": "json",
    "source_name": "example-orders.json",
    "platform": "taobao",
    "source_account": "default",
    "time_zone": "Asia/Shanghai",
    "content": "[{\"订单号\":\"EXAMPLE_ORDER_001\",\"订单提交时间\":\"2026-10-01 12:00:00\",\"订单状态\":\"交易成功\",\"商品名称\":\"示例商品\",\"实付金额\":\"12.30\"}]"
  }
}
```

请求仍须满足现有认证、写入权限和写入 epoch 合同；账号与权限来自服务端上下文。

## 解析与账目事实

- 淘宝按订单及续行分组，实付金额只记一次；商品数量、金额、型号和链接保留在来源明细，不把商品金额相加替代实付。
- 京东保留原支付与独立退款。金额中的退款注记不把原支出改成净额。
- 美团保留交易号和实付，退款须有自己的事件证据；商家订单号不是每次退款的唯一标识。
- 仅有“已退款”等订单状态不能制造退款。明确退款仍要求 `original_entry_id`，沿用原有金额与关联约束。
- 未完成、未结算或缺关键状态的订单保留为无效候选；普通字段更正不能把它们改成已付款。
- 无时区的日期/时间保留来源当地日；明确带 `Z` 或偏移的时间按 `time_zone` 归日。没有可靠时间的记录不补造午夜时间。
- 金额保持十进制字符串；JSON 数字使用原始 token 解析，超长交易号不经过浮点取整。CSV 错列、重复表头、不闭合引号等错误明确失败，不静默吞行。
- 精确商家规则可补分类和支付方式，不能改写金额、日期、币种或将退款改成支出。

`money.import_review` 返回 `raw`、`source_proposed` 和 `proposed`：分别为原始行/商品、规则应用前的解析事实、当前建议或已确认更正值。批次还返回 `platform`、`source_account` 和 `parser_version`。原始全文仍保存在批次中；公开历史列表不携带原文。

## 重导、重复与冲突

相同来源、账号、时区和文本重复上传会返回原批次。不同文件、重排或重叠账期则按主体、平台、账号与稳定外部 ID 检查，并区分退款与非退款事件。支出变成收入属于来源变化，不是另一笔交易。

待处理和已确认候选均参与去重；确认时加事务锁并重新检查，避免两份重叠文件并发入账。重复已确认账目返回冲突，可忽略重复候选；金额、日期、币种或收支方向变化不会自动覆盖旧账。若两份尚未确认来源互相冲突，应保留正确来源并忽略另一份，然后按现有接口处理。

忽略候选后，其重复引用不再计入待处理重复数量。已经确认或后来作废的账目仍保留来源身份，重导不自动恢复它们。无稳定外部 ID 的独立行不按“同日、同商家、同金额”硬合并。跨平台订单和支付流水也不自动归并为一笔账。

升级迁移 `0048` 用原始字段的完整表头签名恢复旧 Life 平台身份，不依据文件名猜平台，不重写账目金额。旧候选未保留不可变的原始事件类型，因此类型保持未知并保守匹配，不能把用户更正后的类型当成新身份。对于已迁入 Life 的旧 Ledger，美团、京东、淘宝在 `default` 来源下通过原件档案、原件关联与迁移对象映射检查历史重复。配置用的迁移 owner key 与旧库 owner ID 可以不同；最终目标仍须属于当前主体。每份文件批量读取历史映射，避免逐行扫描整个档案。

若旧资料缺原件链、没有稳定单号或平台不在上述桥接范围内，就不能保证自动识别历史重复；不会改用金额/日期相似度冒充确定关联。本轮验证使用合成档案，没有读取或重导生产账单。

## 查询与统计

| 能力 | HTTP | 主要参数与结果 |
| --- | --- | --- |
| `money.import_history` | `GET /api/money/imports` | 可选 `platform`、`source_account`、`status=review/completed`；`limit` 默认 30、最大 100，`cursor` 续页 |
| `money.import_review` | `GET /api/money/imports/:batchId` | 完整有界候选、原件、规则、重复关联、修订和处理数量 |
| `money.import_month` | `GET /api/money/import-month?period=2026-10` | 按交易发生月汇总未确认、重复、未分类和未关联退款数量 |

历史以批次创建时间及 ID 倒序分页，保留 PostgreSQL 时间精度。游标绑定主体和筛选条件，换条件应从第一页开始。创建时间上界阻止后来上传的批次插入正在浏览的结果；处理状态与候选数量按读取时的当前事实返回，并非跨多次请求冻结状态。列表带候选数量、重复数和发生日期范围。

月度统计始终聚合全部匹配批次。`batches` 最多展示 100 个，`total_batches` 和 `truncated` 明确覆盖范围；`totals` 不受展示上限影响。没有发生日期的候选按批次时区下的导入月份归入待处理统计。

所有接口继续执行主体隔离与权限检查。批次详情在一个只读数据库快照中读取，避免同一响应里的总数和候选状态互相矛盾。没有新增审批页面、定时任务或自动抓取平台账号。

## 其他数据修正

今日概览和健康饮食复盘只统计活动餐次；已删除餐次及其历史条目不再影响餐数、营养和更新时间。同日存在未填写食物的餐次时，首页不能把已有条目的宏量齐全当成整日完整；缺失值继续与明确的零值区分，部分食用比例继续参与计算。

参考依据与后续范围见 [研究记录](../research/data-import-references-2026-10-25.md)。Agent 与 Losna 编排、Web/Android 交互、生产导入和部署不在本次范围。

## 个人 Agent 接入

`personal` 与 `personal-money-void` MCP profile 均可发现和使用 `money.stage_import`、
`money.resolve_import_candidate`、`money.import_review`、`money.import_history` 和 `money.import_month`。
实际调用仍由服务端授权、主体、写入 epoch 和场景范围约束；没有开放导入规则管理或其他管理能力。

邮件读取与附件接收由 Losna 完成，解密、XLSX/编码转换和自动处理由 Life 完成。文本分片入口继续兼容，
所有账单沿用原 Executor、来源防重和回执。暂存只产生候选，不代表消费、收入或退款已经记入账本。


## 原始账单文件的程序处理

Losna 仅交付原件并检查结果。MCP `assets.upload_local_file` 从已配置的私有缓存读取最多 20 MiB 的普通文件，
通过既有 `/api/assets` 保存原字节，核对摘要、长度和不可变版本。随后以稳定命令调用 `money.import_file`：

```json
{
  "command_id": "cmd_statement_example_001",
  "input": {
    "asset_version_id": "assetv_REPLACE_ORIGINAL",
    "source_name": "example.csv",
    "time_zone": "Asia/Shanghai",
    "platform": "alipay",
    "source_account": "default"
  }
}
```

ZIP 可额外提供用户给出的 `password`；多个账单成员时用 `member` 指定原件内的完整成员名。密码经 stdin 进入解码器，
不写命令行、数据库输入或业务回执。Life 只保存命令指纹、原件及处理事实。

Life 程序解码 UTF-8/GB18030 CSV、JSON、单个非空工作表的 XLSX，以及包含这些文件的普通/AES ZIP，
保留十进制和长交易号。拒绝公式、XML 实体、路径穿越、超限展开或不明确的成员选择。不猜 Excel 数字日期，
PDF、图片和自由文本账单属于显式未支持格式。原件及展开总量最多 20 MiB，最多 50,000 行；
完整订单分片进入原文本解析路径，每片通常 100 行，单个订单最多 500 行。

正常且唯一的交易自动通过原候选处理路径入账；已确认来源、明确的跨平台订单关联和精确旧支付跳过重复，
关闭订单及不计收支明细不制造消费。相似旧账、来源冲突、字段不完整、缺少唯一退款原账或退款余额不足时保留异常。
处理不调用模型，也没有逐条审批页。完整历史自动核对有 100,000 条候选/有效账目的覆盖上限，超过时明确失败。

同一个文件及来源账号、平台、时区、ZIP 成员的重复交付复用原处理对象，文件名及密码不决定业务身份。
整个文件在同一 Executor 事务提交；正常明细通过已有 `stage_import` / `resolve_import_candidate` 领域实现，
原件关联、候选、收支、汇总对象、操作回执和 Outbox 一起提交。确定的数据异常使用事务保存点保留为待补充；
系统错误整体回滚，调用者先恢复原命令。不会出现逐条网络调用完成一半后丢掉进度的另一条成功路径。

调用 `money.import_file_status`（`GET /api/money/import-files/:fileId`）检查当前结果。响应包含原件摘要、
`completed` / `needs_input`、总数、入账、跳过、待补充数量、异常原因计数与各批次；后续人工更正后读取当前候选状态。
原始明细仍由 `money.import_review` 读取，状态不会把暂存或异常冒充已入账。原件和处理对象均按主体隔离。

服务端仅需要 Python 3 与 `server/database/python/requirements.txt` 的 AES ZIP 依赖。
`SHADOW_STATEMENT_CONFIG_FILE` 只指定仓库外 JSON 配置路径，结构见 `server/database/python/config.example.json`。
MCP 可用 `SHADOW_MCP_CONFIG_FILE` 指定缓存目录和超时配置，结构见 `server/mcp/config.example.json`；旧环境配置继续兼容。
实际配置、秘密和附件都不提交仓库。解密和账单处理只在服务端运行，MCP 仍只是 HTTP 适配，不导入数据库或业务实现。
