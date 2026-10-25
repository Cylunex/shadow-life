# 共享合同

`contracts/` 是服务端与所有客户端的公共协议来源，包名保持 `@shadow/contracts`。
公开输入、结果、错误、能力登记和传输映射只在 `contracts/src` 维护，不从服务端数据库或客户端界面反向生成。
合同包不得依赖 HTTP 服务框架、数据库实现或 Agent Runtime。

生成物包括 `contracts/generated` 下的能力、目录和 MCP JSON，以及 Android 的 Kotlin 合同模型与资源。
生成物不手工维护；修改源定义后从仓库根目录执行：

```bash
pnpm --filter @shadow/contracts generate
pnpm check:contracts
```

## 分范围生成与检查

```bash
pnpm --filter @shadow/contracts generate:shared
pnpm --filter @shadow/contracts check-generated:shared
pnpm check:shared
```

`generate:shared` 与 `check-generated:shared` 使用 `--scope shared`，只处理共享目录中的 JSON 快照，
不读取或写入 Android 生成文件。`check:shared` 还检查合同包的类型与测试；服务端范围检查也采用此生成器范围。
默认 `generate` / `check-generated` 使用完整范围，同时处理共享 JSON 和 Android 产物。

shared 范围让服务端日常检查聚焦自身依赖，但不证明客户端生成物或跨端调用兼容。公共合同变更应完整生成，
并执行 `pnpm check`、`pnpm test:full:offline` 以及适用的 Android Gradle 验证。

## 兼容原则

同一份合同必须同时服务已有 HTTP、Web、Android、CLI 与 MCP 调用。新增字段应明确缺省、未知值和历史数据
语义；新增默认值也可能改变命令规范化内容和幂等指纹，不能只以类型检查通过作为兼容证据。对旧请求、
错误结果、分页游标和可恢复回执保留适当回归。

共享代码不包含真实运行配置或领域数据库实现。仓库仍使用一份根 lockfile；目录分区与生成器范围不表示合同包
已成为独立发布或独立安装的仓库。完整边界与测试选择见[目录设计](../docs/architecture/server-client-layout.md)。
