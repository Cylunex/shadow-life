import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { HttpRuntimeAdapter,type AgentRuntimeAdapter } from '../../packages/agent-adapter/src/index.js';
import { AgentRepository } from '../../packages/database/src/index.js';
import { createApp } from '../../apps/api/src/app.js';
import { reviewFixture,mealInput } from '../../packages/database/test/review-fixture.js';

test('opt-in model retrieval observation on disposable synthetic data',async t=>{
  assert.equal(process.env.SHADOW_EVAL_MODEL_OPT_IN,'1');
  const {pool,unitOfWork,executor,queries,run,context}=await reviewFixture(t);
  const saved=await run('life.record_meal',mealInput),expectedId=String(saved.actual_values.meal_id);
  const adapter=new HttpRuntimeAdapter({url:process.env.SHADOW_EVAL_RUNTIME_URL!,...(process.env.SHADOW_EVAL_RUNTIME_TOKEN?{token:process.env.SHADOW_EVAL_RUNTIME_TOKEN}:{})});
  let runtimeRequests=0;
  const runtime:AgentRuntimeAdapter={id:adapter.id,available:true,run(request,signal){runtimeRequests++;return adapter.run(request,signal);},submitToolResult(request,signal){runtimeRequests++;return adapter.submitToolResult(request,signal);}};
  const repository=new AgentRepository(pool),app=createApp({unitOfWork,executor,queries,developmentAuth:true,agent:{repository,runtime,nextId:kind=>`${kind}_${randomUUID().replaceAll('-','')}`}});
  const samples=[{name:'historical-lunch',prompt:'请用 agent.context 查询 2026-09-10 这一天（Asia/Shanghai）的合成米饭午餐，报告实际记录，缺失营养保持未知。',expected_id:expectedId},{name:'unsupported-fact',prompt:'请用 agent.context 查询 2026-09-10 至 2026-09-11（结束日不含）的完全不存在的火星午餐；没有证据就说明无法确定。',expected_id:null}];
  const results=[];
  for(const sample of samples){
    const thread=`thread_${randomUUID().replaceAll('-','')}`;await repository.createThread(context.subjectId,thread,sample.name);
    const started=performance.now(),response=await app.request(`/api/threads/${thread}/runs`,{method:'POST',headers:{authorization:`Bearer dev:${context.subjectId}`,'content-type':'application/json'},body:JSON.stringify({text:sample.prompt})});
    const text=await response.text();assert.equal(response.status,200);
    const events=text.split('\n').filter(line=>line.startsWith('data:')).map(line=>JSON.parse(line.slice(5)));
    const queries=events.filter(event=>event.type==='tool.result'&&event.capability==='agent.context'&&event.outcome==='returned');
    const ids=queries.flatMap(event=>event.result.records.map((record:any)=>record.ref.id));
    results.push({sample:sample.name,expected_id:sample.expected_id,retrieved_ids:ids,retrieval_matches:sample.expected_id?ids.includes(sample.expected_id):queries.length>0&&ids.length===0,tool_calls:events.filter(event=>event.type==='tool.result'||event.type==='operation.committed').length,terminal_state:events.filter(event=>event.type==='run.state').at(-1)?.state,answer:events.filter(event=>event.type==='message.delta').map(event=>event.text).join(''),duration_ms:performance.now()-started});
  }
  const report={fixture_version:'life-context-v1',declared_model:process.env.SHADOW_EVAL_MODEL,runtime:adapter.id,host_runs:samples.length,runtime_requests:runtimeRequests,provider_model_calls:null,results,limitations:['Model identity is caller-declared; the Runtime adapter does not report provider call counts.','Retrieval matches are measured; answer quality requires separate review. This is not the 18-class offline invariant suite.']};
  if(process.env.SHADOW_EVAL_REPORT)writeFileSync(process.env.SHADOW_EVAL_REPORT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
});
