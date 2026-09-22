# 次卡与逐次使用交付（2026-09-22）

新增三项公开能力：`money.save_service_card`、`money.record_service_card_use`、`money.service_cards`。
覆盖已有购买关联、明确使用扣次、当前余额、有效期、关闭、误扣更正/撤销及历史分页。
Web 计划下新增“次卡”，MCP personal profile 和 Life operator 的工作流/示例同步更新。

验证：

- 隔离本地 PostgreSQL 全量测试 264/264 通过，无跳过。包括新增的重复命令、并发扣次、
  超额/未来/有效日期拒绝、跨主体权限、修订快照、分页余额及 MCP 丢响应恢复回归。
- 全部 TypeScript 工程类型检查、合同生成一致性、依赖边界和 Android 模块边界通过。
- Web 生产构建通过；浏览器实际完成创建 8 次卡、使用后剩 7 次、撤销误扣恢复 8 次。
  桌面和 390px 窄屏已目视验证布局。
- Android `:core:model:compileDebugKotlin --offline` 通过，仅验证生成 DTO；未构建 APK。
- 仓库 Life operator 与本地 Hermes umbrella skill 均通过 skill validator；示例由真实合同测试。

实际部署版本、数据库/配置备份、Hermes 常驻目录刷新和用户原记录关联结果写入工作区外的
本地运维目录，不把真实个人记录、服务地址或秘密放进代码仓库。
