import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { AssetService, configuredVisionProcessor, processPendingLibrary, visionAvailability, type VisionProcessor } from "../src/index.js";
import { pgOnly, reviewFixture } from "./review-fixture.js";

test("configured vision adapter validates its local stub protocol and availability",async t=>{
  assert.equal(visionAvailability({}).available,false);
  assert.equal(visionAvailability({SHADOW_LIBRARY_VISION_URL:"http://example.com/vision"}).available,false);
  const server=createServer(async(request,response)=>{
    let raw="";for await(const chunk of request)raw+=String(chunk);
    const input=JSON.parse(raw) as {protocol:string;pages:Array<{page:number;data_base64:string}>};
    assert.equal(input.protocol,"shadow.library.vision.request");assert.equal(input.pages[0]?.page,1);
    assert.equal(Buffer.from(input.pages[0]!.data_base64,"base64").toString(),"synthetic image");
    response.setHeader("content-type","application/json");response.end(JSON.stringify({protocol:"shadow.library.vision.response",processor_version:"stub-vision-v1",candidate:{title:"合成车票",document_date:"2026-09-10",category:"旅行",summary:"一张车票",content:"合成车票识别词",locators:[{page:1,quote:"合成车票识别词"}]}}));
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));t.after(()=>server.close());
  const address=server.address();assert.ok(address&&typeof address!=="string");
  const processor=configuredVisionProcessor({SHADOW_LIBRARY_VISION_URL:`http://127.0.0.1:${address.port}/vision`});
  assert.equal(processor.available,true);
  assert.equal((await processor.process(Buffer.from("synthetic image"),"image/png")).candidate.title,"合成车票");
  await assert.rejects(()=>processor.process(Buffer.from("x"),"image/gif"),/does not support/u);
  await assert.rejects(()=>configuredVisionProcessor({}).process(Buffer.from("x"),"image/png"),/未配置/u);
});

test("monthly reconciliation keeps raw candidates and separates pending, duplicates, category and refund links",pgOnly,async t=>{
  const f=await reviewFixture(t);
  const staged=await f.run("money.stage_import",{format:"csv",source_name:"九月账单.csv",content:"date,type,amount,merchant,transaction_id\n2026-09-10,expense,12.30,合成超市,a-1\n2026-09-11,refund,2.30,合成超市,a-2",time_zone:"Asia/Shanghai"});
  const batchId=String(staged.actual_values.batch_id);
  const month=await f.queries.moneyImportMonth(f.context,{period:"2026-09"});
  assert.equal(month.totals.unconfirmed,2);assert.equal(month.totals.uncategorized,2);assert.equal(month.totals.refunds_unlinked,1);
  const review=await f.queries.moneyImportReview(f.context,batchId);
  assert.equal(review.candidates[0]!.proposed.amount,"12.30");assert.equal(review.candidates[0]!.raw.amount,"12.30");
  await assert.rejects(()=>f.queries.moneyImportMonth({...f.context,effects:new Set()}, {period:"2026-09"}),/Missing permission/u);
  await f.run("money.resolve_import_candidate",{candidate_id:review.candidates[0]!.id,expected_revision:1,decision:"ignore",reason:"合成样例忽略"});
  assert.equal((await f.queries.moneyImportMonth(f.context,{period:"2026-09"})).totals.unconfirmed,1);
});

test("trip checklist revisions and member visibility follow the shared Executor",pgOnly,async t=>{
  const f=await reviewFixture(t),created=await f.run("travel.create_trip",{title:"合成行程",starts_on:"2026-09-10",ends_on:"2026-09-12",time_zone:"Asia/Shanghai"}),tripId=String(created.actual_values.trip_id);
  const first=await f.run("travel.set_checklist",{trip_id:tripId,items:[{title:"证件",state:"needed"}],reason:"建立清单"});
  const workspace=await f.queries.travelWorkspace(f.context,{trip_id:tripId});
  assert.equal(workspace.checklist?.items[0]?.title,"证件");assert.equal(workspace.checklist?.revision,1);
  await assert.rejects(()=>f.run("travel.set_checklist",{trip_id:tripId,expected_revision:1,items:[{id:"trip_check_foreign",title:"伪造",state:"packed"}],reason:"伪造 ID"}),/identity/u);
  const id=workspace.checklist!.items[0]!.id;
  await f.run("travel.set_checklist",{trip_id:tripId,expected_revision:1,items:[{id,title:"证件",state:"packed"}],reason:"收拾完毕"});
  assert.equal((await f.queries.travelWorkspace(f.context,{trip_id:tripId})).checklist?.items[0]?.state,"packed");
  assert.equal((await f.pool.query("select count(*)::int count from trip_checklist_revisions")).rows[0].count,1);
  await assert.rejects(()=>f.queries.travelWorkspace({...f.context,subjectId:"subject_other"},{trip_id:tripId}),/not found/u);
  assert.equal(first.actual_values.revision,1);
});

test("vision worker preserves original, holds candidates for confirmation and uses receipt transitions",pgOnly,async t=>{
  const vision:VisionProcessor={available:true,reason:null,async process(){return{processorVersion:"stub-vision-v1",candidate:{title:"合成车票",document_date:"2026-09-10",category:"旅行",summary:"一张车票",content:"合成车票识别词",locators:[{page:1,quote:"合成车票识别词"}]}};}};
  const f=await reviewFixture(t),asset=await new AssetService(f.pool).store(f.context.subjectId,"image/png",Buffer.from("synthetic image"));
  const captured=await f.run("library.capture",{title:"合成车票",item_type:"image",tags:[],source:{kind:"image",captured_on:"2026-09-10",asset_version_id:asset.asset_version_id}}),itemId=String(captured.actual_values.library_item_id);
  const queued=await f.run("library.queue_processing",{item_id:itemId,source_asset_version_id:asset.asset_version_id,kind:"vision",requested_processor:"configured-vision-v1"});
  assert.deepEqual(await processPendingLibrary(f.pool,20,vision),[{job_id:queued.actual_values.library_processing_job_id,state:"completed"}]);
  const detail=await f.queries.libraryItem(f.context,itemId);
  assert.match(detail.snippets[0]!.text,/合成车票识别词/u);assert.equal(detail.revisions[0]!.text,null);
  assert.equal(detail.processing_jobs[0]!.suggestion?.document_date,"2026-09-10");
  await f.run("library.revise",{item_id:itemId,expected_revision:1,title:"合成车票",text:"人工核对的正文",tags:[],document_date:"2026-09-10",category:"旅行",source_processing_job_id:String(queued.actual_values.library_processing_job_id),reason:"人工确认视觉候选"});
  const confirmed=await f.queries.libraryItem(f.context,itemId);assert.equal(confirmed.revisions[0]!.text,"人工核对的正文");assert.equal(confirmed.revisions[0]!.source_processing_job_id,queued.actual_values.library_processing_job_id);
  assert.equal((await f.pool.query("select bytes from asset_blobs where asset_version_id=$1",[asset.asset_version_id])).rows[0].bytes.toString(),"synthetic image");
});

test("unconfigured vision fails visibly and retries through the Executor",pgOnly,async t=>{
  const f=await reviewFixture(t),asset=await new AssetService(f.pool).store(f.context.subjectId,"image/png",Buffer.from("synthetic image"));
  const captured=await f.run("library.capture",{title:"待处理图片",item_type:"image",tags:[],source:{kind:"image",captured_on:"2026-09-10",asset_version_id:asset.asset_version_id}}),itemId=String(captured.actual_values.library_item_id);
  const queued=await f.run("library.queue_processing",{item_id:itemId,source_asset_version_id:asset.asset_version_id,kind:"vision",requested_processor:"configured-vision-v1"}),jobId=String(queued.actual_values.library_processing_job_id);
  const unavailable=configuredVisionProcessor({});assert.deepEqual((await processPendingLibrary(f.pool,20,unavailable)).map(item=>item.state),["failed"]);
  let detail=await f.queries.libraryItem(f.context,itemId);assert.match(detail.processing_jobs[0]!.last_error??"",/未配置/u);assert.equal(detail.processing_jobs[0]!.suggestion,null);
  await f.run("library.retry_processing",{job_id:jobId});
  const vision:VisionProcessor={available:true,reason:null,async process(){return{processorVersion:"stub-vision-v1",candidate:{title:"待处理图片",document_date:null,category:null,summary:"人工核对",content:"可检索内容",locators:[{page:1,quote:"可检索内容"}]}};}};
  assert.deepEqual((await processPendingLibrary(f.pool,20,vision)).map(item=>item.state),["completed"]);
  detail=await f.queries.libraryItem(f.context,itemId);assert.equal(detail.processing_jobs[0]!.attempts,2);assert.equal(detail.revisions[0]!.text,null);
});
