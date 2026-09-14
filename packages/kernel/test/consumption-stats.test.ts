import assert from "node:assert/strict";
import test from "node:test";
import { consumptionStatsInputSchema } from "@shadow/contracts";
import { buildConsumptionStats, type ConsumptionStatsRawData, type ConsumptionStatsRawPurchase } from "../src/consumption-stats.js";

const instant="2026-09-14T00:00:00.000Z";
const item=(id:string,raw_name:string,extra:Partial<ConsumptionStatsRawPurchase["items"][number]>={})=>({id,raw_name,quantity:null,unit:null,line_amount:null,category_key:null,...extra});
const purchase=(id:string,extra:Partial<ConsumptionStatsRawPurchase>={}):ConsumptionStatsRawPurchase=>({id,record_id:`record_${id}`,merchant:"示例店",category:null,scene:"delivery",channel_name_raw:null,occurred_on:"2026-09-01",occurred_at:null,currency:"CNY",purchase_amount:null,items:[],expense:null,refunds:[],meal_ids:[],...extra});
const input=(extra:Record<string,unknown>={})=>consumptionStatsInputSchema.parse({from_on:"2026-08-01",to_on_exclusive:"2026-10-01",time_zone:"Asia/Shanghai",...extra});
const data=(extra:Partial<ConsumptionStatsRawData>={}):ConsumptionStatsRawData=>({purchases:[],meals:[],intakes:[],aliases:[],asOf:instant,...extra});

test("merges full-width punctuation and personal merchant aliases while retaining explanations",()=>{
  const result=buildConsumptionStats(data({purchases:[purchase("purchase_1",{merchant:"饭堂（东区）",scene:"dine_in"}),purchase("purchase_2",{merchant:"饭堂(东区)",scene:"dine_in"}),purchase("purchase_3",{merchant:"东区饭堂",scene:"dine_in"})],aliases:[{alias:"东区饭堂",target_kind:"merchant",target_value:"饭堂（东区）"}]}),input(),true);
  assert.equal(result.merchants.length,1);assert.equal(result.merchants[0]!.orders,3);assert.deepEqual(result.merchants[0]!.raw_names,["东区饭堂","饭堂(东区)","饭堂（东区）"]);assert.ok(result.merchants[0]!.normalization.includes("personal_alias"));assert.ok(result.merchants[0]!.normalization.includes("unicode_nfkc"));
});

test("filters service and preference rows without hiding real products",()=>{
  const result=buildConsumptionStats(data({purchases:[purchase("purchase_1",{items:[item("line_1","配送费"),item("line_2","无需餐具"),item("line_3","加辣"),item("line_4","规格：大份"),item("line_5","口味：少辣"),item("line_6","香辣鸡腿饭",{category_key:"dish"})]})]}),input(),true);
  assert.equal(result.coverage.item_lines,6);assert.equal(result.coverage.excluded_service_lines,5);assert.equal(result.items.length,1);assert.equal(result.items[0]!.canonical_name,"香辣鸡腿饭");
});

test("separates restaurant delivery, grocery delivery, and unknown delivery",()=>{
  const result=buildConsumptionStats(data({purchases:[
    purchase("purchase_food",{merchant:"餐馆",items:[item("line_food","牛肉饭")]}),
    purchase("purchase_grocery",{merchant:"盒马鲜生",items:[item("line_grocery","香蕉",{quantity:"700",unit:"g"})]}),
    purchase("purchase_unknown",{merchant:"同城配送",items:[item("line_unknown","神秘商品")]})
  ]}),input(),true);
  assert.equal(result.merchants.find(row=>row.canonical_name==="餐馆")?.scope,"restaurant_delivery");assert.equal(result.merchants.find(row=>row.canonical_name==="盒马鲜生")?.scope,"grocery_delivery");assert.equal(result.merchants.find(row=>row.canonical_name==="同城配送")?.scope,"unknown");assert.equal(result.coverage.scope_unknown,1);
});

test("ranks by distinct order and meal occurrences and keeps mixed units separate",()=>{
  const result=buildConsumptionStats(data({purchases:[purchase("purchase_1",{items:[item("line_1","香蕉",{quantity:"700",unit:"g"})]}),purchase("purchase_2",{items:[item("line_2","鸡腿饭",{quantity:"1",unit:"份"})]}),purchase("purchase_3",{items:[item("line_3","鸡腿饭",{quantity:"1",unit:"份"})]})],meals:[{id:"meal_1",occurred_on:"2026-09-02",occurred_at:null,linked_record_ids:[]},{id:"meal_2",occurred_on:"2026-09-03",occurred_at:null,linked_record_ids:[]}],intakes:[{id:"intake_1",meal_id:"meal_1",name:"香蕉",quantity:"1",unit:"份",consumed_fraction:"0.5"},{id:"intake_2",meal_id:"meal_2",name:"香蕉",quantity:"0.2",unit:"kg",consumed_fraction:null}]}),input(),true);
  assert.equal(result.items[0]!.canonical_name,"鸡腿饭");const banana=result.items.find(row=>row.canonical_name==="香蕉")!;assert.equal(banana.purchased_orders,1);assert.equal(banana.confirmed_consumptions,2);assert.deepEqual(banana.quantities.map(value=>[value.basis,value.unit,value.quantity]),[["consumed","g","200"],["consumed","份","0.5"],["purchased","g","700"]]);
});

test("keeps unknown categories and date-only times visible as coverage gaps",()=>{
  const result=buildConsumptionStats(data({purchases:[purchase("purchase_1",{items:[item("line_1","未分类商品")]})]}),input(),false);
  assert.equal(result.coverage.item_category_unknown,1);assert.equal(result.coverage.timestamp_known,0);assert.equal(result.time_distribution.find(row=>row.bucket==="unknown")?.orders,1);assert.equal(result.coverage.money_authorized,false);assert.deepEqual(result.unknowns.items,[{name:"未分类商品",occurrences:1}]);
});

test("refunds reduce spend but never erase order or confirmed consumption occurrences",()=>{
  const result=buildConsumptionStats(data({purchases:[purchase("purchase_1",{items:[item("line_1","牛肉饭")],expense:{amount:"30.00",currency:"CNY"},refunds:[{id:"money_refund_1",amount:"10.00",currency:"CNY"},{id:"money_refund_1",amount:"10.00",currency:"CNY"}],meal_ids:["meal_1","meal_1"]})],meals:[{id:"meal_1",occurred_on:"2026-09-01",occurred_at:null,linked_record_ids:["record_purchase_1"]}],intakes:[{id:"intake_1",meal_id:"meal_1",name:"牛肉饭",quantity:"1",unit:"份",consumed_fraction:null}]}),input(),true);
  assert.deepEqual(result.merchants[0]!.spend,[{currency:"CNY",gross:"30",refund:"10",net:"20"}]);assert.equal(result.merchants[0]!.orders,1);assert.equal(result.merchants[0]!.confirmed_meals,1);assert.equal(result.items[0]!.confirmed_consumptions,1);
});

test("duplicate raw rows cannot inflate order, meal, item, or quantity counts",()=>{
  const order=purchase("purchase_1",{items:[item("line_1","牛肉饭",{quantity:"1",unit:"份"})],expense:{amount:"30",currency:"CNY"},meal_ids:["meal_1"]}),meal={id:"meal_1",occurred_on:"2026-09-01",occurred_at:null,linked_record_ids:["record_purchase_1"]},intake={id:"intake_1",meal_id:"meal_1",name:"牛肉饭",quantity:"1",unit:"份",consumed_fraction:"0.5"};
  const result=buildConsumptionStats(data({purchases:[order,order],meals:[meal,meal],intakes:[intake,intake]}),input(),true),food=result.items[0]!;
  assert.equal(result.coverage.orders,1);assert.equal(result.monthly[1]!.orders,1);assert.equal(result.monthly[1]!.confirmed_meals,1);assert.equal(food.purchased_orders,1);assert.equal(food.confirmed_consumptions,1);assert.deepEqual(food.quantities.map(row=>[row.basis,row.quantity]),[["consumed","0.5"],["purchased","1"]]);
});

test("never adds different currencies together",()=>{
  const result=buildConsumptionStats(data({purchases:[purchase("purchase_cny",{expense:{amount:"10.00",currency:"CNY"}}),purchase("purchase_usd",{currency:"USD",expense:{amount:"20.00",currency:"USD"}})]}),input(),true);
  assert.deepEqual(result.monthly.find(row=>row.month==="2026-09")!.spend,[{currency:"CNY",gross:"10",refund:"0",net:"10"},{currency:"USD",gross:"20",refund:"0",net:"20"}]);
});

test("uses the requested time zone at month and day-part boundaries",()=>{
  const result=buildConsumptionStats(data({purchases:[purchase("purchase_1",{occurred_on:"2026-08-31",occurred_at:"2026-08-31T16:30:00.000Z"})]}),input({from_on:"2026-09-01",to_on_exclusive:"2026-10-01"}),true);
  assert.equal(result.coverage.orders,1);assert.equal(result.monthly[0]!.orders,1);assert.equal(result.time_distribution.find(row=>row.bucket==="unknown")?.orders,0);assert.equal(result.time_distribution.find(row=>row.bucket==="morning")?.orders,1);
});

test("returns stable empty months and coverage for empty data",()=>{const result=buildConsumptionStats(data(),input(),true);assert.deepEqual(result.monthly.map(row=>[row.month,row.orders]),[["2026-08",0],["2026-09",0]]);assert.equal(result.merchants.length,0);assert.equal(result.items.length,0);assert.equal(result.coverage.orders,0);});
test("rejects unbounded historical scans",()=>{assert.throws(()=>input({from_on:"2024-01-01",to_on_exclusive:"2026-01-01"}),/twelve months/)});
