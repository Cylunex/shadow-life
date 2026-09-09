# Android client

原生 Compose 客户端沿用旧应用 ID `com.shadow.app`。登录使用系统浏览器中的 OIDC Authorization Code + PKCE；访问令牌、刷新令牌和授权状态保存在 Android Keystore 支持的加密存储中。WorkManager 同步前自动刷新访问令牌，分享入口先写入同时绑定 account 与 subject 的 Room 队列。客户端只有在协议、能力、command ID、execution ID 和 committed 状态全部匹配时才标记成功；401 或刷新失败停止该账号重试并要求重新登录，429/服务故障保留原 command ID 重试。

本地通过 `~/.gradle/gradle.properties` 或命令行 Gradle 属性配置 `SHADOW_API_BASE`、`SHADOW_OIDC_ISSUER`、`SHADOW_OIDC_CLIENT_ID`、`SHADOW_OIDC_REDIRECT_URI` 和 `SHADOW_OIDC_REDIRECT_SCHEME`。这些值不得包含客户端密钥；Android 使用身份提供方注册的 public client。

Health Connect 权限已在 manifest 声明，服务端使用 `health.ingest_batch` 原子接收一页变更并在全部记录持久化后推进按设备/类型 cursor。正式启用仍须在签名候选 APK 上验证权限撤销、token 过期、分页、删除和断网恢复。仓库不包含真实 API 地址、会话、签名材料或生产数据。

本地源码编译使用 JDK 17 与已安装的 Android SDK：`gradle :app:compileDebugKotlin`。Room v3 schema 会输出到 `app/schemas/`，迁移变更应与 schema 一并评审。
