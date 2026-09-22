# Agent usability delivery — 2026-09-22

## Evidence and scope

Reviewed the separate Life/Nexus usage conversation, the recent Hermes Life tool history, the local
personal-operator template, the repository MCP/CLI, public contracts and built-in Runtime dispatch.
Private conversation payloads, real service configuration, media paths and credentials are not included
in this repository. Changes address observed failed inputs, lost image evidence, incorrect consumption
assumptions, repeated discovery, stale Gateway catalogs and missing recovery paths.

## Delivered behavior

- The repository owns one MCP implementation. The operational Hermes/OpenClaw adapter template is now
  a launcher shim importing that implementation; connection settings stay outside source control.
- The personal profile exposes 86 supported capabilities, plus local image upload when configured and
  discoverable. This extends the former 65-capability profile with existing projects/actions, meal plans,
  shopping lists, budgets/recurring plans, food/recipe references, manual health plans, travel day plans,
  foreign entries, generated reviews and by-command receipt recovery. API permissions still trim the list.
  Device ingestion, void operations, membership management and processor administration remain outside
  this profile. An explicitly configured `authorized` profile retains full server-authorized access.
- Discovery fetches authorized schemas in one API response; old API compatibility limits fallback schema
  requests to four concurrent reads. Every new list refreshes discovery. Persistent Gateway cache refresh
  remains an operational step and is not misrepresented as automatic server-side refresh.
- Write schemas expose the exact command-key pattern, estimate evidence and source requirements. Tool
  descriptions distinguish actual intake from purchase/gift facts and route linked dining to the atomic
  operation. Source roles and the different meal versus purchase readback IDs are documented precisely.
- Tool execution failures expose structured error codes, fields and recovery instructions. Timeout or
  invalid write responses mean unknown outcome, not definite failure. No automatic retry changes keys,
  facts or revisions. Redirects are disabled and unreadable upstream response bodies are not echoed.
- `operations.find` exposes the existing permission-checked, subject-bound lookup by original command ID
  through the shared contract, CLI query transport, MCP and built-in Agent dispatch. Receipt queries no
  longer emit a new `operation.committed` event in the built-in Agent.
- Meal pagination passes the opaque cursor unchanged. Historical search can omit a keyword when both
  local date boundaries are supplied, preserving the existing limit, snapshot and permission checks.
- Image upload is shared, restricted to configured canonical cache roots, bounded to 20 MiB, and checks
  format and returned digest/size/MIME. Upload and association remain distinct. Linked dining can save
  all sources atomically and verify them through the returned consumption record.
- The packaged [Life operator skill](../../skills/life-operator/SKILL.md) and six contract-checked examples
  cover ordinary logging, unknown nutrition/time, gifts not consumed, separate purchases, receipt recovery,
  date-window search and daily checks. The broader guide covers corrections, weekly date coverage,
  rankings, inventory, plans and travel. The local umbrella skill preserves the stock workflow.

## Verification

- All 256 tests passed with zero skips in a disposable local PostgreSQL cluster. The new end-to-end
  journey uploaded two different originals through MCP, committed dining through the API/Executor,
  deliberately discarded the response after commit, recovered its receipt, replayed the same command,
  and verified exactly one meal/payment, linked originals, intake excluding a gift, exact date bounds
  and distinct successive meal pages. After moving that test into its owning MCP package, it passed again.
- Generated contracts, dependency boundaries, Android module boundaries and workspace TypeScript checks
  passed. The API/MCP typechecks were rerun after the test placement adjustment.
- Fifteen offline MCP checks cover protocol framing/stdio, negotiation, notifications, current/legacy
  discovery, parameter errors, conflicts/authorization, unknown results, cursor forwarding, image
  rejection and verified examples. The sixteenth MCP test is the PostgreSQL journey above.
- Both the packaged skill and the updated local umbrella skill pass the skill validator. The operational
  shim passes syntax checking and a real initialize/ping stdio smoke test against the local source.

## Release boundary

This delivery changes source and local operational templates only. No production business data, live
Gateway, cron task, notification destination or running Life service was changed. No paid model was
called, no notification sent and no APK built. Live adoption requires an explicitly requested deployment
of matching API/MCP source, skill refresh, Gateway reconnect/catalog verification and authorized checks
through the scheduler's real execution path. See [integration](../agents/integration.md).
