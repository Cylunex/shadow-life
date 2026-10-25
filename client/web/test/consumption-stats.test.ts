import assert from "node:assert/strict";
import test from "node:test";
import { consumptionStatsWindow, coveragePercent } from "../src/consumption-stats.js";

test("recent-month window uses the requested timezone and complete calendar months",()=>{
  assert.deepEqual(consumptionStatsWindow(new Date("2026-04-30T16:30:00Z"),3,"Asia/Shanghai"),{fromOn:"2026-03-01",toOnExclusive:"2026-06-01"});
  assert.deepEqual(consumptionStatsWindow(new Date("2026-01-15T03:00:00Z"),12,"Asia/Shanghai"),{fromOn:"2025-02-01",toOnExclusive:"2026-02-01"});
});
test("coverage is explicit for empty and partial datasets",()=>{assert.equal(coveragePercent(0,0),100);assert.equal(coveragePercent(7,10),70)});
