# 旅行预订按日查看：参考取舍与交付

本轮只改 Life。Travel、App、Garden、Nexus、Platform 的已合并能力以 Life 当前实现为准；没有修改旧仓库、Losna、运行配置或生产数据。调研基线为 Life `0638536`。

## 当前能力与缺口

源码已有统一 Executor、日计划、发布版本、在途结果、预算、清单、地图、实际交通与到访、HTML 离线行程单；助手已有持久任务上下文、事件恢复与确定性回执。没有必要重建另一个旅行服务或 Agent Runtime。

`TravelBasicsPanel` 原来固定以 `confirmed` 新增预订，无法录入候补；`TravelItinerary` 只展示计划停留。住宿续住、退房与跨夜到达只能另找详情。离线单原来按预订开始日归类，待确认/候补住宿还会混入“当晚住宿”。数据库详情与 Bundle 查询未过滤 `voided_at`，误录作废的预订会再次出现。

## 核实的上游源码与许可

2026-10-28 查询 GitHub 当前 HEAD，读取以下源码与根 LICENSE。只做静态源码核实，没有安装、执行或安全审计上游；功能宣传不作为性能、稳定性或设备兼容性证据。本次独立实现 Life 的显示投影，没有复制上游代码或资源、引入上游依赖。

| 项目与选定修订 | 核实入口、机制与取舍 |
| --- | --- |
| [TripStar `2455e6f66ab9bf1a45147aca7103117a7a1600f9`](https://github.com/1sdv/TripStar/tree/2455e6f66ab9bf1a45147aca7103117a7a1600f9) · GPL-2.0 | `frontend/src/views/Result.vue` 具备按日结果、预约与预算展示。采用旅行上下文内直接查看相关安排的体验；不把模型预算或预约建议当作 Life 的账目、确认预订或实际到访。 |
| [our-little-planet `e86364e7da54b50275dafa98a873e20720530c1a`](https://github.com/zhangzhiwei0905/our-little-planet/tree/e86364e7da54b50275dafa98a873e20720530c1a) · MIT | `src/components/timeline/TimelineList.tsx` 按记录日期结合媒体、文字展示。此次不移植恋爱互动、相册或素材；Life 已有日回忆与资料来源，媒体展示需另有明确的来源和预览范围。 |
| [deva `7f10bf3402dfbfd1b81da187ac4be52c44280e53`](https://github.com/sqfcyily/deva/tree/7f10bf3402dfbfd1b81da187ac4be52c44280e53) · MIT | `apps/desktop/src/main/services/tasks.ts` 将任务 CRUD、文件持久化和执行器分离。Life 已有数据库任务与回执；不引入桌面文件任务库，也不采用该文件中写入失败仍只保留内存态的处理。 |
| [Eta `6bedba981b78cb308a58c9f040a9f66a9a16595a`](https://github.com/Mangi-11/Eta/tree/6bedba981b78cb308a58c9f040a9f66a9a16595a) · PolyForm Noncommercial 1.0.0 | `agent/runtime/AgentRunCheckpointStore.kt`（位于 `app/src/main/kotlin/io/github/mangi/eta/`）区分持久事件、transcript 与上下文快照，恢复时结合 Runtime 判断状态。不是无使用限制的开源许可；本轮不复制代码，不引入 Root、Hook 或新的 Android Runtime。 |
| [agent-purge `a3e7fbfc584d224d3db12e50ebabf6f81cfbacfd`](https://github.com/ZiChuanLan/agent-purge/tree/a3e7fbfc584d224d3db12e50ebabf6f81cfbacfd) · MIT | `lib/detect.mjs` 用适配规格描述可执行文件、配置标记和版本探测。当前缺口不涉及宿主配置适配，故不采用、不运行探测或修改任何宿主。 |
| [AdventureLog `a890a17001e7a9cd6b82916804acdc4070008f72`](https://github.com/seanmorley15/AdventureLog/tree/a890a17001e7a9cd6b82916804acdc4070008f72) · GPL-3.0 | 本轮补充搜索发现。`frontend/src/lib/components/collections/CollectionItineraryPlanner.svelte` 的日分组包含续住住宿与未排期项目。采用该产品组织方式；Life 按旅程 IANA 时区投影绝对时间，不照搬该文件截取时间字符串日期的规则，也不导入协作拖拽和自动排期。 |

## 实际交付与使用

- 打开 Web「计划 → 旅行」，每日停留下方可查看「预订与住宿」。跟随行程日期显示入住、续住、退房和跨夜结束，亦可切换全部预订；完全未定时间的项目单列。旅程范围外已知预订日期可选择，标记范围外，不改变旅程天数与计划边界。
- 候补、待确认、已改签、已取消、已退款保持各自状态；只有 `confirmed` 且入住/退房区间已知的住宿进入“当晚已确认预订”。取消/退款仍在开始、结束日及全部列表可查，不算连续住宿。未知开始但已知结束归入结束日，不补造开始时间。
- 新增预订支持六种现有状态、出发地、目的地、班次、座位；仍通过 `travel.add_reservation` 直接执行并等待原回执。确认号与座位只展示服务端返回的字段，默认折叠。
- 详情独立加载、失败可重试；切换旅程清空旧预订，并中止或忽略旧响应。录入表单按旅程隔离，避免带着上一旅程草稿保存。
- HTML 离线单共用预订归日函数，显示跨日开始/结束完整日期和班次并转义文本。下载仍是用户主动保存的静态副本，含当前可见的私人确认号；没有后台推送、外发或日历提醒。
- `travelTrip` 与 `travelExportData` 排除作废预订，保留正常取消/退款记录及数据库修订历史。服务端原有成员、私密字段与来源权限仍生效；公开合同与 Android 生成物无改动。

## 验证入口与边界

- `pnpm check`：生成物、依赖边界、各包类型与测试。
- `pnpm test:full:offline`：临时 PostgreSQL、合成事实、完整套件；新增数据库回归覆盖所有者/成员详情、Bundle、私密字段、作废过滤及历史保留。
- `node --import tsx scripts/test-travel-reservations-offline.mjs`：临时 PostgreSQL + 实际 API + Vite + Playwright，外部网络请求拦截。可沿用 `SHADOW_TEST_BROWSER_EXECUTABLE` 指向已安装浏览器；不安装上游软件。
- `pnpm build:client`：Web 构建；不是部署或 APK 打包。

最终测试数量和浏览器验收结果见 [交付记录](../execution/travel-reservations-2026-10-28.md)。Android 原生页面未增加同款面板；地图供应商、真实预订、模型效果、系统提醒和实体设备不在本轮验证范围。没有自动取消供应商订单、退款或创建账目；状态仅记录用户提供的预订事实。
