import assert from "node:assert/strict";
import test from "node:test";
import { homeWorkoutMenu } from "@shadow/contracts";
import { buildMenuPlan,buildStrengthWorkout,loadMenuPlans,menuForPlan,type MenuPlan } from "../src/workout-menu.js";
const plan:MenuPlan={id:"health_plan_testmenu",kind:"workout_plan",title:"旧计划",supporting:null,happened_on:null,state:"active",revision:3,record_id:null,amount:null,currency:null,workout_plan:{schedule:{days:[1],time_zone:"Asia/Shanghai"},detail:{note:"既有备注",custom:{a:1}}}};
test("menu save preserves legacy metadata and optimistic revision",()=>{
  const command=buildMenuPlan(homeWorkoutMenu,"自选菜单",plan);
  assert.equal(command.plan_id,plan.id);assert.equal(command.expected_revision,3);
  assert.deepEqual(command.schedule,{days:[1],time_zone:"Asia/Shanghai"});
  assert.deepEqual((command.detail as Record<string,unknown>).custom,{a:1});
  assert.deepEqual(menuForPlan(plan),homeWorkoutMenu);
  const opaque=buildMenuPlan(homeWorkoutMenu,"旧版数组",{...plan,workout_plan:{schedule:[1,2,4],detail:"旧版字符串备注"}});
  assert.deepEqual((opaque.schedule as Record<string,unknown>).legacy_schedule,[1,2,4]);assert.equal((opaque.detail as Record<string,unknown>).legacy_detail,"旧版字符串备注");
});
test("selection never fabricates actual sets, duration, calories, or load",()=>{
  const selected=[{exercise:homeWorkoutMenu.exercises[6]!,values:"",load:""}];
  assert.throws(()=>buildStrengthWorkout(selected,"chest","2026-10-16","Asia/Shanghai"));
  const input=buildStrengthWorkout([...selected,{exercise:homeWorkoutMenu.exercises[0]!,values:"10，8",load:""}],"chest","2026-10-16","Asia/Shanghai");
  assert.equal(input.duration_minutes,undefined);assert.equal(input.calories_kcal,undefined);
  const actual=(input.detail as any).strength_session;assert.equal(actual.exercises.length,1);assert.deepEqual(actual.exercises[0].sets,[{reps:10},{reps:8}]);
  assert.throws(()=>buildStrengthWorkout([{...selected[0]!,values:"-1"}],"chest","2026-10-16","Asia/Shanghai"));
});
test("plan reader follows health query cursor, independent of recent health records",async()=>{
  const calls:string[]=[];const fetcher=(async(url:string)=>{calls.push(url);return new Response(JSON.stringify({items:[{...plan,id:`health_plan_page${calls.length}`}],next_cursor:calls.length===1?"opaque cursor":null,as_of:"2026-10-16T00:00:00Z"}));}) as typeof fetch;
  const plans=await loadMenuPlans(fetcher,{});assert.equal(plans.length,2);assert.match(calls[0]!,/q=workout_plan/u);assert.match(calls[1]!,/cursor=opaque\+cursor/u);
});
