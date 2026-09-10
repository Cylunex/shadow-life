# Rebuild status

Design baseline: `shadow-life-migration-gap-design-2026-09-08.md` SLG-1. The table separates source modeling, usable operations, migrated production data, and actual cutover. A schema or command alone is never counted as a completed migration.

| Source and reviewed SHA | Life fact model | Usable operation and verification | Production migration | Formal takeover and retirement condition |
|---|---|---|---|---|
| Health `800af69` | Meals, nutrition snapshots, raw revisions, body/sleep/activity/workout/habit projections, habits/goals/workout plans | Meal aggregate, correction, templates, batch cursor, queued normalizer, daily rebuild and versioned Health plans have contract and journey coverage | Synthetic importer only; real owner map, snapshots, photos and device backlog absent | Not taken over; real Health Connect/Samsung/scale runs, full history reconciliation and old writers stopped |
| Ledger `2465b89` | ConsumptionRecord, MoneyEntry, refunds, purchase lines, budgets, recurring plans/occurrences, spending intents and use cycles | Exact money, payment method, independent payment date, correction/void, concurrent refund rules, due materialization and planning detail have contract and journey coverage | Synthetic exact-scale USD sample reconciles; no real ledger snapshot imported | Not taken over; real balances/relationships reconcile to zero and old API/jobs/queues are frozen |
| Travel `56fb024` | Trip, reservation, segment, visit, linked fare, Place, day plan, immutable plan version, member run and per-stop outcome | Create/correct/full detail, stable stop identity, plan publication, version-pinned run recovery and owner/editor writes are covered by the PostgreSQL journey; shared reads omit other members' fare/source references and private run history | No production Travel bundle mapped | Not taken over; real offline bundle/GPX/ICS restore and current trip migration remain release work |
| Archive `a6f294f` | Library item/revision, annotation, derivation, proof, source, asset/version/blob and read grant | Capture/revise/read, idempotent binary storage, protected read, Chinese matching and versioned derivation/proof chains are implemented | No production archive bytes or old proof chain imported | Not taken over; old URI mapping and production export/restore remain release work |
| Platform `57424fc` | Principal, effects, write epochs and resource grants | JWT verification plus server-side Web OIDC PKCE session; transaction write fence shared by HTTP/CLI/MCP/Agent | Identity data is intentionally not copied | Not taken over; production issuer/client configuration and account session run are release gates |
| Nexus `2df5787` | Thread, Message, Run and event log | Conversation recovery, capability-filtered MCP discovery, Host-only operation receipts, typed run states, stop and sequence recovery pass automated tests | Historical Nexus conversations not imported | Not taken over; real Runtime evaluation, object context and attachment tool flow remain SL-03 |
| App `6bd237b` | Account-isolated pending commands, attachments and encrypted receipts | Share text/image, OIDC Authorization Code + PKCE and WorkManager refresh exist; Room 5 quarantines accountless legacy rows, encrypts known-account command/attachment payloads with per-account Keystore keys and exposes bounded queue recovery without changing command IDs | No installed-device queue migrated | Not taken over; configured issuer, Keystore/process-death matrix, Health Connect Changes and device compatibility remain SL-03/SL-05 |

## Current implementation packages

| Package | State | Evidence required to close it |
|---|---|---|
| SL-00 completion ledger | Implemented in this document and `health-ledger-inventory.md` | Keep source SHAs and four dimensions current on every migration change |
| SL-01 core correctness | Implemented and PostgreSQL-verified | Fixed-SHA migration `0001` remains immutable and upgrades through additive migrations, including an exact-checksum bridge for the known intermediate schema; old receipts/events are normalized while compatible fingerprints still replay; exact decimals survive JSON reads and cursor timestamps preserve PostgreSQL microseconds; regression also covers replay during freeze, date-only payment, active-refund accounting, cross-subject asset denial/read grant and database-owned snapshot pagination |
| SL-02 device to projection | Implemented for server ingestion | Raw batches and manual measurements create durable invalidations; Worker/recovery rebuilds facts, activity, sleep, wellbeing, workouts and habits transactionally; daily activity chooses the greater of device summary and independent workout total and rebuilds after deletion; isolated PostgreSQL journey verifies first build and refresh |
| SL-03 login and assistant first path | Partly implemented | Web and Android OIDC PKCE/session refresh, conversation recovery and structured missing-fact continuation exist; Runtime events are revalidated at the Host, only Executor results create subject/run/tool/command-bound receipts, and Web distinguishes partial commits, completion, interruption and input requests with stop and sequence recovery; Agent personal aliases/templates pass through the Kernel authorization query layer and exact read effects; Android version code 16 and Room 5 add encrypted queue recovery and verified receipt display, while a configured issuer/device run, real Runtime and attachment-to-assistant flow remain |
| SL-04 original assets and importer | Partly implemented | Manifest files are verified from actual bytes inside the bundle directory; idempotent asset application and bidirectional target/mapping reconciliation exist; target evidence hashes are computed from fresh readback facts and extra child rows block completion; final-delta now updates changed money/meal/health/archive targets only when prior readback evidence still matches, keeps domain revision history, preserves deletes as tombstones and detects mutation before replay; cutover selects the exact final-delta batch and reruns reconciliation under a frozen repeatable-read gate, while full legacy field/asset mappers, old URI relationships and production recovery drill remain |
| SL-05 Health/Ledger daily replacement | Implemented at server capability level; typed Web quick entry is usable | Detail queries, habits/goals/workout plans, recurring occurrences, intent/use-cycle and Worker materialization are wired through HTTP/CLI/MCP/Agent; Web quick entry preserves actual date, independent payment date, time zone, meal type, notes, counterparty/category/payment method and typed health metric/unit, and loads authorized domains independently; recurring plans retain anchor date, local time, zone, normalized rule and an explicit missing-date policy so month-end/leap-day schedules do not drift; richer detail/trend pages, food catalog, bill recognition and installed Android device validation remain product/release work |
| SL-06 complete travel | Partly implemented and PostgreSQL-verified at server capability level | Place/day-plan arrays, trip correction history, immutable published plans, stable stops, version-pinned per-member runs, independent stop outcomes, owner/editor collaboration and private fare/source/run filtering pass the isolated journey; map collections, invitations, route geometry, memories, GPX/ICS and offline/production restoration remain |
| SL-07 archive takeover | Implemented and PostgreSQL-verified at server capability level | Revision, annotation, derivation, SHA-256 asset proofs, owner/read-grant protected assets and Chinese lookup pass the isolated journey; protected originals are attachment-only while inline preview uses a passive allowlist with no-store/nosniff/same-origin headers, so HTML/SVG and unknown media cannot execute with the business origin; real old URI mapping and production export/restore remain release work |
| SL-08 release cutover | Not executed | Production snapshot, restore drill, real client/device/runtime runs, final reconciliation, writer freeze and explicit release operation |

## Verification on 2026-09-09

- Contract generation, dependency boundaries, all TypeScript checks and non-PostgreSQL tests pass for the current source changes. Web production build is rerun before commit.
- A fresh disposable PostgreSQL run applied all fourteen migrations and passed the expanded journey. It recreated the fixed `c418d9f` `0001` checksum, bridged only the known `bd38674` intermediate schema, preserved six-decimal large money values and microsecond cursor ordering, materialized a January month-end plan through March without drift, rebuilt activity energy after a workout deletion, and kept an active Travel run pinned while a newer plan version was published.
- A synthetic apply plus final-delta reconciled with no differences. With both write epochs frozen and queues drained, `cutover-check` returned ready; after adding an unexpected intake child, a direct second reconciliation reported the exact child-array difference, returned `complete: false`, and exited 2. Manifest verification tests cover correct bytes, missing files and path traversal.
- A second isolated delta journey changed a migrated money fact, tombstoned a removed meal, retained the prior meal snapshot, reconciled cleanly and replayed twice without another write. Mutating the target before a later replay changed that batch to `conflict` instead of accepting stale evidence.
- Contract generation, dependency boundaries, all TypeScript checks, 37 non-PostgreSQL tests, the PostgreSQL journey and Web production build pass on the current local source. The prior Android `compileDebugKotlin` remains valid because this batch does not change Android source or schema; no APK was packaged.
- Production data, services, DNS, real Runtime, APK and physical health devices were not touched. A configured issuer and installed-device run remain release work.

## Verification on 2026-09-10

- Runtime-forged start/commit events fail Host validation without entering the Executor. Query results cannot
  create a saved badge; only an Executor-owned `operation.committed` event can do so.
- Empty streams, invalid events, explicit input requests, user stop, partial text, write-then-EOF and SSE
  sequence parsing have focused API/adapter/Web regression coverage. A committed operation remains visible and
  queryable when the enclosing run later becomes interrupted.
- Contract generation, dependency boundaries, all TypeScript checks, 46 non-PostgreSQL tests, the full
  fourteen-migration PostgreSQL journey and the Web production build pass. Android was unchanged and no APK
  was packaged.
- Permission-aware dashboard loading keeps successful domains visible when a sibling read fails, and omits
  domains not exposed by capability discovery. Agent context tests prove that an agent-only or money-only
  client cannot retrieve meal templates or food aliases.
- Typed Web command builders and PostgreSQL readback cover money counterparty/category/payment method/note,
  meal type/note with a payment on a different date, and weight as a real health metric with label/unit/note.
  Contract generation, boundaries, all TypeScript checks, 54 non-PostgreSQL tests, the PostgreSQL journey and
  Web production build pass; Android was unchanged and no APK was packaged.
- Asset boundary regressions prove that an SVG/HTML original is attachment-only, active media receives no
  inline preview, and allowlisted raster preview keeps exact bytes under no-store/nosniff/same-origin policy.
  The non-PostgreSQL suite now contains 57 tests.
- Android Room 5 versions command, receipt and attachment envelopes, uses per-account Keystore AES-GCM with
  account/subject/type/ID authenticated data, and excludes device-bound ciphertext from backup and transfer.
  The worker recovers unknown command results before replay, validates the complete execution binding, keeps
  stable IDs, isolates item failures, caps automatic retries at eight and leaves explicit retry/confirmed
  cleanup in the queue UI. A SQLite version-4 fixture preserved known/accountless command and attachment rows
  while moving them to `needs_encryption`/`needs_account`; the generated Room 5 schema and final Android source
  pass `compileDebugKotlin`. No APK was built.
- Meal timeline reads now use one bounded parent query plus batched item/source/payment reads, keep a stable
  date/creation/ID order, omit the payment query without money permission, and remain at three or four SQL
  statements regardless of page size. Money planning validates real calendar months and uses half-open date
  bounds instead of formatting every expense date; migration 0015 adds matching meal and budget indexes, and
  the isolated PostgreSQL journey asserts both fixed query counts and usable index plans. Contract generation,
  dependency boundaries, all TypeScript checks and 58 non-PostgreSQL tests pass for this batch.
- Monthly planning now returns only plans and occurrences attributable to the requested month, intents whose
  intended date is in that month, and use cycles overlapping it. Every collection has a stable order, hard
  limit and explicit truncation flag; the response states its half-open date window and limits. Migration 0016
  adds the corresponding planning indexes. Contract and PostgreSQL regressions cover invalid/maximum years,
  cross-month exclusion, a 101-row truncation boundary and index usability. All TypeScript checks and 59
  non-PostgreSQL tests pass.
- Health source reads now fetch all authorized source instances and their cursors in two stable, batched
  statements instead of one cursor query per source. Migration 0017 adds the subject/source cursor index; the
  PostgreSQL journey asserts both the fixed statement count across multiple sources and the usable index plan.
- The Today page now consumes server-side per-date metrics instead of treating fetched page lengths as totals.
  A typed, permission-trimmed overview counts meals, confirmed money facts by currency, effective Health facts,
  visible visits and locally dated Library captures with freshness timestamps. The unified timeline uses actual
  occurrence instants, an authorization-bound snapshot cursor and explicit DTOs rather than merging arbitrary
  per-domain JSON in the browser. Migration 0018 adds the first overview paths; contracts, permission tests,
  API route parsing, Web loading tests and the PostgreSQL journey cover partial access, local dates, ordering and
  late-write exclusion. All TypeScript checks, the complete non-PostgreSQL suite and the Web production build pass.
- Android now has an explicit Health Connect permission and sync path for weight, steps, sleep and exercise.
  Each type resumes from the server-committed opaque Changes token, serializes one encrypted idempotent batch at
  a time, preserves provider IDs across upserts/deletes, and records permission revocation or token expiry before
  a bounded rescan. Initial capture refuses silent truncation beyond the documented 30-day/1000-record window.
  Source/queue/rescan failures are visible in the Android UI. Migration 0019 and the worker align provider
  millisecond versions with PostgreSQL bigint semantics. Kotlin compilation and the isolated PostgreSQL journey
  pass; signed-device, Samsung-provider and physical permission/process-death evidence remain release acceptance
  and are not claimed by this source-level implementation.
- The Web Health workspace now loads daily projection status, selectable 90-point metric trends and every
  authorized source independently, keeps a missing daily projection as an honest empty state, and reports
  section-local failures without hiding sibling data. Source cards expose permission, generation and cursor
  freshness but never render opaque cursor contents. The unified Plan tab creates typed Health goals, habits and
  workout plans alongside budgets, normalizes weekly schedules, preserves workout notes and hides plan kinds the
  current capability set cannot write. Focused Web tests, all TypeScript checks and the production Web build pass.
- Today now includes bounded, permission-trimmed action context instead of metrics alone: open recurring
  occurrences due by the selected date, unhealthy Health source/cursor states, and trips active on that date.
  The Web presents these as a compact attention section and keeps a truthful all-clear state. Migration 0020
  adds the open-due, source-state and trip-window read paths; a fresh isolated PostgreSQL journey applies all
  twenty migrations and verifies the three result families, authorization trimming and usable query plans.
