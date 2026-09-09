# Health / Ledger migration inventory

The PostgreSQL exporter discovers the live catalog inside one `REPEATABLE READ READ ONLY` transaction. Every discovered table and column is written to the snapshot manifest. Tables or columns added by a legacy release therefore remain visible to the mapper instead of being silently skipped.

Health facts mapped to native facts are body metrics, daily activity, sleep, foods, recipes, diet logs/photos, templates, fitness/lab records, workout plans/logs, habits/logs, goals, preferences, monitors, raw revisions and sync cursors. Reviews, achievements, release logs, prior tasks and non-secret Agent audit records are retained as subject-visible archive records when no active native behavior depends on them.

Ledger facts mapped to native facts are record states, money entries/categories, merchants/items and aliases, consumption events/lines, capture sources and bindings, recurring commitments, spending intents, budgets, use cycles, forecasts, feedback and external references. Completed jobs, old audit/catalog snapshots and resolved import review items are retained as archive records. In-flight outbox/background work is reconciled and then cancelled or recreated; it is never replayed as an unchecked new side effect.

## Field disposition matrix

Every discovered source column remains in the snapshot manifest. A production mapper must assign one of the dispositions below before validation accepts the bundle; the rows summarize the reviewed `800af69` Health and `2465b89` Ledger models.

| Legacy source group | Native target and required fields | Disposition | Acceptance evidence |
|---|---|---|---|
| Health diet log / food / photo | `meals` date/time/type; `intake_items` name, amount, nutrition, estimate/provenance; `sources` and immutable asset version | Native facts | Item count, nutrition snapshot, grouping origin and asset hash match |
| Health measurement / sleep / activity / workout / habit | `health_raw_records` + revision payload; typed projection; daily summary | Native raw plus rebuildable projection | Raw version/state and typed values match; normalization queue completed |
| Health templates / plans / goals / monitors | Corresponding active Life command model | Blocked until SL-05 where no native behavior exists | Active state remains operable; archive text alone is rejected |
| Health audit / release / completed task | `library_items` with source identity | Historical archive | Searchable item and source revision preserved |
| Ledger entry / refund / category | `consumption_records`, `money_entries`, `refunds` | Native facts | Per-currency amount/scale/state and original-refund relationship match |
| Ledger purchase / item / merchant alias | `consumption_records`, `purchases`, `purchase_items`, personal aliases and optional MoneyEntry | Native facts | Price-known state, lines, merchant text, payment method and links match |
| Ledger budget / recurring item | `budgets`, `recurring_plans` | Native facts | Period/cadence/state/revision and nullable amount match |
| Ledger intent / use cycle / feedback | Active Life application model | Blocked until SL-05 contracts and reads exist | Existing actions and feedback remain executable |
| Ledger completed job / catalog snapshot | Revisioned library archive | Historical archive | Content hash and source identity match |
| Sessions, password/token/cookie/key fields | None | Explicitly excluded | Exporter refuses secret-bearing included columns |

The checked-in synthetic bundle only exercises exact-scale money and a legacy meal bucket. It is not evidence that every row above has a production mapper.

`local_identities`, `browser_sessions`, and `oidc_transactions` are excluded because sessions and login transactions must be re-established through the Life identity provider. The exporter also refuses any included table with a password, token, cookie, client secret, private key, DSN or authorization column.

Run snapshots only into an isolated operations directory:

```bash
LEGACY_DATABASE_URL=... pnpm --filter @shadow/legacy-importer export:postgres health-prod /isolated/health-snapshot.json
pnpm migration validate fixtures/migration-bundle.json
DATABASE_URL=... pnpm migration apply fixtures/migration-bundle.json
DATABASE_URL=... pnpm migration reconcile fixtures/migration-bundle.json
DATABASE_URL=... pnpm migration cutover-check fixtures/migration-bundle.json
```

The checked-in bundle is synthetic. Production owner maps, exported rows, asset paths, counts and reports stay outside the repository.
