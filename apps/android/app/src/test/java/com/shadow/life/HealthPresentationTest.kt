package com.shadow.life

import org.junit.Assert.assertEquals
import org.junit.Test

class HealthPresentationTest {
  @Test fun `health decimals use human friendly precision`() {
    assertEquals("85.7",healthValueText("85.700000","kg"))
    assertEquals("1714",healthValueText("1714.000000","kcal/day"))
    assertEquals("5.68",healthValueText("5.678900","score"))
  }

  @Test fun `instants are rendered in the fact time zone`() {
    assertEquals("2026-09-14 14:30",localDateTime("2026-09-14T06:30:00Z","Asia/Shanghai"))
    assertEquals("14:30",localDateTime("2026-09-14T06:30:00Z","Asia/Shanghai",includeDate=false))
  }

  @Test fun `all scale metrics have readable labels`() {
    assertEquals("低频阻抗",healthMetricLabel("impedance_low"))
    assertEquals("基础代谢",healthMetricLabel("bmr"))
  }
}
