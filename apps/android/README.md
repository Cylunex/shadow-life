# Android client

原生 Compose 客户端沿用旧应用 ID `com.shadow.app`。登录使用系统浏览器中的 OIDC Authorization Code + PKCE；访问令牌、刷新令牌和授权状态保存在 Android Keystore 支持的加密存储中。WorkManager 同步前自动刷新访问令牌，分享入口先写入同时绑定 account 与 subject 的 Room 队列。客户端只有在协议、能力、command ID、execution ID 和 committed 状态全部匹配时才标记成功；401 或刷新失败停止该账号重试并要求重新登录，429/服务故障保留原 command ID 重试。

本地通过 `~/.gradle/gradle.properties` 或命令行 Gradle 属性配置 `SHADOW_WEB_BASE`、`SHADOW_API_BASE`、`SHADOW_OIDC_ISSUER`、`SHADOW_OIDC_CLIENT_ID`、`SHADOW_OIDC_REDIRECT_URI` 和 `SHADOW_OIDC_REDIRECT_SCHEME`。这些值不得包含客户端密钥；Android 使用身份提供方注册的 public client。

主入口用受限 WebView 打开完整 Shadow Life Web：仅允许与 `SHADOW_WEB_BASE` 同源的 HTTPS 导航，
关闭文件/内容访问和混合内容，外部链接交给系统浏览器。NAS Basic Auth 凭据由用户在系统认证挑战
出现时输入，只存在于当前 WebView 认证会话，不写入源码或 APK。原生离线采集、分享与 Health
Connect 位于“采集”入口，仍以独立 OIDC public client 为正式启用条件。

Health Connect 权限已在 manifest 声明。客户端显式授权后为体重、步数、睡眠和训练分别申请并维护 Changes token，首次只回填最近 30 天且超过 1000 条时拒绝截断；后续将 upsert/delete 分页写入账号加密队列。服务端使用 `health.ingest_batch` 原子接收一页变更并在全部记录持久化后推进按设备/类型 cursor，客户端每次从服务端已提交游标继续，因此响应丢失或重装不会盲目跳页。权限撤销和 token 过期会写入来源状态并进入受控重扫。

这条源码链路通过 `compileDebugKotlin`，但正式启用仍须在签名候选安装包上逐项验证权限撤销、token 过期、多页、删除、断网/进程死亡和三星设备提供的数据类型。仓库不包含真实 API 地址、会话、签名材料或生产数据。

本地源码编译使用 JDK 17 与已安装的 Android SDK：`gradle :app:compileDebugKotlin`。Room v5 schema 会输出到 `app/schemas/`，迁移变更应与 schema 一并评审。

重扫协议使用明确窗口和一次完整批次：读完所有页并复查权限后才带 `rescan.generation/window_start/window_end/complete` 入队；总数超过 1000 时失败，不提交不完整扫描。服务端仅对完整覆盖窗口做缺失对账，范围外历史保留。步数采用 `steps_interval`，保留起止时间与来源；服务端按来源去重，跨午夜整段归入记录时区的开始日。旧日总量编码只在完整窗口内退役，不改写旧 raw revision。纯 JVM 协议回归入口为 `node scripts/test-health-policy.mjs`（仓库根目录，需本地 Kotlin Gradle 缓存与 JDK 17）。

Android Health Connect 请求构造、同步轮次与本地回归验证见 [V01/V02 返修记录](../../docs/execution/android-health-reverification-fixes-2026-09-11.md)。
