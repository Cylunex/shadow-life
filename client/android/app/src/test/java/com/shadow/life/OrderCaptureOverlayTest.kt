package com.shadow.life

import android.accessibilityservice.AccessibilityService
import android.app.Application
import android.view.WindowManager
import android.view.accessibility.AccessibilityEvent
import android.widget.Button
import android.view.ViewGroup
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
  val buttons=(windows.views.single() as ViewGroup).getChildAt(1) as ViewGroup
  (buttons.getChildAt(2) as Button).performClick()
  assertEquals(OrderCaptureAction.Cancel,control.terminal)
  assertTrue(windows.views.isEmpty())
  overlay.close()
 }
}
