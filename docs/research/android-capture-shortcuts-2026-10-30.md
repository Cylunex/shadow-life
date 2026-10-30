# Android 采集与快捷截图参考

查阅日期：2026-10-30。以下用于交互与职责设计，没有复制外部项目代码或引入其运行时依赖。

| 项目 | 可参考部分 | Life 中的取舍 |
| --- | --- | --- |
| [ScreenshotTile](https://github.com/cvzi/ScreenshotTile/blob/main/README.md) | 快捷设置磁贴；系统截图与通过无障碍服务获取图片的不同路径 | 增加“截图到 Life”磁贴。Android 11 起采用系统截图 API，收起面板后截图；原件直接进现有加密队列 |
| [ActivityWatch Android](https://github.com/ActivityWatch/aw-android) | Android 应用活动采集及本地事件服务 | 保留 Life 的应用使用区间、来源身份与未知覆盖，不再嵌入一套独立事件后端 |
| [Screenpipe](https://github.com/screenpipe/screenpipe) | 屏幕、音频与可检索历史；事件驱动的采集思路 | 借鉴采集与理解分层、页面稳定后读取和去重；Android 继续使用原生系统权限和前台服务 |
| [Beayy](https://github.com/hengfengliya/beayy) | 多来源材料和分层回顾 | 接入现有 Life API、账单身份和资料来源；十分钟／小时／日周月回顾可以回到采集原文 |

## 快捷操作

1. 进入 Life 的“应用使用与活动记录 → 采集与回顾 → 截图”，启用系统中的 Life 屏幕内容服务。
2. Android 13 起可点“添加截图快捷磁贴”；较早版本在系统快捷设置编辑页添加“截图到 Life”。
3. 打开需要记录的账单、订单或活动页面，下拉快捷设置，点磁贴。锁屏时先由系统解锁；面板收起后保存截图。
4. 截图原件和可读页面文字在同一个收录操作中保存。只有截图前后页面文字与应用均一致时才附带文字；没有可读节点时仍保留图片。
5. 自动订单关联需要事先保存该来源应用、平台和平台账号的规则。截图文字可复用此规则；图像识别内容不会自行转成付款证据。

Android 10 使用“系统截图 → 分享 → Shadow Life”保存原件。此路径也继续适用于新系统。原件后续可从资料页识别；直接截图命令在视觉处理器已经配置时会排队识别。

自动读取页面仍只面向用户选择的应用；磁贴截图是另一次明确操作。密码、敏感与编辑节点不进入文字采集。原件留在 Life，不另写入公共相册或剪贴板。系统保护页面截图失败时会显示实际失败提示。

## 系统依据与验证边界

- [AccessibilityService.takeScreenshot](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService#takeScreenshot(int,java.util.concurrent.Executor,android.accessibilityservice.AccessibilityService.TakeScreenshotCallback))：API 30 起提供截图，服务必须声明截图能力。
- [TileService](https://developer.android.com/reference/android/service/quicksettings/TileService)：磁贴通过系统活动入口收起面板；API 34 起使用 PendingIntent 重载。
- [添加磁贴请求](https://developer.android.com/reference/android/app/StatusBarManager#requestAddTileService(android.content.ComponentName,java.lang.CharSequence,android.graphics.drawable.Icon,java.util.concurrent.Executor,java.util.function.Consumer))：由系统处理用户添加请求。
- [前台服务类型](https://developer.android.com/develop/background-work/services/fgs/service-types)：录音与位置由可见界面的明确操作启动，保留系统前台通知；不开机自动开启麦克风。

本轮完成代码、合同与离线回归；尚未在用户主力设备上验证面板动画、厂商无障碍限制、受保护窗口、长时间锁屏录音和耗电。700 毫秒的面板收起等待属于实现默认值，不当作跨厂商保证。
