# Life 分享与 Losna 处理接入

日期：2026-10-31。状态：源码实现与离线验证，尚未部署或打包 APK。

- 三星既有唯一周期任务调整为约 30 分钟，沿用原授权、分页、加密队列与服务端回执。受系统调度及源数据到达时间影响，不保证准点。
- Android 分享文字和附件自动携带 `losna:process`、`losna:batch:<ingressId>` 标签，同一次文字和多图共享批次身份；主动截图使用相同处理标记。
- `agent.objects` 的资料节点返回当前修订的标签，Losna 可从既有持久变化流识别新分享；主体与权限过滤继续由 Life 执行。
- 个人 MCP profile 允许排入 `library.queue_processing`，只开放普通资料处理请求，处理器管理权限保持原有边界。
- Life 继续显示实际领域记录，分析成果由 Losna 保存并经既有 QQ 通道反馈；没有新增报告表、分析结果页面或报告回写接口。

Losna 消费者、配置、恢复与图片识别依赖见[Losna 实施记录](../../../shadow-losna/docs/execution/life-health-20261031.md)。

验证：全量合同、依赖边界、类型及包测试通过；完整隔离 PostgreSQL 回归 **480/480** 通过；含 Samsung Data SDK 的 Android Kotlin 编译与应用单测通过。记录具体数量以同日提交回执为准。新增回归覆盖处理标记在有权限变化流中的保留及主体隔离。

[设计](../architecture/health-capture-losna.md)中的高级分类型三星 checkpoint、来源切换、历史汇总更正和 HC 周期备选仍为后续增强；本次沿用现有同步实现，没有宣称这些增强已完成。真机熄屏／Doze／耗电和实际 QQ、模型联调需在明确部署与设备验收任务中验证。
