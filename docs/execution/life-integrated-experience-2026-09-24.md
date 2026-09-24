# Life 跨领域日视图整合交付（2026-09-24）

本分支合并了当日领域增强与 Money、Travel、Library 记录工作台，并在同一 Life 主体权限下增加“某一天”、往日回忆及显式来源关联。两批原始交付分别见 [日常领域](daily-domains-2026-09-24.md) 与 [记录工作台](money-travel-library-records-2026-09-24.md)。

## 借鉴点 → Life 既有能力 → 本次增量

| 借鉴点 | Life 既有能力 | 本次增量 |
| --- | --- | --- |
| [Memos 的日历与时间线](https://github.com/usememos/memos/blob/main/CHANGELOG.md)、[Immich 的同日回忆](https://github.com/immich-app/immich/discussions/16624) | 统一记录时间线、领域内事实和来源详情 | `life.day` 按指定本地日汇集已授权领域，并返回总数、游标和来源；`life.memories` 从前五年的同月同日确定性回取真实记录。Web Records 与 Android Records 可直接打开来源。 |
| [Actual Budget 的导入与对账](https://actualbudget.org/docs/transactions/importing/) | Money 候选导入和确认入账 | 月度核对继续只计算候选状态；日视图只读取已确认账目，不把待核对候选算作支出。 |
| [Tandoor 的食谱、计划与购物](https://docs.tandoor.dev/features/shopping/) | Meals 食谱、计划、手动库存与已记录餐次 | 日视图保留餐次事实，并仅展示餐次与付款间真实存在的关联；计划和库存不被推断为已食用。 |
| [Super Productivity 的项目与行动](https://github.com/super-productivity/super-productivity)、[AdventureLog 的旅行记录](https://github.com/seanmorley15/AdventureLog) | 生活项目行动、旅行计划与实际记录 | 行动完成时刻独立保存，完成事件按所选时区入日；旅程只展示可见内容。已有旅程与账目明确关系时提供相互来源链接。 |

## 数据与交互约束

- 有时刻的事实按所选 IANA 时区归日；仅有日期的事实保留源日期。完成行动使用独立 `completed_at`；迁移前已经完成的行动以原 `updated_at` 回填。Library 资料优先使用当前修订的资料日期，否则使用收录日。
- 读取按主体、领域 read effect 和现有可见性过滤；跨领域链接仅在双方均可读且关系真实存在时返回。支持餐次↔账目、旅程↔账目、物品↔资料的现有显式关系；不做相似性猜测。
- 日页有准确总数和有界分页。回忆只查前五年同月同日，每年最多取 20 条，总计最多 100 条；没有历史证据时返回空数组，不生成文字叙事。授权领域列表使“没有记录”与“没有读取权限”可以区分。
- Library 视觉处理成功后可自动生成普通、可再次修订的资料版本；保留原件、处理任务、模型与页面引文来源。用户已修改的修订不被后台结果覆盖。视觉结果不自动建立账目或健康事实。
- Web 和 Android 都提供某一天、回忆及来源入口；Web 的项目来源按确切项目 ID 读取。Android 行动来源进入项目详情。

## 验证与当前边界

- 新 PostgreSQL 测试覆盖本地日与时区、分页总数、同日回忆、授权裁剪、显式餐次付款链接和非法游标；API 测试覆盖新路由解析。完整 `pnpm check` 在独立临时 PostgreSQL 通过，数据库测试 52/52。Web 生产构建、Android 离线 Kotlin 编译与 debug 单元测试通过。
- 视觉处理只通过本地 stub 验证协议、自动修订、重试与并发用户修订保护；真实模型质量、真实图片/PDF 和实体设备尚待端到端验收。没有调用付费模型、部署、推送、构建 APK 或操作生产数据。
- 日视图是当前事实的只读投影，跨页读取期间若来源修订变化，后续页可能显示较新的标题。回忆不持久化，也不代替领域原始记录。
