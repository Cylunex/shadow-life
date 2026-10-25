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
}
