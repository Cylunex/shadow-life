# Android Health Connect V01/V02 返修记录

返修基线：`dbc3364151bdac5a35fc8bfac946488910f1dba0`。独立复验发现，初轮 13 项纯 Kotlin 策略断言没有覆盖 Worker 的 JSON 表达式和跨回执调度，因此不能证明 Android 同步闭环。此次只调整 Android 请求、队列续接和相应测试，公开合同与服务端业务实现没有改动。

## V01：重扫请求构造

Worker 通过 `runHealthSyncRound` 调用生产函数 `healthBatchCommand`。构造函数先建立 input，在该对象上设置 `rescan`，再建立 envelope，消除嵌套 `also` 绑定错误。JVM 测试使用真实 org.json 20250517，直接编译生产文件；普通 changes、首次 bootstrap、过期重扫和空完整扫描的输出继续交给公开的 `universalCommandEnvelopeSchema` 与 `ingestHealthBatchInputSchema` 校验。

断言逐项检查 envelope、来源/设备/类型、指纹、epoch、前后 cursor、parser、provider 记录与版本，以及重扫代次、窗口和 complete。命令 ID 使用账号、用户、设备、来源、类型、epoch 和前后 cursor 的确定性身份；入队后的正文继续沿用原有加密队列，重试不会重新构造正文或更换 ID。

## V02：持久同步轮次

Room 6 新增按账号和用户隔离的 `health_sync_rounds`，保存显式请求 ID、当前类型、待确认命令和回执后的类型位置；不在此表保存健康数据或 opaque token。入队命令与保存等待位置在同一 Room 事务内完成；验证回执的提交与推进位置也在同一事务内完成。重复或无关命令的回执不会再次推进，已经提交的本地命令重放不会留下永久等待。

生产 `runHealthSyncRound` 按 body、steps_interval、sleep、workout 完成一轮：

- `hasMore=true` 时等待该页回执，再继续同类型的下一页。
- `hasMore=false` 时，该页回执推进到下一类型。空 records 但 next token 前进也适用。
- 空 records、cursor 未变且没有 rescan 时，可直接完成该类型；完整空扫描仍然入队。
- token 过期时先等待来源状态重置回执，再从第一类型重扫，避免跳过已被新 epoch 失效的早先类型。
- 四类完成后，回执/恢复唤醒不会开启新轮次；只有新的显式同步请求可以开始下一轮。重复执行原始 WorkRequest 也不会重开已完成轮次。

队列 Worker 只续接尚未完成且没有等待命令的轮次。应用恢复时已有队列 Worker 也会检查该状态，补上“回执已提交、唤醒前进程退出”的间隙。内部续接使用 WorkManager `APPEND_OR_REPLACE`，避免正在完成的同名任务吞掉续接；普通外部请求仍合并为同名任务。未确认的失败命令保留在轮次中供现有队列重试，清理终态历史不会删除其唯一等待对象。

## 验证与复验入口

- `node scripts/test-health-policy.mjs`：13 项既有策略断言、117 项生产构造/轮次断言通过。假 provider 每次返回空 records、新 token、hasMore=false，四类各收到一次回执后结束；同时覆盖已有 body 与其他三类首次 bootstrap、三页同类型分页、重复回执、持久状态重建、事务失败重试、来源过期后的四类重扫和无进展分页拒绝。
- 同一命令将生产 JVM 实际输出的四个请求送入公共合同校验，全部通过；不是在 JavaScript 中重写构造器。
- 同一命令将生产迁移 SQL 应用到导出的 Room 5 SQLite schema，比较生成的 Room 6 schema，校验原命令/附件行保留和三组账号/用户进度隔离。
- 离线 `:app:compileDebugKotlin` 通过，包含实际 Worker、Room DAO/KSP 和迁移注册；没有执行 APK 构建任务。

测试入口也登记为 `pnpm test:android-health`。需要 JDK 17、本地 Kotlin 2.2.21、coroutines 1.8.0、org.json 20250517 Gradle 缓存、已安装 Node 依赖与 Python 3。测试不请求 provider、网络、生产数据库或模型 Runtime。

这是生产函数和可注入边界的 JVM/SQLite 验证，不是 Android 真机或 WorkManager 系统进程死亡矩阵；真实设备、三星来源与 Keystore 验收仍未完成。所有改动仅保留本地，不推送、不部署。
