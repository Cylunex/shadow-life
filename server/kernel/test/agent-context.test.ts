import assert from 'node:assert/strict';
import test from 'node:test';
import { agentContextInputSchema } from '@shadow/contracts';
import { boundAgentContext,queryAgentContext } from '../src/agent-context.js';
import type { UnitOfWork,RequestContext } from '../src/ports.js';

test('date range must be complete and request narrowing never grants permissions',async()=>{
  assert.equal(agentContextInputSchema.safeParse({}).success,false);
  assert.equal(agentContextInputSchema.safeParse({from_on:'2026-09-10'}).success,false);
  assert.equal(agentContextInputSchema.safeParse({query:'午餐',from_on:'2026-09-11',to_on_exclusive:'2026-09-10'}).success,false);
  const context:RequestContext={actorId:'subject_context',subjectId:'subject_context',clientId:'client_context',traceId:'trace_context',effects:new Set(['agent.run','health.measurement.read'])};
  let selected:string[]=[];
  const unit={read:async(work:any)=>work({agentContext:async(_subject:string,options:any)=>{selected=options.kinds;return{asOf:'2026-09-10T00:00:00Z',records:[],memories:[],matchedRecords:0,matchedMemories:0,refsAvailable:true};}})} as UnitOfWork;
  await queryAgentContext(unit,context,{scenario:'health',profile:'authorized'});assert.deepEqual(selected,['health_measurement','health_workout']);
  await assert.rejects(()=>queryAgentContext(unit,context,{object_refs:[{kind:'meal',id:'meal_12345678',revision:1}]}),/unavailable/);
});
test('multibyte budget includes metadata and drops complete objects without invalid JSON',()=>{
  const input=agentContextInputSchema.parse({scenario:'library',byte_budget:2048,response_format:'detailed'});
  const data={asOf:'2026-09-10T00:00:00Z',records:[{ref:{kind:'library_item' as const,id:'library_12345678',revision:1},domain:'library' as const,title:'中文记录',excerpt:'中😀'.repeat(1000),happened_on:'2026-09-10',occurred_at:null,time_zone:'Asia/Shanghai',source_type:'note',detail:{capability:'library.get_item' as const,input:{id:'library_12345678'}}}],memories:[],matchedRecords:1,matchedMemories:0,refsAvailable:true};
  const value=boundAgentContext(data,input,['library_item']);assert.ok(Buffer.byteLength(JSON.stringify(value))<=2048);assert.equal(Buffer.byteLength(JSON.stringify(value)),value.truncation.result_bytes);assert.equal(value.truncation.truncated,true);assert.ok(value.truncation.reasons.includes('oversized_record'));assert.deepEqual(JSON.parse(JSON.stringify(value)),value);
});

test('continuation always advances when byte metadata leaves no room for the first record',()=>{
  const data={asOf:'2026-09-10T00:00:00Z',records:Array.from({length:3},(_,index)=>({ref:{kind:'meal' as const,id:`meal_1234567${index}`,revision:1},domain:'meals' as const,title:'中文'.repeat(140),happened_on:'2026-09-10',occurred_at:null,time_zone:'Asia/Shanghai',source_type:'manual',detail:{capability:'life.get_record' as const,input:{id:`meal_1234567${index}`}}})),memories:[],matchedRecords:3,matchedMemories:0,refsAvailable:true};
  for(let budget=2048;budget<2500;budget++){const result=boundAgentContext(data,agentContextInputSchema.parse({scenario:'daily',byte_budget:budget}),['meal']);assert.ok(result.truncation.result_bytes<=budget);assert.ok(result.continuation.next_offset===null||result.continuation.next_offset>0);}
});
