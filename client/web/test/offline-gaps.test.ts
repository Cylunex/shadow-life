import assert from "node:assert/strict";
import test from "node:test";
import { offlineGaps } from "../src/offline-gaps.js";

test("gaps merge overlapping observations and reserve the tail until the last page", () => {
  const rows = [
    {started_at:"2026-11-17T23:00:00Z", ended_at:"2026-11-18T00:00:00Z"},
    {started_at:"2026-11-17T22:30:00Z", ended_at:"2026-11-17T23:30:00Z"},
  ];
  const partial = offlineGaps("2026-11-18", "Asia/Shanghai", rows, false);
  assert.deepEqual(partial, [{start:Date.parse("2026-11-17T16:00:00Z"),end:Date.parse("2026-11-17T22:30:00Z")}]);
  assert.deepEqual(offlineGaps("2026-11-18", "Asia/Shanghai", rows, true), [...partial,
    {start:Date.parse("2026-11-18T00:00:00Z"),end:Date.parse("2026-11-18T16:00:00Z")}]);
  const [springDay] = offlineGaps("2026-03-08", "America/Los_Angeles", [], true);
  assert.equal(springDay!.end - springDay!.start, 23 * 3600000);
});
