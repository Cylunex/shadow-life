# Shadow Life architecture

Shadow Life is a new product kernel. It does not import or proxy the legacy Shadow services at runtime.

The dependency direction is fixed:

```text
contracts <- kernel <- database <- api / worker
                    <- agent-adapter
contracts <- cli / web
```

`contracts` owns public input, result, error and capability schemas. `kernel` owns authorization effects,
idempotency and workflows through ports. `database` implements those ports with PostgreSQL and Drizzle.
Transport packages construct trusted request context and call the kernel Executor. They never implement a
second write path.

Every write capability follows the same transaction protocol. Meals, purchases, refunds, budgets, health,
travel and library facts commit with an Operation receipt and Outbox event. Missing payment does not block a
meal. A purchase or receipt alone never proves that a meal occurred. Corrections require an expected revision
and preserve the prior snapshot.

Ordinary money writes use CNY with two decimal places. Explicit foreign-entry writes and historical imports
retain NUMERIC(24,6), source scale and ISO currency; conversions and allocations are separate relationships.
Generic correction cannot change amount or currency while those relationships exist. Every summary groups by
currency without converting through JavaScript numbers. Date-only legacy facts remain date-only; the importer never manufactures midnight timestamps.

Development authentication is deliberately explicit: `dev:` bearer tokens are accepted only when
`SHADOW_DEV_AUTH=true`, and production startup rejects that setting. Production verifies issuer, audience,
signature and expiry through OIDC JWKS, derives subject/client/effects from claims, and applies a server-owned
Health/Ledger write epoch. Request bodies never choose their owner or permissions.
