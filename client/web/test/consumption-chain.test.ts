import assert from "node:assert/strict";
import test from "node:test";
import { consumptionLinkStatus } from "../src/ConsumptionLinks.js";
import { moneyRecordHref } from "../src/MoneyWorkspace.js";
import { detailEndpoint, selectionFromLocation, recordRelations, detailEditKind, initialEditableFields, correctionCommand } from "../src/record-detail.js";

test("consumption detail does not invent payment, nutrition or ingress provenance",()=>{
  const status=consumptionLinkStatus({kind:"record",state:"confirmed",purchase:{},purchase_items:[{}],money_entry:null,meals:[],sources:[]});
  assert.match(status.find(row=>row.label==="付款")!.value,/不计入支出/);
  assert.match(status.find(row=>row.label==="饮食")!.value,/不会自动计入营养/);
  assert.match(status.find(row=>row.label==="凭证")!.value,/未记录/);
  assert.deepEqual(consumptionLinkStatus({kind:"record",state:"confirmed"}).map(row=>row.label),["记录状态"]);
});
test("import receipt and purchase detail links open the unified workspace using stable record identity",()=>{
  const href=moneyRecordHref("record_example","purchase"),selection=selectionFromLocation(href)!;
  assert.match(href,/section=money/);assert.equal(detailEndpoint(selection),"/api/life/records/record_example");
  const links=recordRelations({related_records:[{domain:"money",kind:"money_entry",id:"record_example",title:"午餐",supporting:"手动确认关联"}]});
  assert.equal(detailEndpoint(selectionFromLocation(links[0]!.href)!),"/api/life/records/record_example");
});

test("an unpaid purchase never edits the first linked meal as if it were the purchase",()=>{
  const detail={kind:"record",record_id:"record_unpaid",money_entry:null,meals:[{id:"meal_existing",revision:1,meal_type:"lunch",occurred_on:"2026-11-05",time_zone:"Asia/Shanghai"}]};
  assert.equal(detailEditKind(detail),undefined);
  assert.throws(()=>correctionCommand(detail,initialEditableFields(detail)),/没有可修正/);
});
