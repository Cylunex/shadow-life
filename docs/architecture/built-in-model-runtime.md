# 内置模型 Runtime

API 可选择外部 NDJSON Runtime 或内置 Chat Completions 适配器。后者只调用模型、维护单次
运行的工具对话，不直接连接数据库或执行业务；Host 的身份、effects、参数校验、命令幂等、
Executor 回执和事件持久化继续生效。模型没有生成 `operation.committed` 的通道。

启动配置见 `.env.example`。模型地址要求 HTTPS，回环开发地址可用 HTTP；禁止带凭据重定向。
不自动重试模型请求或业务写入。供应方错误正文不透传至用户，以免带出凭据或内部信息。
供应方应支持标准 `tools`、`tool_calls`、`tool` 消息和非流式响应；可选思考字段只在显式配置时发送。
工具轮次保留供应方的 reasoning/encrypted 字段，但不把思考内容输出给用户。

初始开放发现工具、获准的上下文和资料读取，以及用户本轮明确点名且获准的合同能力。
`agent.discover` 返回工具后，根据当前合同
生成模型 Schema，并与本次 Host capability profile 取交集；工具名用 `life_` 前缀和 `__`
编码点号。禁止调用未发现或未获准的工具。资料和工具结果被标为数据，不能改变系统授权。
模型默认请求串行工具；即使供应方返回多个调用，也逐一等待 Host 的真实结果再继续。
重复调用 ID、跨会话回传、空答案、截断答案和无效 JSON 都会中断，不伪装完成。

每次运行最多 20 次工具调用、96 个已发现工具；最多同时保留 32 个模型会话。
会话 120 秒到期，单次模型请求最长 60 秒，消息上下文和响应各有 2 MB 上限。
内置模型对话保存在进程内；重启后不声称自动继续模型推理。已保存的 Host 事件与回执仍可
由原运行恢复接口读取，客户端不得重发原用户请求来模拟恢复。

单元测试用受控供应方验证发现、权限、续接匹配、串行工具、重复 ID、中断、响应限制与脱敏。
API 集成测试在临时 PostgreSQL 上验证真实 Executor 写入和 Host 回执。常规测试不访问模型。
只有用户明确允许模型调用时，才运行 `pnpm eval:agent:model --allow-model`：可用原有
`SHADOW_EVAL_RUNTIME_URL` / `SHADOW_EVAL_MODEL`，或指定秘密 JSON 文件
`SHADOW_EVAL_MODEL_CONFIG_FILE`（字段 `url`、`apiKey`、`model`，可选 `thinking`）。
测试数据全部位于自动销毁的临时数据库；`SHADOW_EVAL_REPORT` 写入脱敏验收结果。
少量真实样本仅证明该次连通性、查询与保存，不代表所有自然语言任务的成功率。
