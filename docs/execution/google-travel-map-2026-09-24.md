# Travel Google 地图接入与边界

旅行地图以当前旅程为范围。Web 和 Android 均可切换当天地点与全程地点；当天地图显示日程序号，并为明确且有 WGS84 坐标的连续地点计算 Google 驾车道路路线。标题或备注标明“备选、可选、候选、弹性、视情况、如果有时间、自由活动”的停留点保留标记，但不进入路线。没有地点的早餐、用餐和休息等非空间停留点不画标记，也不改变相邻已知地点的顺序；其他缺地点或坐标的停留点断开路线。全程地图汇总该旅程各日地点，不混入其他旅程的个人收藏或实际到访。

Google 底图上的橙线是 Google 估算的驾车道路路线，并展示总距离和约计时间；无可用道路的段落不连直线。高德底图上的橙线仍仅示意地点顺序。当天清单可逐段打开 Google 地图道路路线。蓝线仅表示另行导入的 GPX 轨迹；计划地点、主题地图收藏、预订与真实到访仍是不同事实。当前地图不会把计划标成到访。

## 受控配置

- Android 复用 Google Maps SDK。忽略的 `apps/android/local.properties` 可设置 `GOOGLE_MAPS_API_KEY`，或通过 `SHADOW_MAP_KEYS_FILE` 指向受限的外部 Java properties 文件；兼容该文件中的 `googlemap_apikey` 别名。密钥只进入本地构建，不写入仓库。Google Cloud 中应为 Android 使用独立 key，限定 `com.shadow.life` 及实际签名证书 SHA-1，并只允许 Maps SDK for Android 与 Routes API；客户端 REST 请求携带 `X-Android-Package` 和 `X-Android-Cert`。
- Web 使用 `GOOGLE_MAPS_WEB_API_KEY` 构建环境变量，例如忽略的 `.env.production.local`。浏览器密钥会进入前端资源；当前按用户要求暂与 Android 复用同一 key，后续应拆分，并分别限制网站来源或 Android 应用、允许的 API 与配额。缺少密钥或加载失败时展示地点坐标预览和明确提示。
- Google Maps Platform 需要启用 Maps JavaScript API、Maps SDK for Android、Routes API 和计费；配额由 Google Cloud 控制。路线只在会话内复用，不持久化 Google 返回的道路数据。当前 NAS 没有可用的 Google 路线接口出口，因此客户端直接请求；服务端代理与专用密钥仍需另行配置。

Google 官方文档：[Maps JavaScript API 加载](https://developers.google.com/maps/documentation/javascript/load-maps-js-api)、[Android SDK 密钥](https://developers.google.com/maps/documentation/android-sdk/get-api-key)、[API 密钥限制](https://developers.google.com/maps/api-security-best-practices)、[Maps URLs 道路路线](https://developers.google.com/maps/documentation/urls/guide)、[Routes API](https://developers.google.com/maps/documentation/routes/compute-route-over)。

## 发布与验证

首次实现时 Web 类型检查和旅行地图用例、Android Kotlin 编译和日程地图用例通过。后续发布与安装包状态由本机运维记录维护；在线底图、来源限制、计费和设备交互需分别验收。

## 地图交互修复（2026-09-24）

- Android 原生地图外增加触摸容器，手势开始时暂停旅行页 `LazyColumn` 的用户滚动，结束或取消时恢复；地点清单自身有固定高度的滚动区域。旅行地图直接显示“全部”和每个日期标签，切换日期后地图标记、分日虚线与下方停留点使用同一组日程。展开地图使用接近全屏的对话层，清单可收起，返回后保留当前旅程和日期。
- Google 地图每次切换日程、全程或主题地点时重新按当前有效坐标适配镜头；待原生地图完成布局后用实际宽高计算边界，并跳过已过期的异步地图回调。全程路线按天分别绘制，不跨日期相连。
- Web 地图增加同样的七日/全部标签和展开布局；按旅程 ID 过滤日程，避免两版行程同日互串；全部地点清单使用一个独立滚动容器，Google 地图控件预留边界空间。通过本地只读测试页在手机尺寸浏览器实操了日期、全程、两版行程、地图拖动和展开/收起。全程清单滚到第七天时内部滚动位置为 1017px，页面滚动位置保持 0。
- 首轮交互修复验证了 Web 66 项测试、类型检查和生产构建，以及 Android Debug Kotlin 编译与 49 项单元测试。该阶段预留候选版本 `2.1.21 (43)`，随后完成正式签名构建、部署和三星真机回归，结果见本机运维记录。

## 道路路线与二次交互修复（2026-09-24）

- 2.1.21 候选包已在三星真机验证地图纵向拖动、七日/全部切换、接近全屏地图与独立地点清单。后续发现切天后清单保留旧滚动位置、切换行程版本后当前选中的日期标签可能在可视范围外。Android 清单在范围、日期或日程变化时回顶，所选日期标签自动滚入视野；Web 地点清单在范围、日期或日程内容变化时重建滚动容器。
- Google 地图改用 Google Routes API 计算驾车路线。Android 从受限本机配置注入现有 key，向 Routes API 请求当前可定位连续停留点，解码返回的道路折线；Web 使用 Maps JavaScript Routes Library。每个连续日程段单独请求，全程视图不跨天连接。地图显示道路路线、总距离与约计时间；没有可用驾车路线的路段不画直线，以免误导。高德底图仍只显示示意连线，并明确标注。
- 路线计算结果只在当前页面/地图会话内存中复用，不写入数据库或持久化缓存。计划地点不等于实际到访；距离与时间是 Google 估算值，不代表实时路况或已行驶轨迹。Android Debug 变体提供免登录的虚构曼谷七日地图 QA 入口，正式包不包含。
- 本机现有 key 对 Routes REST 请求返回 200，示例路段得到 65 个道路路径点、4,841 米、约 15 分钟；Chrome 的 Maps JavaScript Routes Library 同样返回路径。使用实际 `TravelMapSurface` 的本地浏览器 QA 显示第 1 天沿道路橙线及 8.4 公里/约 25 分钟，第 7 天切换正常，全部范围显示 58.9 公里/约 175 分钟、28 个可定位停留点。NAS 和云服务器直连 `routes.googleapis.com` 超时，现阶段客户端直接请求；应另行配置可用的受控出口与服务端代理，并拆分 Web、Android 专用密钥及应用来源限制。正式环境的七日真实路线、手机网络可达性和 Google Cloud 费用配额需继续验收。
- Android 无账号 Debug QA 入口在模拟器上验证了日期标签可见、切天后清单回顶、全屏返回等交互；当前 Google APIs 模拟器仅显示 Google 标识和控件，底图/道路折线未加载，无法将该模拟器结果视作 Android 道路路线验收。正式签名 2.1.21 在三星真机已验证原生地图手势和分天视图，2.1.22 的 Android 路线网络请求仍待可用的模拟器或实体设备复测。
