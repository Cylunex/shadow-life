import assert from "node:assert/strict";
import test from "node:test";
import { buildItemAttention, buildStockAttention } from "../src/planning-attention.js";

test("stock deadlines retain unknowns and empty batches, with calendar-day timezone boundaries", () => {
  const lots = [null, "2026-10-21", "2026-10-22", "2026-10-29", "2026-10-30"].map((expires_on, index) => ({ id: `lot_test_${index}`, quantity: "0.000001", expires_on }));
  lots.push({ id: "lot_empty_test", quantity: "0.000000", expires_on: "2026-01-01" });
  const shanghai = buildStockAttention(lots, "2026-10-21T17:00:00Z", "Asia/Shanghai");
  assert.equal(shanghai.on, "2026-10-22");
  assert.deepEqual(shanghai.items.map(item => item.state), ["unknown", "past", "today", "soon", "later", "empty"]);
  assert.equal(buildStockAttention(lots, "2026-10-21T17:00:00Z", "America/Los_Angeles").items[1]?.state, "today");
});

test("item deadlines use explicit assessment day, separate windows, and exclude non-owned items", () => {
  const items = ["owned", "gifted", "returned", "disposed", "lost"].map((ownership_state, index) => ({ id: `owned_test_${index}`, ownership_state, return_by: "2026-03-09", warranty_ends_on: "2026-04-01" }));
  const result = buildItemAttention(items, "2026-10-22T00:00:00Z", "America/New_York", "2026-03-07");
  assert.equal(result.items[0]?.return_window.days_until, 2);
  assert.equal(result.items[0]?.warranty.state, "soon");
  assert.ok(result.items.slice(1).every(item => item.return_window.state === "inactive" && item.warranty.state === "inactive"));
  const unknown = buildItemAttention([{ ...items[0]!, return_by: null, warranty_ends_on: null }], "2026-10-22T00:00:00Z", "UTC");
  assert.equal(unknown.items[0]?.warranty.state, "unknown");
});
