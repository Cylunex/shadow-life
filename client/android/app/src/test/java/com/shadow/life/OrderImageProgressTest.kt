package com.shadow.life

import org.junit.Assert.*
import org.junit.Test

class OrderImageProgressTest {
 @Test fun ambiguousOverlapPreservesNextViewportAndAllowsMorePages(){
  val progress=OrderImageProgress(1080,2340)
  assertTrue(progress.add(800));assertEquals(3140,progress.height)
  assertTrue(progress.add(null));assertTrue(progress.separateImages);assertEquals(3,progress.pages)
  assertTrue(progress.canReadNext);assertTrue(progress.add(700));assertEquals(4,progress.pages)
  assertTrue(progress.separateImages)
 }
 @Test fun unchangedViewportDoesNotConsumePageAndHeightLimitKeepsOriginals(){
  val progress=OrderImageProgress(1080,2340)
  assertFalse(progress.add(0));assertEquals(1,progress.pages)
  repeat(8){assertTrue(progress.add(2000))}
  assertTrue(progress.separateImages);assertEquals(9,progress.pages)
 }
 @Test fun pageLimitStillRequiresExplicitFinish(){
  val progress=OrderImageProgress(1080,2340);val control=OrderCaptureControl()
  repeat(11){assertTrue(progress.add(null))}
  assertFalse(progress.canReadNext);assertFalse(progress.add(null));assertEquals(12,progress.pages)
  assertNull(control.terminal)
  assertThrows(IllegalStateException::class.java){control.requireFinish()}
  control.request(OrderCaptureAction.Next)
  assertThrows(IllegalStateException::class.java){control.requireFinish()}
  control.request(OrderCaptureAction.Finish);control.requireFinish()
 }
 @Test fun cancelNeverAuthorizesSaving(){
  val control=OrderCaptureControl();control.request(OrderCaptureAction.Cancel)
  assertThrows(IllegalStateException::class.java){control.requireFinish()}
 }
}
