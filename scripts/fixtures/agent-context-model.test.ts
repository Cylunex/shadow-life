import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { ChatCompletionRuntimeAdapter,HttpRuntimeAdapter,type AgentRuntimeAdapter } from '../../server/agent-adapter/src/index.js';
import { AgentRepository } from '../../server/database/src/index.js';
import { createApp } from '../../server/api/src/app.js';
import { reviewFixture,mealInput } from '../../server/database/test/review-fixture.js';

test('opt-in model retrieval observation on disposable synthetic data',async t=>{
  assert.equal(process.env.SHADOW_EVAL_MODEL_OPT_IN,'1');
  const {pool,unitOfWork,executor,queries,run,context}=await reviewFixture(t);
  const saved=await run('life.record_meal',mealInput),expectedId=String(saved.actual_values.meal_id);
  const modelConfig=process.env.SHADOW_EVAL_MODEL_CONFIG_FILE?JSON.parse(readFileSync(process.env.SHADOW_EVAL_MODEL_CONFIG_FILE,'utf8')):null;
  let providerModelCalls=0;
  const adapter=modelConfig?new ChatCompletionRuntimeAdapter({...modelConfig,fetcher:(...args:Parameters<typeof fetch>)=>{providerModelCalls++;return fetch(...args);}}):new HttpRuntimeAdapter({url:process.env.SHADOW_EVAL_RUNTIME_URL!,...(process.env.SHADOW_EVAL_RUNTIME_TOKEN?{token:process.env.SHADOW_EVAL_RUNTIME_TOKEN}:{})});
  let runtimeRequests=0;
  const runtime:AgentRuntimeAdapter={id:adapter.id,available:true,run(request,signal){runtimeRequests++;return adapter.run(request,signal);},submitToolResult(request,signal){runtimeRequests++;return adapter.submitToolResult(request,signal);}};
  const repository=new AgentRepository(pool),app=createApp({unitOfWork,executor,queries,developmentAuth:true,agent:{repository,runtime,nextId:kind=>`${kind}_${randomUUID().replaceAll('-','')}`}});
  const samples=[{name:'historical-lunch',prompt:'请用 agent.context 查询 2026-09-10 这一天（Asia/Shanghai）的合成米饭午餐，报告实际记录，缺失营养保持未知。',expected_id:expectedId},{name:'unsupported-fact',prompt:'请用 agent.context 查询 2026-09-10 至 2026-09-11（结束日不含）的完全不存在的火星午餐；没有证据就说明无法确定。',expected_id:null},{name:'receipt-write',prompt:'这是一次独立合成验收，请直接调用 life.record_meal 保存以下明确完整的输入，不创建计划或偏好记忆。保存后报告真实回执：'+JSON.stringify({...mealInput,occurred_on:'2026-09-11'}),expected_id:null}];
  const results=[];
  for(const sample of samples){
    const thread=`thread_${randomUUID().replaceAll('-','')}`;await repository.createThread(context.subjectId,thread,sample.name);
    const started=performance.now(),response=await app.request(`/api/threads/${thread}/runs`,{method:'POST',headers:{authorization:`Bearer dev:${context.subjectId}`,'content-type':'application/json'},body:JSON.stringify({text:sample.prompt})});
    const text=await response.text();assert.equal(response.status,200);
    const events=text.split('\n').filter(line=>line.startsWith('data:')).map(line=>JSON.parse(line.slice(5)));
    const queries=events.filter(event=>event.type==='tool.result'&&event.capability==='agent.context'&&event.outcome==='returned');
    const ids=queries.flatMap(event=>event.result.records.map((record:any)=>record.ref.id));
    const terminal=events.filter(event=>event.type==='run.state').at(-1)?.state;
    const saved=events.filter(event=>event.type==='operation.committed');
    const matches=sample.name==='receipt-write'?saved.length===1&&saved[0].capability==='life.record_meal':saved.length===0&&(sample.expected_id?ids.includes(sample.expected_id):queries.length>0&&ids.length===0);
    results.push({sample:sample.name,expected_id:sample.expected_id,retrieved_ids:ids,retrieval_matches:matches,committed_operations:saved.length,tool_calls:events.filter(event=>event.type==='tool.result'||event.type==='operation.committed').length,tool_outcomes:events.filter(event=>event.type==='tool.result').map(event=>({capability:event.capability,outcome:event.outcome,...(event.outcome==='rejected'?{code:event.result.code}: {})})),terminal_state:terminal,answer:events.filter(event=>event.type==='message.delta').map(event=>event.text).join(''),duration_ms:performance.now()-started});
  }
  const report={fixture_version:'life-context-v2',declared_model:modelConfig?.model??process.env.SHADOW_EVAL_MODEL,runtime:adapter.id,host_runs:samples.length,runtime_requests:runtimeRequests,provider_model_calls:modelConfig?providerModelCalls:null,results,limitations:['Declared model is the requested provider model; provider routing is not independently attested.','This is a small live smoke test, not the 18-class offline invariant suite.']};
  if(process.env.SHADOW_EVAL_REPORT)writeFileSync(process.env.SHADOW_EVAL_REPORT,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
  for(const result of results){assert.equal(result.terminal_state,'completed',result.sample);assert.equal(result.retrieval_matches,true,result.sample);}
});
