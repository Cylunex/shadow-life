# Money、Travel、Library 记录工作台交付（2026-09-24）

## Money：月度账单核对

- `money.import_month` 按候选交易月份读取导入批次，返回待确认、重复、未分类、未关联退款计数。候选保留原始行和规则建议；账目仍只由 `money.resolve_import_candidate` 的既有 Executor 命令确认或忽略。
- Web 提供月份、批次、状态筛选与原始行核对；Android 提供原生月度核对入口、候选详情和确认/忽略操作，写入走加密队列。
- 设计参照 [Actual Budget 的导入说明](https://actualbudget.org/docs/transactions/importing/) 与 [对账说明](https://actualbudget.org/docs/accounts/reconciliation/)；未引入自动过账。

## Travel：准备清单和离线行程单

- `travel.set_checklist` 保存有稳定项目 ID、修订号及历史快照的旅程清单；读写遵守旅程成员权限。清单表示准备状态，不代替实际到访。
- Web 和 Android 都能编辑清单，并从有权限的旅程详情生成独立 HTML 行程单。HTML 包含旅程日期、时区、计划停留、预订、交通、清单和单独列出的实际到访；文本经过 HTML 转义。下载后无需再请求服务端即可打开。
- 时间按旅程时区展示；无开始时间的预订和交通独立列出，不猜测所属日期。时区边界参考 [Dawarich 的旅行时区讨论](https://github.com/Freika/dawarich/discussions/3114)。

## Library：视觉理解候选

- 固定原件仍保存在资产版本中。图片和最多 8 页 PDF 通过配置的视觉理解端点生成结构化候选：标题、资料日期、分类、摘要、正文、页码与引文位置。PDF 使用 `pdfinfo` / `pdftoppm` 转成页面图像；没有本地 OCR 依赖。
- 视觉候选、派生文本和检索片段随处理任务保存，但不会自动成为已确认的资料事实。Web 与 Android 可核对并编辑候选，再通过 `library.revise` 创建带来源任务 ID 的修订。处理任务的认领、失败、重试和完成仍由 Executor 回执与租约约束。
- 服务端运行时设置 `SHADOW_LIBRARY_VISION_URL` 才会启用端点；可选 `SHADOW_LIBRARY_VISION_TOKEN` 和 `SHADOW_LIBRARY_VISION_MODEL`。URL 只接受 HTTPS 或本机 HTTP。请求 JSON 包含 `protocol: "shadow.library.vision.request"`、`model`、`instruction` 和带 base64 图片的 `pages`；响应必须包含 `protocol: "shadow.library.vision.response"`、`processor_version` 和符合契约的 `candidate`。API 与 worker 运行时需要相同的配置。密钥不写入仓库。
- 未配置端点、端点失败或模型输出不符合契约时，任务呈现失败并可重试。测试仅使用本机 stub 与注入式假处理器，没有调用真实模型或付费服务；真实模型质量与生产端点尚未验证。

## 验证

- `pnpm check`：契约生成校验、边界、TypeScript、现有测试通过。
- Android `:app:compileDebugKotlin --offline`、Web build 通过。
- 临时 PostgreSQL 中的新领域测试覆盖月度核对、清单权限与修订、视觉协议、候选确认、未配置失败和重试；完整 Life 旅程测试单独通过。数据库全量测试的其余 49 项通过，但一次运行中旧旅程测试、另一次串行运行中新清单测试遇到测试库连接被管理员终止，仍需排查测试夹具的清理时序。
