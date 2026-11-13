import assert from "node:assert/strict";
import test from "node:test";
import {pgOnly,reviewFixture} from "./review-fixture.js";
test("field evidence refers only to an original of the selected purchase and never changes payments",pgOnly,async t=>{
  const {run,queries,context,pool}=await reviewFixture(t);
  const order=await run("life.record_purchase",{occurred_on:"2026-11-13",time_zone:"Asia/Shanghai",scene:"delivery",items:[{raw_name:"饭"}],
    source:{kind:"text",captured_on:"2026-11-13",original_text:"实付 8.90\n配送费 1.00\n总优惠 2.00"}});
  const record_id=order.actual_values.record_id;const read=()=>queries.amountEvidence(context,{record_id});
  const data=await read();assert.equal(data.items.length,3);assert.equal(data.items[0]!.region,null);
  const input={record_id,field:"paid",source_id:data.sources[0]!.id,amount:"8.90",quote:"实付 8.90"};
  await run("life.save_amount_evidence",input);assert.equal((await read()).items.find(x=>x.field==="paid")!.revision,1);
  await assert.rejects(()=>run("life.save_amount_evidence",{...input,expected_revision:1,quote:"并不存在"}),/原文|原始材料/);
  await assert.rejects(()=>run("life.save_amount_evidence",{...input,source_id:"source_other_material"}),/不匹配/);
  await assert.rejects(()=>queries.amountEvidence({...context,effects:new Set(["life.meal.read"])},{record_id}));
  assert.deepEqual((await queries.amountEvidence({...context,subjectId:"subject_other_amount"},{record_id})).sources,[]);
  assert.equal((await pool.query("select count(*)::int n from money_entries")).rows[0].n,0);
});
