package com.shadow.life

import org.junit.Assert.*
import org.junit.Test

class HomeRecentInfoTest {
  private val item="""{"source_id":"shake_a","kind":"screen_text","title":"摇一摇补记 · 微信","text":"付款材料"}"""
  private fun body(items:String=item)="""{"command_id":"cmd_a","capability":"life.ingest_activity","input":{"device_id":"shake","items":[$items]}}"""
  private fun receipt(resources:String="""{"type":"activity_capture","id":"source_a"}""",commandId:String="cmd_a")="""{"protocol":"shadow.execution-result","command_id":"$commandId","capability":"life.ingest_activity","status":"committed","resources":[$resources]}"""
  private val paidResources="""{"type":"activity_capture","id":"source_a"},{"type":"money_entry","id":"entry_a"},{"type":"consumption_record","id":"record_a"}"""

  @Test fun queuedCaptureIsVisibleBeforeNetworkSync(){
    val row=recentCaptureEntries("cmd_a",123,"pending",body(),null).single()
    assertEquals("摇一摇补记 · 微信",row.title)
    assertEquals("付款材料",row.preview)
    assertEquals(123L,row.at)
    assertNull(row.sourceId);assertNull(row.moneyRecordId)
    assertEquals("待同步 · 已保存在本机",recentCaptureState(row.state))
  }

  @Test fun committedCaptureUsesVerifiedSourceAndHidesRetainedPlaintext(){
    val row=recentCaptureEntries("cmd_a",123,"committed",body(),receipt()).single()
    assertEquals("source_a",row.sourceId)
    assertNull(row.moneyRecordId);assertNull(row.preview)
    assertNotEquals("摇一摇补记 · 微信",row.title)
  }

  @Test fun onlyActualMoneyAndConsumptionResourcesProducePaidLink(){
    assertEquals("record_a",recentCaptureEntries("cmd_a",123,"committed",body(),receipt(paidResources)).single().moneyRecordId)
    val purchaseOnly="""{"type":"activity_capture","id":"source_a"},{"type":"consumption_record","id":"record_a"}"""
    assertNull(recentCaptureEntries("cmd_a",123,"committed",body(),receipt(purchaseOnly)).single().moneyRecordId)
  }

  @Test fun mismatchedReceiptAndUncertainQueueNeverProducePaidLink(){
    for(state in listOf("pending","uploading","unknown","failed","blocked","committed")){
      val row=recentCaptureEntries("cmd_a",123,state,body(),receipt(paidResources,"cmd_other")).single()
      assertNull(row.moneyRecordId);assertNull(row.sourceId)
    }
    for(state in listOf("pending","uploading","unknown","failed","blocked")){
      assertNull(recentCaptureEntries("cmd_a",123,state,body(),receipt(paidResources)).single().moneyRecordId)
      assertFalse(recentCaptureState(state).startsWith("已入账"))
    }
  }

  @Test fun batchReceiptDoesNotAssignAnotherItemsAccountOrSource(){
    val rows=recentCaptureEntries("cmd_a",123,"committed",body("$item,${item.replace("shake_a","shake_b")}"),receipt("$paidResources,{\"type\":\"activity_capture\",\"id\":\"source_b\"}"))
    assertEquals(2,rows.size)
    assertTrue(rows.all{it.sourceId==null&&it.moneyRecordId==null})
  }

  @Test fun passiveUsageAndInvalidCommandsDoNotFillRecentCard(){
    assertTrue(recentCaptureEntries("cmd_a",123,"pending",body(item.replace("screen_text","app_usage")),null).isEmpty())
    assertTrue(recentCaptureEntries("cmd_wrong",123,"pending",body(),null).isEmpty())
    assertTrue(recentCaptureEntries("cmd_a",123,"pending","invalid",null).isEmpty())
  }

  @Test fun recentCaptureKeepsResultLabelWhenTimelineContainsSameRecord(){
    val local=HomeRecentInfo("capture",30,"账目","已入账",LifeDomain.Money,"r1")
    val duplicate=HomeRecentInfo("remote",40,"账目","消费 · 已记录",LifeDomain.Money,"r1")
    val other=HomeRecentInfo("meal",35,"午餐","饮食 · 已记录",LifeDomain.Meals,"r2")
    assertEquals(listOf(other,local),mergeHomeRecentInfo(listOf(local),listOf(duplicate,other)))
    assertEquals(listOf(other),mergeHomeRecentInfo(listOf(local),listOf(duplicate,other),1))
  }
  @Test fun automaticRefreshWaitsOneMinuteButManualRefreshIsImmediate(){
    assertEquals(0L,recentInfoRefreshDelay(null,100))
    assertEquals(59_000L,recentInfoRefreshDelay(100,1_100))
    assertEquals(0L,recentInfoRefreshDelay(100,60_100))
    assertEquals(0L,recentInfoRefreshDelay(100,110,true))
    assertEquals(60_000L,recentInfoRefreshDelay(100,90))
  }
}
