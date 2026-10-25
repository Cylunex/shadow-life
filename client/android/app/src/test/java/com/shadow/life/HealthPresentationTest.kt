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

  @Test fun `range boundaries and missing values are not misclassified`() {
    val bmi=defaultHealthReference("bmi")
    assertEquals(HealthTone.Low,assessHealth(18.49,"kg/m²",bmi).tone)
    assertEquals(HealthTone.Good,assessHealth(18.5,"kg/m²",bmi).tone)
    assertEquals(HealthTone.High,assessHealth(24.0,"kg/m²",bmi).tone)
    assertEquals(HealthTone.Neutral,assessHealth(null,"kg/m²",bmi).tone)
    assertEquals(HealthTone.Neutral,assessHealth(Double.NaN,"kg/m²",bmi).tone)
    assertEquals(HealthTone.Neutral,assessHealth(23.0,"kg",bmi).tone)
    assertEquals(HealthTone.Neutral,assessHealth(85.0,"kg",null).tone)
    assertEquals("已达目标",assessHealth(20000.0,"步",HealthReference(8000.0,null,"步"),true).label)
  }

  @Test fun `provider contexts stay in distinct series`() {
    assertEquals("heart_rate_daily_min",healthSeriesKey("heart_rate","samsung:daily_min"))
    assertEquals("heart_rate_daily_max",healthSeriesKey("heart_rate","samsung:daily_max"))
    assertEquals("skin_temperature_min",healthSeriesKey("temperature","samsung:min_skin_temperature"))
    assertEquals("temperature",healthSeriesKey("temperature","samsung:body_temperature"))
    assertEquals("spo2_max",healthSeriesKey("spo2","samsung:max_oxygen_saturation"))
  }

  @Test fun `macro colors require complete data and compare energy proportions`() {
    val balanced=MealNutrition(2000.0,100.0,66.666666666,250.0,1,1,false,true)
    assertEquals(HealthTone.Good,macroAssessment(balanced,"protein").tone)
    assertEquals(HealthTone.Good,macroAssessment(balanced,"carb").tone)
    assertEquals(HealthTone.High,macroAssessment(balanced.copy(protein=500.0),"protein").tone)
    assertEquals(HealthTone.Neutral,macroAssessment(balanced.copy(completeMacros=false),"protein").tone)
    assertEquals("部分已记录",macroAssessment(balanced.copy(completeMacros=false),"protein").label)
    assertEquals(HealthTone.Neutral,macroAssessment(balanced.copy(protein=0.0,carb=0.0,fat=0.0),"protein").tone)
  }

  @Test fun `pace needs positive comparable duration and distance`() {
    val run=HealthWorkoutSummary("run","2026-09-22","running",null,"UTC",30,"5",null,null,null,null)
    assertEquals("6′00″ /km",workoutPerformance(run)?.second)
    assertEquals(null,workoutPerformance(run.copy(distanceKm="0")))
    assertEquals(null,workoutPerformance(run.copy(durationMinutes=null)))
    assertEquals("10 km/h",workoutPerformance(run.copy(sessionType="cycling"))?.second)
  }
  @Test fun `weight reference requires a known adult profile`() {
    val today=java.time.LocalDate.parse("2026-09-22")
    val reference=adultWeightReference("170","1990-01-01",today)
    assertEquals(HealthTone.Good,assessHealth(60.0,"kg",reference).tone)
    assertEquals(HealthTone.High,assessHealth(80.0,"kg",reference).tone)
    assertEquals(null,adultWeightReference("170","2015-01-01",today))
    assertEquals(null,adultWeightReference("170","",today))
    assertEquals(null,adultWeightReference("NaN","1990-01-01",today))
  }
}
