import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../server/api/src/app.js';
import { LifeClient } from '../../client/mcp/src/client.js';
import { createMcpServer } from '../../client/mcp/src/server.js';
import { reviewFixture, pgOnly } from '../../server/database/test/review-fixture.js';

test('HTTP and actual MCP calls share personal data and cannot widen fixed scenarios',pgOnly,async t=>{
  const {run,unitOfWork,executor,queries,context}=await reviewFixture(t);
  await run('agent.set_intention',{key:'travel-seat',scope:'travel',kind:'preference',category:'travel',statement:'火车靠窗',assertion:'explicit'});
  await run('agent.set_intention',{key:'planning-time',scope:'planning',kind:'constraint',category:'time_budget',minutes:30,statement:'做饭半小时',assertion:'explicit'});
  const app=createApp({unitOfWork,executor,queries,developmentAuth:true});
  const fetcher=((url:string,init:RequestInit)=>{const target=new URL(url);return app.request(target.pathname+target.search,init);}) as typeof fetch;
  const client=new LifeClient({api:'https://life.example.com',token:`dev:${context.subjectId}`,profile:'personal',scenario:'planning',fetch:fetcher}),handle=createMcpServer(client);
  const call=async(name:string,args:unknown)=>await handle(JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})) as any;
  const result=await call('agent.intentions',{on:'2026-10-14',scenario:'travel'});
  assert.equal(result.result.structuredContent.items.length,1);assert.equal(result.result.structuredContent.items[0].statement,'做饭半小时');
  const rejected=await call('agent.set_intention',{command_id:'cmd_outside_scope',input:{key:'travel-new',scope:'travel',kind:'preference',category:'travel',statement:'未获本场景授权',assertion:'explicit'}});
  assert.equal(rejected.result.isError,true);
  const saved=await call('agent.save_task',{command_id:'cmd_mcp_checkpoint',input:{task_key:'dinner',scope:'planning',title:'做晚饭',next_step:'看食材'}});
  assert.equal(saved.result.structuredContent.status,'committed');
  const other=new LifeClient({api:'https://life.example.com',token:`dev:${context.subjectId}`,profile:'personal',fetch:fetcher});
  const tasks=await other.call('agent.tasks',{}) as any;assert.equal(tasks.items[0].next_step,'看食材');
  const response=await app.request('/api/agent/foundation/workspace',{method:'POST',headers:{authorization:`Bearer dev:${context.subjectId}`,'content-type':'application/json'},body:JSON.stringify({scenario:'planning',from_on:'2026-10-14',to_on_exclusive:'2026-10-17'})});
  assert.equal(response.status,200);assert.equal((await response.json() as any).intentions[0].statement,'做饭半小时');
});

test('configured proxy MCP clients retain identity across sessions and fence task claims',pgOnly,async t=>{
  const {unitOfWork,executor,queries,context}=await reviewFixture(t),secret='fixture-proxy-secret-of-at-least-32-characters';
  const app=createApp({unitOfWork,executor,queries,developmentAuth:false,auth:{proxyAuth:{secret,subjectId:context.subjectId,clientIds:['client_hermes','client_openclaw']}}});
  const fetcher=((url:string,init:RequestInit)=>app.request(new URL(url).pathname+new URL(url).search,init)) as typeof fetch;
  const client=(id:string)=>new LifeClient({api:'https://life.example.com',proxySecret:secret,proxyClientId:id,profile:'personal',fetch:fetcher});
  const hermes=client('client_hermes'),openclaw=client('client_openclaw');
  const input={task_key:'integration',title:'跨会话恢复',scope:'planning',state:'running',claim_seconds:15,next_step:'核对接口'};
  const receipt=await hermes.call('agent.save_task',{command_id:'cmd_fixture_claim',input}) as any;
  const resumed=await client('client_hermes').call('agent.tasks',{id:receipt.actual_values.id}) as any;
  assert.equal(resumed.items[0].lease.token,receipt.actual_values.lease_token);
  assert.equal(resumed.items[0].provenance.client_id,'client_hermes');
  const other=await openclaw.call('agent.tasks',{id:receipt.actual_values.id}) as any;
  assert.equal(other.items[0].lease.token,null);
  await assert.rejects(()=>openclaw.call('agent.save_task',{command_id:'cmd_fixture_compete',input:{...input,id:receipt.actual_values.id,expected_revision:1,reason:'竞争'}}),/claimed/);
  await hermes.call('agent.save_task',{command_id:'cmd_fixture_release',input:{...input,id:receipt.actual_values.id,expected_revision:1,lease_token:resumed.items[0].lease.token,claim_seconds:undefined,state:'waiting',reason:'交接'}});
  const taken=await openclaw.call('agent.save_task',{command_id:'cmd_fixture_takeover',input:{...input,id:receipt.actual_values.id,expected_revision:2,reason:'接手'}}) as any;
  assert.equal(taken.actual_values.revision,3);
});
