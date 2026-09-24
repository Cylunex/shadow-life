# Travel Google 地图接入与边界

旅行地图以当前旅程为范围。Web 和 Android 均可切换当天地点与全程地点；当天地图显示日程序号，并为明确且有 WGS84 坐标的地点绘制橙色虚线。标题或备注标明“备选、可选、候选、弹性、视情况、如果有时间、自由活动”的停留点保留标记，但不进入路线。没有地点的早餐、用餐和休息等非空间停留点不画标记，也不改变相邻已知地点的顺序；其他缺地点或坐标的停留点断开路线。全程地图汇总该旅程各日地点，不混入其他旅程的个人收藏或实际到访。

橙色虚线是点与点之间的直线示意，不是道路导航，不显示距离或预计时间。当天清单可逐段打开 Google 地图道路路线。蓝线仅表示另行导入的 GPX 轨迹；计划地点、主题地图收藏、预订与真实到访仍是不同事实。当前地图不会把计划标成到访。

## 受控配置

- Android 复用 Google Maps SDK。忽略的 `apps/android/local.properties` 可设置 `GOOGLE_MAPS_API_KEY`，或通过 `SHADOW_MAP_KEYS_FILE` 指向受限的外部 Java properties 文件；兼容该文件中的 `googlemap_apikey` 别名。密钥只进入本地构建，不写入仓库。Google Cloud 中应把 Android key 限定为 `com.shadow.life` 及实际签名证书 SHA-1，并只允许 Maps SDK for Android。
- Web 使用独立的 `GOOGLE_MAPS_WEB_API_KEY` 构建环境变量，例如忽略的 `.env.production.local`。浏览器密钥会进入前端资源，因此应限定 HTTPS 站点来源和 Maps JavaScript API，不复用 Android key。缺少密钥或加载失败时展示地点坐标预览和明确提示。
- Google Maps Platform 需要启用相应 API 和计费；配额由 Google Cloud 控制。当前实现不调用 Routes API，不产生或缓存道路距离和用时。若以后要在应用内画沿路路线，需单独评估 Routes API、服务端密钥、费用上限、路线模式和缓存策略。

Google 官方文档：[Maps JavaScript API 加载](https://developers.google.com/maps/documentation/javascript/load-maps-js-api)、[Android SDK 密钥](https://developers.google.com/maps/documentation/android-sdk/get-api-key)、[API 密钥限制](https://developers.google.com/maps/api-security-best-practices)、[Maps URLs 道路路线](https://developers.google.com/maps/documentation/urls/guide)、[Routes API](https://developers.google.com/maps/documentation/routes/compute-route-over)。

## 发布与验证

Web 类型检查和旅行地图用例、Android Kotlin 编译和日程地图用例通过。Google 在线底图、来源限制、计费和设备交互仍需要配置后在实际 Web 域名及 Android 设备验证。当前改动不部署服务，也不生成安装 APK。
