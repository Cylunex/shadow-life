# Bill imports and historical reconciliation

Use the supported Life CLI and discovered capability schemas. No direct SQL/business writes,
alternative ledger or new review queue. A closed historical task is evidence to inspect, not an
instruction to replay its import. Keep private originals, plans and receipts outside the repository.

## Normal path and coverage

For a new statement, upload its opaque original with `assets.upload_local_file`, then call
`money.import_file` once with the returned immutable asset version, source account/platform, time zone
and any user-supplied ZIP password. Keep the password out of task text, notes, logs and examples.
Let Life decode and process rows. Read `money.import_file_status`; a successful import command can
still return `needs_input`. It does not mean all transactions were booked.

For historical exceptions, reuse existing originals, file objects and batches. Page through
`money.import_history` until the returned cursor is exhausted, keeping filters unchanged; read each
relevant `money.import_review` once, then refresh only affected batches. Page record searches through
their `next_cursor` and read full record/source details only for potential matches. A month response's
displayed batch list can be truncated even when its totals cover the full month.

Maintain a small private checkpoint containing scope, cursors, candidate IDs/revisions, evidence refs,
planned decisions and execution results. Keep user amendments separate from regenerated analysis.
Resume from this checkpoint and authoritative readback, not a new collection of one-off write scripts.
Do not rerun historical plan generators that could overwrite later user decisions.

Report candidate counts separately from financial events: duplicate exports can produce many candidates
for one transaction. In batch review, remaining = `pending + invalid`; file status `pending` already
includes both. Do not add those counts together. Save the initial financial aggregates by currency
using the authorized summary/read tools, with the same scope for the final comparison.

## Classify only unresolved candidates

Read `raw`, immutable `source_proposed`, current `proposed`, issues, warnings and duplicate links together.
An unmapped payment-method warning does not by itself require the user to re-enter the bill.

| Evidence | Action |
| --- | --- |
| Same platform/account, exact event ID, matching source facts and an existing record | Reuse the record; end the duplicate candidate with its evidence. Changed amount, date or direction is a conflict to resolve, not an update to the old payment. |
| Same order with payment plus one or more refunds | Treat each as its own event. Prefer explicit refund IDs; the shared order ID alone cannot distinguish multiple refunds. Do not invent IDs by stripping or appending a suffix. |
| `36.50元` or `36.50(已退款6.50)` in a supported source | Preserve the raw text and original payment of 36.50. A separate evidenced refund of 6.50 may be linked; do not silently record a net payment of 30.00. Unsupported annotation formats remain exceptions. |
| Payment status changed to 已退款 / 已部分退款 | Status alone is not a new refund event. Inspect direction, type, event ID and actual refund evidence. |
| Explicit zero self-payment, closed/unsettled transaction, 不计收支 or non-cash reward | Do not manufacture a cash expense. Record the exclusion reason and retain the source; an unresolved status cannot be overridden by correcting ordinary amount fields. |
| Same amount/date, different merchant, or uncertain cross-channel link | Search and inspect sources; never auto-merge or void based on similarity alone. Ask only for the fact that changes the decision if evidence cannot resolve it. |

Merchant aliases confirmed for one transaction apply to that transaction. Do not set `remember_rule`
unless the user actually wants a reusable merchant rule. A user's exclusion of one tiny refund is
also a single-event instruction, never a global minimum-amount rule.

## Refunds and historical duplicates

For every new refund, find the original **money entry** ID, not the consumption record ID. Read its
confirmed state, currency, amount, existing linked refunds and remaining balance. Check refund date
and other channels before writing. `possible_existing_refund` requires evidence review;
`refund_balance_exceeded` is not a missing-original problem and must not trigger a fabricated payment.
Distinct, proven partial refunds may use the existing manual resolution path with explicit original ID.

If the original is absent, inspect retained sources and completed/ignored candidates before asking
the user. A closed original and fully refunded order can be ended without inventing isolated ledger
facts only when the complete, deduplicated event set proves net zero and no original payment is booked.
Otherwise retain the exception and ask for the necessary fact. Never ignore a refund just because its
original lookup failed.

When correcting historical duplicates, compare platform/account and exact source IDs first. If those
are unavailable across channels, inspect amount, currency, direction, second-level payment time,
merchant, payment card and complete ordered item details as available. A date-only record is not a
midnight timestamp. Conflicting evidence remains unresolved; a match on date/amount is insufficient.

Prefer the verified record with purchase items, meal links and original sources over a later
money-only copy. Read refund and other relationships before using `money.void_entry` on a proven
duplicate with its current revision and reason. Retain original sources and audit history; do not
delete and recreate rich records. Read back both the retained and voided records and their links.
For an already processed capture, reuse its source and linked result: synced capture status alone
does not prove the bill was handled, and an existing business result must not be entered again.

## Execute, recover and close

- For authorized exceptions, use `money.resolve_import_candidate` with the current
  `expected_revision` and a specific evidence-backed reason. Use corrections only when supported by
  source/user facts. Skip terminal candidates; never reconfirm them to get a fresh receipt.
- Keep one stable `command_id` and exact input per intent. Inspect `isError` and committed receipt;
  the receipt identifier is **`execution_id`**, not `operation_id`. Recover an unknown outcome with
  `operations.find` before retrying unchanged input. Stop dependent writes on unresolved conflicts or
  unknown outcomes; read current revision/facts before preparing a new correction intent.
- Preserve execution IDs, affected references and readback in the checkpoint. Re-read all affected
  batches and new/changed records; verify refunds point to the intended original and excluded/voided
  records retain their sources. Compare expenditure, refund and net changes separately by currency.
  Use decimal arithmetic, and account for concurrent unrelated changes rather than claiming an
  unexplained aggregate difference as success.
- Only claim the authorized scope complete when its unresolved counts and financial changes reconcile.
  Read the current `agent.tasks` object, revision and lease; then `agent.save_task` with final evidence,
  `state: completed`, empty `missing` and `next_step`. The schema's `operation_ids` array contains actual
  receipt **execution IDs** (at most 30); retain the full receipt set in the private checkpoint and
  preserve relevant existing refs. Task state is not a substitute for business verification.
- If the work also has a Losna/product item, use that runtime's existing supported work API with its
  current version, execution epoch and source authority, then read its production product view back.
  Update only a commitment that actually exists; legacy work can have no commitment ID. If the runtime
  capability is unavailable, report the remaining closeout explicitly instead of inventing a link or
  changing a private store. Life completion and product work completion are separate states to verify.

Conclude with processed/new/refund/duplicate counts, remaining exceptions, verified scope and retained
originals. Do not claim all historical accounts are duplicate-free from a limited reconciliation.
