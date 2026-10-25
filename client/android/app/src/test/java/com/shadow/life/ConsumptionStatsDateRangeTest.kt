package com.shadow.life

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Test

class ConsumptionStatsDateRangeTest {
  @Test fun includesCurrentCalendarMonth(){assertEquals(LocalDate.parse("2026-03-01") to LocalDate.parse("2026-06-01"),consumptionStatsDateRange(LocalDate.parse("2026-05-17"),3))}
  @Test(expected=IllegalArgumentException::class) fun rejectsUnsupportedWindow(){consumptionStatsDateRange(LocalDate.parse("2026-05-17"),2)}
}
