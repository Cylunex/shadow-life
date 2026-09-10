# 归档任务恢复优化交付

实施基线 `b4f4802`。本轮完成[研究与设计](../architecture/library-processing-recovery-2026-09-11.md)的两个切片：任务租约/代次与内置处理器统一事务入口。保留 TypeScript 单体、现有 PostgreSQL 和 pg-boss，不新增依赖。

- 迁移 0032 将旧 running 任务的租约设为到期，不修改原件、已成功结果和尝试次数；新约束使租约只存在于 running。
- claim 比较预期 attempts，认领 queued 或过期 running；renew/fail/complete 在持有行锁后检查数据库时钟和当前 attempt。重复 command 重放原回执。失败后重试仍显式进行。
- 内置处理器逐个认领，claim/complete/fail 均调用公共 Executor。派生关系、片段、完成状态与 Operation/Outbox 在同一事务提交，迟到失败不会覆盖成功。
- 外部队列提供可恢复任务；增加 renew 合同，完成/失败要求 attempt，不为旧处理器自动填当前代次。

## 实际验证

在本轮新建的独立临时 PostgreSQL 16 实例运行，每项集成测试各自创建数据库，未访问生产。最终完整集以 `--test-concurrency=1` 运行：**143 项通过，零失败、零跳过**，含 32 次增量迁移的完整业务旅程。

新增 7 项测试中，6 项使用真实 PostgreSQL，覆盖新实例恢复、续租与重放、双认领竞态、旧完成/失败/续租拒绝、终态不可回退、跨 subject 与缺权限拒绝、片段插入失败后的全事务回滚、内置并发只完成一次、旧表升级保真、等锁后租约过期，以及第一文件未完成时第二文件仍 queued。另 1 项验证缺少代次的旧处理器合同被拒绝。既有 MIME/原件摘要与字节保真回归继续通过。

所有 10 个 TypeScript 项目检查通过；生成合同、依赖边界、Web 生产构建与 `git diff --check` 通过。Web 构建仅保留上游 Zod 注释的 Rollup 提示。Android 在此前独立返修复验中通过 130 项 JVM 断言、4 个实际命令合同及 Room 升级，本轮未修改 Android。

第一次运行暴露了新代码对 Drizzle 原始时间返回值的错误假设，已改为解析字符串后输出 ISO 时间；全量测试的固定迁移计数也已更新。随后默认并行运行有 142/143 通过，已有 API 回归出现一次 `terminating connection due to administrator command`；临时库日志显示连接在库清理时被终止。串行完整运行 143/143 通过。这是仍需关注的并行测试清理稳定性限制，未把该次并行结果记为通过，也未通过吞掉数据库错误使测试变绿。

不推送、不部署、不构建 APK。真实设备与 OS 进程死亡矩阵、外部 OCR 服务、完整历史表/关系/资产迁移和生产恢复验收仍不在本轮通过结论内。
