package com.shadow.life

import org.junit.Assert.*
import org.junit.Test

class TravelItineraryTest {
  private val trip=TravelTripSummary("trip_a","旅行","2026-10-01","2026-10-03","Asia/Tokyo",null,false)
  @Test fun emptyDatesRemainReachableAndOtherTripsAreExcluded(){
    val days=listOf(TravelDaySummary("a",trip.id,"2026-10-05",emptyList()),TravelDaySummary("b","trip_other","2026-11-01",emptyList()))
    assertEquals(listOf("2026-10-01","2026-10-02","2026-10-03","2026-10-05"),travelDates(trip,days))
  }
  @Test fun switchingTripsNeverKeepsAnUnrelatedDate(){
    val dates=travelDates(trip,emptyList())
    assertEquals("2026-10-02",travelSelectedDate(dates,"2025-10-10","2026-10-02"))
    assertEquals("2026-10-03",travelSelectedDate(dates,"2026-10-03","2026-10-02"))
    assertEquals("2026-10-01",travelSelectedDate(dates,null,"2025-01-01"))
  }
  @Test fun newStopsUseContractCompatibleStableIds(){val first=newTravelStopId();assertTrue(first.matches(Regex("^[a-z][a-z0-9_]{7,127}$")));assertNotEquals(first,newTravelStopId())}
  @Test fun stopTimesRoundTripInTripZoneInsteadOfDeviceZone(){
    assertEquals("09:30",travelTime("2026-10-01T00:30:00Z","Asia/Tokyo"))
    assertEquals("2026-10-01T00:30:00Z",travelStopInstant("2026-10-01","09:30","Asia/Tokyo"))
    assertNull(travelStopInstant("2026-10-01","","Asia/Tokyo"))
    assertEquals("时间待定",travelTime(null,"Asia/Tokyo"))
  }
  @Test fun invalidOrAmbiguousLocalTimesDoNotCreateDifferentFacts(){
    assertTrue(runCatching{travelStopInstant("2026-02-30","09:00","Asia/Tokyo")}.isFailure)
    assertTrue(runCatching{travelStopInstant("2026-11-01","01:30","America/New_York")}.isFailure)
    assertTrue(runCatching{travelStopInstant("2026-03-08","02:30","America/New_York")}.isFailure)
  }
  @Test fun optionalAndUnlocatedStopsKeepMarkersButBreakIllustrativeRoutes(){
    val places=listOf("hotel","market","option","temple").mapIndexed{index,id->TravelPlaceSummary(id,id,null,13.0,100.0+index,emptyList(),false)}
    val day=TravelDaySummary("day",trip.id,"2026-10-01",listOf(
      TravelStopSummary("a","酒店",null,"hotel",null),TravelStopSummary("d","早餐休息",null,null,null),TravelStopSummary("b","夜市",null,"market",null),
      TravelStopSummary("c","弹性备选",null,"option",null),
      TravelStopSummary("e","寺庙",null,"temple",null)))
    val result=travelDayMap(day,places)
    assertEquals(listOf("1","3","4","5"),result.markers.map{it.label})
    assertEquals(listOf(listOf(TravelMapPoint(13.0,100.0),TravelMapPoint(13.0,101.0))),result.routes)
    assertEquals("https://www.google.com/maps/dir/?api=1&origin=13.0%2C100.0&destination=13.0%2C101.0",googleDirectionsUrl(result.routes[0][0],result.routes[0][1]))
  }
}
