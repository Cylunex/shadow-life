# 2026-10-14 数据底座复查与发布验收

复查基线为 `f270c5e`。本轮补齐以下问题：

- 餐次、购买原件关系加入共同对象展开，日常、消费、旅行和规划场景可在原领域及资产权限范围内读取来源。
- 任务读取返回租约状态，持有客户端可在新会话取得 token；其他客户端不能读取该 token。Web/Android 展示有效租约并自动携带自己的 token。
- 租约在取得数据库行锁后重新检查实际到期，覆盖等待期间过期的恢复路径。
- 可信代理支持服务端白名单内的运行时标识，便于区别真实 MCP 客户端的写入来源和租约。Bearer 身份仍从签名 token 决定，未知代理标识拒绝；网页代理清除外部同名标头。

本地验收：`pnpm check` 通过；完整隔离 PostgreSQL 回归 334/334 无跳过，新增底座验收 11/11；Web 构建通过；Android Kotlin 编译和 50 个单元测试通过。浏览器合成请求还验证了自身租约 token 自动携带、其他客户端租约等待和 390px 无横向溢出。

## 已完成发布

- 通过已连接的 GitHub 账号发布三次本地提交，逐一核对 blob 与整树 SHA；部署源 `eb2fdb8bf6a9aa65ef89b56853bb36df131b7487` 的 tree 为 `7b3c67d4ed889046fa717662bfd585f28a35a327`，与本地已验收内容相同。原本地提交保留在备份 ref。
- 标准发布流程完成数据库与配置备份、Web 生产构建、合同与边界检查、迁移、版本切换和健康检查。API/Worker 正常；代理运行时配置和两个 Agent 的技能、配置另有修改前备份。真实位置与回滚资料只保存在仓库外运维文档。
- 公网 healthz/readyz 为 200；匿名页面/API 和无效 Bearer 为 401；Basic 认证页面/API 正常。伪造运行时来源标头被浏览器代理清除；页面入口 JS 与发布文件逐字节哈希一致。线上授权目录为 148 项，完整规划材料读取成功。
- 两个常驻 Gateway 刷新后，Hermes 的实际 schema 缓存为 114 个 Life 工具，OpenClaw 的原生 MCP 探测为 113 个、diagnostics 为空；既有 profile 和其他服务配置保留。

## 真实模型与恢复验收

| 路径 | 证据 |
| --- | --- |
| Hermes 首个独立 CLI 会话，原配置 `ark-code-latest` | 通过真实 Life MCP 保存明确标记的临时验收意图和 waiting 任务，取得 committed 回执并读回 |
| Hermes 第二个独立 CLI 会话 | 提示只给业务 key，没有给分钟数；从 Life 读出 23 分钟约束，并用当前修订领取检查点，保存 revision 2 |
| OpenClaw 常驻 Gateway 的新会话，原配置 `volcengine-ark/deepseek-v4-flash` | 初始 messageCount=0；通过实际 MCP 读取同一约束及检查点，确认旧租约到期后领取 revision 3，完成为 revision 4，并归档验收意图 |
| 实际两套启动配置的 MCP 协议 | 校验 `client_hermes` / `client_openclaw` 的可信来源、有效租约竞争拒绝、其他客户端 token 隐藏、原 command_id 回执恢复和幂等重放、释放后跨运行时接手 |
| 最终权威读取 | 当前任务 completed、无租约；历史为 waiting/Hermes → running/Hermes → running/OpenClaw → completed/OpenClaw；六个真实模型写入回执均 committed；验收意图 archived，活动列表中无本批验收记录 |

原始会话、回执与运行配置保存在受限运维证据目录，未放入仓库。验收脚本初次误将回执查询当作幂等重放，修正断言后重新验证；留下的合成任务已取消，其他合成任务已完成，意图已归档。没有发送外部消息、改写餐次/购买/支付事实或运行定时任务。

这是三次真实模型会话和相应协议检查的发布验收，不是通用模型成功率评测。Hermes 模型路径使用两个真实 CLI 会话并核对常驻缓存，OpenClaw 模型路径经常驻 Gateway；未声称验收聊天平台投递、Android APK、设备安装或真机。
