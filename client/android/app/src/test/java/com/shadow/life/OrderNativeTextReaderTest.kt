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
  assertFalse(attemptsNativeOrderText("com.taobao.taobao","com.taobao.themis.container.app.TMSActivity"))
  assertFalse(attemptsNativeOrderText("com.jingdong.app.mall","example.OrderDetailActivity"))
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
