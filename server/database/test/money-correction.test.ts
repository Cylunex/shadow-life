import assert from "node:assert/strict";
import test from "node:test";
import { reviewFixture, pgOnly } from "./review-fixture.js";

const dated={occurred_on:"2026-09-10",time_zone:"Asia/Shanghai"};
const initial={entry_type:"expense",amount:"12.00",currency:"CNY",...dated,occurred_at:"2026-09-10T02:03:04Z",category:"日用",counterparty:"示例商店",payment_method:"wechat",note:"原备注"};
const correction={amount:"12.00",currency:"CNY",...dated,reason:"核对"};
async function read(pool:Awaited<ReturnType<typeof reviewFixture>>["pool"],recordId:unknown){
  return(await pool.query("select to_jsonb(record) record,to_jsonb(entry) entry from consumption_records record join money_entries entry on entry.record_id=record.id where record.id=$1",[recordId])).rows[0];
}

test("money note correction preserves omitted fields, original snapshots, replay and revision isolation",pgOnly,async t=>{
  const {run,pool,executor,context,command}=await reviewFixture(t);
  const created=await run("money.record_entry",initial),recordId=created.actual_values.record_id;
  const before=await read(pool,recordId);
  const input={...correction,record_id:recordId,expected_revision:1,note:"补充备注"};
  const edit=command("money.correct_entry",input);
  await executor.execute(context,edit);const after=await read(pool,recordId);
  for(const field of ["occurred_at","category","counterparty","payment_method"])assert.deepEqual(after.entry[field],before.entry[field]);
  assert.equal(after.record.occurred_at,before.record.occurred_at);assert.equal(after.record.note,"补充备注");assert.equal(after.entry.note,"补充备注");
  assert.equal(after.record.revision,2);assert.equal(after.entry.revision,2);
  const snapshot=(await pool.query("select snapshot from consumption_record_revisions where record_id=$1 and revision=1",[recordId])).rows[0].snapshot;
  assert.equal(snapshot.money_entry.note,"原备注");assert.equal(new Date(snapshot.money_entry.occurredAt).toISOString(),initial.occurred_at.replace("Z",".000Z"));
  assert.equal((await executor.execute(context,edit)).replayed,true);
  await assert.rejects(()=>run("money.correct_entry",{...input,note:"过期更正"}),/revision changed/);
  await assert.rejects(()=>run("money.correct_entry",{...input,expected_revision:2},{...context,subjectId:"subject_other",actorId:"subject_other"}));
  assert.deepEqual(await read(pool,recordId),after);
  assert.equal((await pool.query("select count(*)::int n from consumption_record_revisions where record_id=$1",[recordId])).rows[0].n,1);
});

test("money correction updates supplied fields and explicitly clears each nullable fact",pgOnly,async t=>{
  const {run,pool}=await reviewFixture(t);const created=await run("money.record_entry",initial),recordId=created.actual_values.record_id;
  await run("money.correct_entry",{...correction,record_id:recordId,expected_revision:1,category:"购物",counterparty:"另一商店",payment_method:"cash"});
  const updated=await read(pool,recordId);assert.equal(updated.entry.category,"购物");assert.equal(updated.entry.counterparty,"另一商店");assert.equal(updated.entry.payment_method,"cash");assert.equal(updated.entry.note,"原备注");
  const clear_fields=["occurred_at","category","counterparty","payment_method","note"];
  await run("money.correct_entry",{...correction,record_id:recordId,expected_revision:2,clear_fields});
  const cleared=await read(pool,recordId);for(const field of clear_fields)assert.equal(cleared.entry[field],null);
  assert.equal(cleared.record.occurred_at,null);assert.equal(cleared.record.note,null);
  const prior=(await pool.query("select snapshot from consumption_record_revisions where record_id=$1 and revision=2",[recordId])).rows[0].snapshot;
  assert.equal(prior.money_entry.counterparty,"另一商店");assert.equal(prior.money_entry.note,"原备注");
  await run("money.correct_entry",{...correction,record_id:recordId,expected_revision:3,note:"再次补充"});
  const last=await read(pool,recordId);assert.equal(last.entry.occurred_at,null);assert.equal(last.entry.counterparty,null);assert.equal(last.entry.note,"再次补充");
});

test("money date changes validate the retained instant before saving and allow replacement or explicit clear",pgOnly,async t=>{
  const {run,pool}=await reviewFixture(t);const created=await run("money.record_entry",{...initial,occurred_at:"2026-09-10T00:03:04Z"}),recordId=created.actual_values.record_id;
  for(const change of [{occurred_on:"2026-09-11"},{time_zone:"America/Los_Angeles"}]){
    await assert.rejects(()=>run("money.correct_entry",{...correction,record_id:recordId,expected_revision:1,...change}),/Retained occurred_at/);
  }
  assert.equal((await read(pool,recordId)).record.revision,1);
  assert.equal((await pool.query("select count(*)::int n from consumption_record_revisions where record_id=$1",[recordId])).rows[0].n,0);
  await run("money.correct_entry",{...correction,record_id:recordId,expected_revision:1,occurred_on:"2026-09-11",occurred_at:"2026-09-11T03:04:05Z"});
  assert.equal(new Date((await read(pool,recordId)).entry.occurred_at).toISOString(),"2026-09-11T03:04:05.000Z");
  await run("money.correct_entry",{...correction,record_id:recordId,expected_revision:2,occurred_on:"2026-09-12",clear_fields:["occurred_at"]});
  const cleared=await read(pool,recordId);assert.equal(cleared.entry.occurred_at,null);assert.equal(cleared.record.occurred_at,null);assert.equal(cleared.entry.occurred_on,"2026-09-12");
});

test("purchase payment correction preserves the independent purchase facts and omitted payment metadata",pgOnly,async t=>{
  const {run,pool}=await reviewFixture(t);
  const created=await run("life.record_purchase",{...dated,occurred_at:"2026-09-10T00:00:00Z",scene:"online_purchase",merchant_name_raw:"示例商店",note:"购买备注",items:[{raw_name:"示例物品"}],payment:{amount:"12.00",currency:"CNY",occurred_on:"2026-09-11",occurred_at:"2026-09-11T02:00:00Z",time_zone:"Asia/Shanghai",payment_method:"wechat"}});
  const recordId=created.actual_values.record_id,before=await read(pool,recordId);
  await run("money.correct_entry",{...correction,occurred_on:"2026-09-11",record_id:recordId,expected_revision:1,note:"支付备注"});
  const after=await read(pool,recordId);assert.equal(after.entry.occurred_at,before.entry.occurred_at);assert.equal(after.entry.payment_method,"wechat");assert.equal(after.entry.note,"支付备注");
  for(const field of ["occurred_on","occurred_at","note"])assert.equal(after.record[field],before.record[field]);
});
