import test from "node:test";
import assert from "node:assert/strict";
import {inspectLibraryOrder} from "../src/library-order.js";
const text=`### 订单状态与商户
- **商户名称**：合成饭店
### 商品明细
1. **商品名称**：合成套餐
   - 数量：× 1
   - 实付：¥25
2. **商品名称**：配菜
   - 实付：¥15
### 其他费用
- 打包费：¥3
- 配送费：原价 ¥3，实付 ¥0
### 价格明细与合计
- 总价：¥60
- 总优惠：¥17
- 实付：¥43
- 商品优惠：-¥2
- 配送费优惠：-¥3
- 红包/抵用券：-¥5
- 店铺活动/券：-¥7（后有“明细 >”按钮）
### 订单附加信息
- 订单号：1234567890123456789 [复制]
- 下单时间：\`2026-01-02 12:00:00.123\`
### 推荐商品
- 实付：¥99`;
test("vision order totals exclude item, fee and recommendation amounts and reconcile exact cents",()=>{
 const r=inspectLibraryOrder(text);assert.equal(r.paid_amount,"43.00");assert.equal(r.order_id,"1234567890123456789");
 assert.equal(r.order_time,"2026-01-02 12:00:00.123");assert.equal(r.payment_time,null);
 assert.equal(r.price_check?.totals_match,true);assert.equal(r.price_check?.discounts_match,true);assert.equal(r.price_check?.discount_components.length,4);
 assert(!r.issues.some(s=>s.includes("多个不同值")));
});
test("conflicting whole-order totals remain unknown; visible discount mismatches stay explicit",()=>{
 assert.equal(inspectLibraryOrder(text.replace("- 实付：¥43","- 实付：¥43\n- 实付：¥44")).paid_amount,null);
 const r=inspectLibraryOrder(text.replace("- 店铺活动/券：-¥7","- 店铺活动/券：-¥6"));assert.equal(r.price_check?.discounts_match,false);
 assert.equal(inspectLibraryOrder(text.replace("- 实付：¥43","- 实付：¥42")).price_check?.totals_match,false);
});
test("partial item-only pages never become a payment; old flat observations still work",()=>{
 assert.equal(inspectLibraryOrder("### 商品明细\n商品名称：合成套餐\n实付：¥25").paid_amount,null);
 assert.equal(inspectLibraryOrder("1. 商品名称：合成套餐\n实付：¥25").paid_amount,null);
 assert.equal(inspectLibraryOrder("实付金额：20.60\n支付时间：2026-01-02 12:00:01").paid_amount,"20.60");
 const r=inspectLibraryOrder("### 价格明细\n总价：60\n实付：43");assert.equal(r.price_check?.totals_match,null);assert.equal(r.price_check?.discounts_match,null);
});
test("overlap repeats are deduplicated but conflicting discounts cannot be reconciled",()=>{
 assert.equal(inspectLibraryOrder(text.replace("- 商品优惠：-¥2","- 商品优惠：-¥2\n- 商品优惠：-¥2")).price_check?.discounts_match,true);
 assert.equal(inspectLibraryOrder(text.replace("- 商品优惠：-¥2","- 商品优惠：-¥2\n- 商品优惠：-¥3")).price_check?.discounts_match,false);
});
