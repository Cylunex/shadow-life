package com.shadow.life

import org.junit.Assert.*
import org.junit.Test

class PaymentAutoCaptureTest {
 private val wx=PaymentAutoRule("wechat","default")
 private val ali=PaymentAutoRule("alipay","default")
 private val paid="支付成功\n付款金额：￥12.50\n交易单号：TESTTRADE12345678\n支付时间：2026-11-05 12:30:00\n完成"
 private fun detect(text:String=paid)=paymentResultPage("com.tencent.mm","com.tencent.mm.plugin.wallet.PayResultUI",text,wx)
 @Test fun completeNativeResultAndSdkResultRecognizeTheSameTransaction(){
   val native=detect()!!;assertTrue(native.complete)
   val sdk=paymentResultPage("example.shop","example.shop.PaymentActivity",paid+"\n微信支付",wx)!!
   assertEquals(native.identity,sdk.identity)
   assertNotEquals(native.identity,paymentResultPage("example.shop","example.shop.PaymentActivity",paid+"\n微信支付",wx.copy(sourceAccount="second"))!!.identity)
 }
 @Test fun enabledMerchantAppStillNeedsPlatformAndCompletedPaymentEvidence(){
   assertNull(paymentResultPage("example.shop","example.shop.PaymentActivity",paid,wx))
   assertNull(paymentResultPage("example.shop","example.shop.PaymentActivity",paid.replace("支付成功","待付款")+"\n微信支付",wx))
   assertNull(paymentResultPage("example.shop","example.shop.PaymentActivity",paid+"\n微信支付",ali))
   assertNull(paymentResultPage("com.tencent.mm","com.tencent.mm.ui.LauncherUI",paid,wx))
 }
 @Test fun historyIncomeRefundAuthenticationAndConflictingTotalsAreNotAutomaticPayments(){
   for(extra in listOf("账单详情","交易详情","退款成功","请输入支付密码","验证码","确认付款","收款成功","付款金额：￥14.00"))assertNull(detect(paid+"\n"+extra))
   assertNull(detect(paid.replace("支付成功","付款失败")))
   assertNull(detect(paid.replace("￥12.50","￥0.00")))
   assertNotNull(detect(paid+"\n领取优惠券20元\n奖励30积分"))
 }
 @Test fun partialResultsAreMaterialOnlyAndALaterFrameCanCompleteThem(){
   val partial=detect(paid.replace("支付时间：2026-11-05 12:30:00", ""))!!
   assertFalse(partial.complete);assertTrue(detect()!!.complete)
   val missing=detect(paid.replace("交易单号：TESTTRADE12345678", ""))!!;assertFalse(missing.hasTransaction)
 }
 @Test fun denseEventsKeepOneGenerationButOtherWindowsAndRevocationInvalidateIt(){
   val cycle=PaymentReadCycle();val initial=cycle.select("account:app:window")
   repeat(100){assertEquals(initial,cycle.select("account:app:window"))}
   assertTrue(cycle.current("account:app:window",initial))
   cycle.select("account:app:second");assertFalse(cycle.current("account:app:window",initial))
   val second=cycle.select("account:app:second");cycle.invalidate();assertFalse(cycle.current("account:app:second",second))
 }
 private class Node(override val text:String?=null,override val description:String?=null,override val editable:Boolean=false,override val secret:Boolean=false,val children:List<Node> = emptyList()):CaptureTextNode{
   override val visible=true;override val childCount get()=children.size
   override fun child(index:Int)=children[index]
   var released=false;override fun release(){released=true}
 }
 @Test fun textReaderIncludesDescriptionsAndDeepContent(){
   var root=Node(text="支付成功",description="付款金额：￥12.50")
   repeat(40){root=Node(children=listOf(root))}
   assertEquals("支付成功\n付款金额：￥12.50",readCompleteCaptureText(root,true));assertTrue(root.released)
 }
 @Test fun readerRejectsDeepInputsAndAllIncompleteTrees(){
   var input=Node(editable=true,text="must not be read")
   repeat(35){input=Node(children=listOf(input))}
   assertNull(readCompleteCaptureText(Node(text="支付成功",children=listOf(input)),true))
   assertNull(readCompleteCaptureText(Node(secret=true,text="must not be read"),false))
   var tooDeep=Node(text="支付成功");repeat(70){tooDeep=Node(children=listOf(tooDeep))}
   assertNull(readCompleteCaptureText(tooDeep,true))
   assertNull(readCompleteCaptureText(Node(children=List(101){Node(text="付款")}),true))
   assertNull(readCompleteCaptureText(Node(text="x".repeat(2049)),true))
 }
}
