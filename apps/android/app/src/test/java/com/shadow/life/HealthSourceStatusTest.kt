package com.shadow.life

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HealthSourceStatusTest {
  @Test fun `historical migration sources never request device action`() {
    assertFalse(isActionableHealthSource("legacy_health"))
    assertFalse(healthSourceNeedsAttention("legacy_health","historical",emptyList()))
    assertFalse(healthSourceNeedsAttention("file_import","historical",listOf("expired")))
  }

  @Test fun `only actionable device source failures request attention`() {
    assertTrue(isActionableHealthSource("samsung"))
    assertTrue(healthSourceNeedsAttention("samsung","revoked",emptyList()))
    assertTrue(healthSourceNeedsAttention("health_connect","granted",listOf("rescan_required")))
    assertFalse(healthSourceNeedsAttention("scale","granted",emptyList()))
  }
}
