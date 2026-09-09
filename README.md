# Shadow Life

Shadow Life is the clean, agent-native rebuild of the personal Shadow product. The native kernel owns meals,
purchases, money and refunds, budgets and recurring plans, health measurements, trips and visits, and a
revisioned library. HTTP, CLI, MCP, Web, Android and the optional Agent Runtime all use the same typed command
contracts and deterministic execution receipts.

Read [ARCHITECTURE.md](ARCHITECTURE.md) and [the rebuild status](docs/execution/rebuild-status.md) before
changing boundaries or extending scope.

## Development

Use Node 24 and pnpm 11. PostgreSQL is required for the integration journey.

```bash
pnpm setup
pnpm check
TEST_DATABASE_URL=postgresql://localhost/shadow_life_test pnpm test:journey -- meal
DATABASE_URL=postgresql://localhost/shadow_life pnpm db:migrate
DATABASE_URL=postgresql://localhost/shadow_life SHADOW_DEV_AUTH=true pnpm dev
```

`SHADOW_RUNTIME_URL` enables the NDJSON Runtime Adapter; without it the assistant returns an explicit unavailable event.
The Runtime/Host trust split and resumable run states are defined in
[ADR 0002](docs/decisions/0002-agent-event-trust-boundary.md).
Run `SHADOW_ACCESS_TOKEN=... pnpm mcp` to expose the same write capabilities to an MCP client.
Production startup requires the OIDC verification and browser PKCE settings shown in `.env.example`; Web uses a protected same-origin session cookie and does not ask the user to paste a token.
Migration tooling and the cutover sequence are documented in [docs/migration/health-ledger-inventory.md](docs/migration/health-ledger-inventory.md)
and [docs/migration/cutover-runbook.md](docs/migration/cutover-runbook.md).
No development command deploys, reaches production, calls a paid model or builds a signed Android package.
