import test from "node:test";
import assert from "node:assert/strict";
import {inspectTakeoutOrder,takeoutPrefix,readTakeoutCapture} from "../src/takeout-order.js";
import {takeoutFixture} from "./fixtures/takeout.js";

function nativeOrder(){
 const blocks:Array<[number,number,number,number,string]>=[];
 const put=(x:number,y:number,text:string,w=100)=>blocks.push([x,y,w,30,text]);
 put(40,40,"尊敬的会员，订单已完成",600);put(40,100,"订单信息");
 put(40,160,"订单号码");put(240,160,"3000 0000 0000 0000 01",600);
 put(40,220,"下单时间");put(240,220,"2026-11-01 12:20:01",600);
 put(40,280,"支付方式");put(240,280,"在线支付");
 put(40,400,"商品费用");put(40,460,"合成面食店");put(900,460,"已收藏");
 put(220,550,"合成炒面片",600);put(960,550,"¥",20);put(980,550,"30",50);
 put(220,590,"1人份");put(220,630,"x",15);put(240,630,"1",20);
 put(220,710,"需要餐具",600);put(960,710,"¥",20);put(980,710,"0",50);put(220,760,"x1");
 put(40,850,"打包费");put(960,850,"¥1");
 put(40,930,"用户配送费");put(850,930,"¥3.6",80);put(950,930,"¥",20);put(980,930,"1.6",60);
 put(40,1010,"准时宝");put(850,1010,"黑金会员免费",180);
 put(40,1090,"放心吃");put(850,1090,"商家赠送");
 put(40,1170,"已用1张美团红包",300);put(940,1170,"-",15);put(960,1170,"¥",20);put(980,1170,"12",50);
 put(40,1300,"合计");put(700,1300,"已优惠14元",180);put(900,1300,"¥",20);put(940,1300,"20.6",90);
 put(220,1500,"推荐商品");put(220,1540,"x1");put(900,1500,"¥999");
 return {platform:"meituan",width:1080,height:1800,complete:true,blocks};
}
test("Meituan native metadata before goods, split prices, discounted delivery and recommendations",()=>{
 const result=inspectTakeoutOrder(takeoutPrefix+JSON.stringify(nativeOrder()))!;
 assert.equal(result.order_id,"300000000000000001");assert.equal(result.order_time,"2026-11-01 12:20:01");assert.equal(result.merchant,"合成面食店");
 assert.equal(result.paid_amount,"20.60");assert.equal(result.order_amount,"34.60");assert.equal(result.takeout.packing_fee,"1.00");assert.equal(result.takeout.delivery_fee,"1.60");assert.equal(result.takeout.discount_amount,"14.00");
 assert.equal(result.takeout.items.length,2);assert.equal(result.takeout.items[0]!.name,"合成炒面片");assert.equal(result.takeout.items[0]!.paid_amount,null);assert.equal(result.takeout.items[1]!.paid_amount,"0.00");
 assert.equal(result.takeout.amounts_reconciled,true);assert.equal(result.takeout.payment_method,"在线支付");assert.equal(result.payment_time,null);assert.equal(result.transaction_id,null);assert.equal(result.accounting_created,false);
});
test("Meituan missing metadata and unsupported charged services remain incomplete",()=>{
 const capture=nativeOrder();capture.complete=false;capture.blocks=capture.blocks.filter(b=>b[4]!=="订单号码"&&b[4]!=="3000 0000 0000 0000 01");
 const result=inspectTakeoutOrder(takeoutPrefix+JSON.stringify(capture))!;assert.equal(result.order_id,null);assert.equal(result.takeout.complete,false);assert.ok(result.issues.includes("缺少订单号"));
 const charged=nativeOrder();charged.blocks.find(b=>b[4]==="黑金会员免费")![4]="¥1";
 assert.equal(inspectTakeoutOrder(takeoutPrefix+JSON.stringify(charged))!.takeout.amounts_reconciled,false);
});
test("legacy OCR material cannot concatenate competing ids or retain inconsistent totals",()=>{
 const capture=readTakeoutCapture(takeoutFixture())!;
 const id=capture.blocks.find(b=>b[4]==="800000000000000001")!;capture.blocks.push([id[0]+80,id[1],id[2],id[3],"0000000001"]);
 const paid=capture.blocks.find(b=>b[4]==="实付￥19.98")!;paid[4]="实付￥199.98";
 const result=inspectTakeoutOrder(takeoutPrefix+JSON.stringify(capture))!;
 assert.equal(result.order_id,null);assert.equal(result.paid_amount,null);assert.ok(result.issues.some(v=>v.includes("疑似拼接")));
});
