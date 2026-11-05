package com.shadow.life

import org.junit.Assert.assertEquals
import org.junit.Test

class TodayCardLayoutStoreTest {
  @Test fun missingLayoutUsesProductDefault(){
    assertEquals(defaultTodayCards,decodeTodayCards(null))
  }

  @Test fun storedLayoutPreservesOrderAndHiddenCards(){
    assertEquals(listOf(TodayCardKind.TravelMap,TodayCardKind.Body),decodeTodayCards("travel_map,body"))
  }

  @Test fun unknownAndDuplicateCardsAreIgnored(){
    assertEquals(listOf(TodayCardKind.Health,TodayCardKind.Meals),decodeTodayCards("removed,health,health,meals"))
  }

  @Test fun cardsCanMoveInEitherDirection(){
    val cards=listOf(TodayCardKind.Health,TodayCardKind.Meals,TodayCardKind.Travel)
    assertEquals(listOf(TodayCardKind.Meals,TodayCardKind.Health,TodayCardKind.Travel),moveTodayCard(cards,1,0))
    assertEquals(listOf(TodayCardKind.Health,TodayCardKind.Travel,TodayCardKind.Meals),moveTodayCard(cards,1,2))
  }

  @Test fun invalidMoveKeepsLayoutUnchanged(){
    val cards=listOf(TodayCardKind.Health,TodayCardKind.Meals)
    assertEquals(cards,moveTodayCard(cards,-1,1))
    assertEquals(cards,moveTodayCard(cards,0,4))
  }

  @Test fun captureCardsAreOrdinaryMovableHideableCards(){
    val cards=decodeTodayCards("money,recent_info,capture_overview,meals")
    assertEquals(listOf(TodayCardKind.Money,TodayCardKind.RecentInfo,TodayCardKind.CaptureOverview,TodayCardKind.Meals),cards)
    assertEquals(TodayCardKind.CaptureOverview,moveTodayCard(cards,2,3).last())
    assertEquals(listOf(TodayCardKind.Money),decodeTodayCards("money"))
  }

  @Test fun captureMigrationPreservesExistingCardOrderAndDoesNotPinOverview(){
    val existing=listOf(TodayCardKind.Money,TodayCardKind.Focus,TodayCardKind.Meals)
    val migrated=introduceCaptureCards(existing)
    assertEquals(listOf(TodayCardKind.Money,TodayCardKind.Focus,TodayCardKind.RecentInfo,TodayCardKind.Meals,TodayCardKind.CaptureOverview),migrated)
    assertEquals(migrated,introduceCaptureCards(migrated))
    assertEquals(listOf(TodayCardKind.Money,TodayCardKind.Meals,TodayCardKind.RecentInfo,TodayCardKind.CaptureOverview),introduceCaptureCards(listOf(TodayCardKind.Money,TodayCardKind.Meals)))
  }
}
