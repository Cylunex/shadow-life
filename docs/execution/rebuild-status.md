# Rebuild status

## 2026-09-24: integrated day view and same-day memories

- The daily domains and Money/Travel/Library workspaces are merged. A bounded `life.day` read now counts and pages visible facts across domains by a selected local date; `life.memories` reads actual records from the same date in the preceding five years. Existing explicit cross-domain links open their sources in Web and Android.
- Library vision output now becomes a normal revisable source-linked revision when the initial record has not been edited. It does not create Money or Health facts. See [integration delivery](life-integrated-experience-2026-09-24.md) for semantics, references, validation and limits.

## 2026-09-24: daily domains strengthening

- Health progression uses only comparable executed sessions; missing evidence produces no next target. Recipe source import has local preview and explicit save, while food stock is manually versioned with expiry and conservative shopping gaps. Owned items gain structured locations and authenticated QR links. Project actions gain optional local-day times and browser draft recovery. Web and Android have usable entries.
- See [daily domains delivery](daily-domains-2026-09-24.md) for semantics, validation, reference projects and device/external limits. No deployment or signed APK is part of this batch.

## 2026-09-24: Money / Travel / Library record workspaces

Monthly Money import reconciliation, versioned Travel checklists with downloadable offline itineraries, and Library vision processing are implemented for Web and Android. The Library processor is verified with a local stub; no real visual model endpoint or production content was used. See [delivery details](money-travel-library-records-2026-09-24.md).

## 2026-09-24: Travel planning assist

- Web Travel can add saved places to a selected day, suggest a geometric order within unconstrained draft blocks,
  save an empty day, and show numbered stops with broken-at-unknown straight connectors on the day map.
  Fixed-time, anchor, completed and unlocated stops retain their positions. Existing
  Executor, permissions, idempotency and day-plan revision checks remain the write path.
- See [the legacy comparison](travel-feature-recheck-2026-09-24.md) for verification and remaining real-data,
  external-service, device and product-code work.

## 2026-09-24: native planning and service-card actions

- Android Meals now edits and copies meal plans, builds shopping lists and updates item states. Money adds editable
  budgets, recurring plans and occurrences, spending intents tied to recorded purchases, consumable use cycles and
  actual use entries, plus prepaid service-card creation, use history and corrections. Health body trends keep
  per-account display preferences.
- Writes reuse the existing offline command queue and refresh after commit. See [native planning follow-up](native-planning-follow-up-2026-09-24.md)
  for the old-project comparison, scope and remaining increments.

## 2026-09-24: legacy sleep insight recheck

- Compared the old Health sleep quality statistics with the current Life daily projection and native screen. Added a bounded, owner-scoped `health.sleep_insights` read capability and a 30-day native summary. Bedtime regularity requires at least three nights with start times; missing stage and interval evidence stays unknown. See [the comparison](legacy-feature-recheck-2026-09-24.md).

Design baseline: `shadow-life-migration-gap-design-2026-09-08.md` SLG-1. The table separates source modeling, usable operations, migrated production data, and actual cutover. A schema or command alone is never counted as a completed migration.

## 2026-09-22: service cards and actual redemptions

- Added separate prepaid service cards linked to existing purchase/payment records, with explicit use history,
  integer balances, expiry, versioned corrections and reversible mistaken deductions. Uses never create money entries.
- API, CLI, built-in Agent and personal MCP share the same contracts and Executor. Web Plans → 次卡 and Android
  Money → 次卡 expose card editing and use history. Hermes workflow examples distinguish purchase, actual redemption and extra payment.
- See [service card semantics](../architecture/service-cards.md). Source verification and operational rollout are
  recorded separately; no Android APK is included in this delivery.

## 2026-09-22: Health display semantics and release history

- Android Health/Meals now use labeled semantic colors, explicit reference ranges and activity goal semantics.
- Samsung vital extrema and skin temperature retain their context; sleep sessions, workout pace/speed and
  activity energy provenance are exposed from existing synchronized facts.
- Health → 起飞 adds monthly calendar, scoped counts, date intervals and detail navigation through an
  owner-scoped, bounded read capability. See [display semantics](../architecture/health-display-semantics.md).
- Validation: all 258 tests pass with disposable local PostgreSQL; contract generation, dependency checks,
  TypeScript and Android compilation plus all 45 unit tests pass. No deployment, APK or device acceptance is included.

## 2026-09-22: Agent usability and one maintained MCP entry

- Repository MCP and operational runtime templates now share one implementation, with personal planning
  capabilities, exact schemas, single-request discovery, bounded legacy discovery, structured errors,
  validated local-image receipts and by-command recovery. Built-in Agent receipt queries remain reads.
- Historical date-window search and meal cursor transport now support complete bounded record checks.
  A reusable skill includes contract-tested examples and precise multi-domain image verification.
- All 256 tests pass on disposable local PostgreSQL; source checks and runtime-shim validation pass.
  Live Gateway refresh/deployment is not included. See [Agent usability delivery](agent-usability-2026-09-22.md).

## 2026-09-22: Life home and presentation hierarchy

- Android now names the home destination Life (生活); Web mirrors the name. Home cards retain saved customization
  and distinguish their reporting periods. Domain cards and details use consistent summaries, content, and actions.
- Presentation corrections cover currency-isolated decimal summaries, unknown nutrition, local-date timeline
  grouping, bounded upcoming agendas, and expandable record evidence. See
  [Life home presentation](life-home-presentation-2026-09-22.md) for scope and verification limits.

## 2026-09-22: daily travel interaction and linked record details

- Android and Web expose one selected travel day at a time, including empty dates. Native day editing uses
  stable stops, trip-local times and the existing versioned command queue; Web keeps maps scoped to the day.
- Explicit meal/payment/purchase, refund/original and travel-fare relationships are navigable and permission
  projected. Detail pages separate business objects and fold long lists and technical history.
- Scope, reference products, browser verification and remaining device acceptance are recorded in
  [Travel and domain interaction delivery](travel-domain-interactions-2026-09-22.md).

## 2026-09-21: authoritative daily record completeness check

- Added the read-only `life.daily_record_check` capability and HTTP/Agent transport. One database read returns
  local-date meal counts by period/type, confirmed purchases and money entries, effective Health fact/step counts,
  source status, and the previous wake date's sleep status.
- Omissions are emitted only from explicit configurable expectations. The default checks a three-record meal
  minimum without guessing which named meal is missing; purchase and money minimums are disabled. Nutrition,
  step, exercise, habit, and sleep goals are never invented, and an absent previous-night sleep fact remains
  pending unless a source explicitly reports a permission or cursor issue.
- Regression fixtures cover 2026-09-18 (four meals, 27 Health facts, 14,444 steps), 2026-09-19 (one meal,
  31 facts, 1,911 steps), and 2026-09-20 (same-night sleep and absent habits are not omissions). Contract,
  boundary, TypeScript, API, kernel, and isolated PostgreSQL checks pass; Android is unchanged and no APK is
  required for this server/runtime capability.

## 2026-09-15: consumable balances and folded purchase detail

- Use cycles now retain optional comparable package quantity, explicit intake matching, daily-use estimate,
  replenishment threshold/lead time, time zone, reminder mode and a concrete purchase-item link. Remaining
  quantity is rebuilt from current effective intake facts; incompatible dimensions are reported, never summed.
- Unknown package size is an explicit `needs_specification` state with no fabricated depletion date or reminder.
  Threshold notifications reuse the notification inbox and have a stable idempotency key.
- `life.update_purchase_items` repairs an existing folded purchase under an expected aggregate revision, retains
  the original summary and full prior snapshot, and never creates another order or amount. Consumption statistics
  report folded/supplemented coverage and exclude folded summaries from product rankings.
- Web and Android expose the resulting balances; Web also supplies minimal versioned repair, specification and
  replenishment-completion entry points. No production data, deployment or APK is changed by this source batch.

## 2026-09-14: consumption and item statistics

- Added the shared `life.consumption_stats` contract, HTTP/Agent query, PostgreSQL fact reader, and
  versioned `consumption-stats-v1` classification in the kernel.
- Web and Android now expose 1/3/6/12-month filters, scope/category filters, monthly trends, merchant
  and item rankings, time distribution, coverage, and minimal unknown lists.
- This is a query-time derivation: no production data, materialized summary, migration, or destructive
  historical backfill was introduced. See `docs/architecture/consumption-statistics.md` for semantics,
  audit, and rollback constraints.

| Source and reviewed SHA | Life fact model | Usable operation and verification | Production migration | Formal takeover and retirement condition |
|---|---|---|---|---|
| Health `800af69` | Meals, nutrition snapshots, raw revisions, body/sleep/activity/workout/habit projections, habits/goals/workout plans | Meal aggregate, correction, templates, batch cursor, queued normalizer, daily rebuild and versioned Health plans have contract and journey coverage | Synthetic importer only; real owner map, snapshots, photos and device backlog absent | Not taken over; real Health Connect/Samsung/scale runs, full history reconciliation and old writers stopped |
| Ledger `2465b89` | ConsumptionRecord, MoneyEntry, refunds, purchase lines, budgets, recurring plans/occurrences, spending intents and use cycles | Exact money, payment method, independent payment date, correction/void, concurrent refund rules, due materialization and planning detail have contract and journey coverage | Synthetic exact-scale USD sample reconciles; no real ledger snapshot imported | Not taken over; real balances/relationships reconcile to zero and old API/jobs/queues are frozen |
| Travel `56fb024` | Trip, reservation, segment, visit, linked fare, Place, personal theme map, imported track, day plan, immutable plan version, member run and per-stop outcome | Map-first workspace, candidate/anchor collections, create/correct/full detail, stable stop identity, version-pinned in-transit mode and deterministic Bundle/GPX/ICS export are covered; portable Bundles have read-only preview and copy restoration; content visibility is applied consistently across detail, search, timeline, overview and export | No production Travel bundle mapped | Not taken over; reviewed real-data recovery and current trip migration remain release work |
| Archive `a6f294f` | Library item/revision, annotation, immutable original, processing job, derivation, indexed snippet, reading state, proof, legacy URI, asset/version/blob and read grant | Capture/revise/read, protected originals, text extraction, external processor claim/failure/completion, full-text snippet lookup, reading resume and explicit legacy proof states are implemented | No production archive bytes or old proof chain imported | Not taken over; reviewed real URI mapping, old-key verification corpus and production export/restore remain release work |
| Platform `57424fc` | Principal, effects, write epochs and resource grants | JWT verification plus server-side Web OIDC PKCE session; transaction write fence shared by HTTP/CLI/MCP/Agent. The old central Access/Session design remains an unimplemented Platform project, not a Life-local service | Identity data is intentionally not copied | Not taken over; production issuer/client configuration and account session run are release gates |
| Nexus `2df5787` | Thread, Message, Run, event log, short-lived object Context Pack and bounded durable memory | Conversation recovery, capability-filtered MCP discovery, Host-only operation receipts, typed run states, stop/sequence recovery, permission-rechecked object context and explicit/aggregate memory filtering pass automated tests; Web and Android can now select prior threads or start a new one, with older-message pagination | Historical Nexus conversations not imported | Not taken over; configured real Runtime evaluation and attachment-to-assistant flow remain release work |
| App `6bd237b` | Account-isolated pending commands, attachments and encrypted receipts | Share text/image, OIDC Authorization Code + PKCE and WorkManager refresh exist; Room 6 preserves the Room 5 accountless-row quarantine, adds receipt-driven Health Connect round progress, encrypts known-account command/attachment payloads with per-account Keystore keys and exposes bounded queue recovery without changing command IDs | No installed-device queue migrated | Not taken over; configured issuer, Keystore/process-death matrix, Health Connect Changes and device compatibility remain SL-03/SL-05 |

## Current implementation packages

| Package | State | Evidence required to close it |
|---|---|---|
| SL-00 completion ledger | Implemented in this document and `health-ledger-inventory.md` | Keep source SHAs and four dimensions current on every migration change |
| SL-01 core correctness | Implemented and PostgreSQL-verified | Fixed-SHA migration `0001` remains immutable and upgrades through additive migrations, including an exact-checksum bridge for the known intermediate schema; old receipts/events are normalized while compatible fingerprints still replay; exact decimals survive JSON reads and cursor timestamps preserve PostgreSQL microseconds; regression also covers replay during freeze, date-only payment, active-refund accounting, cross-subject asset denial/read grant and database-owned snapshot pagination |
| SL-02 device to projection | Implemented for server ingestion | Raw batches and manual measurements create durable invalidations; Worker/recovery rebuilds facts, activity, sleep, wellbeing, workouts and habits transactionally; daily activity chooses the greater of device summary and independent workout total and rebuilds after deletion; isolated PostgreSQL journey verifies first build and refresh |
| SL-03 login and assistant first path | Partly implemented | Web and Android OIDC PKCE/session refresh, conversation recovery and structured missing-fact continuation exist; Runtime events are revalidated at the Host and only Executor results create bound receipts. A Web detail can attach a 15-minute object/version reference pack; creation and every run recheck current effects, ownership, expiry and optional thread binding, while the Runtime still queries facts on demand. Durable memory accepts only explicit preferences or algorithm-versioned aggregates with authorized evidence; model inference has no persistence contract. Android version code 16 and Room 5 add encrypted queue recovery and verified receipt display. A configured issuer/device run, real Runtime evaluation and attachment-to-assistant binary flow remain |
| SL-04 original assets and importer | Partly implemented | Exports now have deterministic JSON, exact schema metadata, per-table/catalog/snapshot hashes and a snapshot-bound field disposition audit; manifests are verified from actual bytes, apply/replay is idempotent, reconciliation reads targets in both directions, and final delta preserves revisions/tombstones while detecting target mutation. The guarded empty-database restore drill verifies exact target schema, first apply, replay and fresh readback; full reviewed production mappers, real asset/old URI relationships and a production-data recovery drill remain |
| SL-05 Health/Ledger daily replacement | Implemented at server capability level; typed Web entry and review workspaces are usable | Detail queries, habits/goals/workout plans and actual workout execution, recurring occurrences, intent/use-cycle, food/recipe catalogs, immutable recipe meal snapshots, bill review and Worker materialization are wired through HTTP/MCP/Agent; Web preserves actual date, independent payment date, time zone, correction reasons, known/unknown nutrition and explicit recipe consumption fraction; installed Android device validation remains release work |
| SL-06 complete travel | Implemented at portable server/Web capability level and PostgreSQL-verified | Personal theme maps keep candidates, anchors and collection-only “visited” state separate from Visit facts; the map-first Web workspace shows coordinate-relative places without an external provider, immutable-plan in-transit progress, GPX import and Bundle/GPX/ICS downloads. Reservations/segments/visits carry explicit content visibility, with actual visits private by default and sensitive reservation fields still author-only. Bundle recovery requires read-only structural/semantic preview, restores a new owned copy with remapped places/maps and stable stops, and deliberately does not invent members, runs, sources or fare links. Invitations, route-provider geometry, memories and production restoration remain product/release extensions rather than this portable core |
| SL-07 archive takeover | Implemented and PostgreSQL-verified at portable server/Web capability level | Revision, annotation, immutable originals, queued/versioned processing, indexed citable snippets, reading resume, SHA-256 asset proofs, explicit old URI status and Ed25519 compatibility verification pass the isolated journey. The Worker only performs bounded UTF-8 text extraction; OCR/transcript require a real processor to list, claim and return a derived asset or failure. Protected originals remain attachment-only and legacy keys/signatures are omitted from normal detail reads. Reviewed real URI mapping, old-key verification corpus and production export/restore remain release work |
| D1 owned items and cross-domain review | Implemented and PostgreSQL-verified | Only an explicit user action creates an OwnedItem from a purchase line or manual entry. Item revisions, exact Library document versions, maintenance/after-sales events, optional cost links and state transitions are subject-scoped. Reviews use fixed program logic, preserve original-currency totals, coverage, bounded evidence and algorithm version, can be recomputed after corrections, and make no health-causality or opaque-score claim |
| D2 life projects, meal planning and foreign money | Implemented and PostgreSQL-verified | LifeProject owns only goals, milestones, actions and permission-rechecked stable references. Meal plans freeze exact recipe revisions, scale and aggregate ingredients into version-bound shopping lists, and never turn a planned or bought item into intake. Foreign entries preserve original amount/source scale and store conversion provenance, trip links and shared allocations separately; travel links are hidden when current travel read authority is absent |
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
- Ledger imports now deterministically parse bounded CSV, JSON and Markdown statements into review candidates
  without writing accounting facts. Raw rows, parse issues, source hashes, external IDs and duplicate links are
  retained; confirmation reuses the normal entry/refund constraints, and refunds still require an explicit
  original expense. Exact counterparty rules are visible, versioned and reversible: a reviewed non-refund may
  remember its type/category/payment method, later candidates explain the rule IDs applied, and disabled rules
  stop affecting new batches without rewriting history. The Web supports stage, per-row repair/confirm/ignore,
  rule creation and rule disablement. Migration 0021 and a fresh PostgreSQL journey verify duplicate-file replay,
  duplicate transactions, invalid repair, linked refunds, rule hit/confirmation/disable and subject isolation.
- Unified records now expose a stable, bounded timeline with domain filters, keyset pagination and shareable
  object URLs. Meal and money links open the permission-trimmed aggregate with relationships and evidence;
  Travel children point back to their authorized trip context; Library opens its revision/proof context; and
  every effective Health fact has a provenance detail that identifies its manual source or raw source identity
  without exposing device cursors. Meal, money and manual Health details can be corrected with an expected
  revision and reason. Device-derived Health facts remain read-only and must change through source versions.
  Migration 0022 preserves manual Health snapshots, invalidates both affected daily projections on date moves,
  and the fresh PostgreSQL journey covers stale revisions, subject isolation and timeline parent references.
- Training plans and actual execution are now distinct facts. A manual workout may reference an active owned
  plan, records only metrics the user supplied, never pretends to be a device raw row, and invalidates the
  affected daily projection. The Web shows active plans and recent actual sessions. Migration 0023 and the
  isolated journey cover linked execution, an unlinked session and rejection of an unavailable plan.
- Personal foods now extend the existing `food_references` identity instead of creating a competing catalog.
  Serving facts, optional nutrition, provenance, archive state and reasoned revisions remain subject-scoped.
  Recipes snapshot validated owned food references plus free ingredients; recording a meal requires the exact
  recipe revision and an explicit consumed fraction, and later recipe edits cannot rewrite the saved meal.
  Search is bounded and permission-checked across HTTP, MCP and Agent dispatch. The Web keeps unknown nutrition
  visibly unknown and supports create/edit/archive plus recipe-to-meal capture. Migration 0024 and a fresh
  PostgreSQL journey verify all 24 migrations, version history, stale revision rejection, subject isolation and
  historical snapshot stability. Contract generation, dependency boundaries, every TypeScript project, 91
  non-PostgreSQL tests (90 pass and the database-only journey is skipped), the explicit PostgreSQL journey and
  the Web production build pass. Android was unchanged; no APK was packaged and nothing was deployed.
- The legacy PostgreSQL exporter now records type/nullability/primary-key metadata, recursively preserves
  instants, bigint values and bytes, canonically orders rows, and binds table, catalog and snapshot hashes. A
  snapshot-bound mapping review must explicitly dispose every discovered table and column; generated skeletons
  are complete but blocked until reviewed. The guarded `restore-drill` also requires an empty target at the
  bundle's exact schema, then proves one initial apply, an all-replay second pass and fresh reconciliation. The
  synthetic fixture completed 2/2 apply, 2/2 replay and zero-difference readback on a fresh 24-migration database;
  its second invocation was rejected because the target was no longer empty. No real source or production target
  was accessed, so production mapping and recovery acceptance remain open.
- Travel now has personal theme maps with reasoned revisions, candidate/anchor/planned collection states, bounded
  GPX tracks and a map-first Web workspace with immutable-plan in-transit controls. Saving a map or importing a
  track cannot create a Visit. Bundle/GPX/ICS exports are deterministic and content-addressed; all-day ICS uses an
  exclusive end date. Explicit shared/private visibility is enforced consistently for reservation, segment and
  visit detail, search, timeline, overview and export, while confirmation codes, seats, fares, sources and private
  notes stay out of other members' payloads. A fresh isolated PostgreSQL journey applied all 25 migrations and
  passed map revision, cross-subject rejection, malicious GPX, Visit separation, member privacy and export-hash
  checks. Portable Bundle recovery now adds a read-only preview with content hash and bounded counts, rejects
  malformed or duplicate identities before any write, then restores a new owned copy without overwriting the
  source trip. Places and theme-map references receive new IDs, published plan snapshots retain stable stop IDs,
  and restored tracks receive hashes from newly serialized bytes; members, run progress, sources and fare links
  are explicitly omitted rather than guessed. Idempotent command replay returns the same restored Trip. All
  TypeScript projects, focused Web/API/Kernel tests and the Web production build pass. Real Travel data recovery
  remains open and is not claimed.
- Library now preserves a fixed source asset version through a durable processing state machine. The built-in
  Worker accepts only bounded UTF-8 plain text, Markdown and JSON, writes a separate derived text asset, indexes
  source-located snippets and leaves the original bytes unchanged. External OCR/transcript integrations have a
  permission-checked bounded queue plus explicit claim, failure, retry and completion commands; completion must
  bind a processor version and owned derived asset. Search includes derived snippets, and the Web can upload an
  original, inspect jobs, retry failure, resume an exact item revision and register an old URI without claiming
  proof validity. The compatibility verifier marks Ed25519 signatures valid only when the signature over the
  canonical ASCII SHA-256 digest matches the fixed original; uncheckable links remain `unverified`, and detail
  responses do not expose stored keys or signatures. Migration 0026 and a fresh PostgreSQL journey cover all 26
  migrations, immutable bytes, built-in and external processing, failure/retry, derived search, reading state,
  verified/unverified legacy links and cross-subject denial. All TypeScript projects, 115 non-PostgreSQL tests
  (114 pass and the database-only journey is skipped), the PostgreSQL journey and Web production build pass. No
  real archive data or issuer was accessed, no APK was packaged, and nothing was deployed.
- Assistant context is now an expiring reference envelope rather than a copied fact payload. Context Packs bind
  exact object revisions, optional thread and validity windows for at most one hour; creation and every read/run
  recheck ownership, current effects, expiry and thread binding before the Runtime can use the references. Durable
  memory accepts only an explicit preference or an algorithm-versioned deterministic aggregate and rechecks every
  evidence reference before returning it; there is deliberately no model-inference persistence category. Generic
  notifications contain no source content or amounts, respect enablement and local quiet hours, and support explicit
  snooze, dismiss and delivery transitions. The Web can attach the currently opened record for 15 minutes and manage
  notification preferences without embedding the record body in the conversation. Migration 0027 and a fresh
  PostgreSQL journey cover all 27 migrations, revision/subject/effect/thread/expiry denial, memory filtering,
  recurring and processing-failure notification materialization, redacted copy and delivery states. All TypeScript
  projects, 117 non-PostgreSQL tests (116 pass and the database-only journey is skipped), contract/boundary checks
  and the Web production build pass. The live Runtime evaluation harness now includes context-pack and notification
  redaction scenarios, but it was not run because no real issuer/Runtime endpoint was configured; no APK was
  packaged and nothing was deployed.
- Owned items now form an explicit purchase-line → item → versioned receipt/manual → maintenance/after-sales
  chain without treating every purchase as inventory. Updates and state-changing events preserve prior aggregate
  snapshots; foreign purchase lines, Library revisions and cost entries are rejected, while current read effects
  independently control purchase, document-title and cost visibility. Cross-domain reviews use `life-review-v1`
  to calculate period metrics by original currency, record coverage and at most 100 evidence references per
  domain, persist limitations against opaque scoring and health-causality claims, and create a new review revision
  when corrected source facts are recomputed. Migration 0028 and a fresh PostgreSQL journey cover all 28
  migrations, subject isolation, stale revisions, invalid maintenance after return, permission-trimmed reads and
  changed results after a money correction. All TypeScript projects, 119 non-PostgreSQL tests (118 pass and the
  database-only journey is skipped), contract/boundary checks and the Web production build pass. No APK was
  packaged and nothing was deployed.

## Verification on 2026-09-11

- Lightweight projects now organize milestones, action items and exact cross-domain references without copying
  source facts. Dynamic effects protect linked plans, recurring occurrences and habits; reads hide links whose
  domain is not currently authorized and recheck shared Trip visibility. Meal plans freeze exact Recipe revisions,
  scale decimal quantities in PostgreSQL and deterministically merge matching ingredients into a revision-bound
  shopping list. Marking an item bought may link an explicit purchase line, advances the real list revision and
  cannot create a Meal. Foreign-money writes preserve original currency and source precision, validate the
  conversion equation and allocation ceiling transactionally, and store FX provenance, optional Trip membership
  and shared allocation state in separate facts. Money-only reads omit Trip identities, while Trip-filtered reads
  require current travel authority. Migration 0029 and a fresh PostgreSQL journey cover all 29 migrations, stale
  references, subject/revision isolation, snapshot stability after Recipe edits, ingredient aggregation, purchase
  separation, invalid rates/allocations and cross-domain permission trimming. Contract generation, dependency
  boundaries, every TypeScript project, the complete non-PostgreSQL suite, the PostgreSQL journey and Web production
  build pass. No APK was packaged, no real issuer/device/runtime or production data was used, and nothing was deployed.

## Independent-review corrections on 2026-09-11

- F01–F03: Context Pack creation and reads now share a database visibility predicate. Mutable facts require
  their current effective revision; an active Library item may reference an independently addressable immutable
  Library revision. Bound packs require the matching thread even on direct HTTP reads (`thread_id`); omitted or
  wrong threads fail closed. `valid_from`/`valid_to` describe the selected fact window, while `expires_at` alone
  bounds access. Intake correction also advances the owning Meal revision. Aggregate memory is recomputed by the
  Host registry (`meal-count-v1` counts only the selected distinct, authorized Meal facts), rejects supplied values
  that disagree, and filters stale or unregistered historical aggregates on every read. Explicit preferences keep
  their ordinary direct write path. Creation and expiry use PostgreSQL `now()` with the existing one-hour constraint.
  Two new isolated PostgreSQL regressions pass, covering correction, void, cross-subject and shared-member denial,
  revoked effects, exact 5/15/60-minute TTL, delayed insertion, expiry, thread binding and command replay; 43 focused
  contract/kernel/API tests also pass. Real Runtime and device acceptance remain open.
- F04/F10: Generic monetary correction now rejects amount/currency changes while FX or allocation relationships
  exist, preserves note-only correction, and records source precision. A settled allocation blocks void until it
  is resolved; void waives unsettled allocations and subsequent allocation writes require a confirmed parent.
  Correction/void history includes exact FX and allocation snapshots. Current FX reads omit inconsistent legacy
  conversions. The migration CLI converts only exact money/intake decimal columns to strings before pg JSON
  decoding; source-scale integers and unrelated JSON numbers retain their types. Two isolated PostgreSQL tests
  pass, including real CLI apply/update/delete/replay and reconciliation with a value above JavaScript's safe
  integer range, all intake numeric fields, and trailing zeros. No historical migration checksum was changed.
- F05/F06: Shopping transitions lock the parent list before updating any child or calculating remaining items.
  A two-connection PostgreSQL barrier proves concurrent completion and reopening, unchanged children while blocked,
  stable replay, and revision conflict rejection. Asset storage preserves existing original IDs; MIME variants and
  derived representations receive deterministic logical identities independent of the byte digest. Plain text,
  Markdown and JSON all finish extraction without changing original bytes/hash/MIME, repeating the same derivation
  does not add assets, and cross-owner originals remain inaccessible. Both new database regressions, database TS,
  and the two text-worker unit tests pass.
- F07/F08: Health Connect steps now use `steps_interval` identities with exact start/end and provider origin.
  The fixed server policy sums a maximum non-overlapping interval set within one origin, then takes the greatest
  origin/device-total result. It intentionally does not sum competing providers. A whole cross-midnight interval
  belongs to its start date in the recorded time zone; no fractional per-minute distribution is fabricated.
  `steps_reconciliation` reports this conservative policy. Complete interval rescans retire covered old HC
  `daily_activity` encodings while preserving their original raw revisions and out-of-window history.
  Rescans carry a unique generation, explicit instant window and `complete:true`; Android reads every page into
  one bounded batch (maximum 1000), checks permissions again, then queues that batch atomically. Oversize, unread
  pages, permission changes and unknown record coverage cannot mark completion or delete absent records. Only
  fully contained missing facts are invalidated, with their IDs retained in `health_rescan_generations`; normalizer
  work is requeued without inventing provider versions. Expired/revoked cursors cannot become active through an
  ordinary upsert batch. Four fresh PostgreSQL regressions, 13 pure Kotlin policy assertions and Android
  `compileDebugKotlin` pass. The protocol follows the [Health Connect sync guidance](https://developer.android.com/health-and-fitness/health-connect/sync-data);
  real provider priorities, signed-device permission/process-death and Samsung acceptance remain open.
- F09: Runs have a persistent owner and 30-second lease renewed every five seconds. Reads/new runs/stop recover
  expired or pre-lease orphan runs as interrupted, while cross-instance stop persists a request for the live owner.
  User-message insertion and run admission are atomic. Executor commands validate and lock their run lease inside
  the business transaction; stop/recovery waits for admitted writes, and expired owners cannot start another write,
  append late events or insert a late assistant message. Committed operations bind run/tool IDs in the same
  transaction, allowing recovery to reconstruct a missing receipt event without replaying the business command.
  Two repository PostgreSQL tests and two real API/PostgreSQL tests pass, including local stub Runtime injection
  for stale contexts/forged aggregates. No external Runtime was invoked. Migration 0031 is additive.
- Final review validation: all 136 Node tests pass together with the isolated PostgreSQL cluster (zero failures
  or skips), including the 31-migration full journey. All TS projects, generated contracts, dependency boundaries,
  Web production build, Android Kotlin compilation and 13 pure Kotlin assertions pass. A real two-instance API
  heartbeat-stop test and a historical-snapshot-to-empty-database restore drill also pass. The final Health check
  verifies that an unchanged provider version reappearing after reconciliation returns its actual pending state
  without marking an incomplete cursor active. See [the F01–F10 delivery record](review-fixes-2026-09-11.md) for
  exact implementation SHAs, test paths, semantic choices and remaining device/production acceptance boundaries.

## Android independent re-verification follow-up (2026-09-11)

V01/V02 exposed gaps in the first Kotlin policy-only checks. The Worker now uses a directly tested production
JSON builder and a durable four-type round runner. Room 6 atomically stores each encrypted command with its
receipt continuation and advances only on a verified receipt; hasMore keeps the current type, a terminal page
rotates to the next type, and completed rounds do not self-start. 13 policy plus 117 production-path JVM
assertions, four actual emitted command contract checks, the Room 5→6 SQLite migration check and Android Kotlin
compilation pass. See [the scoped follow-up](android-health-reverification-fixes-2026-09-11.md). Real device,
provider and OS process-death validation remain release work.

## Library processing recovery optimization (2026-09-11)

After independent F01–F10 / V01–V02 re-verification, Library processing now uses a database-clock five-minute
lease and monotonic attempts. Expired work is discoverable and reclaimable; renew, completion and failure are
fenced after row-lock acquisition. Builtin text processing claims just before work and routes all job transitions
through the shared Executor, committing derivations/snippets/status together with receipts and Outbox events.
Migration 0032 preserves originals and terminal data. External processors must carry the returned attempt.
The complete serial PostgreSQL/Node suite passes 143/143, including seven new regressions; ten TS projects,
contracts, boundaries and Web build pass. One prior parallel run hit a temporary database teardown connection
race, retained as a test stability limitation. See the [research/design](../architecture/library-processing-recovery-2026-09-11.md)
and [delivery/validation record](library-processing-recovery-delivery-2026-09-11.md). No deployment or full historical migration is implied.

## Next-phase daily experience and UI optimization (2026-09-11)

- The Web shell now follows four stable daily destinations: Today, Records, Plans and Library. Assistant and
  quick-add are global overlays instead of peer destinations. Today prioritizes the next due item/current trip,
  bounded domain summaries, attention items and recent activity over technical collection counts. Desktop,
  390-pixel mobile, light/dark, focus and reduced-motion rules were reviewed against the local Life UI references.
- Every Web command now passes through one persisted controller. It stores the command before dispatch, coalesces
  an in-flight click, queries the authoritative operation before retrying an unknown outcome, and refuses to replace
  an unresolved intent. A refreshed page rechecks a cached receipt against the current server subject instead of
  trusting cross-session browser state; after a delivered success, an identical later click remains a new intent.
- A reusable searchable object picker exposes human titles, dates and exact revisions. Projects no longer require
  manual object IDs; owned-item receipts/manuals and foreign entries select real Library/Trip objects. Project
  rewriting is disabled when the caller cannot see every reference domain, avoiding a partial permission-trimmed
  snapshot deleting hidden links. Updating an action preserves its recurring-occurrence or Health-habit mirror.
- Projects now support edit, pause, resume, completion and reversible action completion. Meal planning supports a
  multi-entry draft, exact-revision edit/copy, optional shopping extras and reversible needed/bought/skipped states.
  Travel adds normal forms for trips, saved places, private actual visits and private reservations alongside the
  existing maps, immutable in-transit runs and portable import/export. Planned, purchased and actually occurred
  facts remain separate throughout these flows.
- Android version 1.0.1 uses the full responsive Web experience as its Life destination while retaining the native
  encrypted offline capture and Health Connect destination. The WebView permits only same-origin HTTPS in-app
  navigation, blocks file/content/mixed-content access and non-Web schemes, refuses authentication challenges from
  other hosts, and keeps NAS Basic Auth input out of source and APK configuration. Kotlin source compilation passes;
  no APK was packaged and no deployment, production data, Runtime or physical device was touched.

## Native production delivery follow-up (2026-09-13)

- The Android daily experience is now fully native rather than a Web destination. Today, Records, Plans, Library,
  domain workspaces, detail views, assistant, settings and recovery surfaces use typed Compose routes and generated
  API DTOs. The default dark design system was refined against the reviewed local Life references.
- The production API now accepts the dedicated public Android OIDC client through Authorization Code + PKCE. It
  verifies RFC 9068 access tokens, issuer, audience, signature and client allowlist, then applies an explicit
  server-owned single-user subject binding and effect ceiling. Browser Basic/proxy access and native Bearer access
  are separated at the reverse proxy; Bearer requests never receive the trusted proxy secret.
- A signed Android `2.0.0` package with version code 21 was built. Its production API/resource, issuer, custom-scheme
  callback and HTTPS App Link host were inspected from the generated build and manifest. Signature v2/v3, artifact
  SHA-256 and the public Digital Asset Links package/certificate binding were verified.
- The complete non-database test run has 174 cases: 151 pass, 23 PostgreSQL-dependent cases skip without an explicit
  test database, and none fail. The legacy importer typecheck and all 15 focused tests pass. Production API/Worker
  readiness, OIDC client recognition, browser/native auth routing and App Links all pass deployment smoke checks.
- A catalog-only production migration inventory completed without exporting row payloads. Health and Ledger remain
  unchanged. The first full Health snapshot correctly refused an opaque provider cursor credential; the exporter
  now supports only a code-reviewed `excluded_runtime_state` allowlist and carries that exclusion through mapping
  review and audit. Exporting sensitive business rows still requires explicit operational authorization, followed
  by reviewed owner mappings, full source mappers, an isolated restore drill and final reconciliation.
- Remaining acceptance depends on external systems rather than hidden source completion: an installed Android device
  must complete browser callback, Keystore/process-death, Health Connect, Samsung and BLE runs; a verified NDJSON
  Agent Runtime, OCR/transcript processor and route provider must be selected and configured before those optional
  integrations can be claimed as production-available.

## Fixed-SHA audit plan follow-up (2026-09-13)

- The independent `10933ce` audit was rechecked against the later native delivery source rather than accepted as a
  current-state checklist. Confirmed defects were fixed: meal workspace queries now use the bounded, domain-filtered
  `life.search` contract and its cursor; the Library root retains and appends its cursor; review metrics and coverage
  preserve actual values and link supported evidence back to records; Today and Health show real weight/steps/sleep
  states instead of a fact count or fabricated zero.
- Refund capture now selects a visible transaction and leaves currency validation to the existing exact CNY refund
  contract; foreign refunds remain explicitly unavailable instead of being converted silently. A manual meal accepts
  multiple food rows with optional positive decimal quantity/unit pairs and omits unknown nutrition. Single-file PDF
  shares have an explicit MIME entry.
- Travel initialization now honors `?trip=…`, treats a later blank selection as the user's location-collection choice,
  and fences late workspace responses by request sequence. Android read DTOs ignore additive unknown response fields
  while command inputs remain strict. Health Connect declares background read and requests it only when the provider
  reports the feature; denial keeps foreground manual sync available.
- Generated contracts, dependency boundaries, every TypeScript typecheck and the complete non-PostgreSQL suite pass
  (`151` pass, `23` database-gated skips, `0` failures). Android production-policy checks pass (`13` policy and `117`
  round-state assertions plus command/schema migration checks), and `:app:compileDebugKotlin` passes under JDK 17.
  No signed APK, deployment, production data export or physical-device claim is implied by this source-level audit.

## Samsung Health and Xiaomi scale integration (2026-09-13)

- The Android device layer now ports the reviewed Shadow Health `800af69` protocol baseline into the native Life
  client. Scale 2 `0x181B` stable frames and encrypted S400 MiBeacon frames retain the old AES-CCM decoder,
  low/high-frequency impedance merge, RTC correction, duplicate suppression and compatible body-composition trend
  formula. Android 10/11 location permission and Android 12+ nearby-device permissions are handled explicitly.
- Scale readings are no longer posted directly from a transient Bluetooth callback. Weight, impedance, heart rate
  and optional profile-derived composition are encoded as typed `health.ingest_raw` records and first committed to
  the account-bound encrypted Room queue. The S400 bindkey and optional calculation profile are stored through the
  Android Keystore and do not enter source, server configuration or logs.
- The vendor Samsung Health Data SDK 1.1.0 is compiled from an ignored, reviewed local AAR. All 25 SDK-supported read
  permissions are requested independently, directly readable types are exhausted through page tokens, and aggregate-
  only steps, activity summaries and goals are retained too. Provider UID/source/update metadata and all public fields
  are stored in raw archive revisions, including continuous series, exercise route/log data and swimming intervals,
  with oversized provider payloads split into ordered lossless chunks below the API command limit. Currently unused
  fields can therefore be projected later without recollecting the phone. Equivalent Health Connect
  permissions take precedence only for current step/sleep/exercise/weight projections; the Samsung originals are
  still archived without double counting. Builds without the AAR compile and expose an honest unavailable state.
- Device synchronization is now a first-level surface on Today and Health rather than a Settings-only action.
  Samsung automatically schedules an immediate unique read whenever an authorized user returns to Life. Samsung and
  Xiaomi status persists per account and exposes authorization/scanning, first BLE advertisement, stable reading,
  queued count, upload state, committed result, last weight and timestamp. A completed upload also refreshes the
  visible Health summary instead of requiring the user to find a manual reload path.
- The full Node/PostgreSQL run passes `176/176` with all 34 migrations on a fresh isolated database. Generated
  contracts, dependency boundaries, every TypeScript project, the Web production build, 13 Health policy assertions,
  117 Android round-state assertions, four production envelope validations, Room 5→6 and 6→7 migrations, five
  Xiaomi parser/formula fixtures, Samsung-AAR Kotlin compilation and the no-AAR fallback compilation all pass.
- This closes the source/build/package implementation, not physical-device evidence. No Android device is currently
  attached, so Samsung app authorization/registration, locked-screen scheduling and actual Scale 2/S400 radio capture
  still require installation on the target phone. Historical Health business-row migration also remains a separate
  guarded operation: it needs a restored source snapshot, verified owner→Life subject map and reviewed real-row
  reconciliation; provider cursors, sessions and keys are deliberately not migrated.

## Connected native experience follow-up (2026-09-13)

- Android `2.1.3` adds a searchable all-functions directory and domain-local creation actions, including first-level
  Samsung, Health Connect and Xiaomi scale operations. Empty workspaces keep their task entry points instead of
  becoming dead ends.
- Project, owned-item and review details now have owner-scoped exact-ID reads and independent loading, retry and
  unavailable states. Meal/payment and purchase/owned-item relations retain typed identifiers, render as navigable
  links and offer context-prefilled refund or owned-item actions instead of requiring users to copy internal IDs.
- The daily meal editor now uses removable food rows with explicit quantity and common-unit controls while retaining
  multiline paste as an advanced option. Correction reasons are optional in the UI and receive an explicit audit
  default at the repository boundary.
- Queued writes no longer trigger a knowingly stale immediate reload. The encrypted queue exposes verified committed
  receipts; the ViewModel detects every newly committed command even when reconciliation finishes out of order,
  replaces the provisional receipt and invalidates Today, Timeline, the active
  workspace, Planning or Library according to the committed capability. Assistant receipts use the same refresh path.
- The current delivery does not label every aggregate summary as a complete feature. Dedicated recipe, health-plan,
  recurring-plan, shopping-list/map/budget management screens, multi-destination sharing, attachment previews and
  object-scoped assistant conversations remain explicit product increments requiring their own read/write contracts
  and scenario acceptance; their current summaries continue to be read-only.

## Native Health and Meals visual workspace follow-up (2026-09-13)

- Android Health is no longer a generic record list. Its native workspace now presents a real 90-day weight chart,
  selectable body-composition trends, period deltas, source-labelled measurement history, activity and sleep cards,
  fixed module navigation, and compact Samsung/Health Connect/Xiaomi status. Missing values remain visibly missing;
  the UI does not invent a health score, nutrition target, sleep stage or causal conclusion.
- Android Meals now groups the selected day by meal, totals only food rows with recorded nutrition, labels incomplete
  coverage and estimates, exposes meal-plan/shopping context, and shows authenticated protected meal-photo previews.
  The bounded meal read adds optional source preview metadata without exposing bytes publicly or breaking older API
  responses. Migrated `legacy_health_photo` assets and new `meal_photo` sources share the same protected preview path.
- Generated contracts, relevant TypeScript projects, 139 non-PostgreSQL tests (23 database-gated skips), the isolated
  full PostgreSQL Life journey, 130 Android Health policy/round assertions, four production envelope checks, Room
  migration checks and Android `:app:compileDebugKotlin` pass. No APK, deployment, production write or physical-device
  claim is implied by this UI increment.

## Native visual workspace completion follow-up (2026-09-13)

- The Android root experience now follows the fixed `Today / Records / Assistant / Plans / Library` information
  architecture. Today presents one primary context, four stable Health/Money/Travel/Items entrances, truthful lightweight
  state, quick capture, upcoming work and compact device status instead of leading with an undifferentiated function list.
- Records now has domain and time filters, grouped visual timeline cards, global result cards and a capture entry that opens
  the complete recorder. Plans now includes a seven-day strip, real agenda actions, project progress, items and traceable
  reviews. Library exposes stable type filters and visually differentiated file, image, link, note and ticket cards.
- Money now has an actual month workspace with currency-scoped bars, entry composition, server-calculated budget progress,
  recurring plans, due occurrences, spending intents and a dedicated details view. It never sums different currencies or
  relabels merchants as authoritative categories.
- Travel now consumes the existing bounded workspace payload instead of reducing it to counts: current/upcoming trips,
  saved places, theme maps, day plans, segments and uploaded tracks are visible. The native map plots only persisted
  coordinates and track points, supports theme-map filtering, and explicitly stays empty when coordinates are absent.
- Items has a dedicated discoverable workspace for owned state, warranty/return attention, events and documents while its
  detail remains the single source of truth. Unsupported facts are not manufactured merely to fill a card or chart.

## Health Connect default-off follow-up (2026-09-15)

- Android now defaults `HEALTH_CONNECT_ENABLED` to `false`. Disabled builds do not enqueue or resume Health Connect
  work, and a previously queued worker exits successfully without reading permissions, creating source-state commands
  or competing with the Samsung direct projection path.
- Today, Health, Settings and the searchable function directory omit Health Connect actions and status when disabled.
  Historical Health Connect records keep their factual provenance labels, but stale source/cursor state no longer
  contributes to the visible device-attention count.
- Samsung Health direct sync and Xiaomi scale reception remain visible and operational. Both default-off and explicit
  opt-in builds compile with the reviewed Samsung Health Data SDK; Android unit tests and the production Health policy,
  round-state, envelope and Room migration checks pass.
