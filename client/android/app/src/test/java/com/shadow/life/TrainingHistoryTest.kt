package com.shadow.life

import android.app.Application
import org.json.JSONArray
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=Application::class)
class TrainingHistoryTest {
  @Test fun restoredTrainingPagesPastNewerSessionsToItsOwnDate()=runBlocking {
    fun session(day:Int)=org.json.JSONObject()
      .put("record_id","workout_$day").put("occurred_on","2026-10-$day")
      .put("sets",JSONArray("""[{"reps":$day,"load_kg":"4.5"},{"reps":8}]"""))
    val pages=mapOf(null to listOf(23,22,21),"workout_21" to listOf(20,19,18),"workout_18" to listOf(17))
    val requests=mutableListOf<String?>()
    val previous=trainingHistory("reps","dumbbell","2026-10-19",null){before ->
      requests.add(before);JSONArray(pages.getValue(before).map(::session))
    }!!
    assertEquals(listOf(null,"workout_21","workout_18"),requests)
    assertEquals(listOf(TrainingSetDraft("19","4.5"),TrainingSetDraft("8")),previous.sets)
    assertTrue(previous.summary.startsWith("2026-10-19 · 4.5 kg / 只 × 19 次，8 次"))
    assertFalse(previous.summary.contains("2026-10-20"))
  }
  @Test fun timedSetsReuseSecondsWithNoInventedWeight()=runBlocking {
    val sessions=JSONArray("""[{"record_id":"workout_19","occurred_on":"2026-10-19","sets":[{"seconds":25}]}]""")
    assertEquals(listOf(TrainingSetDraft("25")),trainingHistory("seconds","bodyweight",null,null){sessions}?.sets)
    assertNull(trainingHistory("seconds","bodyweight","2026-10-18",null){sessions})
  }
}
