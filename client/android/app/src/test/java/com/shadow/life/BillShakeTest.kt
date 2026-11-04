package com.shadow.life
import org.junit.Assert.*
import org.junit.Test

class BillShakeTest {
 @Test fun shakeWorksInEveryPhoneOrientationAndCoolsDown(){
   for(gravity in listOf(floatArrayOf(0f,9.8f,0f),floatArrayOf(0f,0f,9.8f),floatArrayOf(5.7f,5.7f,5.7f))){
     val g=BillShakeGesture()
     fun x(t:Long,v:Float)=g.sample(t,gravity[0]+v,gravity[1],gravity[2])
     assertFalse(x(0,0f));assertFalse(x(100,12f));assertFalse(x(115,-12f))
     assertTrue(x(240,-13f));assertFalse(x(400,14f));assertFalse(x(520,-14f))
     assertFalse(x(3100,14f));assertTrue(x(3240,-14f))
   }
 }
 @Test fun restWalkingAndSingleBumpDoNotTrigger(){
   val g=BillShakeGesture()
   for(i in 0..40)assertFalse(g.sample(i*30L,0f,9.8f+(if(i%2==0)2f else -2f),0f))
   assertFalse(g.sample(1600,12f,9.8f,0f))
   for(i in 0..20)assertFalse(g.sample(1650+i*30L,0f,9.8f,0f))
 }
 @Test fun returningShakeMayCrossAxes(){
   val g=BillShakeGesture();assertFalse(g.sample(0,0f,9.8f,0f))
   assertFalse(g.sample(100,10f,17.8f,0f))
   assertTrue(g.sample(250,-8f,-0.2f,0f))
 }
 @Test fun staleFirstPeakDoesNotTrigger(){
   val g=BillShakeGesture();g.sample(0,0f,9.8f,0f)
   assertFalse(g.sample(100,14f,9.8f,0f));assertFalse(g.sample(1000,-14f,9.8f,0f))
 }
 @Test fun onlyBillFieldsQualify(){
   assertFalse(resemblesBillDetail("聊天\n打开交易号看看\n支付成功"))
   assertFalse(resemblesBillDetail("账单列表\n实付金额：12.00"))
   assertFalse(resemblesBillDetail("聊天\n交易单号\n123456\n当前状态：支付成功"))
   assertTrue(resemblesBillDetail("账单详情\n交易单号\n123456\n当前状态：支付成功"))
 }
}
