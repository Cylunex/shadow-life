import assert from "node:assert/strict";
import test from "node:test";
import { capabilityRegistry } from "@shadow/contracts";
import { correctionCommand, detailEndpoint, initialEditableFields, loadRecordDetail, selectionFromLocation, selectionHref } from "../src/record-detail.js";

test("record selections round-trip through a shareable permission-checked URL",()=>{const item={domain:"money" as const,kind:"money_entry",id:"money_12345678",record_id:"record_12345678",happened_at:"2026-09-10T00:00:00Z",title:"超市"},href=selectionHref(item),selection=selectionFromLocation(href.slice(1));assert.match(href,/tab=record/u);assert.match(href,/section=timeline/u);assert.deepEqual(selection,{domain:"money",kind:"money_entry",id:"money_12345678",recordId:"record_12345678"});assert.equal(detailEndpoint(selection!),"/api/life/records/record_12345678");assert.equal(selectionFromLocation("?tab=record&domain=unknown&id=x&kind=x"),undefined);});

test("detail loading reports hidden and unsupported records honestly",async()=>{const selection={domain:"library" as const,kind:"library_item",id:"library_item_12345678"};let requested="";const value=await loadRecordDetail((async input=>{requested=String(input);return new Response(JSON.stringify({item:{title:"手册"}}),{headers:{"content-type":"application/json"}});}) as typeof fetch,{},selection);assert.equal(requested,"/api/library/items/library_item_12345678");assert.deepEqual(value,{item:{title:"手册"}});await assert.rejects(()=>loadRecordDetail((async()=>new Response("{}",{status:404})) as typeof fetch,{},selection),/不存在或当前账号不可见/u);assert.equal(detailEndpoint({domain:"health",kind:"observation",id:"health_12345678"}),"/api/health/records/health_12345678");assert.equal(detailEndpoint({domain:"travel",kind:"reservation",id:"reservation_12345678",recordId:"trip_12345678"}),"/api/travel/trips/trip_12345678");assert.equal(detailEndpoint({domain:"travel",kind:"visit",id:"visit_12345678"}),undefined);});

test("money detail correction preserves the current fact and expected revision",()=>{const detail={record_id:"record_12345678",revision:3,occurred_on:"2026-09-09",time_zone:"Asia/Shanghai",note:"原备注",money_entry:{amount:"35.00",currency:"CNY",counterparty:"社区超市",category:"日用",payment_method:"wechat"}},fields={...initialEditableFields(detail),amount:"36.00",reason:"小票金额核对"},built=correctionCommand(detail,fields);assert.equal(built.capability,"money.correct_entry");assert.deepEqual(capabilityRegistry[built.capability].inputSchema.parse(built.input),{record_id:"record_12345678",expected_revision:3,amount:"36.00",currency:"CNY",occurred_on:"2026-09-09",time_zone:"Asia/Shanghai",category:"日用",counterparty:"社区超市",payment_method:"wechat",note:"原备注",reason:"小票金额核对"});});

test("meal detail correction uses the meal revision instead of a consumption record",()=>{const detail={meal_id:"meal_12345678",revision:2,occurred_on:"2026-09-08",time_zone:"Asia/Shanghai",meal_type:"lunch",note:"面"},fields={...initialEditableFields(detail),mealType:"dinner" as const,reason:"补正餐次"},built=correctionCommand(detail,fields);assert.equal(built.capability,"life.correct_meal");assert.deepEqual(capabilityRegistry[built.capability].inputSchema.parse(built.input),{meal_id:"meal_12345678",expected_revision:2,occurred_on:"2026-09-08",time_zone:"Asia/Shanghai",meal_type:"dinner",note:"面",reason:"补正餐次"});});

test("manual health detail correction keeps its measurement identity and revision",()=>{const detail={kind:"measurement",fact:{id:"health_12345678",metric:"weight",value:"69.000000",unit:"kg",label:"晨起",occurred_on:"2026-09-10",time_zone:"Asia/Shanghai",note:"空腹",revision:1},source:null,raw:null},fields={...initialEditableFields(detail),healthValue:"68.8",reason:"秤面读数核对"},built=correctionCommand(detail,fields);assert.equal(built.capability,"health.correct_measurement");assert.deepEqual(capabilityRegistry[built.capability].inputSchema.parse(built.input),{measurement_id:"health_12345678",expected_revision:1,metric:"weight",value:"68.8",unit:"kg",label:"晨起",occurred_on:"2026-09-10",time_zone:"Asia/Shanghai",note:"空腹",reason:"秤面读数核对"});});

test("detail links retain actual identities for payments, meals, refunds and measurement groups",async()=>{
  const {recordRelations}=await import("../src/record-detail.js");
  const links=recordRelations({payments:[{id:"money_original",record_id:"record_original",amount:"12.30",currency:"CNY"}],meals:[{id:"meal_example",occurred_on:"2026-09-22",items:[{name:"米饭"}]}],related_records:[{domain:"money",kind:"money_entry",id:"record_refund",title:"退款",supporting:"CNY 2.30"}],fact:{related_observations:[{id:"obs_weight",metric_key:"weight",value:"60",unit:"kg"}]}});
  assert.equal(links.length,4);
  assert.deepEqual(links.map(link=>selectionFromLocation(link.href)?.id),["record_original","meal_example","record_refund","obs_weight"]);
  assert.equal(recordRelations({related_records:[{domain:"invalid",id:"not-visible"}]}).length,0);
});

test("money editor clears only values deliberately removed and omits hidden transaction time",()=>{
  const detail={record_id:"record_example",revision:2,occurred_on:"2026-09-10",occurred_at:"2026-09-10T02:00:00Z",time_zone:"Asia/Shanghai",note:"原备注",money_entry:{amount:"12.00",currency:"CNY",category:"日用",counterparty:"商店",payment_method:"wechat"}};
  const changed=correctionCommand(detail,{...initialEditableFields(detail),note:"补备注"});
  const parsed=capabilityRegistry[changed.capability].inputSchema.parse(changed.input) as Record<string,unknown>;
  assert.equal("occurred_at" in parsed,false);assert.equal("clear_fields" in parsed,false);
  const cleared=correctionCommand(detail,{...initialEditableFields(detail),note:" ",category:"",counterparty:"",paymentMethod:""});
  const input=capabilityRegistry[cleared.capability].inputSchema.parse(cleared.input) as Record<string,unknown>;
  assert.deepEqual(input.clear_fields,["category","counterparty","payment_method","note"]);
  assert.equal("note" in input,false);
});

test("purchase payment editor uses payment dates and notes independently of the purchase",()=>{
  const detail={record_id:"record_example",revision:1,occurred_on:"2026-09-10",time_zone:"Asia/Shanghai",note:"购买备注",purchase:{merchant:"示例商店"},money_entry:{amount:"12.00",currency:"CNY",occurred_on:"2026-09-11",time_zone:"UTC",note:null}};
  const fields=initialEditableFields(detail);
  assert.equal(fields.occurredOn,"2026-09-11");assert.equal(fields.timeZone,"UTC");assert.equal(fields.note,"");
  const command=correctionCommand(detail,{...fields,note:"支付备注"});
  const parsed=capabilityRegistry[command.capability].inputSchema.parse(command.input) as Record<string,unknown>;
  assert.equal(parsed.occurred_on,"2026-09-11");assert.equal(parsed.time_zone,"UTC");assert.equal(parsed.note,"支付备注");
});
