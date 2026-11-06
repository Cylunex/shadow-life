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

const alipayBill=(identity:string,amount="8.8")=>`合成商店\n支出${amount}元\n交易成功\n订单金额\n10.00\n本店回头客红包\n-1.20\n支付时间\n2026-10-30 09:00:00\n商品说明\n合成商品\n订单号\n${identity}\n商家订单号\nMERCHANT-01\n返回\n账单详情\n全部账单`;
const shake=(id:string,text:string,explicit=true)=>({device_id:"device_shake",...(explicit?{record_expenses:true}:{}),items:[{...screen(id,text).items[0],app_package:"com.eg.android.AlipayGphone",title:"摇一摇补记 · 支付宝"}]});
test("Alipay title-first capture books the heading debit and backfill reuses the original source",pgOnly,async t=>{
 const f=await reviewFixture(t);
 const bill="返回\n全部账单\n\uE642\n账单详情\n支出18.60元\n交易成功\n支付时间\n2026-10-30 09:00:00\n付款方式\n示例银行卡\n商品说明\n合成午餐\n收款方全称\n示例餐厅\n订单号\nTITLE-FIRST-01\n商家订单号\n商家可扫码退款或查询交易\nMERCHANT-TITLE-01";
 await f.run("life.set_order_capture",{app_package:"com.eg.android.AlipayGphone",platform:"alipay",source_account:"original",enabled:true,auto_accounting:false});
 const captured=await f.run("life.ingest_activity",shake("title_first_old",bill,false));
 const id=captured.resources.find(r=>r.type==="activity_capture")!.id;
 await f.pool.query("update capture_order_sources set fields=fields-'paid_amount'-'transaction_id'");
 const backfill=await f.run("life.record_captured_expenses",{capture_ids:[id]});
 const record=backfill.resources.find(r=>r.type==="consumption_record")!.id;
 const repeat=await f.run("life.ingest_activity",shake("title_first_again",bill));
 assert.equal(repeat.resources.find(r=>r.type==="consumption_record")!.id,record);
 assert.equal((await f.queries.activitySource(f.context,{id})).consumption_record_id,record);
 const workspace=await f.queries.captureWorkspace(f.context,date);
 assert.equal(workspace.orders.length,1);assert.equal(workspace.orders[0]!.source_count,2);
 assert.equal(workspace.orders[0]!.source_account,"original");assert.equal(workspace.orders[0]!.conflict,false);
 const detail=await f.queries.lifeRecord(f.context,record);assert.equal(detail.kind,"record");
 if(detail.kind==="record"){assert.equal(Number(detail.money_entry?.amount),18.6);assert.equal(detail.occurred_on,"2026-10-30");}
 assert.equal((await f.pool.query("select count(*)::int n from money_entries")).rows[0].n,1);
});
test("explicit shake books paid expenses without background opt-in, retries/concurrent captures reuse one record",pgOnly,async t=>{
 const f=await reviewFixture(t);const bill=alipayBill("SHAKE-ONE");
 await f.run("life.set_order_capture",{app_package:"com.eg.android.AlipayGphone",platform:"alipay",source_account:"default",enabled:false,auto_accounting:false});
 await f.run("life.ingest_activity",shake("passive",bill,false));assert.equal((await f.queries.captureWorkspace(f.context,date)).orders.length,0);
 const receipts=await Promise.all([f.run("life.ingest_activity",shake("shake_a",bill)),f.run("life.ingest_activity",shake("shake_b",bill))]);
 assert.ok(receipts.every(r=>r.resources.some(v=>v.type==="money_entry")&&r.resources.some(v=>v.type==="consumption_record")));
 const record=receipts[0]!.resources.find(r=>r.type==="consumption_record")!.id;
 assert.equal(receipts[1]!.resources.find(r=>r.type==="consumption_record")!.id,record);
 const retry=await f.run("life.ingest_activity",shake("shake_a",bill));assert.equal(retry.actual_values.duplicates,1);assert.equal(retry.resources.find(r=>r.type==="consumption_record")!.id,record);
 assert.equal((await f.pool.query("select count(*)::int n from money_entries")).rows[0].n,1);
 const detail=await f.queries.lifeRecord(f.context,record);assert.equal(detail.kind,"record");if(detail.kind==="record")assert.equal(Number(detail.money_entry?.amount),8.8);
});
test("historical capture reprocessing preserves source identity and original account, and links file imports",pgOnly,async t=>{
 const f=await reviewFixture(t);const input=shake("old_shake",alipayBill("OLD-SHAKE"),false);
 await f.run("life.set_order_capture",{app_package:"com.eg.android.AlipayGphone",platform:"alipay",source_account:"original",enabled:true,auto_accounting:false});
 const old=await f.run("life.ingest_activity",input);
 // A persisted v2 observation must be reparsed from its original text on the same source.
 await f.pool.query("update capture_order_sources set fields=fields-'paid_amount'-'transaction_id'");
 const staged=await f.run("money.stage_import",{format:"json",source_name:"合成文件账单",platform:"alipay",source_account:"original",time_zone:"UTC",content:JSON.stringify([{"交易号":"OLD-SHAKE","交易时间":"2026-10-30 09:00:00","交易状态":"交易成功","收/支":"支出","交易对方":"合成商店","金额":"8.80","商品说明":"合成商品"}])});
 const candidate=(await f.pool.query("select id,revision,issues from money_import_candidates where batch_id=$1",[staged.actual_values.batch_id])).rows[0];assert.deepEqual(candidate.issues,[]);
 const imported=await f.run("money.resolve_import_candidate",{candidate_id:candidate.id,expected_revision:candidate.revision,decision:"confirm",remember_rule:false,reason:"确认合成账单"});
 await f.run("life.set_order_capture",{app_package:"com.eg.android.AlipayGphone",platform:"alipay",source_account:"changed",enabled:false,auto_accounting:false});
 const backfill=await f.run("life.record_captured_expenses",{capture_ids:[old.resources[0]!.id]});assert.equal(backfill.actual_values.processed,1);
 assert.equal(backfill.resources.find(r=>r.type==="activity_capture")!.id,old.resources[0]!.id);
 assert.equal(backfill.resources.find(r=>r.type==="consumption_record")!.id,imported.actual_values.record_id);
 assert.equal((await f.pool.query("select count(*)::int n from money_entries")).rows[0].n,1);
 assert.equal((await f.queries.captureWorkspace(f.context,date)).orders[0]!.source_account,"original");
 assert.equal((await f.queries.activitySource(f.context,{id:old.resources[0]!.id})).consumption_record_id,imported.actual_values.record_id);
 assert.equal((await f.queries.activitySource({...f.context,effects:new Set(["library.item.read"])},{id:old.resources[0]!.id})).consumption_record_id,null);
});
test("explicit capture rejects missing grants/restores and does not book pending, refund, incomplete or conflicting evidence",pgOnly,async t=>{
 const f=await reviewFixture(t);const bill=alipayBill("BLOCKED-SHAKE");
 await assert.rejects(()=>f.run("life.ingest_activity",shake("no_grants",bill),{...f.context,effects:new Set(["library.item.write"])}),/permission|money.entry.write/i);
 await assert.rejects(()=>f.run("life.ingest_activity",{...shake("restore",bill),device_id:"restore_archive"}));
 for(const [i,text] of [bill.replace("交易成功","待付款"),bill.replace("交易成功","退款成功"),bill.replace("支出8.8元","支出8.8"),bill.replace("支付时间","未知时间"),bill+"\n实付金额：9元"].entries())await f.run("life.ingest_activity",shake(`incomplete_${i}`,text.replaceAll("BLOCKED-SHAKE",`INCOMPLETE-${i}`)));
 assert.equal((await f.pool.query("select count(*)::int n from money_entries")).rows[0].n,0);
 await f.pool.query("update write_epochs set stage='legacy' where domain='ledger'");await assert.rejects(()=>f.run("life.ingest_activity",shake("fenced_shake",bill)),/fenced/);
 assert.equal((await f.pool.query("select count(*)::int n from activity_captures where source_id='fenced_shake'")).rows[0].n,0);
});

test("WeChat explicit gesture without a saved rule creates one expense and reuses it",pgOnly,async t=>{
 const f=await reviewFixture(t);const text="合成早点店\n主页\n交易详情\n-6.00\n当前状态\n支付成功\n收单机构\n财付通支付科技有限公司\n支付时间\n2026年10月30日 08:30:00\n支付方式\n零钱\n交易单号\nWX-SYNTHETIC-01\n经营单号\nMERCHANT-01";
 const input=shake("wechat_gesture",text);input.items[0]!.app_package="com.tencent.mm";
 const first=await f.run("life.ingest_activity",input);const record=first.resources.find(r=>r.type==="consumption_record")!.id;
 const second=await f.run("life.ingest_activity",{...input,items:[{...input.items[0],source_id:"wechat_repeat"}]});assert.equal(second.resources.find(r=>r.type==="consumption_record")!.id,record);
 const detail=await f.queries.lifeRecord(f.context,record);assert.equal(detail.kind,"record");if(detail.kind==="record"){assert.equal(Number(detail.money_entry?.amount),6);assert.equal(detail.occurred_on,"2026-10-30");}
 assert.equal((await f.pool.query("select count(*)::int n from money_entries")).rows[0].n,1);
});

test("backfill receipts replay, preserve original captures and reject deleted or other-owner sources atomically",pgOnly,async t=>{
 const f=await reviewFixture(t);await f.run("life.set_order_capture",{app_package:"com.eg.android.AlipayGphone",platform:"alipay",source_account:"default",enabled:true,auto_accounting:false});
 const captured=await f.run("life.ingest_activity",shake("backfill_a",alipayBill("BACKFILL-A"),false));const id=captured.resources[0]!.id;
 const before=(await f.pool.query("select fingerprint,text,started_at from activity_captures where id=$1",[id])).rows[0];
 await assert.rejects(()=>f.run("life.record_captured_expenses",{capture_ids:[id]},{...f.context,subjectId:"other_subject"}));
 const command=f.command("life.record_captured_expenses",{capture_ids:[id]});const first=await f.executor.execute(f.context,command);assert.equal(first.status,"committed");assert.equal((await f.executor.execute(f.context,command)).replayed,true);
 const repeat=await f.run("life.record_captured_expenses",{capture_ids:[id]});assert.deepEqual(repeat.resources.filter(r=>r.type==="consumption_record"),first.resources.filter(r=>r.type==="consumption_record"));
 assert.deepEqual((await f.pool.query("select fingerprint,text,started_at from activity_captures where id=$1",[id])).rows[0],before);
 await f.run("life.delete_activity",{id});await assert.rejects(()=>f.run("life.record_captured_expenses",{capture_ids:[id]}));assert.equal((await f.pool.query("select count(*)::int n from money_entries")).rows[0].n,1);
});

test("automatic SDK captures retain payment account provenance and deduplicate against native payment details",pgOnly,async t=>{
 const f=await reviewFixture(t);
 const text="支付成功\n付款金额：￥12.50\n交易单号：SDK-PAYMENT-01\n支付时间：2026-10-30 09:00:00\n商家名称：合成商店\n微信支付\n完成";
 const input={...shake("sdk_payment",text),items:[{...shake("sdk_payment",text).items[0],app_package:"example.merchant",payment_context:{platform:"wechat",source_account:"wallet",trigger:"payment_success"}}]};
 const first=await f.run("life.ingest_activity",input);const record=first.resources.find(r=>r.type==="consumption_record")!.id;
 const original=(await f.pool.query("select payment_context from activity_captures where id=$1",[first.resources.find(r=>r.type==="activity_capture")!.id])).rows[0];assert.equal(original.payment_context.platform,"wechat");assert.equal(original.payment_context.source_account,"wallet");
 await f.run("life.set_order_capture",{app_package:"com.tencent.mm",platform:"wechat",source_account:"wallet",enabled:false,auto_accounting:false});
 const detail={...shake("native_payment",text.replace("付款金额","实付金额")),items:[{...shake("native_payment",text.replace("付款金额","实付金额")).items[0],app_package:"com.tencent.mm"}]};
 const second=await f.run("life.ingest_activity",detail);assert.equal(second.resources.find(r=>r.type==="consumption_record")!.id,record);
 assert.equal((await f.pool.query("select count(*)::int n from money_entries")).rows[0].n,1);
 await assert.rejects(()=>f.run("life.ingest_activity",{...input,record_expenses:false}));
 await assert.rejects(()=>f.run("life.ingest_activity",input,{...f.context,effects:new Set(["library.item.write"])}));
});
test("incomplete automatic payment pages remain materials without fabricating identity or payment time",pgOnly,async t=>{
 const f=await reviewFixture(t);const text="支付成功\n￥12.50\n商家名称：合成商店\n完成";
 const input={...shake("auto_missing",text),items:[{...shake("auto_missing",text).items[0],payment_context:{platform:"alipay",source_account:"default",trigger:"payment_success"}}]};
 const receipt=await f.run("life.ingest_activity",input);assert.ok(receipt.resources.some(r=>r.type==="activity_capture"));assert.ok(!receipt.resources.some(r=>r.type==="money_entry"));
 assert.equal((await f.pool.query("select count(*)::int n from money_entries")).rows[0].n,0);
 const complete=text+"\n交易单号：AUTO-LATER-01\n支付时间：2026-10-30 09:00:00";
 const booked=await f.run("life.ingest_activity",{...input,items:[{...input.items[0],source_id:"auto_complete",text:complete}]});assert.ok(booked.resources.some(r=>r.type==="money_entry"));
});

test("payment capture provenance survives export and restore without booking and is erased on deletion",pgOnly,async t=>{
 const f=await reviewFixture(t);const text="支付成功\n付款金额：￥12.50\n交易单号：RESTORE-PAYMENT-01\n支付时间：2026-10-30 09:00:00\n完成";
 const item={...shake("context_backup",text).items[0],payment_context:{platform:"alipay",source_account:"backup-wallet",trigger:"payment_success"}};
 const receipt=await f.run("life.ingest_activity",{device_id:"device_auto",items:[item],record_expenses:true});
 const id=receipt.resources.find(r=>r.type==="activity_capture")!.id;
 const exported:any=await f.queries.captureCompletion(f.context,"life.capture_export",{from_on:"2026-10-30",to_on_exclusive:"2026-10-31",time_zone:"UTC"});
 assert.deepEqual(exported.items[0]!.payment_context,item.payment_context);
 const count=(await f.pool.query("select count(*)::int n from money_entries")).rows[0].n;
 await f.run("life.restore_activities",{archive_id:"payment_backup",items:[item]});
 assert.equal((await f.pool.query("select count(*)::int n from money_entries")).rows[0].n,count);
 assert.deepEqual((await f.pool.query("select payment_context from activity_captures where device_id='restore_payment_backup'")).rows[0].payment_context,item.payment_context);
 await f.run("life.delete_activity",{id});assert.equal((await f.pool.query("select payment_context from activity_captures where id=$1",[id])).rows[0].payment_context,null);
});

test("anonymous payment materials group on read, withdraw on ambiguity and never create another expense",pgOnly,async t=>{
 const f=await reviewFixture(t);
 const text="完成\n支付成功￥8.80\n支付成功\n8.80\n￥8.80\n订单金额\n付款方式\n示例银行信用卡(1234)";
 const automatic=await f.run("life.ingest_activity",{...shake("anonymous_result",text),items:[{...shake("anonymous_result",text).items[0],started_at:"2026-10-30T09:00:02Z",ended_at:"2026-10-30T09:00:02Z",payment_context:{platform:"alipay",source_account:"default",trigger:"payment_success"}}]});
 const id=automatic.resources.find(v=>v.type==="activity_capture")!.id;
 assert.equal((await f.queries.activitySource(f.context,{id})).related_consumption_record_id,null);
 const bill=alipayBill("GROUP-ONE")+"\n付款方式\n示例银行信用卡(1234)";
 const saved=await f.run("life.ingest_activity",shake("group_detail",bill));
 const record=saved.resources.find(v=>v.type==="consumption_record")!.id;
 let source=await f.queries.activitySource(f.context,{id});assert.equal(source.consumption_record_id,null);assert.equal(source.related_consumption_record_id,record);assert.equal(source.text,text);
 assert.equal((await f.pool.query("select count(*)::int n from money_entries")).rows[0].n,1);
 assert.equal((await f.queries.activitySource({...f.context,effects:new Set(["library.item.read"])},{id})).related_consumption_record_id,null);
 await f.run("life.ingest_activity",shake("group_competing",bill.replace("GROUP-ONE","GROUP-TWO")));
 source=await f.queries.activitySource(f.context,{id});assert.equal(source.related_consumption_record_id,null);
});

test("takeout screenshot text creates a source-linked order without another payment or configured rule",pgOnly,async t=>{
 const {readFileSync}=await import("node:fs");const takeoutFixture=()=>readFileSync(new URL("../../kernel/test/fixtures/takeout-a.txt",import.meta.url),"utf8");
 const f=await reviewFixture(t);const asset=await new AssetService(f.pool).store(f.context.subjectId,"image/jpeg",Buffer.from([255,216,255]));
 const sources:string[]=[];
 for(let i=0;i<2;i++){const receipt=await f.run("life.capture_screenshot",{asset_version_id:asset.asset_version_id,title:"合成长订单",captured_at:"2026-10-30T01:00:00Z",time_zone:"UTC",app_package:"com.shadow.life.shared_order",text:takeoutFixture().replace("合成外卖店",i?"合成外卖店（分店）":"合成外卖店")});sources.push(receipt.resources.find(r=>r.type==="activity_capture")!.id);}
 const page=await f.queries.captureWorkspace(f.context,date);assert.equal(page.orders.length,1);assert.equal(page.orders[0]!.source_count,2);assert.equal(page.orders[0]!.conflict,false);assert.equal(page.orders[0]!.record_id,null);
 const fields=JSON.parse(page.orders[0]!.fields);assert.equal(fields.takeout.items.length,8);assert.equal(fields.takeout.amounts_reconciled,true);
 for(const id of sources)assert.equal((await f.queries.activitySource(f.context,{id})).capture_order_id,page.orders[0]!.id);
 await f.pool.query("update capture_orders set conflict=true where id=$1",[page.orders[0]!.id]);
 const refreshed=await f.run("life.record_captured_expenses",{capture_ids:sources});assert.ok(!refreshed.resources.some(r=>r.type==="money_entry"||r.type==="consumption_record"));
 const repaired=await f.queries.captureWorkspace(f.context,date);assert.equal(repaired.orders.length,1);assert.equal(repaired.orders[0]!.source_count,2);assert.equal(repaired.orders[0]!.conflict,false);
 assert.equal((await f.pool.query("select count(*)::int n from money_entries")).rows[0].n,0);
});

test("complete takeout and payment materials group without joining their external identities",pgOnly,async t=>{
 const {readFileSync}=await import("node:fs");const takeoutFixture=()=>readFileSync(new URL("../../kernel/test/fixtures/takeout-a.txt",import.meta.url),"utf8");const f=await reviewFixture(t);
 const text=alipayBill("TAKEOUT-PAYMENT").replace("支出8.8元","支出19.98元").replace("2026-10-30 09:00:00","2026-10-30 19:17:57").replace("合成商品","合成外卖店外卖订单");
 const bill=await f.run("life.ingest_activity",shake("takeout_payment",text));
 await f.run("life.ingest_activity",{device_id:"screenshot_capture",items:[{...screen("takeout_order",takeoutFixture()).items[0],app_package:"com.shadow.life.shared_order"}]});
 const page=await f.queries.captureWorkspace(f.context,date);const order=page.orders.find(o=>o.platform==='eleme')!;
 assert.equal(order.record_id,null);assert.equal(order.related_record_id,bill.resources.find(r=>r.type==='consumption_record')!.id);
 assert.equal((await f.queries.captureWorkspace({...f.context,effects:new Set(['library.item.read'])},date)).orders.find(o=>o.platform==='eleme')!.related_record_id,null);
 assert.equal((await f.pool.query("select count(*)::int n from money_entries")).rows[0].n,1);
});
