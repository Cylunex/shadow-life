package com.shadow.life

import org.junit.Assert.*
import org.junit.Test

class NativeOfflineItineraryTest {
  private val detail="""{"trip":{"title":"测试<script>","starts_on":"2026-10-22","ends_on":"2026-10-24","time_zone":"Asia/Tokyo"},"day_plans":[{"plan_date":"2026-10-26","items":[{"title":"范围外安排","note":"<img src=x>","starts_at":null}]}],"reservations":[{"title":"旅馆","reservation_type":"hotel","state":"confirmed","starts_at":"2026-10-21T06:00:00Z","ends_at":"2026-10-24T02:00:00Z","confirmation_code":"A&B","seat":"A1"},{"title":"已取消旅馆","reservation_type":"hotel","state":"cancelled","starts_at":"2026-10-21T06:00:00Z","ends_at":"2026-10-24T02:00:00Z"},{"title":"待定预订","state":"pending","starts_at":null,"ends_at":"2026-10-27T01:00:00Z"}],"segments":[{"origin":"东京","destination":"大阪","mode":"train","starts_at":"2026-10-25T15:30:00Z","ends_at":"2026-10-26T01:00:00Z","note":"车票已收存"}],"visits":[{"occurred_on":"2026-10-22","place_name":"实际到访"}]}"""
  private val workspace="""{"checklist":{"items":[{"title":"证件","state":"packed","note":"带原件"},{"title":"雨伞","state":"skipped"},{"title":"充电器","state":"needed"}]}}"""
  @Test fun exportKeepsOutsideDatesEndTimesAndIndependentChecklistStates(){
    val result=renderNativeOfflineItinerary("trip_test",detail,workspace)
    assertTrue(result.html.contains("2026-10-21"));assertTrue(result.html.contains("2026-10-27"))
    assertTrue(result.html.contains("2026-10-26 00:30"));assertTrue(result.html.contains("到达：2026-10-26 10:00"))
    assertTrue(result.html.contains("旅程日期范围外的安排"));assertTrue(result.html.contains("☑ 证件"))
    assertTrue(result.html.contains("− 雨伞"));assertTrue(result.html.contains("☐ 充电器"))
    assertTrue(result.html.contains("座位：A1"));assertTrue(result.html.contains("结束：2026-10-27 10:00"))
    assertFalse(result.html.contains("<script>"));assertFalse(result.html.contains("<img"));assertTrue(result.html.contains("A&amp;B"))
  }
  @Test fun lodgingCoversNightsButExcludesCheckoutAndCancelledBookings(){
    val html=renderNativeOfflineItinerary("trip_test",detail,workspace).html
    fun lodging(date:String)=html.substringAfter("<h2>$date</h2>").substringAfter("<h3>当晚住宿（按预订区间）</h3>").substringBefore("<h3>预订</h3>")
    assertTrue(lodging("2026-10-22").contains("旅馆"));assertTrue(lodging("2026-10-23").contains("旅馆"))
    assertFalse(lodging("2026-10-22").contains("已取消旅馆"));assertFalse(lodging("2026-10-24").contains("旅馆"))
  }
  @Test fun malformedSnapshotsCannotMasqueradeAsEmptyItineraries(){
    assertTrue(runCatching{renderNativeOfflineItinerary("trip_test",detail.replace("\"reservations\":", "\"missing_reservations\":"),workspace)}.isFailure)
  }
  @Test fun absurdTripRangesAreRejected(){
    assertTrue(runCatching{renderNativeOfflineItinerary("trip_test",detail.replace("2026-10-24\",\"time_zone","2050-10-24\",\"time_zone"),workspace)}.isFailure)
  }
}
