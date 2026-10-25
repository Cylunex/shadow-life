import assert from "node:assert/strict";
import test from "node:test";
import { reviewFixture, pgOnly, mealInput } from "./review-fixture.js";

test("F01/F02: current visible facts and Host aggregates are rechecked after correction, revocation and void",pgOnly,async t=>{
  const {pool,run,executor,command,queries,context,unitOfWork}=await reviewFixture(t);
  const meal=await run("life.record_meal",mealInput),id=String(meal.actual_values.meal_id),refs=[{kind:"meal",id,revision:1}];
  const pack=await run("agent.create_context_pack",{object_refs:refs,valid_from:"2000-01-01T00:00:00Z",valid_to:"2000-01-02T00:00:00Z"});
  const packQuery={context_pack_id:pack.actual_values.context_pack_id};
  assert.ok(await queries.agentContextPack(context,packQuery)); // validity window describes fact selection, not access expiry
  await assert.rejects(()=>run("agent.set_memory",{category:"deterministic_aggregate",memory_key:"unknown",value:{count:999999},evidence_refs:refs,algorithm_version:"arbitrary-unimplemented-v99"}),/not registered/);
  await assert.rejects(()=>run("agent.set_memory",{category:"deterministic_aggregate",memory_key:"forged",value:{count:999999},evidence_refs:refs,algorithm_version:"meal-count-v1"}),/Host computation/);
  const aggregate=command("agent.set_memory",{category:"deterministic_aggregate",memory_key:"selected-meals",evidence_refs:refs,algorithm_version:"meal-count-v1"});
  const saved=await executor.execute(context,aggregate);assert.equal((await executor.execute(context,aggregate)).execution_id,saved.execution_id);
  assert.deepEqual((await queries.agentMemories(context)).items[0]?.value,{count:1});
  await run("agent.set_memory",{category:"explicit_preference",memory_key:"spice",value:"mild"});
  await assert.rejects(()=>queries.agentContextPack({...context,effects:new Set(["agent.run"])},packQuery),/Missing permission/);
  assert.deepEqual((await queries.agentMemories({...context,effects:new Set(["agent.run"])})).items.map(x=>x.category),["explicit_preference"]);
  await run("life.correct_meal",{meal_id:id,expected_revision:1,occurred_on:"2026-09-10",time_zone:"Asia/Shanghai",meal_type:"dinner",reason:"修正测试"});
  await assert.rejects(()=>queries.agentContextPack(context,packQuery),/not found/);
  assert.equal((await queries.agentMemories(context)).items.length,1);
  await assert.rejects(()=>run("agent.set_memory",{category:"deterministic_aggregate",memory_key:"stale",evidence_refs:refs,algorithm_version:"meal-count-v1"}),/unavailable/);
  await unitOfWork.ensurePrincipal("subject_other_review");
  await assert.rejects(()=>run("agent.create_context_pack",{object_refs:[{kind:"meal",id,revision:2}]},{...context,subjectId:"subject_other_review",actorId:"subject_other_review"}),/unavailable/);
  const current=await run("agent.create_context_pack",{object_refs:[{kind:"meal",id,revision:2}]});
  await pool.query("update meals set state='deleted' where id=$1",[id]);
  await assert.rejects(()=>queries.agentContextPack(context,{context_pack_id:current.actual_values.context_pack_id}),/not found/);
  const trip=await run("travel.create_trip",{title:"共享测试",starts_on:"2026-09-10",ends_on:"2026-09-12",time_zone:"Asia/Shanghai"});
  const tripId=String(trip.actual_values.trip_id),other={...context,subjectId:"subject_other_review",actorId:"subject_other_review"};
  await pool.query("insert into trip_members(trip_id,subject_id,role,visibility) values($1,$2,'viewer','shared')",[tripId,other.subjectId]);
  const shared=await run("agent.create_context_pack",{object_refs:[{kind:"trip",id:tripId,revision:1}]},other);
  assert.ok(await queries.agentContextPack(other,{context_pack_id:shared.actual_values.context_pack_id}));
  await pool.query("delete from trip_members where trip_id=$1 and subject_id=$2",[tripId,other.subjectId]);
  await assert.rejects(()=>queries.agentContextPack(other,{context_pack_id:shared.actual_values.context_pack_id}),/not found/);
});

test("F01/F03: exact 5/15/60-minute database TTL, expiry and required thread binding",pgOnly,async t=>{
  const {pool,run,queries,context}=await reviewFixture(t),meal=await run("life.record_meal",mealInput),refs=[{kind:"meal",id:meal.actual_values.meal_id,revision:1}];
  await pool.query("insert into threads(id,subject_id,title) values('thread_review_ttl',$1,'TTL')",[context.subjectId]);
  for(const ttl of [5,15,60]){
    const pack=await run("agent.create_context_pack",{thread_id:"thread_review_ttl",object_refs:refs,ttl_minutes:ttl}),id=pack.actual_values.context_pack_id;
    const seconds=(await pool.query("select extract(epoch from expires_at-created_at)::int seconds from agent_context_packs where id=$1",[id])).rows[0].seconds;
    assert.equal(seconds,ttl*60);
    await assert.rejects(()=>queries.agentContextPack(context,{context_pack_id:id}),/not found/);
    await assert.rejects(()=>queries.agentContextPack(context,{context_pack_id:id},"thread_wrong_123"),/not found/);
    assert.ok(await queries.agentContextPack(context,{context_pack_id:id},"thread_review_ttl"));
    await pool.query("update agent_context_packs set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=$1",[id]);
    await assert.rejects(()=>queries.agentContextPack(context,{context_pack_id:id},"thread_review_ttl"),/not found/);
  }
  await assert.rejects(()=>run("agent.create_context_pack",{object_refs:refs,ttl_minutes:61}));
  // A trigger deliberately delays insertion beyond transaction start; expiry must share created_at's clock.
  await pool.query("create function delay_pack() returns trigger language plpgsql as $$ begin perform pg_sleep(0.05); return NEW; end $$; create trigger delay_pack before insert on agent_context_packs for each row execute function delay_pack()");
  assert.ok(await run("agent.create_context_pack",{object_refs:refs,ttl_minutes:60}));
});
