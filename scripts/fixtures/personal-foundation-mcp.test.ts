import assert from 'node:assert/strict';
import test from 'node:test';
import { createApp } from '../../apps/api/src/app.js';
import { LifeClient } from '../../apps/mcp/src/client.js';
import { createMcpServer } from '../../apps/mcp/src/server.js';
import { reviewFixture, pgOnly } from '../../packages/database/test/review-fixture.js';

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
