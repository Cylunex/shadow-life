# Agent integration

Life's API, CLI, built-in Agent and MCP share the public contracts and the same domain Executor.
Use the repository MCP for Hermes, OpenClaw and other MCP clients; keep environment-specific launchers
outside the repository. The personal workflow skill is [life-operator](../../skills/life-operator/SKILL.md).

## Start the MCP

From the Life repository, with Node 24+ and workspace dependencies installed:

```sh
SHADOW_API_URL=https://life.example.com \
SHADOW_ACCESS_TOKEN=REPLACE_ACCESS_TOKEN \
node --import tsx apps/mcp/src/main.ts
```

Pass these as environment settings in the MCP client's process configuration, using the absolute path
to `apps/mcp/src/main.ts` and the repository's `tsx` loader if the client uses a different working directory.
Stdout is JSON-RPC only. No development auth, production URL or credential is embedded in the adapter.

| Setting | Behavior |
|---|---|
| `SHADOW_API_URL` | Life API base URL; development default is loopback |
| `SHADOW_ACCESS_TOKEN` | Existing Life access token; API owns subject/effect checks |
| `SHADOW_PROXY_AUTH_SECRET` | Alternative for an already configured trusted local proxy deployment; never distribute to ordinary clients |
| `SHADOW_MCP_PROFILE` | `personal` by default; `personal-money-void` adds only `money.void_entry` for a specifically configured personal client; `authorized` exposes the server-visible full catalog for explicitly configured operator clients |
| `SHADOW_MEDIA_ROOTS` | Optional absolute media-cache roots, separated by the platform path delimiter; omitted means no local image tool |
| `SHADOW_MCP_TIMEOUT_MS` | Per-request deadline, default 30000 ms, maximum 120000 ms |

If both authentication variables are present, Bearer takes precedence. Requests never follow redirects
with credentials. The personal profile permits ordinary personal writes/reads, including plans, shopping,
food references, manual health plans and travel day planning. The default profile excludes void operations; `personal-money-void` permits only money-entry voids, not other void operations, device ingestion,
membership changes, processor administration and external delivery controls. Existing domain permissions
still apply to every call; adding a tool to this profile does not grant API authority.

Local image uploads preserve original bytes, check the canonical path against configured roots, reject
non-regular/oversized files, detect supported raster formats, and verify the returned digest, size and
MIME. Assets use the existing content-addressed API; upload is separate from linking to a business record.

## Discovery and recovery

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
launcher import `apps/mcp/src/main.ts`, and install/update the packaged workflow skill. Refresh/reconnect
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
