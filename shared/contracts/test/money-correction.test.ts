import assert from "node:assert/strict";
import test from "node:test";
import { correctMoneyEntryInputSchema } from "../src/index.js";

const input={record_id:"record_example",expected_revision:1,amount:"12.00",currency:"CNY",occurred_on:"2026-09-10",time_zone:"Asia/Shanghai",reason:"核对"};
test("money correction preserves the old normalized payload and validates explicit clears",()=>{
  assert.deepEqual(correctMoneyEntryInputSchema.parse(input),input);
  const fields=["occurred_at","category","counterparty","payment_method","note"];
  assert.deepEqual(correctMoneyEntryInputSchema.parse({...input,clear_fields:fields}).clear_fields,fields);
  for(const clear_fields of [["amount"],["time_zone"],["note","note"]])assert.equal(correctMoneyEntryInputSchema.safeParse({...input,clear_fields}).success,false);
  for(const [field,value] of Object.entries({occurred_at:"2026-09-10T00:00:00Z",category:"日用",counterparty:"商店",payment_method:"wechat",note:"备注"})){
    assert.equal(correctMoneyEntryInputSchema.safeParse({...input,[field]:value,clear_fields:[field]}).success,false);
    assert.equal(correctMoneyEntryInputSchema.safeParse({...input,[field]:null}).success,false);
  }
});
