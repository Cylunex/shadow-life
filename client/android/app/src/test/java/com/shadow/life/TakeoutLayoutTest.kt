package com.shadow.life
import org.junit.Test
import org.junit.Assert.*
class TakeoutLayoutTest {
 private fun b(y:Int,text:String,x:Int=200)=OrderTextBox(x,y,200,30,text)
 @Test fun alignsMovingContentAndIgnoresFixedHeaderAndRepeatedQuantities(){
  val old=listOf(b(50,"订单详情"),b(700,"合成商品甲"),b(740,"×1"),b(900,"合成商品乙"),b(940,"×1"),b(1200,"商品合计"))
  val next=listOf(b(50,"订单详情"))+old.drop(1).map{it.copy(y=it.y-400)}
  assertEquals(400,takeoutScrollOffset(old,next,1400))
  val merged=mergeTakeoutBoxes(old,next,400,0,1400)
  assertEquals(2,merged.count{it.text=="×1"});assertEquals(1,merged.count{it.text=="订单详情"})
 }
 @Test fun refusesUnrelatedPagesAndOneAnchor(){
  assertNull(takeoutScrollOffset(listOf(b(700,"唯一商品")),listOf(b(300,"唯一商品")),1400))
  assertNull(takeoutScrollOffset(listOf(b(700,"旧订单甲"),b(800,"旧订单乙")),listOf(b(300,"新订单甲"),b(400,"新订单乙")),1400))
 }
 @Test fun requiresAnOrderPageAndKeepsIncompleteOrdersVisible(){
  assertFalse(isTakeoutPage(listOf(b(10,"订单列表"),b(50,"闪购"))))
  assertTrue(isTakeoutPage(listOf(b(10,"订单已送到指定位置"),b(50,"闪购"))))
  assertFalse(takeoutEnded(listOf(b(10,"订单号"),b(30,"下单时间"))))
  assertTrue(takeoutEnded(listOf(b(10,"订单号"),b(30,"下单时间"),b(50,"支付万式"),b(80,"订单信息"))))
 }
}
