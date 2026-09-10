# 独立审查 F01–F10 修复记录

后续独立复验发现 Android 重扫请求构造与类型轮转仍有 V01/V02 问题。初轮 13 项 Kotlin 策略断言不能证明 Worker 同步闭环；生产路径返修及直接执行证据见 [Android 返修记录](android-health-reverification-fixes-2026-09-11.md)。

审查基线：`5064b0c1412bfdcac9c47cfc94a43bf547b382c7`。本轮只修复已确认的十项问题，保留 TypeScript 单体、统一 Executor 和业务 kernel 边界。所有提交仅保留本地。

| 项目 | 处置 | 实现提交 |
|---|---|---|
| F01 | 创建与读取共享引用校验；可变事实要求当前有效版本，Library 允许仍可读的不可变历史版本；检查共享成员、effect、expiry 和绑定线程。明细纠正推进 Meal 版本。失效包拒绝，失效记忆过滤。 | `88155032f3340713599b0102bb3f65d1636cb474` |
| F02 | Host 注册 `meal-count-v1`，计算所选已验证餐次的数量；未知算法、重复证据和伪造结果被拒绝。显式偏好保持直接写入。 | `88155032f3340713599b0102bb3f65d1636cb474` |
| F03 | PostgreSQL 同一 `now()` 计算 created_at 与 expiry，保留精确一小时约束。 | `88155032f3340713599b0102bb3f65d1636cb474` |
| F04 | 关联 FX/分摊存在时拒绝通用金额或币种变更，允许备注修正并维护 source_scale；已结算分摊阻止作废，作废后不能继续结算；历史保留精确关系。 | `938b5a8cae4164fbdb074d99514cc0f769b82e2b` |
| F05 | 修改子项、计算 remaining 前串行锁定清单父行；提交时完成状态正确。 | `403aa2437f373ba7db167914a252f26a7bd3f7e4` |
| F06 | 原件身份保持兼容；MIME 变体及 source/processor/kind 定义的派生表示各有确定性 identity，哈希仍描述原始字节。 | `403aa2437f373ba7db167914a252f26a7bd3f7e4` |
| F07 | StepsRecord 使用独立区间类型，保留起止时间、provider 身份和版本；同源选最大不重叠区间集合，跨源/旧日总量取最大值。 | `5a5315d2e19a8161a97a84b9c3e22516ca110955` |
| F08 | 完整、有边界、带代次的重扫原子对账缺失记录；未知完整性、权限变化、分页失败/超限不删；窗口外保留；重放、重新出现及旧编码迁移均留有证据。 | `5a5315d2e19a8161a97a84b9c3e22516ca110955` |
| F09 | 持久 owner/lease、心跳、跨实例 stop、过期孤儿恢复；业务事务内锁住并验证 lease，回执与 run 同事务绑定，恢复不重放业务操作；消息与运行准入原子化。 | `3e1511ebc8b7f30b15f80e2106e1185d65cd4f66` |
| F10 | CLI final-delta 在 pg JSON 解码之前将金额、餐次数量与营养字段转为精确字符串，保留无关 JSON 数字类型；合成历史快照恢复验证通过。 | `938b5a8cae4164fbdb074d99514cc0f769b82e2b` |

最终验证提交另包含：完整旅程采用自己的独立临时数据库、旧夹具改用完整重扫协议和当前餐次版本、真实 API 跨实例心跳测试、历史快照 restore-drill、Kotlin 断言计数，以及重扫记录重新出现时回执返回实际 pending 状态。

## 验证证据

- 全量 Node 测试在独立临时 PostgreSQL 下运行：**136 通过，0 失败，0 跳过**。数据库实例为本任务新建；每个数据库用例继续新建独立数据库，结束后清理，只用合成身份和事实。
- 完整 PostgreSQL 旅程通过 **31 个迁移**，包含原始 checksum、已知中间版本升级、精度/退款/权限/旅行等既有断言。新增 `0030`、`0031`，历史 migration 没有改写。
- 所有 TypeScript 项目、合同生成检查、依赖边界和 Web 生产构建通过。Web JS 461.80 KB / gzip 131.43 KB；依赖注释提示不影响构建。
- Android `compileDebugKotlin` 通过；**13 项**纯 Kotlin 编码、代次、分页、权限与进程重启断言通过，命令入口为 `node scripts/test-health-policy.mjs`。
- 新增正式回归：[上下文与 TTL](../../packages/database/test/agent-context-regression.test.ts)、[金额与迁移历史](../../packages/database/test/money-review-regression.test.ts)、[购物竞态与派生资产](../../packages/database/test/shopping-library-regression.test.ts)、[Health 同步](../../packages/database/test/health-sync-regression.test.ts)、[运行租约](../../packages/database/test/agent-run-regression.test.ts)、[真实 API/本地 Runtime](../../apps/api/test/review-integration.test.ts)、[Kotlin 策略](../../apps/android/tests/HealthSyncPolicyTest.kt)。
- F05 使用两个真实连接及可控父行锁屏障，明确断言双方均等待且子项尚未变更。F09 API 用两个独立 Repository/应用实例，验证另一个实例请求 stop 后由持有者心跳终止流。
- F10 通过实际 CLI 的 apply、final-delta、删除、重放、reconcile，以及从历史快照重建的空库 restore-drill；金额 `9007199254740993.123456` 和尾零精度保持不变。

复验可使用显式配置的临时 `TEST_DATABASE_URL`，直接运行 `node --import tsx --test packages/*/test/*.test.ts apps/*/test/*.test.ts importers/*/test/*.test.ts`。本环境使用已有 Node/tsx/tsc/Vite 等价执行 package scripts，没有运行触发自动安装的 `pnpm check` 或清理依赖。

## 语义与剩余验收边界

- `valid_from/valid_to` 是事实选择窗口，`expires_at` 是访问有效期。线程绑定包在直接 HTTP 读取时也必须传匹配的 `thread_id`。
- `meal-count-v1` 计算的是明确列出的餐次集合，不能当作无边界的“所有餐次总数”。
- F04 的关联金额修正采用明确拒绝规则；没有新增完整 FX/分摊编辑器或审批中心。
- 步数采用公开的保守去重策略，可能低于有来源优先级信息的设备聚合。跨午夜整段归入记录时区的开始日，不推测每分钟步数分布。未声称与 Health Connect 的用户来源优先级聚合完全等价。协议依据：[Health Connect 同步](https://developer.android.com/health-and-fitness/health-connect/sync-data)、[聚合数据](https://developer.android.com/health-and-fitness/health-connect/aggregate-data)。
- Android 重扫在读完所有页、总数不超过 1000 且权限未变化后一次入队；超过范围会明确失败。服务端只失效完整落入窗口的记录，保留跨窗口和窗口外历史。
- 写入在有效租约下进入事务后，stop/孤儿恢复会等待该事务提交或回滚；其已提交回执保留。失去租约后的新写入和迟到事件被拒绝。
- 未运行真实设备/三星来源/Keystore 及后台进程死亡矩阵，未用生产数据、真实 issuer 或付费 Runtime，未部署、未推送、未构建 APK。生产迁移、设备语义与实际 Runtime 验收仍由后续独立流程完成。
