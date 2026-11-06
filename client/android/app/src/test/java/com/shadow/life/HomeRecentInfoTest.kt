package com.shadow.life

import org.junit.Assert.*
import org.junit.Test
import kotlinx.coroutines.*
import kotlinx.serialization.json.*

class HomeRecentInfoTest {
  private val takeoutText="life.takeout.v1\n"+"""{"blocks":[[20,20,200,30,"合成外卖店"],[800,100,200,30,"实付¥19.98"]]}"""
  private fun takeoutBody()=buildJsonObject{put("command_id","cmd_order");put("capability","life.capture_screenshot");putJsonObject("input"){put("title","外卖订单");put("text",takeoutText)}}.toString()
  private fun takeoutReceipt(capability:String="life.capture_screenshot",extra:String="")="""{"protocol":"shadow.execution-result","command_id":"cmd_order","capability":"$capability","status":"committed","resources":[{"type":"library_item","id":"library_order"},{"type":"activity_capture","id":"source_order"}$extra]}"""
  @Test fun screenshotOrderTextAppearsInRecentCapturesWithoutInventingPayment(){
    val pending=recentCaptureEntries("cmd_order",123,"pending",takeoutBody(),null).single()
    assertEquals("合成外卖店\n实付¥19.98",pending.preview)
    val committed=recentCaptureEntries("cmd_order",123,"committed",takeoutBody(),takeoutReceipt()).single()
    assertEquals("source_order",committed.sourceId);assertNull(committed.moneyRecordId);assertNull(committed.preview)
    assertNull(recentCaptureEntries("cmd_order",123,"committed",takeoutBody(),takeoutReceipt("life.ingest_activity")).single().sourceId)
    assertNull(recentCaptureEntries("cmd_order",123,"committed",takeoutBody(),takeoutReceipt(extra=",{\"type\":\"activity_capture\",\"id\":\"other\"}")).single().sourceId)
  }
  @Test fun textResultTakesPrecedenceOverItsOriginalImageOnly(){
    val text=HomeRecentInfo("capture",30,"订单文字","已提取",LifeDomain.Library,"capture:source_order",originalLibraryId="library_order")
    val original=HomeRecentInfo("image",31,"截图","已保存",LifeDomain.Library,"library_order")
    val unrelated=original.copy(key="another",targetId="another_image",at=20)
    assertEquals(listOf(text,unrelated),mergeHomeRecentInfo(listOf(text),listOf(original,unrelated)))
  }
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
  @Test fun automaticAndShakeSourcesShowOneExpenseAndRetainMaterialCount(){
    val auto=HomeRecentInfo("auto",10,"旧材料","付款页已归组 · 查看对应消费",LifeDomain.Money,"record_a")
    val shake=HomeRecentInfo("shake",20,"餐厅 · 19.98","已入账 · 查看消费",LifeDomain.Money,"record_a")
    val other=shake.copy(key="other",targetId="record_b",at=15)
    val rows=mergeHomeRecentInfo(listOf(auto,other,shake),listOf(shake.copy(key="timeline")))
    assertEquals(2,rows.size);assertEquals("餐厅 · 19.98",rows.first().title)
    assertEquals("已入账 · 查看消费 · 2 份采集材料",rows.first().status)
    assertEquals(20L,rows.first().at)
  }
  @Test fun newlyCommittedCaptureBypassesBackgroundRefreshThrottle(){
    val paid=recentCaptureEntries("cmd_a",123,"committed",body(),receipt(paidResources)).single()
    assertTrue(hasNewCaptureResults(listOf(paid),emptySet()))
    assertEquals(0L,recentInfoRefreshDelay(100,110,newResults=hasNewCaptureResults(listOf(paid),emptySet())))
    assertFalse(hasNewCaptureResults(listOf(paid),setOf(paid.key)))
    assertFalse(hasNewCaptureResults(listOf(paid.copy(state="pending")),emptySet()))
    assertEquals(59_990L,recentInfoRefreshDelay(100,110,newResults=false))
  }

  @Test fun fastCaptureResultIsPublishedBeforeSlowOlderReadFinishes()=runBlocking{
    val older=RecentCaptureInfo("older",1,"old","committed",null)
    val newer=RecentCaptureInfo("newer",2,"new","committed",null)
    val slow=CompletableDeferred<Unit>();val fastPublished=CompletableDeferred<Unit>()
    val published=mutableListOf<String>()
    val job=launch{resolveRecentCaptures(listOf(older,newer),read={item->
      if(item.key=="older")slow.await()
      HomeRecentInfo(item.key,item.at,"消费","已入账")
    },publish={key,_->published+=key;if(key=="newer")fastPublished.complete(Unit)})}
    withTimeout(2000){fastPublished.await()}
    assertEquals(listOf("newer"),published);assertFalse(job.isCompleted)
    slow.complete(Unit);job.join();assertEquals(listOf("newer","older"),published)
  }

  @Test fun repeatedTakeoutShowsOneOrderAndKeepsDifferentOrdersSeparate(){
    val first=HomeRecentInfo("first",10,"订单","订单文字已提取",LifeDomain.Library,"capture:s1",originalLibraryId="l1",captureOrderId="o1")
    val second=first.copy(key="second",at=20,targetId="capture:s2",originalLibraryId="l2")
    val other=first.copy(key="other",at=15,targetId="capture:s3",originalLibraryId="l3",captureOrderId="o2")
    val images=listOf("l1","l2","l3").map{HomeRecentInfo(it,30,"截图","原件",LifeDomain.Library,it)}
    val rows=mergeHomeRecentInfo(listOf(first,second,other),images)
    assertEquals(2,rows.size);assertEquals("capture:s2",rows.first().targetId)
    assertEquals("订单文字已提取 · 2 份采集材料",rows.first().status)
    assertEquals("o2",rows.last().captureOrderId)
  }

}
