import assert from "node:assert/strict";
import test from "node:test";
import { buildCapabilityHttpRequest } from "@shadow/contracts";
import { reviewFixture, pgOnly } from "./review-fixture.js";

const cardInput={name:"理发八次卡",merchant_name:"示例理发店",total_units:8,started_on:"2026-09-01"};

test("service cards link the original payment, redeem exactly once, correct and void without another expense",pgOnly,async t=>{
  const {run,queries,context,executor,command,pool}=await reviewFixture(t);
  const purchase=await run("life.record_purchase",{occurred_on:"2026-09-01",time_zone:"Asia/Shanghai",scene:"service",items:[{raw_name:"理发八次卡",quantity:"1",unit:"张"}],payment:{amount:"200.00",currency:"CNY",occurred_on:"2026-09-01",time_zone:"Asia/Shanghai"}});
  const saved=await run("money.save_service_card",{...cardInput,purchase_record_id:purchase.actual_values.record_id});
  const cardId=saved.actual_values.card_id as string;
  const before=await queries.serviceCards(context,{id:cardId});assert.equal(before.items[0]!.remaining_units,8);assert.equal(before.items[0]!.used_units,0);
  const intent=command("money.record_service_card_use",{card_id:cardId,expected_revision:1,occurred_on:"2026-09-02",units:1});
  const first=await executor.execute(context,intent),replay=await executor.execute(context,intent);assert.equal(replay.replayed,true);assert.equal(first.actual_values.remaining_units,7);
  await run("money.record_service_card_use",{card_id:cardId,expected_revision:2,use_id:first.actual_values.use_id,occurred_on:"2026-09-02",units:2,reason:"当天实际用了两次"});
  assert.equal((await queries.serviceCards(context,{id:cardId})).items[0]!.remaining_units,6);
  await run("money.record_service_card_use",{card_id:cardId,expected_revision:3,use_id:first.actual_values.use_id,occurred_on:"2026-09-02",units:2,state:"voided",reason:"这次使用记错了卡"});
  const after=await queries.serviceCards(context,{id:cardId});assert.equal(after.items[0]!.remaining_units,8);assert.equal(after.items[0]!.uses[0]!.state,"voided");assert.equal(after.items[0]!.revision,4);
  assert.equal((await pool.query("select count(*)::int count from money_entries")).rows[0].count,1);
  assert.equal((await pool.query("select count(*)::int count from service_card_use_revisions")).rows[0].count,2);
  assert.equal((await pool.query("select count(*)::int count from service_card_revisions")).rows[0].count,3);
  assert.equal((await queries.serviceCards(context,{purchase_record_id:purchase.actual_values.record_id})).items.length,1);
});

test("card aggregate versions serialize concurrent deductions; balance and date boundaries reject invalid uses",pgOnly,async t=>{
  const {run,queries,context}=await reviewFixture(t);
  const saved=await run("money.save_service_card",{...cardInput,total_units:1,expires_on:"2026-09-10"}),cardId=saved.actual_values.card_id;
  const uses=await Promise.allSettled([1,2].map(()=>run("money.record_service_card_use",{card_id:cardId,expected_revision:1,occurred_on:"2026-09-02",units:1})));
  assert.equal(uses.filter(result=>result.status==="fulfilled").length,1);
  assert.equal((await queries.serviceCards(context,{id:cardId})).items[0]!.remaining_units,0);
  await assert.rejects(()=>run("money.record_service_card_use",{card_id:cardId,expected_revision:2,occurred_on:"2026-09-03",units:1}),/超过次卡总次数/u);
  const other=await run("money.save_service_card",{...cardInput,expires_on:"2026-09-10"});
  for(const date of ["2026-08-31","2026-09-11","2999-01-01"])await assert.rejects(()=>run("money.record_service_card_use",{card_id:other.actual_values.card_id,expected_revision:1,occurred_on:date,units:1}),/日期|未来/u);
  const used=await run("money.record_service_card_use",{card_id:other.actual_values.card_id,expected_revision:1,occurred_on:"2026-09-04",units:2});
  await assert.rejects(()=>run("money.save_service_card",{...cardInput,card_id:other.actual_values.card_id,expected_revision:2,total_units:1,reason:"错误总次数"}),/超过次卡总次数/u);
  await assert.rejects(()=>run("money.save_service_card",{...cardInput,card_id:other.actual_values.card_id,expected_revision:2,expires_on:"2026-09-03",reason:"错误有效期"}),/有效期/u);
  await run("money.save_service_card",{...cardInput,card_id:other.actual_values.card_id,expected_revision:2,state:"closed",reason:"停止使用"});
  await assert.rejects(()=>run("money.record_service_card_use",{card_id:other.actual_values.card_id,expected_revision:3,occurred_on:"2026-09-05",units:1}),/关闭/u);
  await run("money.record_service_card_use",{card_id:other.actual_values.card_id,expected_revision:3,use_id:used.actual_values.use_id,occurred_on:"2026-09-04",units:2,state:"voided",reason:"关闭后更正误扣"});
});

test("service card reads and mutations enforce permissions and ownership, including purchase and use links",pgOnly,async t=>{
  const {run,queries,context,unitOfWork}=await reviewFixture(t);
  const other={...context,subjectId:"subject_other_cards",actorId:"subject_other_cards"};await unitOfWork.ensurePrincipal(other.subjectId);
  const saved=await run("money.save_service_card",cardInput),cardId=saved.actual_values.card_id;
  assert.equal((await queries.serviceCards(other,{id:cardId})).items.length,0);
  await assert.rejects(()=>queries.serviceCards({...context,effects:new Set()},{}),/money.entry.read/u);
  await assert.rejects(()=>run("money.record_service_card_use",{card_id:cardId,expected_revision:1,occurred_on:"2026-09-02",units:1},other),/不存在/u);
  await assert.rejects(()=>run("money.save_service_card",{...cardInput,card_id:cardId,expected_revision:1,reason:"越权修改"},other),/不存在/u);
  const purchase=await run("life.record_purchase",{occurred_on:"2026-09-01",time_zone:"Asia/Shanghai",scene:"service",items:[{raw_name:"卡"}]});
  await assert.rejects(()=>run("money.save_service_card",{...cardInput,purchase_record_id:purchase.actual_values.record_id},other),/不属于/u);
  const otherCard=await run("money.save_service_card",cardInput,other);
  const used=await run("money.record_service_card_use",{card_id:cardId,expected_revision:1,occurred_on:"2026-09-02",units:1});
  await assert.rejects(()=>run("money.record_service_card_use",{card_id:otherCard.actual_values.card_id,expected_revision:1,use_id:used.actual_values.use_id,occurred_on:"2026-09-02",units:1,reason:"越权修改"},other),/不属于/u);
});

test("service card history pagination never changes all-time balance",pgOnly,async t=>{
  const {run,queries,context}=await reviewFixture(t);
  const saved=await run("money.save_service_card",{...cardInput,total_units:105});
  for(let i=0;i<101;i++)await run("money.record_service_card_use",{card_id:saved.actual_values.card_id,expected_revision:i+1,occurred_on:"2026-09-02",units:1});
  const first=(await queries.serviceCards(context,{id:saved.actual_values.card_id})).items[0]!;
  assert.equal(first.uses.length,100);assert.equal(first.remaining_units,4);assert.ok(first.next_uses_before_id);
  const second=(await queries.serviceCards(context,{id:first.id,uses_before_id:first.next_uses_before_id})).items[0]!;
  assert.equal(second.uses.length,1);assert.equal(second.remaining_units,4);assert.equal(second.next_uses_before_id,null);assert.ok(!first.uses.some(use=>use.id===second.uses[0]!.id));
});

test("service card transport validates correction shape and routes the authoritative query",()=>{
  const request=buildCapabilityHttpRequest("https://life.example.com","money.service_cards",{query:"理发"});assert.equal(request.method,"GET");assert.ok(request.url.includes("/api/money/service-cards?"));
  assert.throws(()=>buildCapabilityHttpRequest("https://life.example.com","money.record_service_card_use",{command_id:"cmd_service_example_001",input:{card_id:"plan_example01",expected_revision:1,occurred_on:"2026-09-22",units:1,state:"voided"}}));
});
