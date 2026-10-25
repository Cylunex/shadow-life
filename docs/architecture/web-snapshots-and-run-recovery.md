# 网页快照与助手运行恢复

本批为 Web 和共享后端增量，复用 Library、Executor 和 PostgreSQL Run 日志。外部个人 Agent 的检查点、
任务租约与内置助手 Run 仍是不同对象。

## 上传、提取与修订

资料库接收用户上传的 SingleFile 或普通 HTML，不抓取网址、不使用浏览器 Cookie，也不自动登录网站。
用户填写的原网址优先保留在 Library 修订中；HTML 中的 canonical、Open Graph 或 SingleFile URL 只作为
片段定位元数据，既不触发访问，也不作为资料身份或权限依据。采集日沿用上传流程的日期语义，
不会变成网页发布日期。缺少网页发布日期时 `document_date` 保持空值。

流程仍是原件上传 → `library.capture` → `library.queue_processing`。上传流程拥有自己的随机意图标识，
捕获和排队使用该标识派生的稳定命令 ID。即使成功回执已清理命令日志、流程阶段尚未写回浏览器，
恢复也会提交原命令。用户另存相同字节或同一网址时生成新意图、新资料，原件字节可以按账户去重。

`builtin-html-v1` 使用既有 `text_extract` 任务和领取、租约、attempt、完成、失败、重试命令。
同步解析放在可终止的 Node Worker 中；超时会终止 Worker，而不是只让调用方停止等待。

| 边界 | 首批限制 |
| --- | --- |
| HTML 输入 | 10 MiB；API 原件上传上限仍为 20 MiB |
| 编码 | 严格 UTF-8；非法字节或其他 meta 编码声明失败 |
| DOM | 构建最多 50,000 节点；解析后最多 256 层 |
| 正文 | 最多 100,000 UTF-16 字符，超过时保留截断说明 |
| 时间与内存 | 5 秒；Worker old generation 128 MiB、young generation 16 MiB |
| 输出 | 纯文本派生、最多 500 个既有片段；本处理器每片段最多 4,000 字符 |

评估 [Readability](https://github.com/mozilla/readability) 后，首批选择小型
[parse5](https://parse5.js.org/) HTML 树解析器，避免引入浏览器 DOM 与资源加载机制。优先提取第一个可见
`article`，其次 `main`，再退回 `body` 并标注不完整风险。脚本、样式、iframe、表单、媒体、导航和明确
隐藏的节点不进入正文；不解码内嵌媒体，不解释 CSS，也不执行脚本或事件属性。这里是保守的结构提取，
不是完整的浏览器排版或通用文章识别器；多文章页面、仅由 CSS 定位的内容和特殊站点可能需要人工更正。
登录、订阅、验证提示只产生观察性说明，不承诺识别所有付费墙或验证码。

完成命令在同一 Executor 事务中登记派生、处理版本和片段，并在初始修订没有正文且尚未更正时，
将提取正文保存为普通修订 2，包含处理任务引用与原件哈希证明。上传标题和用户原网址保留。
若用户已更正，处理器保留用户修订，片段绑定固定原件对应的修订 1，不冒充当前正文。
默认资料列表与全文检索只匹配有效条目的当前修订及其片段；历史片段仍能在详情中展开，明确标注修订。

Web 默认阅读纯文本，显示真实处理状态、限制说明、来源片段和重试入口。HTML 原件仅经认证附件路径
以 `application/octet-stream`、`Content-Disposition: attachment`、`nosniff` 和隔离 CSP 返回，
不提供同源 HTML iframe。保存的阅读网址只接受 HTTP/HTTPS，快照正文中的链接不会变成可执行组件。
Agent 沿用 `agent.context` 和 `library.get_item`，得到普通修订与固定原件的引用。正文中的指令属于资料数据，
不能改变工具集合、权限或任务目标；资料提取不会产生购买、摄入或日程事实。

搜索仍为有界、忽略大小写的字面子串匹配，支持中文完整词和英文词，没有分词、向量或语义召回。

## 事件、分页与恢复

公开 Host 事件和分页合同维护在 `shared/contracts/src/run-schemas.ts`；Agent Adapter 保持原导出入口。
Runtime 的 NDJSON 事件合同没有增加 Host 事件，Runtime 也不能用其他 run 的事件触发调用。

- `GET /api/threads/:threadId/runs`：按所有者返回最多 20 个最近 Run；读取会沿用现有过期租约恢复。
- `GET /api/runs/:runId?after=…&limit=…`：保留 `run`、`events`，新增 `next_after` 和 `has_more`。
- `GET /api/runs/:runId/events`：保留 `items`，新增相同分页字段。

每页限制 1–1,000，Web 显式请求 100。省略限制仍返回最多 1,000，覆盖当前 Host 的 200 个 Runtime 事件、
20 次工具调用及附加 Host 事件，兼容既有原生恢复读取。事件只读取到本次 Run 快照的 `last_sequence`，
不会将之后的事件混入先前终态边界。读取保持所有者鉴权和 `agent.run` 权限检查。

`assistant-stream.ts` 是可测试的状态投影。只有合法且属于该 Run 的事件能推进连续游标；重复序号只应用
一次。遇到缺口立即结束本地 SSE 订阅并转向权威日志补读，不取最大序号跳过缺口。SSE 支持 UTF-8 BOM、
分片、多行 data 和完整帧边界；不完整尾帧由日志恢复。订阅 15 秒没有数据也转入观察流程。

`assistant-recovery.ts` 只执行 GET。SSE 正常结束、reader 抛错、刷新和断网恢复走同一观察器，
不会再次发送用户消息、启动 Runtime 或重放写工具。进入恢复时从零重建视图，重新通过服务端来源校验；
如果观察期间运行结束，再进行一次终态重建，避免保留早期已失效的查询来源。
浏览器只持久保存账户隔离的线程 ID，不保存工具参数、结果或旧游标。失效线程 ID 会从服务端列表重新选择。

恢复请求 10 秒超时，失败后按 1–8 秒退避，后台页面降至 15 秒；上线事件提前唤醒等待。
权限失效或 Run 不可见会明确结束观察，不把读取失败标为业务失败。卸载、账户与权限范围切换取消旧请求，
迟到回调不能更新新视图。Run 已终结也必须先读完其日志高水位；SSE 的终态事件可能早于最后的回执补发。

`tool.started` 只由 Host 产生，保留调用标识、能力和读写类型，不复制完整参数。活动卡片来自实际查询结果、
澄清与 Run 状态；“已保存”只来自 Executor 回执。未知或中断的调用不显示成功。恢复继续执行既有来源
再验证；权限已收回的工具事件以不含结果的 `event.redacted` 占据原序号，保证游标连续。

点击停止先显示“正在停止”。请求失败显示“停止未确认”并继续观察；收到持久终态且读完事件后才结束。
停止与提交竞争时，已提交 Operation 仍由现有回执恢复逻辑补发；停止不回滚事务，也不补执行动作。
服务进程退出后的模型续跑仍取决于现有 Host 租约策略，本批仅保证显示实际终态和已提交结果。

## 离线验收入口

`pnpm test:web:offline` 创建并销毁本机测试 PostgreSQL、API、Worker 调度和 Vite，使用受控 Runtime 与
合成 HTML。它需要 Playwright Chromium；也可通过 `SHADOW_TEST_BROWSER_EXECUTABLE` 指定本机测试浏览器。
截图和 JSON 回执默认写入临时目录，可通过 `SHADOW_WEB_TEST_ARTIFACTS` 指定仓库外目录。
此脚本不会读取实际部署配置或连接生产，覆盖上传成功回执丢失后的继续、正文与检索、认证下载、失败重试、
刷新、断网恢复和停止竞争。其余命令与结果见[交付记录](../execution/web-snapshots-and-run-recovery-2026-10-15.md)。
