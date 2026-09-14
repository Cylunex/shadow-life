import assert from "node:assert/strict";
import test from "node:test";
import { buildRecurrenceRule, healthHabitLabel, nextRecurrenceDate, parseRecurrenceRule, reconcileActivityEnergy, workoutSessionLabel } from "../src/index.js";

test("monthly recurrence keeps its anchor instead of drifting after a short month", () => {
  const recurrenceRule = buildRecurrenceRule({ cadence:"monthly", anchorOn:"2026-01-31", missingDatePolicy:"last_day" });
  assert.equal(recurrenceRule, "FREQ=MONTHLY;BYMONTHDAY=-1");
  assert.equal(nextRecurrenceDate({ recurrenceRule, currentDueOn:"2026-01-31", anchorOn:"2026-01-31", missingDatePolicy:"last_day" }), "2026-02-28");
  assert.equal(nextRecurrenceDate({ recurrenceRule, currentDueOn:"2026-02-28", anchorOn:"2026-01-31", missingDatePolicy:"last_day" }), "2026-03-31");
});

test("skip policy and leap-year recurrence preserve the requested calendar day", () => {
  assert.equal(nextRecurrenceDate({ recurrenceRule:"FREQ=MONTHLY;BYMONTHDAY=31", currentDueOn:"2026-01-31", anchorOn:"2026-01-31", missingDatePolicy:"skip" }), "2026-03-31");
  assert.equal(nextRecurrenceDate({ recurrenceRule:"FREQ=YEARLY;BYMONTH=2;BYMONTHDAY=29", currentDueOn:"2024-02-29", anchorOn:"2024-02-29", missingDatePolicy:"skip" }), "2028-02-29");
  assert.throws(() => parseRecurrenceRule("FREQ=MONTHLY;BYDAY=MO"), /Unsupported recurrence rule/u);
  assert.throws(() => parseRecurrenceRule("FREQ=DAILY;FREQ=WEEKLY"), /Duplicate recurrence rule field/u);
  assert.throws(() => buildRecurrenceRule({ cadence:"interval", intervalDays:367, anchorOn:"2026-01-01", missingDatePolicy:"skip" }), /between 1 and 366/u);
});

test("activity energy chooses the larger complete source without adding overlapping totals", () => {
  assert.deepEqual(reconcileActivityEnergy("300.000000", "500.000000"), { caloriesKcal:"500.000000", source:"workout_sum" });
  assert.deepEqual(reconcileActivityEnergy("600", "500.000000"), { caloriesKcal:"600", source:"device_summary" });
  assert.deepEqual(reconcileActivityEnergy(null, null), { caloriesKcal:null, source:null });
});

test("Samsung exercise keys have stable Chinese presentation labels",()=>{
  assert.equal(workoutSessionLabel("walking"),"健走");
  assert.equal(workoutSessionLabel("circuit_training"),"循环训练");
  assert.equal(workoutSessionLabel("backpacking"),"旅行徒步");
  assert.equal(workoutSessionLabel("cycling"),"自行车");
  assert.equal(workoutSessionLabel("pool_swimming"),"游泳");
  assert.equal(workoutSessionLabel("open_water_swimming"),"户外游泳");
  assert.equal(workoutSessionLabel("elliptical"),"椭圆机");
  assert.equal(workoutSessionLabel("壶铃 HIIT"),"壶铃 HIIT");
  assert.equal(healthHabitLabel("release"),"释放记录");
});
