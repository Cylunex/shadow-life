import assert from 'node:assert/strict';
import test from 'node:test';
import { writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { agentContextResultSchema, type AgentContextResult } from '../../shared/contracts/src/index.js';
import { AgentRepository } from '../../server/database/src/index.js';
import { reviewFixture, mealInput } from '../../server/database/test/review-fixture.js';
import { createApp } from '../../server/api/src/app.js';
import { LifeClient } from '../../server/mcp/src/client.js';
import { createMcpServer } from '../../server/mcp/src/server.js';
import type { AgentRuntimeAdapter } from '../../server/agent-adapter/src/index.js';

test('offline task context retrieval and recovery invariants', async t => {
  const { pool, run, queries, context, unitOfWork, executor, command } = await reviewFixture(t);
  const cases: Array<Record<string,unknown>> = [];
  const metrics={ requests:0, result_bytes:0, call_errors:0, mcp_calls:0, mcp_errors:0, expected_matches:0, retrieved_matches:0, source_checks:0, valid_sources:0, validation_requests:0, forbidden_data_leaks:0, stale_facts:0 };
  const read = queries.agentContext.bind(queries);
  queries.agentContext=async(ctx,input)=>{
    metrics.requests++;
    try{
      const value=await read(ctx,input);metrics.result_bytes+=Buffer.byteLength(JSON.stringify(value));
      for(let offset=0;offset<value.records.length;offset+=20){
        const selected=value.records.slice(offset,offset+20);metrics.validation_requests++;
        const checked=await read(ctx,{object_refs:selected.map(record=>record.ref),limit:20,byte_budget:65536});
        for(const record of selected){metrics.source_checks++;if(checked.records.some(current=>current.ref.id===record.ref.id&&current.ref.revision===record.ref.revision))metrics.valid_sources++;else metrics.stale_facts++;}
      }
      assert.equal(metrics.stale_facts,0);return value;
    }catch(error){metrics.call_errors++;throw error;}
  };
  let runtimeInput:unknown={}, runtimeCapability='agent.context', runtimeHistory=0;
  const repository=new AgentRepository(pool);
  const runtime:AgentRuntimeAdapter={id:'offline-controlled-v1',available:true,async *run(request){runtimeHistory=request.history?.length??0;yield{id:'tool_offline',type:'tool.requested',runId:request.runId,capability:runtimeCapability,input:runtimeInput};},async *submitToolResult(request){yield{id:'answer_offline',type:'message.delta',runId:request.runId,text:JSON.stringify(request.result)};yield{id:'done_offline',type:'run.completed',runId:request.runId};}};
  const app=createApp({unitOfWork,executor,queries,developmentAuth:true,agent:{repository,runtime,nextId:(kind)=>`${kind}_${randomUUID().replaceAll('-','')}`}});
  const fetcher=((url:string,init:RequestInit)=>{const target=new URL(url);return app.request(target.pathname+target.search,init);}) as typeof fetch;
  const client=new LifeClient({api:'https://life.example.com',token:`dev:${context.subjectId}`,profile:'personal',fetch:fetcher});
  const handle=createMcpServer(client);
  let rpcId=0;
  const call=async(input:unknown,server=handle):Promise<AgentContextResult>=>{metrics.mcp_calls++;const response=await server(JSON.stringify({jsonrpc:'2.0',id:++rpcId,method:'tools/call',params:{name:'agent.context',arguments:input}})) as any;if(response.error){metrics.mcp_errors++;throw new Error(JSON.stringify(response.error));}if(response.result.isError){metrics.mcp_errors++;throw new Error(JSON.stringify(response.result.structuredContent));}return agentContextResultSchema.parse(response.result.structuredContent);};
  const check=async(name:string,work:()=>Promise<void>)=>{const started=performance.now(),before={...metrics};let passed=false;await t.test(name,async()=>{await work();passed=true;});cases.push({name,passed,duration_ms:performance.now()-started,requests:metrics.requests-before.requests,result_bytes:metrics.result_bytes-before.result_bytes,call_errors:metrics.call_errors-before.call_errors});};
  const expected=async(value:AgentContextResult,ids:string[])=>{metrics.expected_matches+=ids.length;metrics.retrieved_matches+=ids.filter(id=>value.records.some(record=>record.ref.id===id)).length;assert.deepEqual(value.records.map(record=>record.ref.id).sort(),ids.slice().sort());};
  const noLeak=(value:unknown,forbidden:RegExp)=>{const matches=JSON.stringify(value).match(forbidden);metrics.forbidden_data_leaks+=matches?.length??0;assert.equal(matches,null);};
  const meal=await run('life.record_meal',mealInput),mealId=String(meal.actual_values.meal_id);
  await run('agent.set_memory',{category:'explicit_preference',memory_key:'travel.seat',value:'靠窗'});
  let historicalRun='';
  const dates={from_on:'2026-09-10',to_on_exclusive:'2026-09-11'};
  await check('新会话查询历史午餐',async()=>{
    const value=await call({scenario:'daily',query:'合成米饭',...dates});await expected(value,[mealId]);assert.equal(value.memories.length,0);
    const thread=await app.request('/api/threads',{method:'POST',headers:{authorization:`Bearer dev:${context.subjectId}`,'content-type':'application/json'},body:JSON.stringify({title:'虚构历史午餐'})});const {id}=await thread.json() as any;
    runtimeInput={scenario:'daily',query:'合成米饭',...dates};
    const response=await app.request(`/api/threads/${id}/runs`,{method:'POST',headers:{authorization:`Bearer dev:${context.subjectId}`,'content-type':'application/json'},body:JSON.stringify({text:'查询历史午餐'})});const stream=await response.text();assert.equal(response.status,200);assert.equal(runtimeHistory,1);assert.match(stream,/"type":"tool.result","authority":"host"/);assert.match(stream,new RegExp(mealId));assert.doesNotMatch(stream,/operation.committed/);historicalRun=JSON.parse(stream.split("\n").find(line=>line.startsWith("data:"))!.slice(5)).run_id;
  });
  await check('饭店购买与实际进餐',async()=>{
    const purchase=await run('life.record_purchase',{occurred_on:'2026-09-10',time_zone:'Asia/Shanghai',merchant_name_raw:'虚构饭店购买',scene:'dine_in',items:[{raw_name:'打包米饭'}]});
    const value=await call({query:'虚构饭店购买',response_format:'detailed',...dates});assert.equal(value.records.length,1);assert.equal(value.records[0]?.ref.kind,'purchase');assert.equal(value.records[0]?.facts?.intake,'not_proven_by_purchase');assert.equal(value.records[0]?.amount,undefined);await expected(value,[String(purchase.actual_values.purchase_id)]);
    await run('life.record_purchase',{occurred_on:'2026-09-10',time_zone:'Asia/Shanghai',merchant_name_raw:'虚构付款饭店',scene:'dine_in',payment:{amount:'20.00',currency:'CNY',occurred_on:'2026-09-11',time_zone:'Asia/Shanghai',note:'合成独立支付'}});
    const bought=await call({query:'虚构付款饭店',...dates});assert.deepEqual(bought.records.map(record=>record.ref.kind),['purchase']);
    const paid=await call({query:'虚构付款饭店',from_on:'2026-09-11',to_on_exclusive:'2026-09-12'});assert.deepEqual(paid.records.map(record=>record.ref.kind),['money_entry']);assert.equal(paid.records[0]?.happened_on,'2026-09-11');
  });
  let entryId='',recordId='';
  await check('账目更正',async()=>{
    const receipt=await run('money.record_entry',{entry_type:'expense',amount:'10.00',currency:'CNY',occurred_on:'2026-09-10',time_zone:'Asia/Shanghai',counterparty:'虚构账目'});entryId=String(receipt.actual_values.money_entry_id);recordId=String(receipt.actual_values.record_id);
    await run('money.correct_entry',{record_id:recordId,expected_revision:1,amount:'12.34',currency:'CNY',occurred_on:'2026-09-10',time_zone:'Asia/Shanghai',counterparty:'虚构账目',reason:'合成更正'});
    const value=await call({object_refs:[{kind:'money_entry',id:entryId,revision:2}]});assert.equal(value.records[0]?.amount,'12.340000');await expected(value,[entryId]);await assert.rejects(()=>call({object_refs:[{kind:'money_entry',id:entryId,revision:1}]}),/unavailable/);
  });
  await check('作废账目',async()=>{
    await run('money.void_entry',{record_id:recordId,expected_revision:2,reason:'合成作废'});const value=await call({scenario:'spending',query:'虚构账目',...dates});assert.equal(value.coverage.matched_records,0);assert.equal(value.records.length,0);const stats=await queries.summarizeMoney(context);assert.equal(stats.totals.find(total=>total.currency==='CNY')?.gross_expense,'20');await assert.rejects(()=>call({object_refs:[{kind:'money_entry',id:entryId,revision:3}]}),/unavailable/);
  });
  let libraryId='';
  await check('Library 历史修订',async()=>{
    const receipt=await run('library.capture',{title:'虚构资料',item_type:'note',text:'旧正文：合成回忆',tags:[]});libraryId=String(receipt.actual_values.library_item_id);
    await run('library.revise',{item_id:libraryId,expected_revision:1,title:'虚构资料更新',text:'新正文：合成回忆',tags:[],reason:'合成更正'});
    const value=await call({object_refs:[{kind:'library_item',id:libraryId,revision:1}],response_format:'detailed'});assert.equal(value.records[0]?.ref.revision,1);assert.match(value.records[0]?.excerpt??'',/旧正文/);assert.doesNotMatch(value.records[0]?.excerpt??'',/新正文/);await expected(value,[libraryId]);
  });
  await check('证据失效',async()=>{
    await run('agent.set_memory',{category:'deterministic_aggregate',memory_key:'daily.selected_meals',evidence_refs:[{kind:'meal',id:mealId,revision:1}],algorithm_version:'meal-count-v1'});
    const before=await call({scenario:'daily',query:'合成米饭',...dates});assert.deepEqual(before.memories[0]?.value,{count:1});
    await run('life.correct_meal',{meal_id:mealId,expected_revision:1,occurred_on:'2026-09-10',time_zone:'Asia/Shanghai',meal_type:'lunch',reason:'合成修订'});
    assert.equal((await call({scenario:'daily',query:'合成米饭',...dates})).memories.length,0);
    for(const suffix of ['', '/events']){const response=await app.request(`/api/runs/${historicalRun}${suffix}`,{headers:{authorization:`Bearer dev:${context.subjectId}`}});const body=await response.json() as any;const event=(body.events??body.items).find((item:any)=>item.payload.type==='tool.result');assert.equal(event.payload.outcome,'rejected');assert.doesNotMatch(JSON.stringify(event.payload.result),/合成米饭|matched_records|meal_/);}
    await assert.rejects(()=>call({object_refs:[{kind:'meal',id:mealId,revision:1}]}),/unavailable/);
    await pool.query("update user_memories set algorithm_version='unregistered' where category='deterministic_aggregate'");assert.equal((await call({scenario:'daily'})).memories.length,0);
  });
  await check('偏好更新和归档',async()=>{
    const saved=await run('agent.set_memory',{category:'explicit_preference',memory_key:'daily.spice',value:'少辣'}),memoryId=String(saved.actual_values.memory_id);
    await run('agent.set_memory',{memory_id:memoryId,expected_revision:1,category:'explicit_preference',memory_key:'daily.spice',value:'不辣',reason:'合成更新'});
    const value=await call({scenario:'daily'});assert.equal(value.memories.length,1);assert.equal(value.memories[0]?.value,'不辣');
    await run('agent.set_memory',{memory_id:memoryId,expected_revision:2,category:'explicit_preference',memory_key:'daily.spice',value:'不辣',state:'archived',reason:'合成归档'});assert.equal((await call({scenario:'daily'})).memories.length,0);
  });
  await check('权限撤回',async()=>{
    const restricted={...context,effects:new Set(['agent.run','life.meal.read'])};const value=await queries.agentContext(restricted,{query:'虚构资料'});assert.equal(value.records.length,0);noLeak(value,/虚构资料|靠窗/g);await assert.rejects(()=>queries.agentContext(restricted,{object_refs:[{kind:'library_item',id:libraryId,revision:1}]}),/unavailable/);
    const revoked={...context,effects:new Set(['agent.run'])};const prefs=await queries.agentContext(revoked,{query:'靠窗'});assert.equal(prefs.memories.length,0);noLeak(prefs,/靠窗/g);
  });
  await check('不同账户',async()=>{
    const other=new LifeClient({api:'https://life.example.com',token:'dev:subject_offline_other',profile:'personal',fetch:fetcher}),server=createMcpServer(other);const value=await call({query:'合成米饭'},server);assert.equal(value.records.length,0);noLeak(value,/合成米饭/g);await assert.rejects(()=>call({object_refs:[{kind:'meal',id:mealId,revision:2}]},server),/unavailable/);await assert.rejects(()=>executor.getOperation({...context,subjectId:'subject_offline_other'},meal.execution_id));
  });
  await check('MCP 固定场景',async()=>{
    const travel=new LifeClient({...client.options,scenario:'travel'}),server=createMcpServer(travel);const value=await call({scenario:'spending',profile:'authorized',query:'合成米饭'},server);assert.deepEqual(value.coverage.authorized_kinds,['trip']);assert.equal(value.records.length,0);noLeak(value,/合成米饭/g);await assert.rejects(()=>call({scenario:'daily',object_refs:[{kind:'meal',id:mealId,revision:2}]},server),/unavailable/);
  });
  await check('多币种',async()=>{
    await run('money.record_entry',{entry_type:'expense',amount:'0.10',currency:'CNY',occurred_on:'2026-09-10',time_zone:'Asia/Shanghai',counterparty:'合成币种'});
    await run('money.record_foreign_entry',{entry_type:'expense',amount:'123.456789',currency:'USD',source_scale:6,occurred_on:'2026-09-10',time_zone:'Asia/Shanghai',counterparty:'合成币种',conversion:{base_amount:'864.197523',base_currency:'CNY',rate:'7',quoted_at:'2026-09-10T00:00:00Z',source_kind:'manual'}});
    const value=await call({scenario:'spending',query:'合成币种',response_format:'detailed'});assert.deepEqual(value.records.map(x=>[x.currency,x.amount]).sort(),[['CNY','0.100000'],['USD','123.456789']]);const stats=await queries.summarizeMoney(context);assert.equal(stats.totals.length,2);
  });
  await check('跨时区与纯日期',async()=>{
    const timed=await run('life.record_meal',{...mealInput,occurred_on:'2026-09-11',occurred_at:'2026-09-10T17:00:00Z',note:'合成时区'});const value=await call({scenario:'daily',query:'合成时区',time_zone:'America/Los_Angeles',...dates});await expected(value,[String(timed.actual_values.meal_id)]);assert.equal(value.records[0]?.happened_on,'2026-09-10');const dateOnly=await call({object_refs:[{kind:'meal',id:mealId,revision:2}],time_zone:'America/Los_Angeles',...dates});assert.equal(dateOnly.records[0]?.occurred_at,null);await assert.rejects(()=>call({from_on:'2026-09-10'}),/date|invalid/i);
  });
  await check('未同步睡眠或健康数据',async()=>{
    const value=await call({scenario:'health',...dates,response_format:'detailed'});assert.equal(value.records.length,0);assert.ok(value.coverage.unknown.some(item=>item.includes('sleep')));assert.doesNotMatch(JSON.stringify(value),/"sleep_minutes":0|"steps":0/);
  });
  await check('查询失败',async()=>{
    await pool.query('alter table meals rename to offline_unavailable_meals');try{await assert.rejects(()=>call({scenario:'daily',...dates}),/tool_failed|internal|unavailable/i);}finally{await pool.query('alter table offline_unavailable_meals rename to meals');}
  });
  await check('无依据问题',async()=>{const value=await call({query:'完全不存在的火星午餐',...dates});assert.equal(value.records.length,0);assert.equal(value.coverage.matched_records,0);assert.equal(value.memories.length,0);});
  await check('大记录集',async()=>{
    for(let index=0;index<65;index++)await run('life.record_meal',{...mealInput,note:`合成分页 ${String(index).padStart(3,'0')}`});
    const seen=new Set<string>();let offset=0;do{const value=await call({scenario:'daily',query:'合成分页',...dates,limit:7,offset});assert.equal(value.coverage.matched_records,65);assert.ok(value.records.length<=7);for(const record of value.records){assert.ok(!seen.has(record.ref.id));seen.add(record.ref.id);}if(value.continuation.next_offset===null)break;assert.ok(value.continuation.next_offset>offset);offset=value.continuation.next_offset;}while(true);assert.equal(seen.size,65);
  });
  await check('中文和多字节预算',async()=>{
    for(let index=0;index<3;index++)await run('library.capture',{title:'合成多字节'+index,item_type:'note',text:'中😀文'.repeat(1500),tags:[]});
    const value=await call({scenario:'library',query:'合成多字节',response_format:'detailed',byte_budget:2048});const bytes=Buffer.byteLength(JSON.stringify(value));assert.equal(bytes,value.truncation.result_bytes);assert.ok(bytes<=2048);assert.equal(value.truncation.truncated,true);assert.deepEqual(agentContextResultSchema.parse(JSON.parse(JSON.stringify(value))),value);
    const detailed=await call({scenario:'library',query:'合成多字节',response_format:'detailed',byte_budget:65536});assert.equal(detailed.records.length,3);assert.ok(detailed.records.every(record=>record.excerpt!.length<=2000));
    await run('agent.set_memory',{category:'explicit_preference',memory_key:'library.long_note',value:'中😀文'.repeat(1500)});const bounded=await call({scenario:'library',memory_keys:['library.long_note'],byte_budget:2048});assert.equal(bounded.memories.length,0);assert.equal(bounded.coverage.matched_memories,1);assert.equal(bounded.truncation.omitted_memories,1);assert.ok(Buffer.byteLength(JSON.stringify(bounded))<=2048);
  });
  await check('写入成功后超时、断线续读',async()=>{
    const threadId='thread_offline_recovery',runId='run_offline_recovery';await repository.createThread(context.subjectId,threadId,'合成恢复');await repository.createRun(threadId,runId,{id:'message_offline_recovery',content:'保存后断线'});
    const write=command('life.record_meal',{...mealInput,note:'合成断线保存'}),lease={...context,agentRun:{runId,ownerId:repository.ownerId,toolCallId:'tool_offline_write'}};const receipt=await executor.execute(lease,write);
    await pool.query("update runs set lease_expires_at=clock_timestamp()-interval '1 second' where id=$1",[runId]);const recovery=new AgentRepository(pool);assert.equal((await recovery.run(context.subjectId,runId))?.status,'interrupted');const events=await recovery.events(context.subjectId,runId);assert.equal(events.filter(event=>event.event_type==='operation.committed').length,1);assert.equal((events[0]?.payload as any).execution_id,receipt.execution_id);assert.equal((await executor.execute(lease,write)).replayed,true);assert.equal((await recovery.events(context.subjectId,runId)).filter(event=>event.event_type==='operation.committed').length,1);assert.equal((await call({query:'合成断线保存'})).records.length,1);await assert.rejects(()=>executor.execute(lease,command('life.record_meal',mealInput)),/lease/);
    const timedClient=new LifeClient({...client.options,profile:'personal',fetch:async(url,init)=>{const response=await fetcher(url,init);if(new URL(String(url)).pathname.includes('/commands'))throw new Error('offline simulated timeout after commit');return response;}}),timedHandle=createMcpServer(timedClient),key=`cmd_${randomUUID()}`;
    metrics.mcp_calls++;
    const rpc=await timedHandle(JSON.stringify({jsonrpc:'2.0',id:++rpcId,method:'tools/call',params:{name:'life.record_meal',arguments:{command_id:key,input:{...mealInput,note:'合成MCP超时'}}}})) as any;metrics.mcp_errors++;assert.equal(rpc.result.structuredContent.code,'outcome_unknown');assert.equal(rpc.result.structuredContent.recovery.arguments.command_id,key);const found=await client.call('operations.find',{command_id:key}) as any;assert.equal(found.status,'committed');
  });
  assert.equal(cases.length,18);
  const report={status:cases.every(item=>item.passed)?'passed':'failed',fixture_version:'life-context-v1',runtime:'offline-controlled-v1',model:null,real_model_success_rate:null,cases,metrics:{...metrics,retrieval_match_rate:metrics.retrieved_matches/metrics.expected_matches,source_validity_rate:metrics.valid_sources/metrics.source_checks},claim:'Tool, transport, Host and receipt invariants on synthetic data only; no model quality or production claim.'};
  if(process.env.SHADOW_EVAL_REPORT)writeFileSync(process.env.SHADOW_EVAL_REPORT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));assert.ok(cases.every(item=>item.passed));
});
