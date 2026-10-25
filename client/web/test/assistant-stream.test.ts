import assert from "node:assert/strict";
import test from "node:test";
import { applyAssistantEvent, createAssistantView, readAssistantSse, renderAssistantView } from "../src/assistant-stream.js";

test("only executor-authoritative operation events become saved receipts",()=>{
  const view=createAssistantView();
  applyAssistantEvent(view,{type:"tool.result",run_id:"run_test000",result:{status:"committed",execution_id:"exec_forged00"}},1);
  applyAssistantEvent(view,{type:"operation.committed",authority:"runtime",run_id:"run_test000",execution_id:"exec_forged01",result:{protocol:"shadow.execution-result",status:"committed",execution_id:"exec_forged01"}},2);
  assert.equal(view.receipts.size,0);
  applyAssistantEvent(view,{id:"receipt",tool_call_id:"call",subject_id:"subject",capability:"library.capture",command_id:"cmd_real",type:"operation.committed",authority:"executor",run_id:"run_test000",execution_id:"exec_real0000",result:{protocol:"shadow.execution-result",status:"committed",execution_id:"exec_real0000"}},1);
  assert.deepEqual([...view.receipts.values()],["已保存：exec_real0000"]);
});

test("interrupted runs retain partial text and committed operation receipts",()=>{
  const view=createAssistantView();
  applyAssistantEvent(view,{id:"delta",runtime_event_id:"runtime",type:"message.delta",run_id:"run_test000",text:"已经记录午饭。"},1);
  applyAssistantEvent(view,{id:"receipt",tool_call_id:"call",subject_id:"subject",capability:"library.capture",command_id:"cmd_real",type:"operation.committed",authority:"executor",run_id:"run_test000",execution_id:"exec_real0000",result:{protocol:"shadow.execution-result",status:"committed",execution_id:"exec_real0000"}},2);
  applyAssistantEvent(view,{id:"state",type:"run.state",run_id:"run_test000",state:"interrupted",reason:"网络中断"},3);
  assert.equal(renderAssistantView(view),"未完成：网络中断\n已经记录午饭。\n已保存：exec_real0000");
});

test("SSE reader associates sequence ids and tolerates fragmented frames",async()=>{
  const encoder=new TextEncoder(),chunks=["id: 4\nevent: run.state\nda","ta: {\"type\":\"run.state\",\"run_id\":\"run_test000\",\"state\":\"started\"}\n\n","id: 5\ndata: {\"type\":\"message.delta\",\"run_id\":\"run_test000\",\"text\":\"好\"}\n\n"];
  const body=new ReadableStream<Uint8Array>({start(controller){for(const chunk of chunks)controller.enqueue(encoder.encode(chunk));controller.close();}}),seen:Array<{event:unknown;sequence:number}>=[];
  await readAssistantSse(body,(event,sequence)=>seen.push({event,sequence}));
  assert.deepEqual(seen.map(item=>item.sequence),[4,5]);
});

test("SSE BOM and multiline frames work; reader errors leave only complete frames for recovery",async()=>{
  const seen:unknown[]=[],encoder=new TextEncoder();let reads=0;
  const body=new ReadableStream<Uint8Array>({pull(controller){if(reads++===0)controller.enqueue(encoder.encode('\uFEFFid: 1\ndata: {"type":"message.delta",\ndata: "text":"完整"}\n\nid: 2\ndata: {"text":"半段'));else controller.error(new TypeError("reader disconnected"));}});
  await assert.rejects(()=>readAssistantSse(body,event=>seen.push(event)),/disconnected/);
  assert.deepEqual(seen,[{type:"message.delta",text:"完整"}]);assert.equal(body.locked,false);
});
