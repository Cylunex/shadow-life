import assert from "node:assert/strict";
import test from "node:test";
import { pgOnly,reviewFixture } from "./review-fixture.js";
import { AssetService } from "../src/asset-service.js";
import { processPendingRecordings } from "../src/recording-worker.js";
const date={date:"2026-10-30",time_zone:"UTC"};
const screen=(id:string,text:string)=>({device_id:"device_suite",items:[{source_id:id,kind:"screen_text",title:"订单",app_package:"example.shop",text,started_at:"2026-10-30T01:00:00Z",ended_at:"2026-10-30T01:00:00Z",time_zone:"UTC"}]});
test("recording pipeline scopes assets, leases, timestamp validation, user revisions and deletion",pgOnly,async t=>{
 const f=await reviewFixture(t);const asset=await new AssetService(f.pool).store(f.context.subjectId,"audio/wav",Buffer.from("synthetic audio"));
 const segment={segment_id:"audio_suite_0001",session_id:"recording_suite_0001",segment_index:0,title:"合成会议",started_at:"2026-10-30T02:00:00Z",ended_at:"2026-10-30T02:01:00Z",time_zone:"UTC",asset_version_id:asset.asset_version_id};
 await assert.rejects(()=>f.run("life.register_recording",segment,{...f.context,subjectId:"another_subject"}));
 await f.run("life.register_recording",segment);await f.run("life.register_recording",segment);
 assert.equal((await f.queries.captureWorkspace(f.context,date)).recordings.length,1);
 const claimed=await f.run("life.claim_recording",{segment_id:segment.segment_id,expected_attempt:0});const attempt=claimed.actual_values.attempt;
 await assert.rejects(()=>f.run("life.complete_recording",{segment_id:segment.segment_id,attempt,processor_version:"stub",spans:[{start_ms:0,end_ms:61000,text:"invalid"}]}),/inside/);
 await f.run("life.fail_recording",{segment_id:segment.segment_id,attempt,message:"合成失败"});await f.run("life.retry_recording",{segment_id:segment.segment_id});
 const outcomes=await processPendingRecordings(f.pool,1,{available:true,async process(){return {processor_version:"stub-v1",spans:[{start_ms:0,end_ms:1000,text:"原始转写",speaker:null}]};}});assert.equal(outcomes[0]?.state,"completed");
 let workspace=await f.queries.captureWorkspace(f.context,date);assert.equal(workspace.recordings[0]!.spans[0]!.text,"原始转写");
 await f.run("life.generate_activity_review",{...date,period:"day"});
 await f.run("life.revise_transcript",{segment_id:segment.segment_id,expected_revision:1,reason:"用户纠正",spans:[{start_ms:0,end_ms:1000,text:"更正后的转写"}]});
 workspace=await f.queries.captureWorkspace(f.context,date);assert.equal(workspace.reviews[0]!.stale,true);assert.equal(workspace.reviews[0]!.body.includes("原始转写"),false);
 await assert.rejects(()=>f.run("life.complete_recording",{segment_id:segment.segment_id,attempt:2,processor_version:"late",spans:[]}),/stale/);
 const activity=(await f.pool.query("select id from activity_captures where source_id=$1",[segment.segment_id])).rows[0];await f.run("life.delete_activity",{id:activity.id});await f.run("life.register_recording",segment);
 assert.equal((await f.queries.captureWorkspace(f.context,date)).recordings.length,0);
 assert.equal((await f.queries.captureWorkspace({...f.context,subjectId:"another_subject"},date)).recordings.length,0);
 await assert.rejects(()=>f.queries.captureWorkspace({...f.context,effects:new Set()},date),/library.item.read/);
});
test("automatic orders merge strong scoped identities, re-use ledger import fences and keep conflicts explicit",pgOnly,async t=>{
 const f=await reviewFixture(t);
 await f.run("life.set_order_capture",{app_package:"example.shop",platform:"taobao",source_account:"default",enabled:true,auto_accounting:true});
 const pending="订单号：DEMO-001\n订单金额：128.00\n待付款";
 await f.run("life.ingest_activity",screen("screen_suite_pending",pending));
 let workspace=await f.queries.captureWorkspace(f.context,date);assert.equal(workspace.orders.length,1);assert.equal(workspace.orders[0]!.record_id,null);
 const paid="订单号：DEMO-001\n实付金额：￥128.00\n付款时间：2026-10-30 09:00\n商家名称：合成商户\n商品名称：合成商品\n支付成功";
 const receipt=await f.run("life.ingest_activity",screen("screen_suite_paid",paid));
 workspace=await f.queries.captureWorkspace(f.context,date);assert.equal(workspace.orders.length,1);assert.equal(workspace.orders[0]!.source_count,2);assert.ok(workspace.orders[0]!.record_id);assert.ok(receipt.resources.some(r=>r.type==='money_entry'));
 await f.run("life.ingest_activity",screen("screen_suite_repeat",paid));assert.equal((await f.pool.query("select count(*)::int n from money_entries where subject_id=$1",[f.context.subjectId])).rows[0].n,1);
 await f.run("life.ingest_activity",screen("screen_suite_conflict",paid.replace("128.00","999.00")));workspace=await f.queries.captureWorkspace(f.context,date);assert.equal(workspace.orders[0]!.conflict,true);
 assert.equal(Number((await f.pool.query("select amount::text amount from money_entries where subject_id=$1",[f.context.subjectId])).rows[0].amount),128);
 await f.run("life.set_order_capture",{app_package:"example.shop",platform:"taobao",source_account:"other-account",enabled:true,auto_accounting:false});await f.run("life.ingest_activity",screen("screen_suite_other",paid));assert.equal((await f.queries.captureWorkspace(f.context,date)).orders.length,2);
});
test("hierarchical reviews retain calendar windows and become stale without exposing deleted source text",pgOnly,async t=>{
 const f=await reviewFixture(t);const captured=await f.run("life.ingest_activity",screen("screen_review_suite","合成材料，不是完整生活"));
 for(const period of ["day","week","month"]){await f.run("life.generate_activity_review",{...date,period});await f.run("life.generate_activity_review",{...date,period});}
 let workspace=await f.queries.captureWorkspace(f.context,date);assert.equal(workspace.reviews.length,3);assert.equal((await f.queries.activitySource(f.context,{id:captured.resources[0]!.id})).text,"合成材料，不是完整生活");assert.ok(workspace.reviews.every(r=>r.revision===1&&!r.stale&&r.body.includes("来源")));
 assert.equal(workspace.reviews.find(r=>r.period==='week')!.from_on,"2026-10-26");assert.equal(workspace.reviews.find(r=>r.period==='month')!.to_on_exclusive,"2026-11-01");
 await f.run("life.delete_activity",{id:captured.resources[0]!.id});await assert.rejects(()=>f.queries.activitySource(f.context,{id:captured.resources[0]!.id}));workspace=await f.queries.captureWorkspace(f.context,date);assert.ok(workspace.reviews.every(r=>r.stale&&!r.body.includes("合成材料")));
 await f.run("life.generate_activity_review",{...date,period:"day"});workspace=await f.queries.captureWorkspace(f.context,date);assert.equal(workspace.reviews.find(r=>r.period==='day')!.revision,2);
});
test("screenshot command stores the fixed image and directly observed page text under one operation",pgOnly,async t=>{
 const f=await reviewFixture(t);const asset=await new AssetService(f.pool).store(f.context.subjectId,"image/png",Buffer.from([137,80,78,71]));
 const receipt=await f.run("life.capture_screenshot",{asset_version_id:asset.asset_version_id,title:"合成订单截图",captured_at:"2026-10-30T01:00:00Z",time_zone:"UTC",app_package:"example.shop",text:"订单号：SCREENSHOT-ONE\n待付款"});
 assert.ok(receipt.resources.some(r=>r.type==='library_item'));const source=receipt.resources.find(r=>r.type==='activity_capture')!;const detail=await f.queries.activitySource(f.context,{id:source.id});assert.equal(detail.library_item_id,receipt.actual_values.library_item_id);assert.match(detail.text!,/SCREENSHOT-ONE/);
 await assert.rejects(()=>f.queries.activitySource({...f.context,subjectId:"other_subject"},{id:source.id}));
});
test("review worker updates only changed material and keeps unchanged revisions stable",pgOnly,async t=>{
 const {materializeCaptureReviews}=await import("../src/capture-review-worker.js");const f=await reviewFixture(t);const capture=await f.run("life.ingest_activity",screen("screen_auto_review","合成工作记录"));
 assert.equal((await materializeCaptureReviews(f.pool)).length,1);assert.equal((await materializeCaptureReviews(f.pool)).length,0);
 const initial=await f.queries.captureWorkspace(f.context,date);assert.equal(initial.reviews.length,3);
 await f.run("life.delete_activity",{id:capture.resources[0]!.id});assert.equal((await materializeCaptureReviews(f.pool)).length,1);assert.equal((await materializeCaptureReviews(f.pool)).length,0);
 const updated=await f.queries.captureWorkspace(f.context,date);assert.ok(updated.reviews.every(r=>r.source_count===0&&r.source_refs.length===0&&!r.stale));
});
test("partial order and transaction pages merge only when a later page proves the bridge",pgOnly,async t=>{
 const f=await reviewFixture(t);await f.run("life.set_order_capture",{app_package:"example.shop",platform:"alipay",source_account:"default",enabled:true,auto_accounting:true});
 await f.run("life.ingest_activity",screen("bridge_order_only","订单号：ORDER-BRIDGE\n待付款"));await f.run("life.ingest_activity",screen("bridge_trade_only","交易单号：TRADE-BRIDGE\n待付款"));assert.equal((await f.queries.captureWorkspace(f.context,date)).orders.length,2);
 await f.run("life.ingest_activity",screen("bridge_both_fields","订单号：ORDER-BRIDGE\n交易单号：TRADE-BRIDGE\n待付款"));const orders=(await f.queries.captureWorkspace(f.context,date)).orders;assert.equal(orders.length,1);assert.equal(orders[0]!.source_count,3);assert.equal(orders[0]!.conflict,false);
});
test("automatic accounting respects current grants and the ledger migration fence atomically",pgOnly,async t=>{
 const f=await reviewFixture(t);await f.run("life.set_order_capture",{app_package:"example.shop",platform:"taobao",source_account:"default",enabled:true,auto_accounting:true});
 const paid="订单号：FENCE-ONE\n实付金额：￥12.00\n付款时间：2026-10-30 09:00\n支付成功";
 await f.run("life.ingest_activity",screen("fence_readonly_actor",paid),{...f.context,effects:new Set(["library.item.write"])});assert.equal((await f.queries.captureWorkspace(f.context,date)).orders[0]!.record_id,null);
 await f.pool.query("update write_epochs set stage='legacy' where domain='ledger'");await assert.rejects(()=>f.run("life.ingest_activity",screen("fence_full_actor",paid)),/fenced/);assert.equal((await f.pool.query("select count(*)::int n from activity_captures where source_id='fence_full_actor'")).rows[0].n,0);
 await f.pool.query("update write_epochs set stage='life' where domain='ledger'");await f.run("life.ingest_activity",screen("fence_full_actor",paid));assert.ok((await f.queries.captureWorkspace(f.context,date)).orders[0]!.record_id);
 assert.equal((await f.queries.captureWorkspace({...f.context,effects:new Set(["library.item.read"])},date)).orders[0]!.record_id,null);
});
test("long recordings paginate with a subject-bound stable cursor and no missing fragments",pgOnly,async t=>{
 const f=await reviewFixture(t);const asset=await new AssetService(f.pool).store(f.context.subjectId,"audio/wav",Buffer.from("synthetic pagination audio"));
 for(let i=0;i<101;i++){const started=new Date(Date.UTC(2026,9,30,1)+i*60000);await f.run("life.register_recording",{segment_id:`audio_page_${String(i).padStart(4,'0')}`,session_id:"recording_page_0001",segment_index:i,title:"合成长录音",started_at:started.toISOString(),ended_at:new Date(started.getTime()+30000).toISOString(),time_zone:"UTC",asset_version_id:asset.asset_version_id});}
 const first=await f.queries.captureWorkspace(f.context,date);assert.equal(first.recordings.length,100);assert.ok(first.recordings_next_before_id);const last=await f.queries.captureWorkspace(f.context,{...date,recordings_before_id:first.recordings_next_before_id});assert.equal(last.recordings.length,1);assert.equal(new Set([...first.recordings,...last.recordings].map(r=>r.id)).size,101);assert.equal(last.recordings_next_before_id,null);
 await assert.rejects(()=>f.queries.captureWorkspace({...f.context,subjectId:"other_subject"},{...date,recordings_before_id:first.recordings_next_before_id}));
});
