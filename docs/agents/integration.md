# Agent integration

Life's API, CLI, built-in Agent and MCP share the public contracts and the same domain Executor.
Use the repository MCP for Hermes, OpenClaw and other MCP clients; keep environment-specific launchers
outside the repository. The personal workflow skill is [life-operator](../../skills/life-operator/SKILL.md).
The MCP implementation lives in `server/mcp` as a server-side tool entry point. It calls Life's API over HTTP,
does not connect directly to the database or import other server business implementations, and does not perform
Agent orchestration. Web, Android and CLI remain under `client/`.

## Start the MCP

内置助手可直接接入支持 function calling 的 Chat Completions 模型。配置完整的
`SHADOW_MODEL_URL`（完整 `/chat/completions` 地址）、`SHADOW_MODEL_API_KEY`、
`SHADOW_MODEL_NAME`；按供应方支持情况选配 `SHADOW_MODEL_THINKING=disabled|enabled`。
真实值仅放本地或服务器秘密环境，不能进 Git 或客户端构建。
若配置 `SHADOW_RUNTIME_URL`，原有 NDJSON Runtime 优先；均未配置时明确显示不可用。
详见 [内置模型适配器](../architecture/built-in-model-runtime.md)。

From the Life repository, with Node 24+ and workspace dependencies installed:

```sh
SHADOW_API_URL=https://life.example.com \
SHADOW_ACCESS_TOKEN=REPLACE_ACCESS_TOKEN \
node --import tsx server/mcp/src/main.ts
```

Pass these as environment settings in the MCP client's process configuration, using the absolute path
to `server/mcp/src/main.ts` and the repository's `tsx` loader if the client uses a different working directory.
Stdout is JSON-RPC only. No development auth, production URL or credential is embedded in the adapter.

| Setting | Behavior |
|---|---|
| `SHADOW_API_URL` | Life API base URL; development default is loopback |
| `SHADOW_ACCESS_TOKEN` | Existing Life access token; API owns subject/effect checks |
| `SHADOW_PROXY_AUTH_SECRET` | Alternative for an already configured trusted local proxy deployment; never distribute to ordinary clients |
| `SHADOW_PROXY_CLIENT_ID` | Optional server-allowlisted runtime identity for existing trusted proxy authentication; Bearer identity remains token-owned |
| `SHADOW_MCP_PROFILE` | `personal` by default; `personal-money-void` adds only `money.void_entry` for a specifically configured personal client; `authorized` exposes the server-visible full catalog for explicitly configured operator clients |
| `SHADOW_MCP_TOOLSET` | `full` by default; `compact` exposes discovery, one read dispatcher, one write dispatcher and receipt recovery, plus the optional image tool. Profile/scenario and API permissions still apply |
| `SHADOW_MEDIA_ROOTS` | Optional absolute media-cache roots, separated by the platform path delimiter; omitted means no local image tool |
| `SHADOW_MCP_TIMEOUT_MS` | Per-request deadline, default 30000 ms, maximum 120000 ms |

If both authentication variables are present, Bearer takes precedence. Requests never follow redirects
with credentials. The personal profile permits ordinary personal writes/reads, including plans, shopping,
food references, manual health plans, travel day planning and statement import staging/review/decisions. The default profile excludes void operations; `personal-money-void` permits only money-entry voids, not other void operations, device ingestion,
membership changes, processor administration and external delivery controls. Existing domain permissions
still apply to every call; adding a tool to this profile does not grant API authority.

Local image uploads preserve original bytes, check the canonical path against configured roots, reject
non-regular/oversized files, detect supported raster formats, and verify the returned digest, size and
MIME. Assets use the existing content-addressed API; upload is separate from linking to a business record.

## Discovery and recovery

### 按需发现的精简工具入口

为没有自行延迟加载工具定义的 Agent/Gateway 设置 `SHADOW_MCP_TOOLSET=compact`。
默认 `full` 保留所有具名工具；能够自行检索并延迟加载工具的客户端也可继续使用 `full`。
启动参数改变后需要重新连接对应 MCP 进程。完整与精简模式不能在同一进程内由调用参数切换。

精简模式在完整个人权限下返回四个工具（权限不足时更少）：

| 工具 | 使用方式 |
| --- | --- |
| `agent.discover` | 先按任务/术语或 `names` 精确发现；`include_schemas: true` 读取本次需要的参数合同 |
| `life.query` | `{capability, input}`，只允许只读能力；包括只读 POST 和查询已有回执 |
| `life.command` | `{capability, command_id, input}`，只允许写能力，保留稳定命令键、版本和原始执行回执 |
| `operations.find` | `{command_id}`，直接恢复结果未知的原命令 |

例如先调用 `agent.discover`，参数为
`{"names":["health.workout_progression"],"include_schemas":true}`；
随后调用 `life.query`，参数为
`{"capability":"health.workout_progression","input":{}}`。
返回的 `input_schema` 描述内层 `input`，不要再套一层 command/input。
发现结果的 `mode` 决定调用查询还是写入入口；分页继续使用原筛选条件与 `next_offset`。
无需完整合同的搜索先省略 `include_schemas`，选中后再按精确名称读取。

领域工具名称在精简模式中作为 `capability` 参数，不直接调用。同一原则适用于查询结果的
`detail.capability/input`：逐字复制到 `life.query`，不改 ID，不猜详情类型。
配置媒体根目录并有对应能力时，`assets.upload_local_image` 仍直接调用；图片验证与关联流程不变。
写入超时返回的 `recovery.tool=operations.find` 可直接执行，不需再次发现，更不能自动换命令键。

MCP 的两种入口都使用 `LifeClient.call`、共同 typed HTTP transport 和原 Executor。
查询入口拒绝写能力，写入口拒绝查询；嵌套分发、未知名称、越过 profile/scenario 的请求在本地拒绝，
服务器继续校验每次实际调用。`life.command` 的风险注解按通用写入保守标注，不授予任何新权限。
普通领域内写入仍直接执行，不新增审核流程。启动列举只取权限过滤元数据，不下载完整 Schema 目录。

2026-10-22 的合成个人权限测量：具名工具 113 个、精简入口 4 个；`{tools}` 的 UTF-8 JSON
从 195,494 字节降至 3,785 字节（98.06%）。不含初始化指引、可选图片工具或后续发现结果，
不代表整个对话的 token、延迟或模型成功率提升。实际 Gateway 需独立验收。

训练查询已纳入个人配置，可用“哑铃”“徒手”“组数”“训练进度”发现计划、实际训练和进度工具。
训练菜单与实际完成组分开；时长进度规则不用于力量训练自动加重量/次数。

### 日常问题与参数纠正

可以直接用 `agent.discover` 检索“看看冰箱哪些东西快过期了”“哪些物品快过保了”
“这个月预算还剩多少”“哪些订阅要续费”；也支持 `show expiry food`、`list budget monthly` 等
英文短语。查看类表达优先排序对应读取工具，但不替用户执行或推断写入；明确写入仍用实际
Schema、命令键和当前修订。`read_only: true` 是需要严格只读目录时的显式筛选。

食品/物品期限以返回的日期、时区和 `attention` 为准。预算 `spent` 是支出原额，退款不冲减；
周期计划金额不是实际付款。所有截断、游标和未知日期保持原语义。

已识别能力的参数错误可能包含：

```json
{"recovery":{"action":"correct_input","schema_lookup":{"tool":"agent.discover","arguments":{"names":["money.set_budget"],"include_schemas":true}}}}
```

按 `schema_lookup` 读取当前合同，再只改错误字段。它是帮助恢复的提示，不是已经重试或保存成功；
full 与 compact 都可直接调用 `agent.discover`。结果未知仍先查原命令回执，冲突仍先读取当前记录。

### 共同发现与恢复语义

Use `agent.discover` for authorized task/term matching, `agent.glossary` for business meanings and
`agent.scenarios` for six task bundles. `agent.catalog` exports the complete authorized contract snapshot
for debugging/comparison. Schemas are omitted by default in discovery; set `include_schemas: true` when
constructing an input. Follow `next_offset` until it is null. `total`/`truncated` describe catalog matches,
never a count of saved life facts.

Optional `SHADOW_MCP_SCENARIO` narrows the process to `daily`, `spending`, `health`, `travel`, `library`
or `planning`. Receipt lookup and discovery remain available. Scenario and profile settings do not grant
API effects; discovery input cannot override the configured MCP scope. Refresh/reconnect persistent
gateways after installing this revision. Web has the same catalog and a parameter-validation/execution
panel. See [semantic catalog](../architecture/agent-semantic-catalog.md) for snapshots and debugging.

`GET /api/capabilities?include_schemas=true` returns authorized schemas in one request. The default
catalog stays compact. Older APIs remain usable via schema discovery with at most four concurrent reads.
MCP refreshes on each `tools/list`; it does not advertise live catalog-change notifications. A persistent
Gateway holding an old catalog still needs a client refresh or reconnect after an update.

The actual `command_id` pattern and source/estimate requirements are in the tool schema. Execution
failures return `isError: true` with structured code, fields and recovery instructions. Malformed
JSON-RPC, unknown tools and unsupported methods use protocol errors. This follows the
[MCP tool error contract](https://modelcontextprotocol.io/specification/2025-06-18/server/tools#error-handling).
Ping and protocol-version negotiation are supported; notifications do not receive replies.

`operations.find` uses the existing subject-bound by-command lookup through MCP, CLI and built-in
Agent dispatch. After a timeout, the client never automatically changes the command key or assumes the
write failed. Reading an earlier receipt is a query event, not a new committed-write event.

`life.list_meals` preserves opaque cursors end to end. `life.search` accepts an omitted search string
when both date boundaries are present, allowing exact historical windows without guessing a keyword.
Every page remains permission-filtered, bounded and bound to its query snapshot.

## Verification and rollout

个人 Agent 的目标、规划材料与跨会话恢复使用新增 foundation 工具；完整语义见
[数据底座](../architecture/personal-agent-foundation.md)。HTTP 读取统一为
`POST /api/agent/foundation/{intentions,workspace,objects,tasks,learning,changes,export}`，
写入仍为 `/api/commands/<capability>`。CLI 和 MCP 直接使用合同名称。

先读 `agent.workspace` 的场景、日期与时区，分清事实、计划、明确意图和观察。
材料不完整时沿专用查询继续，不能把缺失当作零；常规保存直接调用现有领域命令。
明确偏好使用 `agent.set_intention`，带 scope 和有效期；模型观察使用 `agent.save_learning`，
附真实依据、环境、工作流版本和限制。`agent.objects` 以返回的引用展开当前关系和来源。

跨 Agent 继续时先读 `agent.tasks`，用当前 revision 保存检查点；需要领取时请求短期租约并保留
服务端 token。超时查询原命令回执。变化轮询先 `agent.set_subscription`，调用 `agent.changes`，
完成处理后通过 `agent.ack_changes` 的 expected_cursor/cursor 确认；消费者互不占用进度。
轮询不会自动发送消息；invalidated_refs 要重新查询。首次接入先读当前数据，日志不回填既往事件。

任务读取的 lease 返回持有客户端、expires_at 和 active，token 只向同一可信客户端返回。
新会话应读取当前任务和租约；其他客户端需等到期或由持有者释放，再用当前修订领取。
代理部署设置服务端 `SHADOW_PROXY_CLIENT_IDS` 后，分别在运行时 MCP 启动配置设置
`SHADOW_PROXY_CLIENT_ID`；网页 Nginx 清除 `X-Shadow-Proxy-Client-Id`，避免外部标头伪造来源。

`agent.export` 用 next_offset 连续读取，检查 total_is_exact、has_more 和截断；原件另行下载。
`agent.restore` 校验后创建新副本，不能直接覆盖旧数据或复制执行租约。
隔离新增验收使用 `pnpm test:foundation:offline`，完整验收使用 `pnpm test:full:offline`。

```sh
pnpm check
pnpm --filter @shadow/mcp test
# Set TEST_DATABASE_URL only to a disposable local test database before full database tests.
pnpm test:full
```

The tests include actual stdio framing, legacy/new discovery, validation errors observed in usage,
unknown outcomes, conflicts, subject-bound receipt recovery, opaque cursors, image evidence, and
contract validation of the shipped examples. They do not call paid models or send notifications.

When deployment is explicitly requested, deploy the matching API/MCP revision, make the environment's
launcher import `server/mcp/src/main.ts`, and install/update the packaged workflow skill. Refresh/reconnect
each persistent Gateway and verify its own `tools/list` contains `life.daily_record_check`,
`operations.find` and the expected profile. Merely launching a fresh one-shot MCP process does not
prove the Gateway's cached catalog changed. Verify scheduled tasks through the scheduler's real execution
path only when the user has authorized that run and any external notification; a manual/direct run is
not equivalent evidence. No source check claims live Gateway or scheduler acceptance.

## 按任务读取上下文与打开来源

使用只读 `agent.context` 查询明确场景、日期、查询词或稳定来源。示例：

```json
{
  "scenario": "daily",
  "query": "米饭",
  "from_on": "2026-09-10",
  "to_on_exclusive": "2026-09-11",
  "time_zone": "Asia/Shanghai",
  "response_format": "concise"
}
```

这是字面查询词，Agent 应先把历史问题转成准确日期和领域条件。日期需两个端点，结束日不含；
未知营养、睡眠、金额和时刻保留未知。不能把购买说成进餐，不能跨币种相加。
HTTP 使用 `POST /api/agent/context`；CLI 继续使用共同 typed transport：

```sh
pnpm --filter @shadow/cli start query agent.context context-query.json
```

调用 MCP `agent.context` 直接提交上述对象，不包 command_id/input。固定 profile/scenario 由
MCP 进程覆盖，不能靠调用参数扩大。返回记录的 ref 包含当前修订；Library 可以指定不可变
历史修订。详细正文用返回的 detail.capability/input 读取。

默认最多 20 条，concise 不返回长正文；detailed 增加有界摘录和领域事实。
若 truncation.truncated=true，用原参数及 continuation.next_offset 继续，或缩小日期/查询范围。
每页重新读取当前事实，并发更正后可以重新查并按 ref 去重；列表长度不是业务总数。
用户正常使用助手无需选择技术预算或复制 ID。

Web 助手的“依据记录”展示“本次查询的来源”，由 Host 结果产生，模型文字不能制造来源。
点击可打开既有详情；Library 历史正文保留指定修订。变更/不可见来源会提示重新查询。
来源与“已保存”是不同语义，写入保存仍只认 Executor 回执。

本机离线验收（需 Node 24、pnpm 11、本机 initdb/pg_ctl，命令自动销毁合成数据库）：

```sh
pnpm eval:agent:offline --baseline
pnpm eval:agent:offline
pnpm test:full:offline
```

设置 SHADOW_EVAL_REPORT 可写出 JSON 报告；设置 SHADOW_TEST_PG_BIN 可指定本机 PostgreSQL
工具目录。未授权真实模型调用时只运行 offline；`eval:agent:model --allow-model` 需要另行设置
SHADOW_EVAL_MODEL、SHADOW_EVAL_RUNTIME_URL（可选 SHADOW_EVAL_RUNTIME_TOKEN），结果不能当作
生产验收或全量真实模型成功率。详细边界见 [设计说明](../architecture/agent-task-context.md)。

## 健康与饮食复盘

用 `agent.discover` 搜索“饮食复盘”并请求 schema；`life.wellness_review` 输入为
`{"to":"2026-10-23","days":7}`（days 支持 7/30/90），返回同一快照的当前期、等长前期和逐日依据。
完整/精简 MCP、CLI 和内置 Agent 共用该能力，需要饮食和健康两项读取权限。
请先报告字段覆盖和估算数量，再比较均值；结合 intentions、库存和实际训练制定明确要求的计划。
详见 [工作流](../../skills/life-operator/references/workflows.md#health-and-nutrition-review--grounded-planning)
与 [调研和取舍](../research/health-nutrition-agent-2026-10-23.md)。
