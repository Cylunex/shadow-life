package com.shadow.life

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.text.TextLayoutResult
import org.junit.Assert.assertFalse
import java.time.LocalDate
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import java.time.YearMonth
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],qualifiers="zh-rCN-w393dp-h852dp-mdpi",application=Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class SessionChartsTest{
  @get:Rule val compose=createAndroidComposeRule<ComponentActivity>()
  private val start="2026-11-01T23:40:00Z"
  private val midnight="2026-11-02T00:00:00Z"
  private val end="2026-11-02T00:20:00Z"

  @Test fun sleepCursorReadsTheStageAcrossMidnight(){
    val record=SleepRecording("UTC",start,end,null,listOf(
      HealthRecordResultDtoSleepSessionFactStageIntervalsEntry(start,midnight,HealthRecordResultDtoSleepSessionFactStageIntervalsEntryStage.Light),
      HealthRecordResultDtoSleepSessionFactStageIntervalsEntry(midnight,end,HealthRecordResultDtoSleepSessionFactStageIntervalsEntryStage.Deep)
    ))
    compose.setContent{LifeTheme(Appearance.Light){Surface{Column(Modifier.padding(16.dp)){SleepRecordingChart(record)}}}}
    compose.onNodeWithText("浅睡  23:40–00:00").assertExists()
    compose.onNodeWithContentDescription("查看时段").performSemanticsAction(SemanticsActions.SetProgress){it(1f)}
    compose.onNodeWithText("深睡  00:00–00:20").assertExists()
  }

  @Test fun workoutSwitchesMeasureAtTheSelectedSample(){
    val record=WorkoutRecording("UTC",emptyList(),listOf(
      HealthRecordResultDtoWorkoutSessionFactExerciseSamplesEntry(start,94.0,null),
      HealthRecordResultDtoWorkoutSessionFactExerciseSamplesEntry(end,102.0,0.0)
    ))
    compose.setContent{LifeTheme(Appearance.Light){WorkoutRecordingChart(record)}}
    compose.onNodeWithText("轨迹").assertDoesNotExist()
    compose.onNodeWithContentDescription("查看采样点").performSemanticsAction(SemanticsActions.SetProgress){it(1f)}
    compose.onNodeWithText("00:20 · 102 次/分").assertExists()
    compose.onNodeWithText("速度").performClick()
    compose.onNodeWithText("00:20 · 0 km/h").assertExists()
  }

  @Test @Config(qualifiers="zh-rCN-w320dp-h720dp-mdpi")
  fun largeTextKeepsTheFullRemDurationOnANarrowScreen() {
    val date=LocalDate.now().toString()
    val night=HealthDailyOverview(date,null,null,null,435,78,112,0,0,date,
      lightMinutes=245,awakeMinutes=15,sleepId="night")
    compose.setContent {
      CompositionLocalProvider(LocalDensity provides Density(1f,fontScale=1.45f)) {
        LifeTheme(Appearance.Light) {
          Column(Modifier.verticalScroll(rememberScrollState()).padding(16.dp)) { SleepWorkspace(listOf(night),null){} }
        }
      }
    }
    val layout=mutableListOf<TextLayoutResult>()
    compose.onNodeWithText("1 小时 52 分").performScrollTo().assertIsDisplayed()
      .performSemanticsAction(SemanticsActions.GetTextLayoutResult) { it(layout) }
    val result=layout.single()
    assertFalse("Layout ${result.size}, paragraph ${result.multiParagraph.width} × ${result.multiParagraph.height}, " +
      "${result.lineCount} lines in ${result.layoutInput.constraints}",result.hasVisualOverflow)
  }

  @Test fun zeroNetDayStillOpensItsTransactions(){
    var selected=""
    compose.setContent{LifeTheme(Appearance.Light){
      SpendingCalendar(YearMonth.of(2026,11),"CNY",listOf(MonthlyMoneyDay("CNY","2026-11-08","0",2))){selected=it}
    }}
    compose.onNodeWithContentDescription("2026-11-08，2 笔，净支出 CNY 0").performClick()
    compose.runOnIdle{assertEquals("2026-11-08",selected)}
  }

  @Test fun energyContributorsKeepZeroAndMissingSeparate(){
    val meal=MealCardSummary("lunch","2026-11-01",null,"UTC",null,listOf(
      MealFoodSummary("无糖茶",energyKcal="0"),MealFoodSummary("配菜")
    ))
    val record=RecordSummary(LifeDomain.Meals,"meal","meal_sample","午餐",null,null,1,meal=meal)
    compose.setContent{LifeTheme(Appearance.Light){
      MealNutritionHero(meal.occurredOn,listOf(record),mealNutrition(listOf(record)),false,null){}
    }}
    compose.onNodeWithText("热量来源").performClick()
    compose.onNodeWithText("午餐 · 0 kcal").assertExists()
    compose.onNodeWithText("午餐 · 未记录").assertExists()
  }
}
