import test from "node:test";
import assert from "node:assert/strict";
import { relatedPaymentRecord,type PaymentCaptureGroupSource,type PaymentCaptureGroupDetail } from "../src/payment-capture-group.js";
const automatic:PaymentCaptureGroupSource={id:"auto",device_id:"phone",app_package:"com.eg.android.AlipayGphone",platform:"alipay",source_account:"default",time_zone:"Asia/Shanghai",started_at:"2026-10-30T11:17:58.991Z",text:"完成\n支付成功￥19.98\n支付成功\n19.98\n￥19.98\n订单金额\n付款方式\n示例银行信用卡(1234)"};
const detail:PaymentCaptureGroupDetail={...automatic,id:"detail",record_id:"record_one",conflict:false,started_at:"2026-10-30T12:00:00Z",text:"返回\n全部账单\n账单详情\n支出19.98元\n交易成功\n支付时间\n2026-10-30 19:17:57\n付款方式\n示例银行信用卡(1234)\n订单号\nSYNTHETIC-TRADE\n商家订单号\nSYNTHETIC-MERCHANT"};
test("unidentified payment result groups with a uniquely matching later bill without a transaction guess",()=>{
 assert.equal(relatedPaymentRecord(automatic,[detail]),"record_one");
 assert.equal(relatedPaymentRecord(automatic,[detail,{...detail,id:"same_trade_repeat"}]),"record_one");
 assert.equal(relatedPaymentRecord(automatic,[detail,{...detail,record_id:"record_two"}]),null);
});
test("amount alone, other accounts/devices, delayed captures and conflicting sources never group",()=>{
 for(const change of [{source_account:"other"},{device_id:"other"},{platform:"wechat"},{time_zone:"UTC"},{conflict:true},{text:detail.text.replace("19.98","19.99")},{text:detail.text.replace("(1234)","(4321)")},{text:detail.text.replace("19:17:57","19:17:40")},{text:detail.text.replace("19:17:57","19:18:00")},{text:detail.text.replace("19:17:57","19:17")},{text:detail.text+"\n实付金额：20元"}])assert.equal(relatedPaymentRecord(automatic,[{...detail,...change}]),null);
 for(const text of [automatic.text+"\n交易单号：OTHER",automatic.text.replace("支付成功","退款成功"),automatic.text.replace("付款方式","未知方式"),automatic.text+"\n币种：USD",automatic.text+"\n付款金额：20元"]){assert.equal(relatedPaymentRecord({...automatic,text},[detail]),null);}
 assert.equal(relatedPaymentRecord({...automatic,device_id:"restore_phone"},[{...detail,device_id:"restore_phone"}]),null);
 assert.equal(relatedPaymentRecord({...automatic,text:automatic.text+"\n支付时间：2026-10-30 19:00:00"},[detail]),null);
 assert.equal(relatedPaymentRecord({...automatic,text:automatic.text+"\n商家名称：甲商户"},[{...detail,text:detail.text+"\n商家名称：乙商户"}]),null);
});
test("grouping crosses midnight but enforces the exact fifteen-second bound",()=>{
 const midnight={...detail,text:detail.text.replace("2026-10-30 19:17:57","2026-10-30 23:59:59")};
 assert.equal(relatedPaymentRecord({...automatic,started_at:"2026-10-30T16:00:01Z"},[midnight]),detail.record_id);
 assert.equal(relatedPaymentRecord({...automatic,started_at:"2026-10-30T11:18:12Z"},[detail]),detail.record_id);
 assert.equal(relatedPaymentRecord({...automatic,started_at:"2026-10-30T11:18:12.001Z"},[detail]),null);
});
