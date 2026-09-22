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
| `SHADOW_MCP_PROFILE` | `personal` by default; `authorized` exposes the server-visible full catalog for explicitly configured operator clients |
| `SHADOW_MEDIA_ROOTS` | Optional absolute media-cache roots, separated by the platform path delimiter; omitted means no local image tool |
| `SHADOW_MCP_TIMEOUT_MS` | Per-request deadline, default 30000 ms, maximum 120000 ms |

If both authentication variables are present, Bearer takes precedence. Requests never follow redirects
with credentials. The personal profile permits ordinary personal writes/reads, including plans, shopping,
food references, manual health plans and travel day planning. It excludes void operations, device ingestion,
membership changes, processor administration and external delivery controls. Existing domain permissions
still apply to every call; adding a tool to this profile does not grant API authority.

Local image uploads preserve original bytes, check the canonical path against configured roots, reject
non-regular/oversized files, detect supported raster formats, and verify the returned digest, size and
MIME. Assets use the existing content-addressed API; upload is separate from linking to a business record.

## Discovery and recovery

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
