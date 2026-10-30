import assert from "node:assert/strict";
import test from "node:test";
import { buildCaptureReview,captureReviewSignature } from "../src/capture-review.js";
import { capturedPaymentHasCnyEvidence,capturedPaymentIdentity } from "../src/activity-order.js";
test("paid currency evidence belongs to the payment and rejects mixed currencies",()=>{
 assert.equal(capturedPaymentHasCnyEvidence("实付金额：￥128.00"),true);assert.equal(capturedPaymentHasCnyEvidence("实付金额\n128.00元"),true);
 assert.equal(capturedPaymentHasCnyEvidence("实付金额：128.00\n运费：0元"),false);assert.equal(capturedPaymentHasCnyEvidence("实付金额：128.00\n币种：USD\n运费：0元"),false);assert.equal(capturedPaymentHasCnyEvidence("实付金额：￥128.00\n货币：美元"),false);assert.equal(capturedPaymentHasCnyEvidence("实付金额：128.00\n币种：CNY"),true);
 assert.equal(capturedPaymentIdentity("jd",{order_id:"order",transaction_id:"trade"}),"order");assert.equal(capturedPaymentIdentity("alipay",{order_id:"order"}),undefined);
});
test("large month reviews retain source counts with bounded readable summaries and real references",()=>{
 const facts=Array.from({length:15000},(_,i)=>({id:`activity_${i}`,kind:"app_usage",title:"合成活动",started_at:new Date(Date.UTC(2026,9,1)+i*120000).toISOString(),ended_at:new Date(Date.UTC(2026,9,1)+i*120000+60000).toISOString(),text:null,stamp:"v1"}));
 const result=buildCaptureReview(facts,"Asia/Shanghai","month");assert.match(result.body,/15000 项可见来源/);assert.ok(result.body.length<100000);assert.ok(result.source_refs.length<=31);assert.ok(result.source_refs.every(ref=>facts.some(f=>f.id===ref.id)));assert.equal(captureReviewSignature(facts),captureReviewSignature([...facts].reverse()));
});
