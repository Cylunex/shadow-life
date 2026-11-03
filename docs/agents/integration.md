# Life skill 与 Agent 接入

Life 的 Agent 能力统一由 [life-operator skill](../../skills/life-operator/SKILL.md) 提供，
以 CLI 通过 HTTP 调用共同合同和 Executor。新接入不需要 MCP 服务或 MCP 配置。
HTTP 客户端、图片上传、权限范围与错误恢复实现位于 `shared/life-client`，
CLI 入口位于 `client/cli/src/skill.ts`。两者不直连数据库或导入业务实现。

## 配置与运行

安装仓库依赖后，将 [配置示例](../../client/cli/config/skill.example.json) 复制到仓库外的运维 secrets
目录，填写实际值并设置 0600 权限；父目录使用 0700。秘密不得进入 Git 或命令参数。
`api` 为 Life API 地址；身份使用 `token`，或既有代理模式的 `proxySecret` 与可选 `proxyClientId`。
`profile` 默认为 `personal`；`personal-money-void` 显式增加作废账目能力；`authorized` 保留服务端授权范围。
可选 `scenario` 进一步收窄任务范围，调用输入不能扩大固定范围。`mediaRoots` 为允许上传原件的绝对目录，
`timeoutMs` 为 1–120000 毫秒。

```sh
skills/life-operator/scripts/life --config /REPLACE_PRIVATE_CONFIG.json catalog
skills/life-operator/scripts/life --config /REPLACE_PRIVATE_CONFIG.json call agent.discover /REPLACE_DISCOVERY_INPUT.json
skills/life-operator/scripts/life --config /REPLACE_PRIVATE_CONFIG.json call life.link_meal_consumption /REPLACE_COMMAND.json
```

省略输入文件时从 stdin 读取单个 JSON。只读能力接收普通输入对象，写入接收
`{"command_id":"cmd_REPLACE_INTENT","input":{...}}`。`catalog` 返回受权限过滤的 schemas；
先按业务词发现能力再构造参数。所有输出为单个 JSON，错误含 `isError: true`；退出码不能替代业务回执。

图片与账单原件通过 `assets.upload_local_image` / `assets.upload_local_file` 交付，输入为
`{"path":"/REPLACE_MEDIA_CACHE/original.png"}`。只有上传回执中的不可变 `asset_version_id`
能用于来源关联；OCR、备注和路径本身不等于附件已挂到记录上。

## 消费与饮食关联

- 新记录同时包含实际用餐、购买、付款、原图时，优先 `life.record_dining` 原子提交。
- 既有餐次与消费用 `life.link_meal_consumption`；输入为 `meal_id`、`consumption_record_id`
  及 `evidence`（用户明确确认用 `user_confirmed`；已有原件证据用 `shared_source`）。
- 先读取消费对象，取得 `record_id`。`purchase_id` 和 `money_entry_id` 不能冒充消费记录 ID。
- 关联后用 `life.get_record` 读取该消费记录，确认 `meals` 包含目标餐次。
- 已有餐次原图用 `life.attach_meal_source` 和当前 `expected_meal_revision`。
- 购买不自动证明吃过；备注、对象引用或任务检查点不能替代正式关系。

## 回执与恢复

每项意图保留一个稳定 `cmd_`。未知结果先用 `operations.find` 查询原命令；必要重试保留
同一键及完全相同输入。修订冲突先读当前记录，不盲目改版本或换键。
普通记录和更正直接执行；付款、外发、权限变更等高影响行为沿用执行点授权。
复杂关联、更正和附件必须回读；只有 committed 回执才能证明业务写入成功。

任务、意图、变化订阅与跨 Agent 交接仍使用共同能力，见
[个人 Agent 数据底座](../architecture/personal-agent-foundation.md)、
[任务上下文](../architecture/agent-task-context.md) 和 skill 的
[工作流](../../skills/life-operator/references/workflows.md)。
健康饮食复盘、训练、统计和账单导入均通过同一 CLI 调用已发现的能力。

## Losna 与旧配置迁移

Losna 的 Life 接入默认 `transport: "skill"`，`command` 指向本 skill 的 `scripts/life`，
`args` 只提供 `--config` 与私有配置路径，`skillFile` 指向本 skill 的 `SKILL.md`。
工作上下文加载 skill 指令，执行仍穿过 Losna Broker 的授权、稳定键和回读边界。
使用前复核服务端与本地合同版本，并以只读 doctor 验证发现及读取。

旧 MCP 仅保留显式 `transport: "mcp"` 的兼容入口，详见
[历史配置参考](mcp-legacy.md)。不再作为新接入默认值。既有生产启动器切换属于明确部署任务，
本次代码修改不自动部署、改线上配置或停用既有进程。
