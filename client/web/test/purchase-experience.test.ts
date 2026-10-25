import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPurchaseExperience, initialPurchaseExperience } from "../src/purchase-experience.js";
import { PurchaseExperiencePanel } from "../src/PurchaseExperiencePanel.js";

const detail = { kind: "record", record_id: "record_experience_1234", revision: 3, state: "confirmed", occurred_on: "2026-10-12", occurred_at: "2026-10-12T04:00:00Z", time_zone: "Asia/Shanghai", note: "原始订单备注", purchase: { merchant: "示例咖啡店", scene: "offline_purchase", channel_name_raw: "线下", place_ref: "place_example", rating: null, would_repeat: null, occurred_on: "2026-10-12", occurred_at: "2026-10-12T04:00:00Z", time_zone: "Asia/Shanghai", note: "原始订单备注" } };
test("unknown experience has no invented rating or repeat decision", () => {
  assert.deepEqual(initialPurchaseExperience(detail), { rating: "", wouldRepeat: "", note: "原始订单备注" });
  const input = buildPurchaseExperience(detail, initialPurchaseExperience(detail));
  assert.equal(input.rating, undefined); assert.equal(input.would_repeat, undefined);
});
test("experience correction preserves the existing purchase identity, revision, dates and raw metadata", () => {
  const input = buildPurchaseExperience(detail, { rating: "5", wouldRepeat: "no", note: "咖啡不错，但是太远" });
  assert.equal(input.expected_revision, 3); assert.equal(input.record_id, detail.record_id);
  assert.equal(input.occurred_at, detail.occurred_at); assert.equal(input.channel_name_raw, "线下"); assert.equal(input.place_ref, "place_example");
  assert.equal(input.rating, 5); assert.equal(input.would_repeat, false); assert.equal(input.merchant_name_raw, "示例咖啡店");
  assert.throws(() => buildPurchaseExperience(detail, { rating: "0", wouldRepeat: "", note: "" }));
});
test("experience form offers explicit unknown values and uses the normal save entry", () => {
  const html = renderToStaticMarkup(React.createElement(PurchaseExperiencePanel, { detail, execute: async () => { throw new Error("unused"); }, onChanged: async () => {} }));
  assert.match(html, /未评分/); assert.match(html, /未决定/); assert.match(html, /保存体验/);
});
