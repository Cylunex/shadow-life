package com.shadow.life

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.junit.Assert.*
import org.junit.Test

class TrainingDraftTest {
  @Test fun onlyConfirmedSetsCountAndDraftKeepsOriginalDate(){
    val draft=TrainingDraft("2026-10-18","Asia/Shanghai",exercises=listOf(TrainingExerciseDraft("floor_press","{}",listOf(TrainingSetDraft("10","4.5",true),TrainingSetDraft("12","",false)))))
    assertEquals(1,draft.completedSets)
    assertEquals(draft,Json.decodeFromString<TrainingDraft>(Json.encodeToString(draft)))
    assertEquals("2026-10-18",draft.date)
  }
  @Test fun validationUsesExerciseUnitAndDoesNotInventWeight(){
    assertTrue(validTrainingSet(TrainingSetDraft("10"),"reps",true))
    assertTrue(validTrainingSet(TrainingSetDraft("20"),"seconds",false))
    assertFalse(validTrainingSet(TrainingSetDraft("1e2"),"reps",true))
    assertFalse(validTrainingSet(TrainingSetDraft("0"),"reps",false))
    assertFalse(validTrainingSet(TrainingSetDraft("1001"),"reps",false))
    assertFalse(validTrainingSet(TrainingSetDraft("10","-1"),"reps",true))
  }
  @Test fun restUsesDeadlineSoBackgroundTimeIsIncluded(){
    assertEquals(1L,trainingRestSeconds(100_000,99_001))
    assertEquals(0L,trainingRestSeconds(100_000,160_000))
  }
  @Test fun introductionKeepsExistingOrderAndIsIdempotent(){
    val cards=listOf(TodayCardKind.Body,TodayCardKind.Health)
    val introduced=introduceTrainingCard(cards)
    assertEquals(listOf(TodayCardKind.Training)+cards,introduced)
    assertEquals(introduced,introduceTrainingCard(introduced))
  }
  @Test fun pendingSubmissionRetainsCommandIdAndExactPayloadAcrossRestart(){
    val draft=TrainingDraft("2026-10-18","Asia/Shanghai",commandId="cmd_android_training_fixture",submission="{\"immutable\":true}")
    val restored=Json.decodeFromString<TrainingDraft>(Json.encodeToString(draft))
    assertEquals(draft.commandId,restored.commandId);assertEquals(draft.submission,restored.submission)
  }
}
