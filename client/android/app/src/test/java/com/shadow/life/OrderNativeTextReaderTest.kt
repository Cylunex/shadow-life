package com.shadow.life

import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class OrderNativeTextReaderTest {
 @Test fun retailAndOtherAppsBypassNativeRead(){
  assertTrue(attemptsNativeOrderText("com.sankuai.meituan","com.sankuai.waimai.bussiness.order.detail.WMOrderDetailActivity"))
  assertFalse(attemptsNativeOrderText("com.sankuai.meituan","com.meituan.retail.c.android.msc.MallMSCActivity"))
  assertTrue(attemptsNativeOrderText("com.taobao.taobao","com.taobao.themis.container.app.TMSActivity"))
  assertTrue(attemptsNativeOrderText("com.jingdong.app.mall","example.OrderDetailActivity"))
  assertFalse(attemptsNativeOrderText("example.app","example.OrderDetailActivity"))
 }
 @Test fun sharedShoppingAppsRequireDeliverySpecificNativeEvidence(){
  fun boxes(vararg lines:String)=lines.mapIndexed { index,line -> OrderTextBox(0,index*24,120,20,line) }
  val detail=arrayOf("订单详情","×2","实付金额：28.50","订单编号：1234567890","下单时间")
  assertTrue(isNativeOrderPage("com.taobao.taobao",boxes("淘宝闪购",*detail)))
  assertTrue(isNativeOrderPage("me.ele",boxes(*detail)))
  assertTrue(isNativeOrderPage("com.jingdong.app.mall",boxes("京东外卖",*detail)))
  assertFalse(isNativeOrderPage("com.jingdong.app.mall",boxes("京东自营",*detail)))
  assertFalse(isNativeOrderPage("com.taobao.taobao",boxes("淘宝闪购","全部订单",*detail)))
  assertFalse(isNativeOrderPage("com.jingdong.app.mall",emptyList()))
  assertTrue(takeoutEnded(boxes(*detail),"jd"))
  assertFalse(takeoutEnded(boxes("订单编号：1234567890","下单时间"),"jd"))
 }
 @Test fun stalledProviderReturnsWithoutQueueingMoreBinderWork()=runBlocking {
  val entered=CountDownLatch(1);val release=CountDownLatch(1);val reader=OrderNativeTextReader(80)
  try{
   assertNull(reader.read{entered.countDown();release.await(5,TimeUnit.SECONDS);listOf(OrderTextBox(1,1,10,10,"late"))})
   assertTrue(entered.await(1,TimeUnit.SECONDS))
   var called=false;assertNull(reader.read{called=true;emptyList()});assertFalse(called)
  }finally{release.countDown();reader.close()}
 }
 @Test fun readableFramesAndUnavailableProvidersAreDistinct()=runBlocking {
  val reader=OrderNativeTextReader()
  try{
   val boxes=listOf(OrderTextBox(1,1,10,10,"订单信息"));assertEquals(boxes,reader.read{boxes})
   assertNull(reader.read{throw IllegalStateException("provider unavailable")})
  }finally{reader.close()}
 }
}
