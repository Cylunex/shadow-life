package com.shadow.life
import org.junit.Assert.*
import org.junit.Test

class BillShakeTest {
 @Test fun shakeNeedsTwoOppositePeaksInTimeAndThenCoolsDown(){
   val g=BillShakeGesture()
   fun x(t:Long,v:Float)=g.sample(t,v,1f,9.8f)
   assertFalse(x(0,2f));assertFalse(x(100,20f));assertFalse(x(115,-20f))
   assertFalse(x(300,21f));assertTrue(x(400,-22f));assertFalse(x(500,21f));assertFalse(x(620,-20f))
   assertFalse(x(3100,-23f));assertFalse(x(4000,21f));assertTrue(x(4150,-22f))
 }
 @Test fun onlyBillFieldsQualify(){
   assertFalse(resemblesBillDetail("聊天\n打开交易号看看\n支付成功"))
   assertFalse(resemblesBillDetail("账单列表\n实付金额：12.00"))
   assertFalse(resemblesBillDetail("聊天\n交易单号\n123456\n当前状态：支付成功"))
   assertTrue(resemblesBillDetail("账单详情\n交易单号\n123456\n当前状态：支付成功"))
 }
}
