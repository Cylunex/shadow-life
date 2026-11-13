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
| Statement import / historical bill reconciliation | `money.import_file`, `money.import_file_status`, `money.import_history` / `money.import_review` | Follow [bill reconciliation](bill-reconciliation.md) for exceptions, evidence, resumable corrections and task closeout |
| Spending / consumed-item rankings | `life.consumption_stats` | Explicit date window, counting unit, currency and coverage |
| Backfill captured paid bills | `life.activities` / `life.search`, `life.activity_source`, `life.record_captured_expenses` | Use existing capture IDs; preserve originals and platform/account identity; read linked records after the receipt |
| Historical record lookup | `life.search`, domain record tools | Date/type filters and `next_cursor` |
| Owned goods / replenishment | `life.owned_items`, `life.save_owned_item`, `money.set_use_cycle` | Actual acquisition, package size and comparable units |
| Budget / recurring expense | `money.set_budget`, `money.set_recurring_plan` | Plans do not automatically create paid transactions |
| Life project or next action | `life.projects`, `life.save_project`, `life.save_action_item`, `life.planning_agenda` | Read current references before editing the complete structure |
| Meal plan / shopping list | `life.meal_planning`, `life.save_meal_plan`, `life.build_shopping_list` | Planning, buying and eating are distinct states |
| Health fact / goal | `health.record_measurement`, `health.set_plan` | Manual fact/explicit goal, not synthetic device readings |
| Travel map / day plan | `travel.workspace`, `travel.save_place`, `travel.save_map`, `travel.set_day_plan` | Actual visits require a separate explicit fact |
| Save a note / attachment | `library.capture`, `library.revise`, `library.get_item` | Original and revision remain traceable |

Availability is the intersection of the CLI profile and the server's current permissions. Use the
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
- When a food label, catalog entry or supported portion estimate is available, record `energy_kcal`
  and all three macros: `protein_g`, `fat_g`, `carb_g`. Do not leave fat/carbs out merely because
  protein was available; do not derive missing macros from calories alone.
- For a habitual branded drink, query `life.food_catalog` before logging it. A catalog value of `"0"`
  is a known zero to send explicitly; an omitted field is unknown. Keep package-specific uncertainty
  in `evidence_note` when using an estimate.
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
3. For purchase-only orders, call `life.record_purchase` with `sources` (1–20 distinct originals)
   using `order_screenshot`, `receipt` or `evidence`. Verify each receipt resource of type `source`
   by its `id` and `asset_version_id` in `life.get_record` with the receipt's `record_id`.
   When the catalog only offers `source`, it supports one original. Use the single `source` field
   for an individual image or text record. For an existing meal, use
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
the schedule's notification policy. The skill itself does not send messages or create schedules.

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

## Consumables: purchase → pending → use

- For a purchase the user wants to track, pass `life.record_purchase.consumables` with zero-based
  `item_position`. The purchase, optional payment and pending tracker commit atomically. Supply only
  explicit quantities; package count is not the number of units inside it. `quantity_unit=count` plus
  `quantity_label` represents bags, rolls, heads, etc.; grams and millilitres use `g` / `ml`.
- Read user conventions first. Do not track every grocery run automatically. A weekly food restock
  exclusion affects extra consumable tracking, never whether the actual purchase/payment is recorded.
- For an existing purchase, search by product and read `life.get_record` plus `money.planning` before
  `money.set_use_cycle`. Link the original `purchase_record_id` and exact `purchase_item_id`; never
  duplicate the payment. A folded order does not prove the other product lines: safely supplement
  only supported facts with `life.update_purchase_items` first.
- `usage_state=pending` means opening/current stock are not yet known. Its `started_on` is the
  purchase/registration date, not an invented opening date. Old purchases must not become claims
  about present inventory. Pending trackers have no remaining balance or depletion forecast.
- When opening is explicitly known, use `usage_state=in_use` and the real `started_on`, with the
  quantity of this batch. Query the current revision and preserve other fields on updates.
- For manual consumption, call `money.record_consumable_use` with the cycle version, actual local
  date and quantity in the cycle's unit. It adds no expense. Correct/void a mistaken use with its
  `use_id` and `reason`; use the original command key to recover uncertain outcomes.
- Oats can retain exact-name/food-ref intake matching. Never also log manual consumption for a cycle
  matched to intake. Use a new cycle for a new package/batch after ending the previous one.
- `expected_daily_usage` is an estimate, not a daily actual-use event. Read back
  `consumed_quantity`, `remaining_quantity` (from recorded uses), `estimated_remaining_quantity`
  (rate estimate) and `projected_depletion_on` with their different meanings. Do not invent an
  opening date, toothbrush replacement interval or grams per bag. Unknown specifications stay unknown.
- `money.planning` lists up to 100 cycles relevant to its month, and the last 50 manual uses per
  cycle. Respect `truncated.use_cycles` and `uses_truncated`; balances use all effective facts.

## Health and nutrition review → grounded planning

1. Discover “饮食复盘” / “健康周报” with schemas, then call `life.wellness_review`
   with an explicit end date and 7, 30 or 90 days. The preceding equal-length period is included.
   Call `life.wellness_review` with `{ "to": "2026-10-23", "days": 7 }`.
2. State dates, recorded meal days, field coverage, estimated counts and known health days before comparing.
   A nutrient's `average_on_complete_days` only covers field-complete **recorded** items on those dates;
   it does not establish a complete food diary. Missing fields/dates are unknown, explicit zeros are known.
   Nutrients are multiplied once by `consumed_fraction` (default 1). Do not scale supplied nutrients twice.
3. Read selected sleep/weight evidence with `health.get_record` using returned IDs and revisions.
   For meal evidence, use `life.search` with `types:["meals"]`, `from_on`, `to_on_exclusive`, follow
   `next_cursor`, then `life.get_record` on returned IDs. The date policy uses stored local dates and sleep
   wake dates; a cross-time-zone trip is not one normalized time zone. Do not infer causal relationships,
   TDEE, calorie deficits or medical conclusions from paired days or period differences.
4. For “下周怎么吃 / 练”, read `agent.workspace` with explicit dates and scenario, `agent.intentions`,
   `life.meal_planning` for recipes/stock and `health.workout_progression` for actual training evidence.
   Respect declared dietary restrictions and valid goals; missing intentions are not invented preferences.
   Keep purchases/spending, planned meals and actual intake separate. Only read Money/Library/Travel when
   the task needs them and the capability is available.
5. Save a requested meal plan through `life.save_meal_plan`; a requested shopping list through
   `life.build_shopping_list`. Missing nutrition never blocks ordinary logging. If the user asks to correct
   nutrition, inspect original labels/catalog entries and current revision first, then use
   `life.correct_intake` for the supported facts. For “I only ate half”, open the meal,
   identify the actual intake item and read its revision. Send `item_id`, `expected_revision`,
   `consumed_fraction: "0.5"` and the correction reason. Read the same meal back and verify that
   item's fraction. Supply the fraction against the original serving and nutrients, exactly once.
   If the order has no confirmed intake yet, record the user's first meal and link the existing
   purchase. A replacement `item` is only for editing the whole food line.
6. Save a model observation only when requested/appropriate through `agent.save_learning`, with verified
   business references, limits and workflow revision. A read result is not a save receipt; verify all writes
   through the original command's committed receipt and read-back. Do not create notifications or schedules
   merely because a review mentions a recurring habit.

### 从七天复盘约定一个行动

先读 `life.wellness_review`。用户选定一件愿意做的事后，按当地自然周（周一开始），用已有 `agent.set_intention` 保存健康目标。例如为 2026-11-09 这一周保存以下输入。没有结果时省略 `goal_outcome`。

```json
{"scope":"health","key":"wellness.week.2026-11-09","kind":"goal","category":"goal","statement":"周三晚饭后散步一次","assertion":"explicit","valid_from":"2026-11-09","valid_to_exclusive":"2026-11-16","state":"active"}
```

下次用 `agent.intentions` 精确查上周、本周和下周。已过期目标也要取回，才能回答“上周说的事做了吗”。

```json
{"on":"2026-11-15","scenario":"health","keys":["wellness.week.2026-11-02","wellness.week.2026-11-09","wellness.week.2026-11-16"],"include_inactive":true,"limit":10}
```

只使用 `scope=health`、`kind=goal` 的匹配行。本人明确回报结果时，用原字段、原 ID 和当前 `expected_revision` 再调用 `agent.set_intention`，附更正原因。已完成写 `goal_outcome="completed"`，本人明确没做写 `"not_done"`，撤回结果写 `null`。缺记录时保持未知。同周改约定要更新原目标，与复盘有关的建议本身不产生目标或提醒。

### 从所购物品找回售后原件

从 `life.get_record` 的购买明细选择本人明确持有的一项，以其 `purchase_item_id` 执行 `life.save_owned_item`。仅填写订单或本人提供的 `return_by`、`warranty_ends_on`。物品详情中的 `purchase.record_id` 可回到原消费记录，`sources` 中有权访问的资产版本即原件。更新时省略 `purchase_item_id` 或 `documents` 保留各自关联，显式传 `null` 或空数组才移除。订阅续费沿用 `money.planning` 和已有周期实例的处理入口。

### 晨起感受与力量训练回看

- 以 `health.morning_window` 读取所选时区和醒来日截至的 14 天。本人明确填写时用 `health.save_morning_checkin`，更正沿用该晨评的修订。缺测或未填保持未知。
- 以 `health.exercise_history` 传入动作 ID、器械和次数／秒数单位，读取最多三次有效训练。换动作时仅实际完成的组进入 `health.record_workout`。

- 用 `travel.connections` 查旅程中当前可见的衔接。保存手填估时用 `travel.save_connection`，带日计划修订、出发点和相邻停留或已确认预订；改动已有估时还需其自身修订。负余量表示按该估计无法按时到达。

- 菜品偏好用 `life.dish_preferences` 按门店查找。本人明确标记时调用 `life.save_dish_preference`，带门店、地点或渠道、菜名与做法；已购可关联确认的购买行，想试的菜可手记。修改或清除带当前修订。整单评价继续走 `life.correct_purchase`。

- 「上次是什么时候」用 `life.interval_events` 按当地日期查看；新事项用 `life.save_interval_event`，明确发生或补记用 `life.record_occurrence`。可传既有核销或物品事件 ID 引用其实际日期；源记录撤销或失去权限后，查询自动重算相邻间隔。
