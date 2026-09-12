# Health / Ledger migration inventory

The PostgreSQL exporter discovers the live catalog inside one `REPEATABLE READ READ ONLY` transaction. Every discovered table and column, its PostgreSQL type, nullability and primary-key position is written to the snapshot. Values are converted recursively to deterministic JSON (including instants, bigint values and bytes), rows are canonically sorted, and each table, catalog and full snapshot receives a content identity. Tables or columns added by a legacy release therefore remain visible to the mapper instead of being silently skipped.

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
LEGACY_DATABASE_URL=... pnpm --filter @shadow/legacy-importer export:postgres health-prod /isolated/health-snapshot.json health,public
pnpm migration:mapping inspect /isolated/health-snapshot.json /isolated/health-snapshot-inspection.json
pnpm migration:mapping skeleton /isolated/health-snapshot.json /isolated/health-mapping-review.json health-800af69-v1
pnpm migration:mapping audit /isolated/health-snapshot.json /isolated/health-mapping-review.json /isolated/health-mapping-audit.json
pnpm migration validate fixtures/migration-bundle.json
DATABASE_URL=... pnpm migration apply fixtures/migration-bundle.json
DATABASE_URL=... pnpm migration reconcile fixtures/migration-bundle.json
DATABASE_URL=... pnpm migration cutover-check fixtures/migration-bundle.json
```

The optional exporter schema argument is a comma-separated allowlist. Health must include `health`; using the old default-only invocation would inspect only `public` and could omit every Health business table. Including `public` as well keeps any public authentication/session catalog entries visible to the exclusion audit. Ledger, Travel and Archive currently use `public`. `mapping inspect` emits only catalog identities, hashes and counts—not row payloads—so it can be retained with the migration evidence.

The generated mapping skeleton is deliberately blocked. It becomes ready only when every included table and every discovered field has a native or historical-archive disposition, every mapped table names its reviewed mapper, and session/identity exclusions exactly match exporter exclusions. The audit is bound to the snapshot content ID and refuses missing, duplicate or invented tables/columns. This coverage gate does not prove that production rows reconcile; the mapped bundle still needs isolated apply, replay and target readback.

For an empty-database recovery exercise, set the explicit isolation guard and run the combined drill after applying the current schema migrations:

```bash
SHADOW_MIGRATION_DRILL=isolated-empty-database DATABASE_URL=... pnpm migration restore-drill /isolated/final-bundle.json /isolated/restore-report.json
```

The command refuses any database containing business facts, Operations or earlier migration batches. It requires the bundle's four-digit target schema to equal the database's latest migration, performs an initial apply, requires an exact replay on the second apply, and reconciles fresh target readback and verified files. It never changes write epochs or claims production cutover readiness.

The checked-in bundle is synthetic. Production owner maps, exported rows, asset paths, counts, mapping reviews and reports stay outside the repository.
