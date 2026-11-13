import test from "node:test";
import assert from "node:assert/strict";
import {pgOnly,reviewFixture} from "./review-fixture.js";
test("split refund allocations use only linked money actually received",pgOnly,async t=>{
  const {run,queries,context,pool}=await reviewFixture(t);
  const date={occurred_on:"2026-11-01",time_zone:"Asia/Shanghai"};
  await run("life.record_purchase",{...date,scene:"offline_purchase",items:[{raw_name:"甲",line_amount:"30.00"},{raw_name:"乙",line_amount:"20.00"}],payment:{...date,amount:"50.00",currency:"CNY"}});
  const original=(await pool.query("select id,record_id from money_entries")).rows[0];
  const items=(await pool.query("select id from purchase_items order by raw_name desc")).rows;
  const save=(idx:number)=>({purchase_item_id:items[idx].id,expected_amount:"20",currency:"CNY"});
  const a=await run("money.save_return_case",save(0)),b=await run("money.save_return_case",save(1));
  await run("money.record_refund",{...date,original_entry_id:original.id,currency:"CNY",amount:"20.00"});
  const {refund_entry_id}=(await pool.query("select refund_entry_id from refunds")).rows[0];
  const allocate=(idx:number,id:unknown)=>run("money.save_return_case",{...save(idx),case_id:id,expected_revision:1,allocations:[{refund_entry_id,amount:"20"}]});
  const settled=await Promise.allSettled([allocate(0,a.actual_values.case_id),allocate(1,b.actual_values.case_id)]);
  assert.equal(settled.filter(r=>r.status==="fulfilled").length,1);
  assert.deepEqual((await queries.returnCases(context,{})).items.map(i=>Number(i.remaining)).sort((a,b)=>a-b),[0,20]);
  assert.deepEqual(await queries.consumptionSources(context,{record_id:original.record_id}),{record_id:original.record_id,state:"confirmed",items:[]});
});
