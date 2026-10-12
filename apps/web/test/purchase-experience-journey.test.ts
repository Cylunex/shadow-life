import assert from "node:assert/strict";
import test from "node:test";
import { buildPurchaseExperience } from "../src/purchase-experience.js";
import { pgOnly, reviewFixture } from "../../../packages/database/test/review-fixture.js";

test("catalog validation leaves persistence unchanged and experience corrections preserve money, raw metadata and revision history", pgOnly, async t => {
  const { run, queries, context, pool, executor, command } = await reviewFixture(t);
  const purchase = await run("life.record_purchase", { occurred_on: "2026-10-12", occurred_at: "2026-10-12T04:00:00Z", time_zone: "Asia/Shanghai", scene: "offline_purchase", merchant_name_raw: "示例咖啡店", channel_name_raw: "线下", place_ref: "place_example", note: "订单备注", items: [{ raw_name: "咖啡", quantity: "1", unit: "杯" }], payment: { amount: "20.00", currency: "CNY", occurred_on: "2026-10-12", time_zone: "Asia/Shanghai" } });
  const id = purchase.actual_values.record_id as string;
  const before = await queries.lifeRecord(context, id) as Record<string, unknown>;
  const input = buildPurchaseExperience(before, { rating: "4", wouldRepeat: "no", note: "咖啡不错，但不想再排队" });
  const count = async () => (await pool.query("select (select count(*) from operations) as operations, (select count(*) from money_entries) as entries, (select count(*) from consumption_record_revisions) as revisions")).rows[0];
  const original = await count(), metadata = queries.agentDiscover(context, { query: "复购" });
  assert.ok(metadata.capabilities.some(item => item.name === "life.correct_purchase"));
  assert.equal(queries.validateAgentTool(context, { name: "life.correct_purchase", input }).executed, false);
  assert.deepEqual(await count(), original);
  const correction = command("life.correct_purchase", input), receipt = await executor.execute(context, correction);
  assert.equal((await executor.execute(context, correction)).replayed, true);
  const after = await queries.lifeRecord(context, id) as any;
  assert.equal(after.purchase.rating, 4); assert.equal(after.purchase.would_repeat, false);
  assert.equal(after.purchase.merchant, "示例咖啡店"); assert.equal(after.purchase.channel_name_raw, "线下"); assert.equal(after.purchase.place_ref, "place_example");
  assert.equal(after.purchase.occurred_at, "2026-10-12T04:00:00.000Z");
  assert.deepEqual(after.money_entry, (before as any).money_entry);
  const totals = await count(); assert.equal(Number(totals.entries), Number(original.entries)); assert.equal(Number(totals.operations), Number(original.operations) + 1); assert.equal(Number(totals.revisions), Number(original.revisions) + 1);
  assert.equal(receipt.status, "committed");
  await assert.rejects(() => run("life.correct_purchase", input), /revision/);
});
