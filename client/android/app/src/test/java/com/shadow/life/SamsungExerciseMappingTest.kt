package com.shadow.life

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SamsungExerciseMappingTest {
  @Test fun `common Samsung exercise types use stable Life keys`() {
    val expected=mapOf(
      "WALKING" to "walking",
      "RUNNING" to "running",
      "CIRCUIT_TRAINING" to "circuit_training",
      "HIKING" to "hiking",
      "BACKPACKING" to "backpacking",
      "BIKING" to "cycling",
      "POOL_SWIMMING" to "pool_swimming",
      "OPEN_WATER_SWIMMING" to "open_water_swimming",
      "ELLIPTICAL" to "elliptical"
    )
    expected.forEach{(provider,key)->
      val mapped=samsungExerciseMapping(provider,null)
      assertEquals(key,mapped.sessionType)
      assertFalse(mapped.releaseEvent)
    }
  }

  @Test fun `custom takeoff is a release event and not a workout`() {
    val mapped=samsungExerciseMapping("OTHER"," 起飞 ")
    assertEquals("release",mapped.sessionType)
    assertTrue(mapped.releaseEvent)
  }

  @Test fun `other custom exercise keeps its user facing title`() {
    assertEquals("壶铃 HIIT",samsungExerciseMapping("UNDEFINED"," 壶铃 HIIT ").sessionType)
  }
}
