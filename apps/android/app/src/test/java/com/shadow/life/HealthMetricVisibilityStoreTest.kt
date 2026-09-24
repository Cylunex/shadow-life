package com.shadow.life

import org.junit.Assert.assertEquals
import org.junit.Test

class HealthMetricVisibilityStoreTest {
  @Test fun storedTrendChoicesIgnoreUnknownEncoding(){
    assertEquals(setOf("weight","body_fat"),decodeHiddenHealthMetrics("weight,body_fat,weight,../secret,心率"))
    assertEquals(emptySet<String>(),decodeHiddenHealthMetrics(null))
  }
}
