import assert from "node:assert/strict";
import test from "node:test";
import { homeWorkoutMenu } from "@shadow/contracts";
import { reviewFixture,pgOnly } from "./review-fixture.js";

test("menu plans round-trip separately from actual sets through the shared Executor",pgOnly,async t=>{
  const {run,queries,context,pool,executor,command}=await reviewFixture(t);
  const input={kind:"workout",name:"自选菜单",state:"active",schedule:{days:[1,2,4]},detail:{note:"保留旧备注",workout_menu:homeWorkoutMenu}};
  const envelope=command("health.set_plan",input);const receipt=await executor.execute(context,envelope);
  assert.equal((await executor.execute(context,envelope)).replayed,true);
  const id=receipt.actual_values.health_plan_id;
  assert.equal((await pool.query("select count(*)::int n from health_workout_sessions")).rows[0].n,0);
  const page=await queries.listDomain(context,"health",{query:"workout_plan",limit:100});
  assert.deepEqual(page.items.find(item=>item.id===id)?.workout_plan?.detail,input.detail);
  const actual={version:1,focus:"chest",exercises:[{exercise:homeWorkoutMenu.exercises[6],sets:[{reps:10,load_kg:"5"}]}]};
  const session=command("health.record_workout",{plan_id:id,occurred_on:"2026-10-16",time_zone:"Asia/Shanghai",session_type:"strength_training",detail:{strength_session:actual}});
  await executor.execute(context,session);await executor.execute(context,session);
  const rows=(await pool.query("select detail,duration_minutes,calories_kcal from health_workout_sessions")).rows;
  assert.equal(rows.length,1);assert.deepEqual(rows[0].detail,{strength_session:actual});assert.equal(rows[0].duration_minutes,null);assert.equal(rows[0].calories_kcal,null);
  await run("health.set_plan",{...input,plan_id:id,expected_revision:1,name:"改名"});
  await assert.rejects(()=>run("health.set_plan",{...input,plan_id:id,expected_revision:1,name:"旧版本覆盖"}),/revision|conflict/iu);
  await assert.rejects(()=>queries.listDomain({...context,effects:new Set()},"health",{query:"workout_plan",limit:100}),/permission/iu);
});
