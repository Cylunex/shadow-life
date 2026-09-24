# Nexus 与 Platform 补查（2026-09-24）

对照旧 Nexus `2df5787`、旧 Platform `57424fc` 和 Life 当前实现，本轮补齐一个实际使用缺口：Life 已有 Thread、Message、Run、事件恢复和分页接口，但 Web 只记住一个会话，Android 只自动读取最近会话。现在两个客户端都可选择已有对话、开启新对话；Web 可继续分页读取更早消息，Android 沿用原有分页。切换时不复制会话，也不新建待审核流程。

| 来源能力 | Life 当前状态 | 本轮结论 |
| --- | --- | --- |
| Nexus 对话续接与浏览 | 服务端会话列表、消息分页和运行恢复已有；客户端缺少会话选择 | Web、Android 补齐已有对话切换和新对话入口；仍由服务端保存历史 |
| Nexus 工具与执行 | Life 有能力过滤的 MCP 发现、Host 校验、Executor 回执、运行停止与恢复 | 保留现有单一执行路径，不复制旧 Nexus 的通用调度或审核页 |
| Nexus 历史对话 | 旧库与 Life 没有可靠的真实账号映射 | 不猜测 owner 或自动导入；需要经核对的数据迁移清单 |
| Nexus 附件与模型 | 对象版本上下文可在 Web 创建并逐次检查权限；二进制附件交给助手、真实 Runtime 评测尚未完成 | 依赖媒体合同、实际 Runtime/模型与数据披露配置；不能只加按钮声称可用 |
| Platform 主体、能力与写栅栏 | Life 已验证 OIDC/JWT、收紧 effects、检查资源权限与写 epoch，Web 有服务端 PKCE 会话 | 当前单领域能力已覆盖，继续使用现有实现 |
| Platform 统一 Access/Session | 旧 Platform `nexus-unified-access-design.md` 明确标注为尚未实现的跨项目目标设计 | 中央服务、SDK、身份迁移和按能力切换需要在 Platform 实现并部署，Life 不能单方面内嵌第二套身份权威 |

生产 issuer/client、真实账号会话、旧库 owner 对照和旧项目退役都属于配置或数据迁移验收。此轮只改 Life 客户端代码与状态记录；不部署服务，不构建 APK，也不迁移真实身份或对话数据。
