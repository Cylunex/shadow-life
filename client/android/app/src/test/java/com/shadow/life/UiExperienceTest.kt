package com.shadow.life

import org.junit.Assert.*
import org.junit.Test
import kotlinx.serialization.json.*

class UiExperienceTest {
  @Test fun mealDraftRestoresAllEnteredFieldsWithoutInventingNutrition(){
    val rows=listOf(MealDraftItem("牛肉面","1.5","碗","560.25","25.5","18","70"),MealDraftItem("茶"))
    assertEquals(rows,readMealDraftRows(encodeMealDraftRows(rows),""))
    assertEquals("",readMealDraftRows(encodeMealDraftRows(rows),"")[1].energyKcal)
  }
  @Test fun malformedDraftDoesNotPartiallyApply(){
    for(value in listOf(null,"not json","[]","[[\"no fields\"]]","[[null,1,2,3,4,5,6]]")){
      assertEquals(listOf(MealDraftItem("原始内容")),readMealDraftRows(value,"原始内容"))
    }
  }
  @Test fun chartSelectionClampsToRealSampleRange(){
    assertEquals(0,nearestTrendIndex(-50f,100f,7))
    assertEquals(6,nearestTrendIndex(200f,100f,7))
    assertEquals(3,nearestTrendIndex(50f,100f,7))
    assertEquals(0,nearestTrendIndex(50f,100f,1))
    assertEquals(0,nearestTrendIndex(50f,0f,0))
  }
  @Test fun pinAndReorderPreserveWeighingCardAndOtherEntries(){
    assertFalse(compactTodayKinds.contains(TodayCardKind.Scale))
    val cards=defaultTodayCards
    val pinned=moveTodayCard(cards,cards.indexOf(TodayCardKind.Scale),0)
    assertEquals(TodayCardKind.Scale,pinned.first())
    assertEquals(cards.toSet(),pinned.toSet())
    assertEquals(cards.size,pinned.size)
    assertEquals(pinned,moveTodayCard(pinned,-1,0))
  }
  private fun sourceFood()=LifeRecordResultDtoMealItemsEntry("food_1","meal_1",0,"牛奶","catalog_1","原始名称","250","ml","258","130","8","5","12","0.1","90","0.5","reference_snapshot","actual_meal",false,"营养标签",3)
  @Test fun foodCorrectionPreservesUneditedEvidenceAndFraction(){
    val original=sourceFood()
    val input=intakeCorrectionInput(original,MealDraftItem(original.name,"250","ml","130","8","5","12"))
    val item=input.getValue("item").jsonObject
    assertEquals("0.5",item.getValue("consumed_fraction").jsonPrimitive.content)
    assertEquals("258",item.getValue("amount_g").jsonPrimitive.content)
    assertEquals("营养标签",item.getValue("evidence_note").jsonPrimitive.content)
    assertEquals("3",input.getValue("expected_revision").jsonPrimitive.content)
    assertFalse(item.containsKey("revision"))
    assertFalse(item.containsKey("meal_id"))
  }
  @Test fun renamedFoodDoesNotKeepAnUnrelatedCatalogReference(){
    val input=intakeCorrectionInput(sourceFood(),MealDraftItem("豆奶"))
    val item=input.getValue("item").jsonObject
    assertFalse(item.containsKey("food_ref_id"))
    assertFalse(item.containsKey("energy_kcal"))
    assertEquals("豆奶",item.getValue("free_text").jsonPrimitive.content)
    assertEquals("manual",item.getValue("provenance").jsonPrimitive.content)
  }
  @Test fun invalidFoodCorrectionIsRejectedBeforeQueueing(){
    assertThrows(IllegalArgumentException::class.java){intakeCorrectionInput(sourceFood(),MealDraftItem("牛奶","1",""))}
    assertThrows(IllegalArgumentException::class.java){intakeCorrectionInput(sourceFood(),MealDraftItem("牛奶",energyKcal="-1"))}
  }

}
