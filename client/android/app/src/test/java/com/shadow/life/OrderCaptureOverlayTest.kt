package com.shadow.life

import android.accessibilityservice.AccessibilityService
import android.app.Application
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.Button
import android.view.ViewGroup
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowWindowManagerImpl
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
@LooperMode(LooperMode.Mode.PAUSED)
class OrderCaptureOverlayTest {
 class CaptureService:AccessibilityService(){
  override fun onAccessibilityEvent(event:AccessibilityEvent?){}
  override fun onInterrupt(){}
 }
 private fun buttons(service:CaptureService):List<Button>{
  val windows=Shadow.extract<ShadowWindowManagerImpl>(service.getSystemService(WindowManager::class.java))
  val row=(windows.views.single() as ViewGroup).getChildAt(1) as ViewGroup
  return (0 until row.childCount).map{row.getChildAt(it) as Button}
 }
 @Test fun manualScrollingCanBeSelectedFromTheFirstScreenshot()=runBlocking{
  val service=Robolectric.buildService(CaptureService::class.java).create().get()
  val control=OrderCaptureControl()
  OrderCaptureOverlay(service,control,images=true).use{overlay->
   val actions=buttons(service).associateBy{it.text.toString()}
   val manual=actions.getValue("手动滑")
   val auto=actions.getValue("自动滚动")
   assertTrue(manual.isEnabled && auto.isEnabled)
   manual.performClick()
   assertEquals(OrderCaptureAction.Manual,control.awaitAction())
   overlay.status("手动慢滑",mode=OrderImageCaptureMode.Manual)
   assertFalse(manual.isEnabled)
   auto.performClick()
   assertEquals(OrderCaptureAction.Automatic,control.awaitAction())
   overlay.status("自动滚动",mode=OrderImageCaptureMode.Automatic)
   assertFalse(auto.isEnabled)
   assertTrue(manual.isEnabled)
   overlay.status("已到采集上限",nextAllowed=false)
   assertFalse(manual.isEnabled || auto.isEnabled)
   actions.getValue("完成保存").performClick()
   control.requireFinish()
  }
 }
 @Test fun nativeTextOffersNextPage(){
  val service=Robolectric.buildService(CaptureService::class.java).create().get()
  OrderCaptureOverlay(service,OrderCaptureControl()).use{
   assertEquals(listOf("下一屏","完成保存","取消"),buttons(service).map{button->button.text.toString()})
  }
 }
 @Test fun closeRemovesWindowBeforeFirstFrameAndIsIdempotent(){
  val service=Robolectric.buildService(CaptureService::class.java).create().get()
  val windows=Shadow.extract<ShadowWindowManagerImpl>(service.getSystemService(WindowManager::class.java))
  val overlay=OrderCaptureOverlay(service,OrderCaptureControl(),images=true)
  val view=windows.views.single()
  assertFalse(view.isAttachedToWindow)
  overlay.close();overlay.close()
  assertTrue(windows.views.isEmpty())
 }
 @Test fun earlyCaptureFailureDoesNotLeaveButtonsBehind(){
  val service=Robolectric.buildService(CaptureService::class.java).create().get()
  val windows=Shadow.extract<ShadowWindowManagerImpl>(service.getSystemService(WindowManager::class.java))
  assertThrows(IllegalStateException::class.java){
   OrderCaptureOverlay(service,OrderCaptureControl(),images=true).use{error("锁屏后停止采集")}
  }
  assertTrue(windows.views.isEmpty())
 }
 @Test fun cancelClosesWindowWithoutWaitingForCaptureLoop(){
  val service=Robolectric.buildService(CaptureService::class.java).create().get()
  val windows=Shadow.extract<ShadowWindowManagerImpl>(service.getSystemService(WindowManager::class.java))
  val control=OrderCaptureControl()
  val overlay=OrderCaptureOverlay(service,control,images=true)
  buttons(service).single{it.text=="取消"}.performClick()
  assertEquals(OrderCaptureAction.Cancel,control.terminal)
  assertTrue(windows.views.isEmpty())
  overlay.close()
 }
}
