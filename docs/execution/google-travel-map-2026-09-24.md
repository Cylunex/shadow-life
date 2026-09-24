# Travel Google 地图接入与边界

旅行地图以当前旅程为范围。Web 和 Android 均可切换当天地点与全程地点；当天地图显示日程序号，并为明确且有 WGS84 坐标的地点绘制橙色虚线。标题或备注标明“备选、可选、候选、弹性、视情况、如果有时间、自由活动”的停留点保留标记，但不进入路线。没有地点的早餐、用餐和休息等非空间停留点不画标记，也不改变相邻已知地点的顺序；其他缺地点或坐标的停留点断开路线。全程地图汇总该旅程各日地点，不混入其他旅程的个人收藏或实际到访。

橙色虚线是点与点之间的直线示意，不是道路导航，不显示距离或预计时间。当天清单可逐段打开 Google 地图道路路线。蓝线仅表示另行导入的 GPX 轨迹；计划地点、主题地图收藏、预订与真实到访仍是不同事实。当前地图不会把计划标成到访。

## 受控配置

- Android 复用 Google Maps SDK。忽略的 `apps/android/local.properties` 可设置 `GOOGLE_MAPS_API_KEY`，或通过 `SHADOW_MAP_KEYS_FILE` 指向受限的外部 Java properties 文件；兼容该文件中的 `googlemap_apikey` 别名。密钥只进入本地构建，不写入仓库。Google Cloud 中应把 Android key 限定为 `com.shadow.life` 及实际签名证书 SHA-1，并只允许 Maps SDK for Android。
- Web 使用独立的 `GOOGLE_MAPS_WEB_API_KEY` 构建环境变量，例如忽略的 `.env.production.local`。浏览器密钥会进入前端资源，因此应限定 HTTPS 站点来源和 Maps JavaScript API，不复用 Android key。缺少密钥或加载失败时展示地点坐标预览和明确提示。
- Google Maps Platform 需要启用相应 API 和计费；配额由 Google Cloud 控制。当前实现不调用 Routes API，不产生或缓存道路距离和用时。若以后要在应用内画沿路路线，需单独评估 Routes API、服务端密钥、费用上限、路线模式和缓存策略。

Google 官方文档：[Maps JavaScript API 加载](https://developers.google.com/maps/documentation/javascript/load-maps-js-api)、[Android SDK 密钥](https://developers.google.com/maps/documentation/android-sdk/get-api-key)、[API 密钥限制](https://developers.google.com/maps/api-security-best-practices)、[Maps URLs 道路路线](https://developers.google.com/maps/documentation/urls/guide)、[Routes API](https://developers.google.com/maps/documentation/routes/compute-route-over)。

## 发布与验证

首次实现时 Web 类型检查和旅行地图用例、Android Kotlin 编译和日程地图用例通过。后续发布与安装包状态由本机运维记录维护；在线底图、来源限制、计费和设备交互需分别验收。

## 地图交互修复（2026-09-24）

- Android 原生地图外增加触摸容器，手势开始时暂停旅行页 `LazyColumn` 的用户滚动，结束或取消时恢复；地点清单自身有固定高度的滚动区域。旅行地图直接显示“全部”和每个日期标签，切换日期后地图标记、分日虚线与下方停留点使用同一组日程。展开地图使用接近全屏的对话层，清单可收起，返回后保留当前旅程和日期。
- Google 地图每次切换日程、全程或主题地点时重新按当前有效坐标适配镜头；待原生地图完成布局后用实际宽高计算边界，并跳过已过期的异步地图回调。全程路线按天分别绘制，不跨日期相连。
- Web 地图增加同样的七日/全部标签和展开布局；按旅程 ID 过滤日程，避免两版行程同日互串；全部地点清单使用一个独立滚动容器，Google 地图控件预留边界空间。通过本地只读测试页在手机尺寸浏览器实操了日期、全程、两版行程、地图拖动和展开/收起。全程清单滚到第七天时内部滚动位置为 1017px，页面滚动位置保持 0。
- Web 66 项测试、类型检查和生产构建，Android Debug Kotlin 编译及 49 项单元测试通过。Android 后续候选版本预留为 `2.1.21 (43)`。用户现有安装包在三星真机上复现纵向拖动带动外层页面；本次 Android 修复尚未装机回归，不把编译与单测当作真机触摸验收。本轮不部署，也不生成正式签名 APK。
