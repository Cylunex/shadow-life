package com.shadow.life

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HealthSleepScheduleTest {
  @Test fun beforeAndAfterMidnightShareTheWakeDayAxis() {
    val window = HealthDailyResultDtoResultSleepWindow(
      "2026-11-19T14:20:00Z", "2026-11-19T23:10:00Z", "Asia/Shanghai"
    )
    val plotted = checkNotNull(sleepWindow("sleep-id", "2026-11-20", window))
    assertEquals(-100f, plotted.start)
    assertEquals(430f, plotted.end)
    assertEquals("22:20 – 07:10", plotted.label)
    assertEquals("前一日 22:00", sleepAxisLabel(-120))
    assertEquals("00:00", sleepAxisLabel(0))
    assertEquals("08:00", sleepAxisLabel(480))
    assertNull(sleepWindow("no-end", "2026-11-20", window.copy(endedAt = null)))
  }
}
