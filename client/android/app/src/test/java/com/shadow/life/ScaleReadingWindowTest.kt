package com.shadow.life

import android.os.Handler
import android.os.Looper
import java.time.Duration
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.LooperMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = android.app.Application::class)
@LooperMode(LooperMode.Mode.PAUSED)
class ScaleReadingWindowTest {
  private val looper = shadowOf(Looper.getMainLooper())
  private val reading = XiaomiScaleFrame("MJTZC01YM/S400", 69.9, profileId = 1)
  private val finished = mutableListOf<Pair<XiaomiScaleFrame, String>>()
  private val window = ScaleReadingWindow<XiaomiScaleFrame>(Handler(Looper.getMainLooper()), 12_000) { frame, reason ->
    finished += frame to reason
  }

  @Test fun repeatedFramesUpdateFieldsWithoutExtendingFirstDeadline() {
    assertTrue(window.collect("scale", reading))
    looper.idleFor(Duration.ofSeconds(5))
    val updated = reading.copy(impedanceLow = 540.0)
    assertFalse(window.collect("scale", updated))
    looper.idleFor(Duration.ofSeconds(6))
    assertTrue(finished.isEmpty())
    assertFalse(window.collect("scale", updated))
    looper.idleFor(Duration.ofSeconds(1))
    assertEquals(listOf(updated to "settle_timeout"), finished)
  }

  @Test fun secondImpedanceCompletesImmediatelyAndCancelsTheDeadline() {
    window.collect("scale", reading)
    looper.idleFor(Duration.ofSeconds(2))
    assertTrue(window.finish("scale", "impedance") { it.copy(impedanceHigh = 497.6) })
    assertEquals(listOf(reading.copy(impedanceHigh = 497.6) to "impedance"), finished)
    looper.idleFor(Duration.ofSeconds(12))
    assertEquals(1, finished.size)
  }

  @Test fun scanTimeoutSavesAlreadyReceivedWeight() {
    window.collect("scale", reading)
    looper.idleFor(Duration.ofSeconds(5))
    assertTrue(window.finishFirst("scan_timeout"))
    assertFalse(window.finishFirst("scan_timeout"))
    looper.idleFor(Duration.ofSeconds(12))
    assertEquals(listOf(reading to "scan_timeout"), finished)
  }

  @Test fun cancellingClearsPendingFramesBeforeTheNextScan() {
    window.collect("scale", reading)
    looper.idleFor(Duration.ofSeconds(10))
    window.clear()
    val next = reading.copy(weightKg = 70.0)
    assertTrue(window.collect("scale", next))
    looper.idleFor(Duration.ofSeconds(2))
    assertTrue(finished.isEmpty())
    looper.idleFor(Duration.ofSeconds(10))
    assertEquals(listOf(next to "settle_timeout"), finished)
  }
}
