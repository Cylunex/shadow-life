import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import type { AgentContextResult } from '@shadow/contracts';
import { agentContextResultSchema } from '@shadow/contracts';
import { applyAssistantEvent,createAssistantView } from '../src/assistant-stream.js';
import { AssistantSources,sourceHref } from '../src/AssistantSources.js';
import { selectionFromLocation } from '../src/record-detail.js';
import { RecordDetailContent } from '../src/RecordDetailContent.js';

function result():AgentContextResult{return agentContextResultSchema.parse({as_of:'2026-09-10T00:00:00Z',time_zone:'Asia/Shanghai',range:{from_on:null,to_on_exclusive:null},response_format:'concise',memories:[],records:[{ref:{kind:'library_item',id:'library_12345678',revision:1},domain:'library',title:'旧正文来源',happened_on:'2026-09-10',occurred_at:null,time_zone:'Asia/Shanghai',source_type:'note',detail:{capability:'library.get_item',input:{id:'library_12345678'}}}],coverage:{authorized_kinds:['library_item'],matched_records:1,returned_records:1,matched_memories:0,unknown:[],complete:true},truncation:{truncated:false,reasons:[],omitted_records:0,omitted_memories:0,result_bytes:1000,byte_budget:16000},continuation:{capability:'agent.context',next_offset:null,instruction:'read detail'}});}

test('only successful Host context results create sources; receipts retain their own meaning',()=>{
  const view=createAssistantView(),value=result(),event={id:'query',type:'tool.result',authority:'runtime',run_id:'run_12345678',capability:'agent.context',tool_call_id:'call_source',outcome:'returned',result:value};
  applyAssistantEvent(view,event,1);assert.equal(view.contextQueries.size,0);
  applyAssistantEvent(view,{...event,authority:'host'},1);applyAssistantEvent(view,{...event,authority:'host'},1);assert.equal(view.contextQueries.size,1);assert.equal(view.receipts.size,0);
  applyAssistantEvent(view,{...event,authority:'host',outcome:'rejected',result:{code:'not_found'}},2);assert.equal(view.contextQueries.size,0);assert.equal(view.contextUnavailable,true);
});
test('source expansion labels actual queries, preserves Library revision and uses the existing detail route',()=>{
  const value=result(),record=value.records[0]!,href=sourceHref(record),selection=selectionFromLocation(href)!;
  assert.equal(selection.sourceRevision,1);assert.equal(selection.domain,'library');assert.equal(new URLSearchParams(sourceHref(record,true)).has('source_revision'),false);
  const html=renderToStaticMarkup(createElement(AssistantSources,{queries:[value],headers:{}}));assert.match(html,/本次查询的来源/);assert.match(html,/回答未提供逐句引用/);assert.match(html,/旧正文来源/);assert.doesNotMatch(html,/已保存/);
  const detail=renderToStaticMarkup(createElement(RecordDetailContent,{selection,value:{item:{title:'最新标题'},revisions:[{revision:1,text:'真实旧正文'},{revision:2,text:'真实新正文'}]}}));assert.match(detail,/本次查询的来源 · 修订 1/);assert.match(detail,/真实旧正文/);
});
