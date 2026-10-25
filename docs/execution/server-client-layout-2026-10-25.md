# 2026-10-25：单仓服务端与客户端拆分

按用户选择保留一个 Git 仓库，将原 `apps/`、`packages/` 与迁移工具按职责迁入 `server/`、`client/`、
`shared/`。服务端包含 API、Worker、业务核心、数据库、已有 Runtime 适配与迁移工具；客户端包含 Web、
Android、CLI 与 MCP；共享合同集中在 `shared/contracts`。包名与依赖版本保持不变，继续使用一份根 lockfile。

## 交付内容

- 新增分侧启动、检查和测试入口；Android 保持独立 Gradle 工程，Web 独立构建。
- 更新 workspace、包链接、迁移路径、合同生成目标、辅助脚本和文档中的源码引用。
- 通过 TypeScript AST 检查包导入、相对路径、重导出、动态导入与类型导入，阻止客户端运行时代码引用服务端
  或数据库实现，并约束共享合同与业务核心的依赖方向。
- 服务端合同检查仅访问共享 JSON；默认完整生成继续覆盖 Android 模型与资源。
- 分侧测试显式保留跨端集成场景在完整套件中，防止目录移动导致漏测；新增工具边界与生成范围回归。
- 完成各分区开发入口与 [目录设计](../architecture/server-client-layout.md)。本次没有修改业务规则、公开路由、
  合同字段或数据库迁移内容，已有 Agent 适配仅随目录迁移，后续 Agent 工作仍由 Losna 接续。

## 验证结果

| 验证 | 结果 |
| --- | --- |
| `pnpm install --frozen-lockfile --ignore-scripts` | 通过；依赖解析及完整性记录未变，仅 workspace 路径调整 |
| `pnpm -r --if-present typecheck` | 全部通过 |
| `pnpm check:shared` | 生成物、类型与 41 项合同测试通过 |
| `pnpm check:server` | 生成物、边界与类型通过；普通测试 221 通过、86 项因未提供测试库跳过 |
| `pnpm test:server:offline` | 307/307 通过，无跳过，使用临时 PostgreSQL |
| `pnpm check:client` | 完整生成物、边界与类型通过；147/147 测试通过 |
| `pnpm test:full:offline` | 433/433 通过，无跳过，包含跨端集成场景 |
| `pnpm build:client` | Web 构建通过；仍有现有的大于 500 kB chunk 提示 |
| Android `:app:compileDebugKotlin :app:testDebugUnitTest --offline` | 编译与 70 项单测通过，16 个测试套件，无失败或跳过 |
| `git diff --check` | 通过 |

分侧套件都包含共享合同与工具测试，因此测试数不能相加作为完整套件总数。Android 验证使用本机 JDK 17
与 Gradle 8.13，没有执行 assemble 或 APK 打包，也没有新增设备 UI 验收。

## 运行与交付边界

这次完成源码组织及分侧开发验证，继续从完整单仓安装依赖；没有引入分仓发布或仅安装生产依赖的打包方案。
API 与 Web 原有的独立运行方式及 HTTP 交互保持不变。

仓库外的本地运维模板和部署脚本已同步新目录，并在未来部署前校验服务进程与静态资源路径。首次部署新布局时，
还需同步服务配置与外部 MCP 启动路径，并准备与旧布局匹配的回滚配置；只切换版本链接不足以完成跨布局回滚。
实际配置与操作说明仍留在仓库外运维目录，未同步或应用到线上。

本轮没有部署服务、修改生产数据、导入真实账单、构建 APK 或调用真实模型。
