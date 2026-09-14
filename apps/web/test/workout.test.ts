import assert from "node:assert/strict";
import test from "node:test";
import { capabilityRegistry } from "@shadow/contracts";
import { buildWorkoutCommand, initialWorkoutFields, workoutTypeLabel } from "../src/workout.js";

test("workout execution keeps plan linkage separate from actual metrics",()=>{const fields={...initialWorkoutFields("2026-09-10","Asia/Shanghai"),planId:"health_plan_12345678",sessionType:"easy run",durationMinutes:"35",distanceKm:"5.2",caloriesKcal:"320",rpe:"4",heartRateAvg:"142",note:"轻松完成"},built=buildWorkoutCommand(fields);assert.equal(built.capability,"health.record_workout");assert.deepEqual(capabilityRegistry[built.capability].inputSchema.parse(built.input),{plan_id:"health_plan_12345678",session_type:"easy run",occurred_on:"2026-09-10",time_zone:"Asia/Shanghai",duration_minutes:35,distance_km:"5.2",calories_kcal:"320",rpe:4,heart_rate_avg:142,detail:{note:"轻松完成"}});});

test("workout start instant must belong to its local fact date",()=>{const schema=capabilityRegistry["health.record_workout"].inputSchema;assert.equal(schema.safeParse({session_type:"run",occurred_on:"2026-09-10",time_zone:"Asia/Shanghai",started_at:"2026-09-09T12:00:00Z"}).success,false);});

test("Samsung workout keys render as familiar Chinese names",()=>{
  assert.equal(workoutTypeLabel("walking"),"健走");
  assert.equal(workoutTypeLabel("backpacking"),"旅行徒步");
  assert.equal(workoutTypeLabel("open_water_swimming"),"户外游泳");
  assert.equal(workoutTypeLabel("elliptical"),"椭圆机");
});
