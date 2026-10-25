package com.shadow.life

import java.time.LocalDate
import java.time.ZoneId
import org.junit.Assert.*
import org.junit.Test

class LifePresentationTest {
  private fun money(id:String,type:String,currency:String,amount:String)=RecordSummary(LifeDomain.Money,"money_entry",id,"交易","2026-09-22","$currency $amount",1,subtype=type)

  @Test fun `money summaries keep currencies precision and negative net spending`() {
    val records=listOf(
      money("a","expense","CNY","100000000000000000.123456"),
      money("b","refund","CNY","100000000000000001.123457"),
      money("c","income","CNY","10.000001"),
      money("d","expense","USD","500.22")
    )
    val cny=moneyCardTotals(records,"CNY")
    assertEquals("-1.000001",cny.net.toPlainString())
    assertEquals("10.000001",cny.income.toPlainString())
    assertEquals("500.22",moneyCardTotals(records,"USD").net.toPlainString())
    assertEquals("0",moneyCardTotals(emptyList(),"CNY").net.toPlainString())
  }

  @Test fun `timeline local day and clock agree while date only facts stay timeless`() {
    val zone=ZoneId.of("Asia/Shanghai")
    assertEquals(LocalDate.parse("2026-09-23"),recordDate("2026-09-22T18:30:00Z",zone))
    assertEquals("02:30",recordTime("2026-09-22T18:30:00Z",zone))
    assertEquals(LocalDate.parse("2026-09-22"),recordDate("2026-09-22",zone))
    assertNull(recordTime("2026-09-22",zone))
    assertNull(recordDate("invalid",zone))
  }

  @Test fun `recent week includes its start and excludes future facts`() {
    val today=LocalDate.parse("2026-09-22")
    assertTrue(inRecordPeriod(today.minusDays(6),"week",today))
    assertFalse(inRecordPeriod(today.minusDays(7),"week",today))
    assertFalse(inRecordPeriod(today.plusDays(1),"week",today))
    assertFalse(inRecordPeriod(LocalDate.parse("2025-09-22"),"month",today))
    assertTrue(inRecordPeriod(null,"all",today))
    assertFalse(inRecordPeriod(null,"today",today))
  }

  @Test fun `health charts retain gaps and explicit zero without accepting stale days`() {
    fun day(date:String,steps:Long?)=HealthDailyOverview(date,steps,null,null,null,null,null,0,0,"")
    val end=LocalDate.parse("2026-09-22")
    val days=healthWeek(listOf(day("2026-09-15",999),day("2026-09-16",100),day("2026-09-22",0)),end)
    assertEquals(7,days.size)
    assertEquals(100L,days.first()?.steps)
    assertNull(days[1])
    assertEquals(0L,days.last()?.steps)
  }

  @Test fun `upcoming agenda is bounded sorted and includes the seventh day`() {
    fun item(date:String)=AgendaItem("project",date,date,date,"open",date,null,"project",date,null,null)
    val items=listOf(item("2026-09-29"),item("2026-09-28"),item("2026-09-21"),item("2026-09-22"))
    assertEquals(listOf("2026-09-22","2026-09-28"),upcomingAgenda(items,LocalDate.parse("2026-09-22")).map{it.dueOn})
  }
  @Test fun `nutrition missing values are distinct from measured zero`() {
    fun meal(foods:List<MealFoodSummary>)=RecordSummary(LifeDomain.Meals,"meal","meal","午餐",null,null,1,meal=MealCardSummary("lunch","2026-09-22",null,"Asia/Shanghai",null,foods))
    val partial=mealNutrition(listOf(meal(listOf(MealFoodSummary("食物",proteinG="12")))))
    assertNull(partial.kcal)
    assertNull(partial.fat)
    assertEquals(12.0,partial.protein!!,0.0)
    assertFalse(partial.completeMacros)
    val zero=mealNutrition(listOf(meal(listOf(MealFoodSummary("无热量饮品",energyKcal="0",proteinG="0",fatG="0",carbG="0")))))
    assertEquals(0.0,zero.kcal!!,0.0)
    assertTrue(zero.completeMacros)
    val withZeroDrink=listOf(meal(listOf(MealFoodSummary("鸡蛋",energyKcal="144",proteinG="12.6",fatG="9.6",carbG="0.8"),MealFoodSummary("无糖可乐",energyKcal="0",proteinG="0",fatG="0"))))
    val complete=mealNutrition(withZeroDrink)
    assertEquals(MealEnergyCoverage(2,2),mealEnergyCoverage(withZeroDrink))
    assertEquals(144.0,complete.kcal!!,0.0)
    assertEquals(0.8,complete.carb!!,0.0)
    assertTrue(complete.completeMacros)
    val missing=listOf(meal(listOf(MealFoodSummary("鸡蛋",energyKcal="144",proteinG="12.6",fatG="9.6",carbG="0.8"),MealFoodSummary("另一食物"))))
    assertEquals(MealEnergyCoverage(1,2),mealEnergyCoverage(missing))
    assertFalse(mealNutrition(missing).completeMacros)
    assertNull(mealNutrition(emptyList()).kcal)
  }

  @Test fun `today nutrient shares require complete macros and use energy proportions`() {
    val complete=TodayMealNutrition("500","25","50","10",2,2,true)
    assertEquals(listOf("蛋白质" to "25.6", "碳水" to "51.3", "脂肪" to "23.1"),todayMealMacroShares(complete))
    assertNull(todayMealMacroShares(complete.copy(completeMacros=false)))
    assertNull(todayMealMacroShares(complete.copy(proteinG="0",carbG="0",fatG="0")))
    assertNull(todayMealMacroShares(null))
  }

  @Test fun `trip dates describe ongoing travel without requiring an active run`() {
    val trip=TravelTripSummary("trip","旅程","2026-09-20","2026-09-22","Asia/Shanghai",null,false)
    assertEquals("planned",tripPhase(trip,LocalDate.parse("2026-09-19")))
    assertEquals("active",tripPhase(trip,LocalDate.parse("2026-09-22")))
    assertEquals("completed",tripPhase(trip,LocalDate.parse("2026-09-23")))
  }

}
