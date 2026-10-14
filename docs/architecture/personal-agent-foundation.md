# 个人 Agent 数据底座

Life 保存个人生活的权威记录、明确意图、持续任务和可核对的经验，并让内置助手、MCP、CLI、Web 与 Android 使用同一份数据。实现沿用 contracts → kernel → database 的依赖方向，所有写入继续经过 Executor、命令幂等和操作回执。

## 已落实的四步

| 步骤 | 实现 | 用户或 Agent 的入口 |
| --- | --- | --- |
| 个人意图与任务材料 | 有类型的偏好、限制、目标，适用场景和有效期；一致快照中的事实、计划、库存、设备状态、任务与经验 | `agent.set_intention`、`agent.intentions`、`agent.workspace`；Web 计划 → 目标与助手、Android 计划 → 目标与助手 |
| 来源与实体关系 | 复用现有图片、Library、订单、Health 接入；统一当前对象引用，字面查询、个人别名、Library 正文匹配与既有关系展开 | `agent.objects`，原有领域详情和认证资产下载 |
| 跨 Agent 持续任务 | 持久检查点、原命令回执恢复、短期领取租约；按消费者分别确认的变化游标 | `agent.save_task`、`agent.tasks`、`agent.set_subscription`、`agent.changes`、`agent.ack_changes` |
| 有依据的长期知识 | 区分观察与工作流经验，记录环境、版本、依据、结果和限制；导出及恢复新副本 | `agent.save_learning`、`agent.learning`、`agent.export`、`agent.restore` |

新接口是既有 `agent.context` 的补充。历史事实查询仍可使用它；需要计划、资源和当前意图的任务优先使用 `agent.workspace`。不复制领域数据，不根据名字相似自动合并对象，不增加模型服务或另一套采集流程。

## 语义、时间与来源

意图的 `assertion` 必须为 explicit，模型归纳不能存成用户明确偏好。类别包含饮食、时间上限、旅行、预算、目标和一般内容；时间和预算分别有分钟或十进制金额与币种。适用范围为 global 或六个既有场景；有效期采用 `[valid_from, valid_to_exclusive)`。更正需要当前 revision 和 reason，历史快照独立保留。目标可引用当前项目，项目与行动仍使用原领域命令。

`agent.workspace` 在只读 REPEATABLE READ 事务中构建，返回共同 `as_of`。实际记录按请求时区解释发生时间，只有日期的记录继续保留日期。计划、当前库存、持有物品和设备来源分别带语义，不声称都是该日期内发生的事件。餐单与库存保留自身日期；来源状态不能证明“没有睡眠”或数值为零。旧 explicit_preference 以单独区段兼容读取。

返回内容保留对象 kind/id/revision 和详情入口。Library 允许指定不可变历史修订，其他业务依据要求当前有效修订。来源原文最多返回 16000 字符，长文标记截断；原始资产仍从已有认证接口下载。源文件、OCR 和模型文字都是材料，不能产生业务成功或权限。

Web 的查询来源来自 Host 的成功工具事件。点击读取当前对象；断线重放先重新执行同一查询并核对内容，失效内容不会继续生成来源卡片。模型生成的正文不构成已保存回执。

## 权限与有界检索

所有入口要求 `agent.run`；引用记录还要求相应领域读取权限、拥有关系或已支持的成员关系。MCP 固定 profile/scenario 覆盖调用参数，写入范围和恢复条目也受同一场景约束。权限先于列表计数和分页过滤；关系两端必须同时可读。

查询默认每页 30 条，最大 100 条，offset 最大 10000；规划日期窗口为 1–31 天。对象图最多两跳，只展开已经存在的明确关系。查询词按字面匹配、个人别名和 Library 正文取得候选；未引入向量数据库或 embedding 服务。图边扫描最多 500 条，节点由 limit 限制，截断结果有明确标记。

结果按实际 UTF-8 JSON 字节计量，默认预算 64000，允许 4096–131072。列表缩减时 next_offset 只跨过实际返回项；单条本身超出预算会报错，调用方提高预算或缩小查询。规划材料可能按区段省略，`coverage.complete=false` 和 unknown 说明缺口，不能把列表长度当作全部业务记录。

## 持续任务和变化消费

任务保存 task_key、当前步骤、下一步、尚缺材料、业务对象修订和已经提交的操作回执。状态包括 open/running/waiting/completed/cancelled；完成任务必须清空下一步和缺失材料。任务完成状态不自动证明相关付款、发送或其他业务已执行，仍需真实领域回执。

两个客户端通过修订检查竞争同一检查点。`claim_seconds` 为 15–300 秒；领取方由可信 client_id 决定。有效租约更新必须带匹配 token；到期重新领取产生新 token，普通检查点更新不延长租约。waiting、completed 等释放租约。未知写入结果继续使用原 command_id 经 `operations.find` 恢复。

任务读取返回租约持有客户端、截止时刻和当前是否有效；仅持有客户端可取得 token，其他客户端看到 null。Web/Android 自动携带自己取得的 token，其他客户端的有效租约展示等待提示。写入在取得行锁后重新检查实际到期时刻，避免锁等待导致把已经到期的租约当成有效。

Migration 0047 在原业务表和新表上安装延迟到提交时的变化日志触发器。事务在提交阶段串行分配 sequence，避免较晚提交的数据落在已确认游标之前；事务中同一对象修订去重。此日志只含对象引用，消费时重新核对当前权限、场景与修订；可见但已更正或作废的业务对象返回 invalidated_refs，客户端重新查询。设备来源状态更新也推进来源修订。

consumer 在同一主体内唯一；订阅可以按场景或明确业务对象过滤。消费者分别保存确认进度，确认使用 expected_cursor CAS，不能倒退或超出已有日志。扫描最多 500 条后可返回空 items 和更大的 cursor，此时仍需确认游标并按 has_more 继续；内部 Outbox 的 delivered_at 不参与此进度。订阅与轮询不会发送通知或自动执行外部动作。

日志当前持续保留，不自动清理或回填部署前的变化；首次接入先查询当前数据，再消费新变化。提交阶段的全局排序锁经过并发正确性测试，尚未进行高并发负载评测；需要后续按实际数据量制定归档和保留期。

## 经验、导出和恢复

observation 的结果只能是 observed；workflow_experience 可记录 succeeded/failed，成功经验必须关联真实领域操作回执。每项都有 environment、workflow_revision、limitations 和可选失效日期；检索可按环境和版本过滤。依据不能递归引用其他 Agent 记忆，写入时检查真实业务对象和回执。依据更正或权限收回后，失效经验不会继续作为可用知识返回；任务保留可见的旧引用并标记 evidence_current=false，便于重新检查。

写入来源使用可信 actor_id/client_id、trace/run/tool 信息；请求正文及 MCP 自报客户端名称不能伪造权限。经验内容的推理质量仍需要真实任务评测，存在回执不代表任何自然语言结论都正确。

已有可信代理部署可在服务端配置 `SHADOW_PROXY_CLIENT_IDS`，MCP 用 `SHADOW_PROXY_CLIENT_ID` 声明该配置中的运行时标识。API 只有在内部代理密钥正确且标识获准时接受 `X-Shadow-Proxy-Client-Id`；普通 Bearer 仍使用已验证 token 的 client_id。这个标识用于同一代理信任域内的来源与租约区分，不增加领域权限，也不能隔离掌握同一内部密钥的管理员。浏览器反向代理必须清除外部传入的该标头，普通网页继续使用原代理标识。

`agent.export` 分页导出 intentions/tasks/learning/subscriptions/history/sources，并显示是否完整；历史扫描上限 10000，超过时 total_is_exact=false。原始图片、文件字节不在 JSON 中，必须另行下载保存。Web 可导出当前意图、任务或经验类别。恢复接受一次 1–50 项，校验后在一个事务中创建新副本；不覆盖已有内容、不复制活跃租约、不恢复身份或权限，跨主体引用需要在目标主体中重新取得有效依据。它是个人 Agent 数据迁移入口，不能替代全库备份或原件归档。

## 验证与发布边界

初次本地实现见 [交付记录](../execution/personal-agent-foundation-2026-10-14.md)。后续经用户授权的服务发布、真实 Hermes/OpenClaw 接入、独立会话读取和任务恢复已完成，见 [复查与发布验收](../execution/personal-agent-foundation-review-2026-10-14.md)。普通源码任务仍不自动触发生产迁移、服务部署、APK 构建或通知；模型会话通过不代表聊天平台投递或真机验收。

## 参考与取舍

调研中的项目用于指导增量设计，未引入其运行时或以论文指标代替 Life 验收。

| 官方参考 | 本批采用的思路 |
| --- | --- |
| [LifeOS](https://github.com/danielmiessler/LifeOS) | 个人目标、偏好与当前状态共同服务任务 |
| [Hindsight](https://github.com/vectorize-io/hindsight) / [论文](https://arxiv.org/abs/2512.12818) | 明确区分业务事实、观察和 Agent 经验，保留依据与适用条件 |
| [Cognee](https://github.com/topoteretes/cognee) | 规范实体和关系；Life 先展开原有 PostgreSQL 关系，不再建图数据库 |
| [LongMemory](https://github.com/CaviraOSS/LongMemory) | 跨客户端共同读取；权限和写入来源仍由 Life 服务端决定 |
| [Khoj](https://github.com/khoj-ai/khoj) | 个人资料与业务记录一起成为可用任务材料 |
| [长任务工程文章](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents) / [LongMemEval V2](https://github.com/xiaowu0162/LongMemEval-V2) | 通过持久检查点恢复，并单独评测动态状态、环境和工作流知识 |
