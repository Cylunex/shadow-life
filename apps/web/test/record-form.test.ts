import assert from "node:assert/strict";
import test from "node:test";
import { capabilityRegistry } from "@shadow/contracts";
import { buildFormCommand, initialRecordFields } from "../src/record-form.js";

test("money form preserves counterparty, date, zone, category, method and note",()=>{
  const fields={...initialRecordFields("2026-09-08","Asia/Shanghai"),title:"社区超市",amount:"18",category:"日用",paymentMethod:"wechat",note:"纸巾"};const built=buildFormCommand("record",fields);
  assert.equal(built.capability,"money.record_entry");assert.deepEqual(capabilityRegistry[built.capability].inputSchema.parse(built.input),{entry_type:"expense",amount:"18.00",currency:"CNY",occurred_on:"2026-09-08",time_zone:"Asia/Shanghai",counterparty:"社区超市",note:"纸巾",category:"日用",payment_method:"wechat"});
});

test("meal form keeps eating and payment dates independent",()=>{
  const fields={...initialRecordFields("2026-09-08","Asia/Shanghai"),kind:"meal" as const,title:"牛肉面",amount:"28.5",paymentOn:"2026-09-09",mealType:"lunch" as const,paymentMethod:"alipay",note:"少辣"};const built=buildFormCommand("record",fields);
  assert.equal(built.capability,"life.record_meal");assert.deepEqual(capabilityRegistry[built.capability].inputSchema.parse(built.input),{occurred_on:"2026-09-08",time_zone:"Asia/Shanghai",meal_type:"lunch",note:"少辣",items:[{name:"牛肉面",estimate:false}],payment:{amount:"28.50",currency:"CNY",occurred_on:"2026-09-09",time_zone:"Asia/Shanghai",payment_method:"alipay"}});
});

test("health form writes a typed metric with its label, unit and note",()=>{
  const fields={...initialRecordFields("2026-09-08","Asia/Shanghai"),kind:"health" as const,title:"晨起",amount:"68.4",healthMetric:"weight" as const,unit:"kg",note:"空腹"};const built=buildFormCommand("record",fields);
  assert.equal(built.capability,"health.record_measurement");assert.deepEqual(capabilityRegistry[built.capability].inputSchema.parse(built.input),{metric:"weight",label:"晨起",value:"68.4",unit:"kg",occurred_on:"2026-09-08",time_zone:"Asia/Shanghai",note:"空腹"});
});

test("money formatting rejects silent rounding",()=>{const fields={...initialRecordFields("2026-09-08","Asia/Shanghai"),amount:"18.009"};assert.throws(()=>buildFormCommand("record",fields),/两位小数/u);});
