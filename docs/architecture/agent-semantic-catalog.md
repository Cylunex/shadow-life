# Agent 业务语义与能力目录

Life 已在自身 contracts、kernel、database、API 和 agent-adapter 中承接原 Platform/Nexus 的合同、身份、资产、命令执行、会话和上下文职责。本功能只使用 Life 的当前合同与 Executor，不引入旧服务依赖。

## 单一事实来源

- `shared/contracts/src/registry.ts` 是能力、输入、结果和效果的来源。
- `agent-catalog.ts` 声明业务术语、同义词、事实边界和六类场景；场景引用已有能力。
- `agent-profile.ts` 集中维护个人 MCP 范围，MCP 入口不复制白名单。
- 示例直接引用 `skills/life-operator/references/examples.json`，测试以实际合同验证。
- 合同生成同时输出 `generated/agent-catalog.json`；摘要包含术语、场景、示例及完整输入/结果 Schema。每次查询仍按当前权限投影，摘要不代表用户权限或生活事实的版本。

## 发现流程

`agent.discover` 根据中文术语、同义词、能力名称或描述匹配当前获准工具。默认每页十项，最多三十项，返回 `total`、`next_offset`、`truncated`。`include_schemas` 默认关闭，精确名称或场景可进一步缩小范围。它检索业务元数据，不检索数据库结构，也不执行自由 SQL。

`agent.glossary` 提供业务定义、边界和实体目录查询入口；个人别名仍由已有的 `life.set_personal_alias`、`life.food_catalog` 管理，不把用户事实编进静态合同。

`agent.scenarios` 提供日常记录、消费复盘、健康记录、旅行规划、资料与回忆、生活规划六个组合。场景和 `profile` 只缩小权限允许的集合，不授予权限。内置助手获得三项发现工具的 Schema 和共同指引，真实查询与写入仍由 Host 分发。

MCP 可配置 `SHADOW_MCP_SCENARIO=daily|spending|health|travel|library|planning`；未设置时保持完整个人配置。场景进程保留发现工具和回执恢复工具，并在工具列举、调用和元数据查询中使用同一范围。调用参数不能覆盖启动时配置。

## 调试与消费体验

Web 顶部“能力目录”展示获准工具、业务口径、虚构示例、输入/结果 Schema 和耗时。

- “仅校验参数”调用 kernel 的纯校验，不访问数据库、模型或命令执行器，不创建回执。它验证输入和普通写入的条件效果，不保证记录仍存在、版本未变化或写入一定成功。
- “执行查询”调用现有 typed HTTP transport；不会显示保存成功。
- “执行并保存”仅开放个人配置中已有的普通操作，复用 `CommandController` 的身份隔离、稳定命令键和未知结果恢复。管理、成员变更、投递、撤销等操作使用其专用入口。
- 消费详情可显式保存评分、复购意愿和感受。复用 `life.correct_purchase` 和当前聚合修订，保留商家、渠道、地点和日期，不新增金额事实；空评分和空意愿保持未知。

## 快照、差异与回退

`agent.catalog` 导出当前权限与可选场景下的完整公开目录，用于调试与离线比较，不应作为普通问答的默认上下文。导出不包含用户数据、真实运行地址或凭据。Web 可导出 JSON 并选择旧目录比较新增、删除、合同变化、术语变化和场景变化；文件仅在浏览器读取。

开发侧可执行：

```sh
pnpm --filter @shadow/contracts generate
pnpm catalog:diff previous-agent-catalog.json
pnpm check:contracts
```

不同权限或场景导出的目录也会产生差异，比较时应使用同一范围。目录与代码同一发布，修改源文件不会热改线上服务。历史版本由 Git 与已有发布流程保留；回退使用匹配的整个应用版本并重新验证合同，不单独加载旧 Schema 覆盖当前 Executor。快照比较不会触发部署。
