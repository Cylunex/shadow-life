package com.shadow.life

import org.junit.Assert.*
import org.junit.Test

class PlanningAttentionTest {
  private fun item(id:String,name:String,state:String="owned",returnState:OwnedItemsResultDtoAttentionItemsEntryReturnWindowState=OwnedItemsResultDtoAttentionItemsEntryReturnWindowState.Unknown)=
    OwnedItemSummary(id,name,state,"书房","2026-11-10","2026-10-23",1,0,0,locationPath=listOf("书房","文件柜"),attention=OwnedItemsResultDtoAttentionItemsEntry(id,OwnedItemsResultDtoAttentionItemsEntryReturnWindow(returnState,1),OwnedItemsResultDtoAttentionItemsEntryWarranty(OwnedItemsResultDtoAttentionItemsEntryWarrantyState.Unknown,null)))
  @Test fun serverDeadlineStatesRemainDistinct(){
    assertEquals("今天到期",deadlineLabel("today",0))
    assertEquals("已过期 2 天",deadlineLabel("past",-2))
    assertEquals("剩余 30 天",deadlineLabel("soon",30))
    assertEquals("未记录日期",deadlineLabel("unknown",null))
    assertEquals("期限状态未载入",deadlineLabel(null,null))
    assertEquals("已用完",deadlineLabel("empty",null))
    assertFalse(stockMatches("soon","empty"));assertTrue(stockMatches("soon","today"))
    assertFalse(stockMatches("unknown",null));assertTrue(stockMatches("unknown","unknown"))
  }
  @Test fun ownedSearchCombinesLocationAndNameWithoutInventingDeadlineState(){
    val soon=item("one","Laptop",returnState=OwnedItemsResultDtoAttentionItemsEntryReturnWindowState.Today)
    val inactive=item("two","Laptop","returned",OwnedItemsResultDtoAttentionItemsEntryReturnWindowState.Inactive)
    val unknown=item("three","台灯")
    assertEquals(listOf(soon),visibleOwnedItems(listOf(soon,inactive,unknown),"laptop 文件柜","return"))
    assertEquals(listOf(soon,unknown),visibleOwnedItems(listOf(soon,inactive,unknown),"书房","owned"))
    assertTrue(visibleOwnedItems(listOf(unknown),"","warranty").isEmpty())
  }
}
