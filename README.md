# Shadow Life

Shadow Life is the personal Shadow product for recording and understanding daily life. The native kernel owns meals,
purchases, money and refunds, budgets and recurring plans, health measurements, trips and visits, and a
revisioned library. HTTP, CLI, MCP, Web, Android and the optional Agent Runtime all use the same typed command
contracts and deterministic execution receipts.

The repository groups the API, worker and MCP tooling in [`server/`](server/README.md), applications and the CLI in
[`client/`](client/README.md), and public contracts in [`shared/`](shared/README.md). They share one pnpm workspace
and lockfile, with separate development and verification commands. Read [ARCHITECTURE.md](ARCHITECTURE.md),
[the layout guide](docs/architecture/server-client-layout.md) and [the rebuild status](docs/execution/rebuild-status.md)
before changing boundaries or extending scope.

Web Library accepts uploaded HTML snapshots with protected originals and searchable text. The assistant can
recover an existing run after a disconnect or refresh. See the [usage guide](docs/guides/web-snapshots-and-assistant-recovery.md).

Home strength training supports themed exercise menus, bodyweight/dumbbell filters and actual sets in Web and Android.
See the [workout menu guide](docs/guides/workout-menu.md).

Web includes food and item deadline filters, monthly budgets and recurring tasks, paged library search, and offline trip exports.
See [daily workspace changes](docs/execution/daily-workspaces-2026-10-22.md) and [related project references](docs/research/daily-workspaces-2026-10-22.md).

Travel shows reservations alongside each day's plan, including overnight stays, checkout and arrival days, with explicit booking states.
See [reservation views and offline itinerary](docs/execution/travel-reservations-2026-10-28.md).

Health and food workspaces include a shared 7/30/90-day nutrition, weight, sleep and training review, also available to agents.
See [health and nutrition integration](docs/research/health-nutrition-agent-2026-10-23.md) for references and scope.

Recurring statement imports preserve platform/account identity, source evidence and refund facts, with paged import history and complete monthly reconciliation counts.
See [the import API guide](docs/guides/recurring-bill-imports.md) and [reference projects](docs/research/data-import-references-2026-10-25.md).

## Development

Use Node 24 and pnpm 11. Install once from the repository root:

```bash
pnpm setup
```

Run the API and Web development servers in separate terminals; start the worker when background jobs are needed:

```bash
pnpm dev:server
pnpm dev:client
pnpm dev:worker
```

The API and worker require local PostgreSQL and runtime configuration; the accepted settings are documented in
[the configuration example](.env.example). Keep actual configuration and secrets outside tracked files. The API
does not embed or serve the Web application. Android has its own Gradle workflow in [the Android guide](client/android/README.md).

| Work | Root commands |
| --- | --- |
| Server, including MCP | `pnpm check:server`, `pnpm test:server:offline` |
| Web and CLI | `pnpm check:client`, `pnpm test:client`, `pnpm build:client` |
| Shared contracts | `pnpm check:shared` |
| Cross-side changes | `pnpm check`, `pnpm test:full:offline` |

The offline database suites use a disposable local PostgreSQL instance and synthetic data. Scope checks help daily
development; shared-contract or cross-client changes still require full validation. `build:client` builds Web;
Android compilation remains a separate Gradle task.

## Documentation

- [Server entry points](server/README.md), [client entry points](client/README.md) and [shared-contract workflow](shared/README.md).
- [Architecture and boundaries](ARCHITECTURE.md), [directory layout and verification scope](docs/architecture/server-client-layout.md), and [delivery status](docs/execution/rebuild-status.md).
- Existing [Agent and MCP integration](docs/agents/integration.md), [Life operator skill](skills/life-operator/SKILL.md), and [Runtime/Host trust boundary](docs/decisions/0002-agent-event-trust-boundary.md).
- [Legacy migration plan](docs/migration/legacy-project-migration-plan.md), [Health/Ledger inventory](docs/migration/health-ledger-inventory.md), and [cutover runbook](docs/migration/cutover-runbook.md).

No development command deploys, reaches production, calls a paid model or builds a signed Android package.
