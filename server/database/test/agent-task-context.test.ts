import assert from 'node:assert/strict';
import test from 'node:test';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { agentContextInputSchema } from '@shadow/contracts';
import { readAgentContext } from '../src/agent-context.js';
import { reviewFixture, pgOnly, mealInput } from './review-fixture.js';
import * as schema from '../src/schema.js';

test('task context validity and projections share one statement during concurrent correction',pgOnly,async t=>{
  const {pool,run,context,queries}=await reviewFixture(t);
  const saved=await run('health.record_measurement',{metric:'weight',value:'60',unit:'kg',label:'修订前体重',occurred_on:'2026-09-10',time_zone:'Asia/Shanghai'});
  const id=String(saved.actual_values.measurement_id),database=drizzle(pool,{schema});let statements=0;
  const wrapped={execute:async(statement:any)=>{statements++;return database.execute(sql`/*offline_context_snapshot*/ with delayed as materialized(select pg_sleep(0.2)) select snapshot.* from delayed cross join lateral (${statement}) snapshot`);}} as Parameters<typeof readAgentContext>[0];
  const pending=readAgentContext(wrapped,context.subjectId,{input:agentContextInputSchema.parse({object_refs:[{kind:'health_measurement',id,revision:1}],response_format:'detailed'}),kinds:['health_measurement'],includeMoney:false,preferenceScopes:['health']});
  for(let i=0;i<100;i++){const active=await pool.query("select 1 from pg_stat_activity where pid<>pg_backend_pid() and state='active' and query like $1",['/*offline_context_snapshot*/%']);if(active.rowCount)break;await new Promise(resolve=>setTimeout(resolve,5));}
  await run('health.correct_measurement',{measurement_id:id,expected_revision:1,metric:'weight',value:'61',unit:'kg',label:'修订后体重',occurred_on:'2026-09-10',time_zone:'Asia/Shanghai',reason:'并发合成更正'});
  const result=await pending;assert.equal(statements,1);assert.equal(result.refsAvailable,true);assert.equal(result.records[0]?.ref.revision,1);assert.equal(result.records[0]?.title,'修订前体重');assert.equal(result.records[0]?.facts?.value,'60.000000');
  await assert.rejects(()=>queries.agentContext(context,{object_refs:[{kind:'health_measurement',id,revision:1}]}),/unavailable/);
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
