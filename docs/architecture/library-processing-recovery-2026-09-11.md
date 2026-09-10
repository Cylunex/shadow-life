# 归档处理恢复：近期方案比较与本轮实施设计

访问日：2026-09-11。代码基线：`b4f4802`；此前 F01–F10 与 Android V01/V02 已完成本地独立复验。本文选择一个有限的优化主题，不把历史功能目录的 218 组全部标为已迁移。

## 近期资料与适配判断

| 第一方资料 | 可核验版本或日期 | 机制与 Shadow 的适配 |
| --- | --- | --- |
| [DBOS TypeScript 发布记录](https://github.com/dbos-inc/dbos-transact-ts/releases)、[后台任务文章](https://www.dbos.dev/blog/durable-nextjs-background-tasks) | 文章 2025-02-07；访问时发布列表含 v4.27，v4.26 记录仅在 PENDING 状态写最终结果 | 持久任务状态及条件提交适合现有 PostgreSQL。Shadow 已有事务回执，不引入第二套 workflow 存储。[SDK 为 MIT](https://github.com/dbos-inc/dbos-transact-ts/blob/main/LICENSE)。 |
| [pg-boss 发布记录](https://github.com/timgit/pg-boss/releases) | 访问时列表含 12.26.3；12.26.2 说明通知连接丢失后的检测与重连 | 通知只用于及时唤醒，数据库轮询负责恢复。Shadow 已依赖 pg-boss，但 Library 自有任务表的代次隔离仍需自身保证；本轮不升级依赖。[MIT](https://github.com/timgit/pg-boss/blob/master/LICENSE)。 |
| [Restate 架构文档](https://docs.restate.dev/references/architecture) | 滚动文档，未标发布日期，以访问日为准 | 单调递增 attempt epoch 拒绝旧执行的迟到事件，可缩小为单行 PostgreSQL 条件写。完整日志/分区运行时增加运维面，本轮只借鉴机制。[服务端许可为 BSL 1.1](https://github.com/restatedev/restate/blob/main/LICENSE)，不能混同 MIT SDK。 |
| [Paperless-ngx v3.1.3](https://github.com/paperless-ngx/paperless-ngx/releases/tag/v3.1.3)、[文档 API](https://docs.paperless-ngx.com/api/)、[归档管理](https://docs.paperless-ngx.com/administration/) | 已打开具体版本页；API 与管理文档为滚动版本 | 原件与派生文件分开，版本对应各自的 MIME、摘要和提取内容。Shadow 已修复表示身份碰撞；本轮保持原件不变，将派生关系、片段、完成回执在同一事务提交。完整文档替换/版本 UI 另行设计，不复制整套系统。[仓库许可证为 GPL v3](https://github.com/paperless-ngx/paperless-ngx/blob/dev/LICENSE)。 |

GitHub 部分页面仅显示月日，本文不据此推断完整发布日期，也不以“最新”标签证明机制可靠。以上适配判断是基于当前代码的设计推论；没有复制上游代码或引入新依赖。

## 当前问题与用户收益

外部处理器只能认领 queued：进程退出后 running 无恢复入口。内置处理器会按更新时间重抢 running，但完成只检查 running，失败则不检查状态；旧执行可能干扰新执行。此外一次预认领整批，后排文件尚未开始即消耗超时时间。

改进后的用户行为不增加确认：重启后未完成任务可继续，成功内容不会被旧失败覆盖；真正处理错误仍保留现有显式重试入口，避免坏文件无限循环。

## 有序实施切片

1. **任务租约与代次合同。** 增量迁移 0032 添加 `lease_expires_at`；已有 running 设置为到期，保留 attempts 和原件。claim 携带队列读到的 `expected_attempt`，仅 queued 或已过期 running 可认领，成功后 attempts 加一。返回 attempt 与数据库时钟计算的 5 分钟到期时间。renew/fail/complete 必须携带该 attempt，持有行锁后校验租约；完成所接纳的事务持锁直到派生关系、片段、状态、Operation 和 Outbox 全部提交。租约不是权限凭证，仍要求 subject 归属与 `library.processor.write`。
2. **内外处理器统一写入。** 内置文本处理器只读候选，开始一个再认领一个，claim/complete/fail 走同一个 Executor。文本计算及内容寻址资产存储在事务外；失去租约的任务返回 superseded，不能写 failed。查询同时提供 queued/到期 running，外部处理器通过 renew 定期延长当前 attempt。保留 30 秒恢复轮询、1 MB 原件和 500 片段界限。

两片本轮均实施。验收包括双认领只有一方成功、崩溃后新实例接续、续租使任务暂不可重抢、旧 attempt 的完成/失败/续租被拒绝、终态不回退、重复 command 返回同一回执、跨 subject/缺权限拒绝、事务失败无半成品、内置并发执行只生成一组派生内容与回执。用新建本地临时 PostgreSQL，保留既有原件保真回归；不访问生产或外部 OCR。

## 升级、回退与明确边界

处理器协议要求新的 attempt 字段，旧 complete/fail 请求应拒绝，不能自动补当前代次。上线时应停止旧处理器、应用迁移及匹配代码、再启动新处理器；本任务不执行上线。发生问题先停止处理器调度，保留原件、任务和已提交派生数据，修正后向前恢复；不能在新旧处理器并行运行时回退到无代次保护的旧二进制。迁移是加列和约束，不删除历史文件。

本轮不保证外部 OCR 调用只执行一次；只能保证一个有效 attempt 提交业务结果。事务外已经存储但未引用的派生资产可能残留，后续 GC 需另有可恢复设计。真机 Health Connect、生产恢复演练、完整旧表/关系/资产迁移映射仍属于未完成验收或后续迁移范围，不以本轮优化代替。

## 处理器接入顺序

读取 `library.processing_queue` 后，将该行 `attempts` 作为 `library.claim_processing.expected_attempt`。认领回执里的 `actual_values.attempt` 必须原样用于后续 renew、fail、complete；不能在旧工作完成时重新读取当前代次并替换。处理器可每分钟调用一次 `library.renew_processing`，每次新的心跳使用新的 command_id，重试同一次请求则复用原 command_id 和正文。续租回执丢失时重放返回原到期时间，不会隐式再次延长。到期或遇到冲突就停止提交该次结果，重新读队列并按新认领重新处理。

内置文本 worker 的单个工作上限为 1 MB，超时通过下轮认领恢复；其结果 `superseded` 表示当前尝试已无权提交，不等同于业务失败。只有明确完成的回执可视为成功。外部处理器旧协议需要与服务端配套升级，普通阅读、排队和失败后显式重试接口不变。
