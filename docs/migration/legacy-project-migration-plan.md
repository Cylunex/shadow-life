# Legacy project migration plan

Shadow Life must import old data as a one-time, independently verified operation. It must not call old services at runtime and must not copy login sessions, tokens, queued side effects or machine credentials.

## Current readiness

| Source | Catalog location | Native destination | Current gate |
|---|---|---|---|
| Shadow Health | `health` plus audited `public` | raw health revisions, typed projections, meals, plans and searchable historical records | Snapshot path is ready; production table-to-bundle mapper and real-data reconciliation are still required |
| Shadow Ledger | `public` | consumption facts, money/refunds, purchases, plans and searchable historical records | Snapshot path is ready; production table-to-bundle mapper and real-data reconciliation are still required |
| Shadow Travel | `public` | trips, maps, places, visits, routes, media references and portable history | Catalog can be snapshotted, but the current importer has no native Travel target writer; do not cut over Travel yet |
| Shadow Archive | `public` | revisioned Library items, protected assets, tags, annotations and relations | Catalog can be snapshotted; the current `archive` target preserves basic searchable content only, so rich relations/assets need a mapper before cutover |

The importer currently writes `money_entry`, `meal`, `health_raw` and basic `archive` targets. That is enough to exercise safety, idempotency, replay and reconciliation, but it is not a complete production mapper for all four old projects. A successful synthetic fixture must never be presented as proof that real legacy data is ready.

## Safe execution sequence

1. Back up every source and restore each backup into an isolated database. Do not export from the only production copy.
2. Produce immutable, read-only snapshots. Health must include `health,public`; the other three projects use `public`. Keep snapshots and asset files in the ignored operations area, never in Git.
3. Run `mapping inspect`, then generate a mapping skeleton. Resolve every table and column as native, historical archive or explicitly excluded. `blocked_tables` must reach zero and `ready` must be true.
4. Build source-specific bundles. Preserve source instance, schema-qualified table, primary key, owner, revision, timestamps, time zone, decimal scale, source links and file hashes. Map every old owner to a verified Life subject; never infer owners from display names.
5. Restore a fresh empty Life database, migrate it to the bundle's exact schema and run `restore-drill`. Require first apply, idempotent replay and target readback reconciliation to all succeed.
6. Compare business invariants in addition to row counts: per-owner/per-currency Ledger totals and refunds; Health raw revisions, daily projections and meal nutrition; Travel trip/member/place/visit graphs; Archive revision, tag, relation and asset hashes.
7. During final cutover, fence both old and Life writers, drain or quarantine offline queues, take a final snapshot, apply only the final delta and run `cutover-check`. Open Life writes only after the report is ready.
8. Keep old databases read-only through the observation and restore window. After Life accepts new writes, repair forward; never reopen two writers.

## Snapshot commands

```bash
# Health business tables are not in public.
LEGACY_RUNTIME_EXCLUDED_TABLES=health.sync_cursors LEGACY_DATABASE_URL=... pnpm --filter @shadow/legacy-importer export:postgres health-prod /isolated/health.json health,public

# Ledger / Travel / Archive currently use public.
LEGACY_DATABASE_URL=... pnpm --filter @shadow/legacy-importer export:postgres ledger-prod /isolated/ledger.json public
LEGACY_DATABASE_URL=... pnpm --filter @shadow/legacy-importer export:postgres travel-prod /isolated/travel.json public
LEGACY_DATABASE_URL=... pnpm --filter @shadow/legacy-importer export:postgres archive-prod /isolated/archive.json public

pnpm migration:mapping inspect /isolated/health.json /isolated/health-inspection.json
pnpm migration:mapping skeleton /isolated/health.json /isolated/health-review.json health-v1
pnpm migration:mapping audit /isolated/health.json /isolated/health-review.json /isolated/health-audit.json
```

Repeat inspection, skeleton and audit for every source snapshot. The exporter refuses secret-bearing columns and nested JSON fields; excluded session/identity tables remain in catalog evidence with zero exported rows so omission is visible.

## What is needed before a real migration

- Read-only database URLs or restored backup locations for all sources.
- The verified mapping from each legacy owner ID to a Life subject ID.
- The asset roots referenced by Health photos, Travel media and Archive revisions.
- The intended cutover order and observation window.
- Completed source-specific bundle mappers for every active fact listed above.

Until these inputs and mappers exist, only inspection and isolated drills are authorized. No production database, writer state or credential should be changed.
