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
  assertTrue(isTakeoutPage(listOf(b(10,"订单已送到指定位置"),b(50,"闪购"),b(100,"×1"),b(120,"实付¥19.98"))))
  assertFalse(takeoutEnded(listOf(b(10,"订单号"),b(30,"下单时间"))))
  assertTrue(takeoutEnded(listOf(b(10,"订单号"),b(30,"下单时间"),b(50,"支付万式"),b(80,"订单信息"))))
 }
 @Test fun acceptsSplitHeadingAndKnownAppWithoutVisibleBrand(){
  assertTrue(isTakeoutDetailText("订单已送到\n指定位置\n× 1\n实付 ¥19.98",true))
  assertTrue(isTakeoutDetailText("订单详情\n合成商品\nx1\n￥23.26",true))
  assertFalse(isTakeoutDetailText("订单详情\nx1\n￥23.26"))
 }
 @Test fun acceptsMiddleAndFooterOfAnOrderWithoutItsTitle(){
  assertTrue(isTakeoutDetailText("打包费 ¥2\n配送费 实付¥0\n价格明细\n实付¥19.98",true))
  assertTrue(isTakeoutDetailText("订单号\n800000000000001\n下单时间\n2026-10-30 19:00:00\n支付方式\n支付宝",true))
  assertFalse(isTakeoutDetailText("订单号\n800000000000001\n下单时间",true))
 }
 @Test fun rejectsOrderListsShopMenusAndPaymentPages(){
  assertFalse(isTakeoutDetailText("我的订单\n订单已送达\n×1\n实付¥19.98\n再来一单",true))
  assertFalse(isTakeoutDetailText("全部订单\n订单详情\n×1\n实付¥19.98",true))
  assertFalse(isTakeoutDetailText("闪购\n商家菜单\n×1\n¥19.98\n去结算",true))
  assertFalse(isTakeoutDetailText("支付成功\n实付¥19.98\n订单号800000000000001",true))
  assertFalse(isTakeoutDetailText("订单详情\n闪购",true))
 }
}
