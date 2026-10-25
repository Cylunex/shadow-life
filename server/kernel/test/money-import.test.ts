import assert from "node:assert/strict";
import test from "node:test";
import { applyMoneyImportRules, parseMoneyStatement } from "../src/money-import.js";

test("CSV statement preserves raw rows and normalizes explicit CNY facts",()=>{
  const [candidate]=parseMoneyStatement({format:"csv",timeZone:"Asia/Shanghai",content:'交易日期,收支类型,金额,交易对方,分类,支付方式,交易单号,备注\n2026/09/08,支出,"￥1,234.50",社区超市,日用,微信支付,trade-001,"纸巾, 洗衣液"'});
  assert.deepEqual(candidate?.proposed,{time_zone:"Asia/Shanghai",currency:"CNY",occurred_on:"2026-09-08",amount:"1234.50",entry_type:"expense",counterparty:"社区超市",category:"日用",payment_method:"wechat",note:"纸巾, 洗衣液"});assert.equal(candidate?.externalId,"trade-001");assert.equal(candidate?.raw.金额,"￥1,234.50");assert.deepEqual(candidate?.issues,[]);
});

test("JSON and Markdown statements use the same deterministic review model",()=>{
  const json=parseMoneyStatement({format:"json",timeZone:"Asia/Shanghai",content:JSON.stringify({transactions:[{date:"2026-09-09",type:"income",amount:"88",merchant:"退款补偿"}]})});assert.equal(json[0]?.proposed.amount,"88.00");assert.equal(json[0]?.proposed.entry_type,"income");
  const markdown=parseMoneyStatement({format:"markdown",timeZone:"Asia/Shanghai",content:"| 日期 | 类型 | 金额 | 商家 |\n| --- | --- | ---: | --- |\n| 2026年9月10日 | 退款 | 35.00 | 外卖平台 |"});assert.equal(markdown[0]?.proposed.occurred_on,"2026-09-10");assert.equal(markdown[0]?.proposed.entry_type,"refund");
});

test("ambiguous or unsupported statement facts stay in review instead of being guessed",()=>{
  const [candidate]=parseMoneyStatement({format:"csv",timeZone:"Asia/Shanghai",content:"date,amount,currency,payment_method\n2026-02-30,12.345,USD,未知钱包"});assert.deepEqual(candidate?.issues,["invalid_date","invalid_amount","missing_entry_type","unsupported_currency"]);assert.deepEqual(candidate?.warnings,["unmapped_payment_method"]);assert.equal(candidate?.proposed.occurred_on,undefined);assert.equal(candidate?.proposed.amount,undefined);
});

test("negative amounts may explain direction but never bypass row and size limits",()=>{
  const [candidate]=parseMoneyStatement({format:"csv",timeZone:"Asia/Shanghai",content:"date,amount\n2026-09-10,-18"});assert.equal(candidate?.proposed.entry_type,"expense");assert.deepEqual(candidate?.warnings,["type_inferred_from_negative_amount"]);
  assert.throws(()=>parseMoneyStatement({format:"json",timeZone:"Asia/Shanghai",content:"{}"}),/array/u);assert.throws(()=>parseMoneyStatement({format:"csv",timeZone:"Asia/Shanghai",content:`date,type,amount\n${Array.from({length:501},()=>"2026-09-10,支出,1").join("\n")}`}),/500-row/u);
});

test("exact merchant rules explain every applied normalization",()=>{const candidates=parseMoneyStatement({format:"csv",timeZone:"Asia/Shanghai",content:"date,type,amount,merchant\n2026-09-10,expense,18, 社区超市 "}),[mapped]=applyMoneyImportRules(candidates,[{id:"import_rule_12345678",matchValue:"社区超市",replacements:{category:"日用",payment_method:"wechat"}}]);assert.equal(mapped?.proposed.category,"日用");assert.equal(mapped?.proposed.payment_method,"wechat");assert.deepEqual(mapped?.appliedRuleIds,["import_rule_12345678"]);assert.deepEqual(mapped?.warnings,["import_rule_applied"]);});
