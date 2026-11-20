import assert from 'node:assert/strict';
import test from 'node:test';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { agentContextInputSchema } from '@shadow/contracts';
import { readAgentContext } from '../src/agent-context.js';
import { reviewFixture, pgOnly, mealInput } from './review-fixture.js';
import * as schema from '../src/schema.js';

test('meal types narrow the authorized facts before counting and paging in the requested time zone',pgOnly,async t=>{
  const {run,queries,context}=await reviewFixture(t);
  const lunch=await run('life.record_meal',mealInput);
  const breakfast=await run('life.record_meal',{...mealInput,meal_type:'breakfast'});
  await run('life.record_meal',{...mealInput,meal_type:'dinner'});
  await run('life.record_meal',{...mealInput,occurred_at:'2026-09-10T01:00:00+08:00'});
  await run('health.record_measurement',{metric:'weight',value:'60',unit:'kg',occurred_on:mealInput.occurred_on,time_zone:mealInput.time_zone});
  await run('agent.set_memory',{category:'explicit_preference',memory_key:'daily.spice',value:'少辣'});

  const input={scenario:'daily',meal_types:['breakfast','lunch'],from_on:'2026-09-10',to_on_exclusive:'2026-09-11',time_zone:'UTC',response_format:'detailed',limit:1};
  const page=await queries.agentContext(context,input);
  assert.equal(page.coverage.matched_records,2);
  assert.equal(page.continuation.next_offset,1);
  assert.deepEqual(page.memories.map(row=>row.memory_key),['daily.spice']);
  const next=await queries.agentContext(context,{...input,offset:page.continuation.next_offset});
  assert.equal(next.continuation.next_offset,null);
  const records=[...page.records,...next.records];
  assert.deepEqual(new Set(records.map(row=>row.ref.id)),new Set([breakfast.actual_values.meal_id,lunch.actual_values.meal_id]));
  assert.deepEqual(new Set(records.map(row=>row.facts?.meal_type)),new Set(['breakfast','lunch']));
  const noMealAccess=await queries.agentContext({...context,effects:new Set(['agent.run','health.measurement.read'])},input);
  assert.equal(noMealAccess.coverage.matched_records,0);
  assert.ok(!noMealAccess.coverage.authorized_kinds.includes('meal'));
  assert.equal((await queries.agentContext(context,{...input,scenario:'health'})).coverage.matched_records,0);
});

test('task context validity and projections share one statement during concurrent correction',pgOnly,async t=>{
  const {pool,run,context,queries}=await reviewFixture(t);
  const saved=await run('health.record_measurement',{metric:'weight',value:'60',unit:'kg',label:'修订前体重',occurred_on:'2026-09-10',time_zone:'Asia/Shanghai'});
  const id=String(saved.actual_values.measurement_id),database=drizzle(pool,{schema});let statements=0;
  const gate=await pool.connect();await gate.query('select pg_advisory_lock(hashtextextended($1,99))',[id]);
  const wrapped={execute:async(statement:any)=>{statements++;return database.execute(sql`/*offline_context_snapshot*/ with delayed as materialized(select pg_advisory_xact_lock(hashtextextended(${id},99))) select snapshot.* from delayed cross join lateral (${statement}) snapshot`);}} as Parameters<typeof readAgentContext>[0];
  const pending=readAgentContext(wrapped,context.subjectId,{input:agentContextInputSchema.parse({object_refs:[{kind:'health_measurement',id,revision:1}],response_format:'detailed'}),kinds:['health_measurement'],includeMoney:false,preferenceScopes:['health']});
  try{let entered=false;for(let i=0;i<200;i++){const active=await pool.query("select 1 from pg_stat_activity where pid<>pg_backend_pid() and state='active' and wait_event_type='Lock' and query like $1",['/*offline_context_snapshot*/%']);if(active.rowCount){entered=true;break;}await new Promise(resolve=>setTimeout(resolve,5));}
  assert.equal(entered,true,'Context statement reached the snapshot barrier');
  await run('health.correct_measurement',{measurement_id:id,expected_revision:1,metric:'weight',value:'61',unit:'kg',label:'修订后体重',occurred_on:'2026-09-10',time_zone:'Asia/Shanghai',reason:'并发合成更正'});
  await gate.query('select pg_advisory_unlock(hashtextextended($1,99))',[id]);
  const result=await pending;assert.equal(statements,1);assert.equal(result.refsAvailable,true);assert.equal(result.records[0]?.ref.revision,1);assert.equal(result.records[0]?.title,'修订前体重');assert.equal(result.records[0]?.facts?.value,'60.000000');
  await assert.rejects(()=>queries.agentContext(context,{object_refs:[{kind:'health_measurement',id,revision:1}]}),/unavailable/);
  }finally{await gate.query('select pg_advisory_unlock_all()');await pending.catch(()=>{});gate.release();}
});

test('replayed Host query evidence is revalidated after archive, correction, permission withdrawal and expiry',pgOnly,async t=>{
  const {pool,run,queries,context}=await reviewFixture(t);
  const saved=await run('life.record_meal',mealInput),id=String(saved.actual_values.meal_id);
  const memory=await run('agent.set_memory',{category:'explicit_preference',memory_key:'daily.spice',value:'少辣'});
  const value=await queries.agentContext(context,{scenario:'daily'});
  assert.equal(await queries.revalidateAgentContext(context,value),true);
  assert.equal(await queries.revalidateAgentContext({...context,effects:new Set(['agent.run'])},value),false);
  await run('agent.set_memory',{memory_id:memory.actual_values.memory_id,expected_revision:1,category:'explicit_preference',memory_key:'daily.spice',value:'少辣',state:'archived',reason:'合成归档'});
  assert.equal(await queries.revalidateAgentContext(context,value),false);
  const current=await queries.agentContext(context,{object_refs:[{kind:'meal',id,revision:1}]});
  await run('life.correct_meal',{meal_id:id,expected_revision:1,occurred_on:'2026-09-10',time_zone:'Asia/Shanghai',meal_type:'dinner',reason:'合成更正'});
  assert.equal(await queries.revalidateAgentContext(context,current),false);
  const pack=await run('agent.create_context_pack',{object_refs:[{kind:'meal',id,revision:2}]});
  await pool.query("update agent_context_packs set created_at=now()-interval '2 hours',expires_at=now()-interval '1 hour' where id=$1",[pack.actual_values.context_pack_id]);
  await assert.rejects(()=>queries.agentContextPack(context,{context_pack_id:pack.actual_values.context_pack_id}),/not found/);
});
