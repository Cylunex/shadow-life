import test from "node:test";
import assert from "node:assert/strict";
import {inspectActivityOrder,mergeOrderObservations} from "../src/activity-order.js";
import {inspectTakeoutOrder,readTakeoutCapture,takeoutPrefix} from "../src/takeout-order.js";
import {takeoutFixture} from "./fixtures/takeout.js";
test("both long order layouts reconcile all product lines and fees without inventing a payment",()=>{
 for(const second of [false,true]){const result=inspectTakeoutOrder(takeoutFixture(second))!;assert.equal(result.paid_amount,second?"23.26":"19.98");assert.equal(result.takeout.items.length,second?5:8);assert.equal(result.takeout.amounts_reconciled,true);assert.equal(result.payment_time,null);assert.equal(result.transaction_id,null);assert.equal(result.status,"unknown");assert.equal(result.order_time,"2026-10-30 19:17:50.614");assert.equal(result.merchant,"合成外卖店");assert.equal(result.takeout.items.filter(v=>v.option).length,1);assert.deepEqual(result.issues,[]);assert.equal(result.takeout.items.some(v=>v.name.includes("广告")),false);}
});
test("repeat material keeps one observation, while incomplete/mismatched inputs retain issues",()=>{
 const text=takeoutFixture();assert.equal(mergeOrderObservations([inspectActivityOrder(text),inspectActivityOrder(text)]).conflict,false);
 const data=readTakeoutCapture(text)!;data.complete=false;data.blocks.find(v=>v[4]==="实付￥19.98")![4]="实付￥20.00";
 const result=inspectTakeoutOrder(takeoutPrefix+JSON.stringify(data))!;assert.equal(result.takeout.amounts_reconciled,false);assert.ok(result.issues.length>=2);
 assert.equal(readTakeoutCapture(takeoutPrefix+'{"platform":"eleme"}'),null);
});
test("OCR punctuation and fee label variants stay reconciled; cancelled orders retain an issue",()=>{
 const data=readTakeoutCapture(takeoutFixture())!;
 for(const b of data.blocks){b[4]=b[4].replace('配送费','配迭费').replace('13.69','13,69');}
 assert.equal(inspectTakeoutOrder(takeoutPrefix+JSON.stringify(data))!.takeout.amounts_reconciled,true);
 data.blocks[0]![4]='订单已取消';
 assert.ok(inspectTakeoutOrder(takeoutPrefix+JSON.stringify(data))!.issues.some(v=>v.includes('取消')));
});

test("repeat takeout selects a coherent complete snapshot and ignores OCR wording differences",()=>{
 const full=inspectTakeoutOrder(takeoutFixture())!;
 const partial=structuredClone(full);partial.takeout.complete=false;partial.takeout.items=partial.takeout.items.slice(0,1);partial.takeout.amounts_reconciled=false;partial.issues=["不完整"];
 const corrected=structuredClone(full);corrected.merchant="合成外卖店（分店）";corrected.takeout.items[0]!.name="修正后的商品";
 const result=mergeOrderObservations([full,corrected,partial]);
 assert.equal(result.conflict,false);assert.deepEqual(result.fields.takeout,corrected.takeout);assert.equal(result.fields.merchant,corrected.merchant);
 assert.equal((result.fields.takeout as typeof full.takeout).items.length,8);
});
test("repeat takeout retains financial contradictions and withdrawal warnings",()=>{
 const full=inspectTakeoutOrder(takeoutFixture())!;
 for(const key of ["paid_amount","order_amount","order_time","order_id"] as const){const changed=structuredClone(full);changed[key]="different";assert.equal(mergeOrderObservations([full,changed]).conflict,true,key);}
 const cancelled=structuredClone(full);cancelled.takeout.delivery_status="订单已取消";
 const result=mergeOrderObservations([cancelled,full]);assert.equal(result.conflict,true);assert.equal((result.fields.takeout as typeof full.takeout).delivery_status,"订单已取消");
});
