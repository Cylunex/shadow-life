package com.shadow.life

import org.junit.Assert.*
import org.junit.Test

class ReadContinuityTest {
  private fun timeline()=TimelinePage(
    (1..90).map{TimelineItem(LifeDomain.Health,"measurement","item_$it","2026-10-23","记录 $it")},
    "cursor_after_90","2026-10-23T08:00:00Z"
  )

  @Test fun backgroundReceiptsKeepEveryLoadedPageAndCursor(){
    val page=timeline()
    var state:LoadState<TimelinePage> = LoadState.Ready(page)
    repeat(30){state=state.noticeUpdate()}
    val ready=state as LoadState.Ready
    assertSame(page,ready.value)
    assertEquals(90,ready.value.items.size)
    assertEquals("cursor_after_90",ready.value.nextCursor)
    assertTrue(ready.updateAvailable)
    assertFalse(ready.refreshing)
  }

  @Test fun refreshFailureKeepsTheReadingSnapshotAndCanRecover(){
    val page=timeline()
    var state:LoadState<TimelinePage> = LoadState.Ready(page).beginRefresh()
    assertSame(page,(state as LoadState.Ready).value)
    assertTrue(state.refreshing)
    state=state.finishRefresh(LoadState.Failed("网络暂不可用"))
    val failed=state as LoadState.Ready
    assertSame(page,failed.value)
    assertFalse(failed.refreshing)
    assertEquals("网络暂不可用",failed.refreshError)
    val fresh=page.copy(asOf="2026-10-23T09:00:00Z")
    state=state.beginRefresh().finishRefresh(LoadState.Ready(fresh))
    assertSame(fresh,(state as LoadState.Ready).value)
    assertNull(state.refreshError)
    assertFalse(state.refreshing)
  }

  @Test fun changedQueryDateOrIdentityDoesNotReuseTheOldSnapshot(){
    val old=LoadState.Ready(timeline(),refreshError="上次更新失败",updateAvailable=true)
    assertEquals(LoadState.Loading,old.beginRefresh(sameResource=false))
    val failed=LoadState.Loading.finishRefresh(LoadState.Failed("新范围读取失败"))
    assertTrue(failed is LoadState.Failed)
  }

  @Test fun updateArrivingDuringRefreshIsNotLostWhenTheResponseCompletes(){
    val old=LoadState.Ready(timeline(),updateAvailable=true)
    val fetching=old.beginRefresh() as LoadState.Ready
    assertFalse(fetching.updateAvailable)
    val result=fetching.noticeUpdate().finishRefresh(LoadState.Ready(timeline())) as LoadState.Ready
    assertTrue(result.updateAvailable)
    assertFalse(result.refreshing)
  }

  @Test fun appendingOlderRecordsPreservesAnUnappliedUpdateNotice(){
    val initial=LoadState.Ready(timeline(),refreshing=true,updateAvailable=true)
    val older=initial.value.copy(items=initial.value.items+TimelineItem(LifeDomain.Health,"workout","older","2026-10-22","旧记录"),nextCursor=null)
    val result=initial.finishRefresh(LoadState.Ready(older)) as LoadState.Ready
    assertEquals(91,result.value.items.size)
    assertNull(result.value.nextCursor)
    assertTrue(result.updateAvailable)
    assertFalse(result.refreshing)
  }

  @Test fun emptyAndInitialFailuresRemainDistinctFromCachedContent(){
    assertEquals(LoadState.Failed("断网"),LoadState.Loading.finishRefresh(LoadState.Failed("断网")))
    assertEquals(LoadState.Empty("已无记录"),LoadState.Ready(timeline()).beginRefresh().finishRefresh(LoadState.Empty("已无记录")))
  }

  @Test fun checkingTheHeadPageDetectsChangesWithoutDiscardingOlderPages(){
    val loaded=timeline().items
    assertTrue(samePageHead(loaded,loaded.take(30),"next"))
    assertFalse(samePageHead(loaded,emptyList(),null))
    assertFalse(samePageHead(loaded,loaded.take(10),null))
    assertFalse(samePageHead(loaded,listOf(loaded.first().copy(title="更正后的记录"))+loaded.drop(1).take(29),"next"))
    assertTrue(samePageHead(loaded,loaded,null))
  }

  @Test fun healthSyncDoesNotRefreshMoneyTravelOrLibrary(){
    assertEquals(setOf(LifeDomain.Health),affectedReadDomains(setOf("health.ingest_raw","health.record_measurement")))
    assertEquals(setOf(LifeDomain.Library),affectedReadDomains(setOf("library.capture","library.queue_processing")))
    assertEquals(setOf(LifeDomain.Travel),affectedReadDomains(setOf("travel.set_day_plan")))
  }

  @Test fun purchaseAndPaymentChangesStillInvalidateBothRelatedDomains(){
    assertEquals(setOf(LifeDomain.Meals,LifeDomain.Money),affectedReadDomains(setOf("life.correct_purchase")))
    assertEquals(setOf(LifeDomain.Meals,LifeDomain.Money),affectedReadDomains(setOf("money.record_refund")))
    assertEquals(setOf(LifeDomain.Health,LifeDomain.Meals,LifeDomain.Money),affectedReadDomains(setOf("health.record_workout","life.record_meal")))
    assertTrue(affectedReadDomains(setOf("agent.save_task")).isEmpty())
  }
}
