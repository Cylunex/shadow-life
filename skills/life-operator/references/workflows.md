# Shadow Life workflows

## Choose the smallest coherent operation

| User intent | Preferred tools | Meaning |
|---|---|---|
| Record an actual meal | `life.record_meal` | Only confirmed intake; optional independent payment |
| Eaten meal plus order/merchant/images | `life.record_dining` | `consumed_items`, `purchased_items`, `payment`, `sources` commit atomically |
| Groceries or goods bought for later | `life.record_purchase` | Purchase/payment only; does not invent intake or owned inventory |
| Same breakfast or usual drink | `life.food_catalog`, `life.record_meal_from_template` | Reuse an explicit saved template or verified recent composition |
| Correct consumed quantity/time | `life.get_record`, `life.correct_intake` / `life.correct_meal` | Current exact item/meal revision, retaining history |
| Fill missing order line items | `life.update_purchase_items` | Repair the original purchase without a second charge/order |
| Refund | `money.record_refund` | Link to the original money entry; the meal remains consumed |
| Spending / consumed-item rankings | `life.consumption_stats` | Explicit date window, counting unit, currency and coverage |
| Historical record lookup | `life.search`, domain record tools | Date/type filters and `next_cursor` |
| Owned goods / replenishment | `life.owned_items`, `life.save_owned_item`, `money.set_use_cycle` | Actual acquisition, package size and comparable units |
| Budget / recurring expense | `money.set_budget`, `money.set_recurring_plan` | Plans do not automatically create paid transactions |
| Life project or next action | `life.projects`, `life.save_project`, `life.save_action_item`, `life.planning_agenda` | Read current references before editing the complete structure |
| Meal plan / shopping list | `life.meal_planning`, `life.save_meal_plan`, `life.build_shopping_list` | Planning, buying and eating are distinct states |
| Health fact / goal | `health.record_measurement`, `health.set_plan` | Manual fact/explicit goal, not synthetic device readings |
| Travel map / day plan | `travel.workspace`, `travel.save_place`, `travel.save_map`, `travel.set_day_plan` | Actual visits require a separate explicit fact |
| Save a note / attachment | `library.capture`, `library.revise`, `library.get_item` | Original and revision remain traceable |

Availability is the intersection of the MCP profile and the server's current permissions. Use the
schema actually exposed by the tool; do not infer optional features from this table alone.

## Input rules that prevent failed writes

- `command_id` starts with `cmd_`, followed by 8–120 characters from letters, digits, `.`, `_`, `:` or `-`;
  the first character after `cmd_` must be alphanumeric. Example: `cmd_lunch_20260922_001`.
- Assign the key once per user intent, keep it with the input, and reuse it unchanged after a timeout.
  Never reuse a fixed example key for unrelated records.
- Decimal amounts and quantities are strings. Ordinary CNY payment is positive with exactly two decimal
  places (`"15.00"`). Foreign entries use `money.record_foreign_entry` and preserve original currency.
- Purchase line names use `raw_name`; consumed food names use `name`. Purchase commands require `scene`.
- Unknown optional values are omitted, not `null`, empty strings or fabricated zeroes. `quantity` and
  `unit` must appear together. Unknown nutrition is valid; an estimate needs `estimate: true` and an
  `evidence_note` explaining its basis and uncertainty.
- `occurred_on` is the factual local date. Include `time_zone`; include `occurred_at` only if the actual
  time is known, with an offset that lands on that date in the supplied zone. Purchase/payment time,
  meal time and evidence capture time may differ. Relative dates use the current conversation's date,
  not a stale transcript timestamp. “照常” may reuse composition, not yesterday's clock time.
- A source needs `original_text` or `asset_version_id`, and `captured_on` or `captured_at`.
  `captured_at` also needs `time_zone`. Preserve the user's uncertainty in notes.

## Order, payment and intake

When an eaten meal has an order screenshot, prefer `life.record_dining`: use `purchased_items` for
actual order lines, `consumed_items` only for what the user actually ate, the actual paid amount in
`payment`, and all relevant uploaded originals in `sources`. This avoids creating an unlinked purchase
or charging again after recording the meal.

An advertised item, free gift, recommended product or delivered quantity is not proof of consumption.
If a gift was not delivered, do not add it to intake. If the user says “noodles half eaten, toppings all
finished”, preserve those separate facts; do not invent an exact combined fraction from assumed
noodle/topping weights. Keep unknown portions and nutrition unknown unless there is a stated estimate.

A purchase for the week is not a meal. Record only explicitly consumed portions separately, and link
to the purchase with `life.link_meal_consumption` when appropriate. Eating less does not reduce the
purchase payment. A refund does not erase consumed food. Check existing linked records before adding
another payment or treating “paid” as net after an already recorded refund.

## Images and attachments

1. Use the exact inbound image path provided by the messaging runtime. Call
   `assets.upload_local_image` for each relevant original; do not search arbitrary files.
2. Use the returned immutable `asset_version_id`. With `life.record_dining`, include every original
   in `sources` with its role (`meal_photo`, `order_screenshot`, `receipt` or `evidence`), so the link
   and business facts commit together.
3. With a single-source command, put the first image in `source`. For an existing meal, use
   `life.attach_meal_source` with the latest `expected_meal_revision`.
   This tool's roles are `meal_photo`, `order_screenshot`, `evidence`, `replacement`; a receipt uses
   source `kind: receipt` and role `evidence`. It does not accept role `receipt`.
4. For `life.record_dining`, read `life.get_record` using the receipt’s `consumption_record_id` to verify
   all linked originals. The meal detail contains meal photos/evidence; order screenshots and receipts
   belong to the linked purchase. Read `meal_id` as well when verifying actual intake. For a simple meal,
   read its `meal_id`. Verify each expected version is linked and preserve distinct image roles.
   Upload success, `kind: image`, OCR text and a local filename alone do not prove association.

Uploads are restricted to configured media-cache directories and supported raster formats, up to
20 MiB. If no upload tool is available, report that the original cannot currently be attached. Keep
reliably recorded text facts where appropriate, but do not claim the original image was saved/linked.

## Corrections and recovery

Search date/merchant/source/order/record first; read the exact object and current revision. Use the
receipt's resource IDs and revisions rather than guessing an ID type. Meal revision and intake-item
revision are different: use the field required by the correction tool. After one correction or image
attachment, use the newly returned revision for the next change.

| Result | Next step |
|---|---|
| `committed`, including `replayed=true` | Already saved; do not create another record |
| `validation` / `missing_fact` | Fix listed fields; ask only for necessary unknown business facts |
| `outcome_unknown` | `operations.find` with the original `command_id`; if unresolved, only identical input/key may be retried |
| Receipt lookup `not_found` | Does not prove the original write failed; it may be in flight or no longer visible |
| `conflict` | Read current facts and reconcile; never blindly bump revision or replace the command key |
| `retryable_not_applied` | Retry the same key/input after the reported condition clears |
| Authorization or contract mismatch | Report the actual connection/version issue; do not bypass the service |

Do not automatically retry a write with modified facts under the old key. A consciously revised user
intent after checking current facts is a new command. A successful query of an earlier receipt is not
another write, and a replay is not an additional meal/expense.

## Queries, completeness and reminders

Use `life.search` with `from_on` inclusive and `to_on_exclusive` exclusive for a historical window.
Omit `q` to read the complete bounded date window; `types` uses domain names such as `meals`, not `meal`.
Follow returned cursors unchanged until the relevant window is complete; a bounded first page is not
an all-time total. Prefer `life.consumption_stats` for rankings instead of counting sampled search
rows. State the period, counting unit, currency and incomplete/folded-detail coverage.

“吃得最多” means actual consumed items/portions; “点得最多” means order lines/orders; “最常去” requires
actual visits or in-person purchases, excluding delivery. Do not sum currencies or incompatible units.
Use verified aliases, without silently merging separate branches/products.

A daily completeness check calls `life.daily_record_check` once for the requested local date and zone.
Only `confirmed_omissions` and `actionable_messages` justify omissions. Unknown same-night sleep is
pending data, and source faults require explicit source evidence. Do not invent nutrition, step,
exercise or habit targets. A weekly check must cover all seven requested dates, not merely today.

For an existing scheduled reminder that asks for silence on no change, remain quiet when there is no
confirmed actionable result. A tool failure is not a record omission; report the genuine failure per
the schedule's notification policy. The MCP itself does not send messages or create schedules.

## Plans, inventory and travel

Read current referenced objects before writing a plan. `save_project`, meal plans and map updates may
replace a whole versioned structure; preserve fields and relationships not changed by the user.

A reminder should attach to the native plan/item where supported, and is not proof of external delivery.
For depletion estimates, use verified package size and comparable units; unknown specification remains
`needs_specification`. Do not infer grams from a bag count or copy a previous purchase's size without evidence.

For a map, reuse real `place_id` values from `travel.workspace`, creating missing places first. Save the
full desired item list with `map_id` and `expected_revision` on updates. Candidate/anchor/planned states
do not imply a visit. Actual visits and private reservation details retain their domain visibility.

## Prepaid service cards (次卡 / 服务权益)

- When a user records buying an N-use haircut card, car-wash card or lesson package, record its purchase/payment once, then `money.save_service_card` with the stated `total_units`, factual start date, merchant and the returned existing `purchase_record_id`. If the payment already exists, reuse it; do not record it again. Omit unknown expiry. A renewal with newly purchased units is a new card linked to its own purchase, not an edit that erases the old card's use history.
- Search `money.service_cards` by card name/merchant or `purchase_record_id` before creating a card or recording a use. Follow `next_after_id` when more cards remain. If several cards could match “那张卡”, ask only which card.
- Buying eight uses does not prove the user used one that day. Record `money.record_service_card_use` only for explicitly reported usage: read the card by `id`, send its current `expected_revision`, actual `occurred_on`, and positive integer `units`. No money entry is created for redemption. Record an extra payment separately only if the user reports one.
- `total_units`, `units`, and `expected_revision` are JSON integers (unlike money's decimal strings). Start/expiry dates are inclusive. Historical uses can be added after calendar expiry if the actual use date was valid; future uses and overdraws are rejected.
- To correct or undo a mistaken deduction, read by card `id`, select the existing `use_id`, preserve the actual date and units as appropriate, and call the use tool with the current **card** revision and a reason; `state: voided` reverses that deduction without deleting history. All card edits and use writes advance the card revision. Do not simulate a correction by making another use or changing total units.
- `money.save_service_card` updates replace metadata; preserve existing start, expiry, merchant, purchase, unit, state and note unless the user changes them. A closed card can be reopened explicitly; expired/unusable cards still show the unconsumed units and their status.
- Read back `money.service_cards` by `id` after writes. Confirm original purchase link, total, recorded used and remaining units. Follow `next_uses_before_id` via `uses_before_id` for older history; the balance always covers all effective uses, including those outside the displayed page.
- Report “总共 8 次，已记录使用 1 次，剩余 7 次”. If historical usage is unknown, say “尚未记录使用” instead of asserting the user has never used it. These service uses are not dietary intake and do not belong in `money.set_use_cycle` matching rules.
