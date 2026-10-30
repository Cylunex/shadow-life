package com.shadow.life
import org.junit.Assert.assertEquals
import org.junit.Test
class AppUsageIntervalsTest {
 @Test fun clipsCrossMidnightAndDropsUnclosedOrUnobservedIntervals(){
   val events=listOf(AppUsageEvent(5,"browser",true),AppUsageEvent(15,"browser"),AppUsageEvent(18,"other",true),AppUsageEvent(19,"missing"))
   assertEquals(listOf(AppUsageInterval("browser",10,15)),appUsageIntervals(events,10,20))
 }
 @Test fun screenOffClosesEachVisibleAppAndDoesNotInventExclusiveTime(){
   val events=listOf(AppUsageEvent(1,"a",true),AppUsageEvent(2,"b",true),AppUsageEvent(3,"a",true),AppUsageEvent(5,"",screenOff=true))
   assertEquals(listOf(AppUsageInterval("a",1,5),AppUsageInterval("b",2,5)),appUsageIntervals(events,0,10))
 }
}
