package com.shadow.life

import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class OrderCaptureControlTest {
 @Test fun finishOverridesQueuedNextAndCannotBeReopened()=runBlocking {
  val control=OrderCaptureControl();control.request(OrderCaptureAction.Next);control.request(OrderCaptureAction.Finish);control.request(OrderCaptureAction.Next)
  assertEquals(OrderCaptureAction.Finish,control.awaitAction());assertEquals(OrderCaptureAction.Finish,control.terminal)
 }
 @Test fun cancellationIsTerminalAndNextCanBeRequestedOneAtATime()=runBlocking {
  val control=OrderCaptureControl();control.request(OrderCaptureAction.Next);assertEquals(OrderCaptureAction.Next,control.awaitAction())
  control.request(OrderCaptureAction.Cancel);control.request(OrderCaptureAction.Finish);assertEquals(OrderCaptureAction.Cancel,control.awaitAction())
 }
 @Test fun pixelOverlapRejectsBlankScreensAndFindsMovingBody(){
  val w=96;val h=240
  fun pixels(offset:Int)=IntArray(w*h){index->val y=index/w+offset;val x=index%w;val seed=(y*19349663) xor (x*73856093);((seed xor(seed ushr 13))*1274126177 ushr 24) and 255}
  assertEquals(600,orderImageOffset(OrderImageSample(w,h,pixels(0)),OrderImageSample(w,h,pixels(60)),2400))
  assertNull(orderImageOffset(OrderImageSample(w,h,IntArray(w*h){255}),OrderImageSample(w,h,IntArray(w*h){255}),2400))
 }
}
