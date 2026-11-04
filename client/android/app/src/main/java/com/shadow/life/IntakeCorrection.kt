package com.shadow.life

import kotlinx.serialization.json.*
import java.math.BigDecimal

internal fun LifeRecordResultDtoMealItemsEntry.editableFood() =
  MealDraftItem(name,quantity.orEmpty(),unit.orEmpty(),energyKcal.orEmpty(),proteinG.orEmpty(),fatG.orEmpty(),carbG.orEmpty())

/** Preserve the original evidence and unedited nutrient fields when changing visible food fields. */
internal fun intakeCorrectionInput(original:LifeRecordResultDtoMealItemsEntry,draft:MealDraftItem, changedPercent:String?=null):JsonObject{
  val fraction = changedPercent?.let { text ->
    val value = text.trim()
    require(Regex("""[0-9]{1,3}(?:[.][0-9]{1,4})?""").matches(value) && value.toBigDecimal() <= BigDecimal("100")) {
      "食用比例请填 0 到 100，最多四位小数"
    }
    value.toBigDecimal().movePointLeft(2).stripTrailingZeros().toPlainString()
  }
  if (fraction != null && draft == original.editableFood()) {
    return buildJsonObject {
      put("item_id",original.id); put("expected_revision",original.revision)
      put("consumed_fraction",fraction); put("reason","用户在餐次详情中更正食用比例")
    }
  }
  val source=Json.encodeToJsonElement(LifeRecordResultDtoMealItemsEntry.serializer(),original).jsonObject
  val writable=setOf("name","food_ref_id","free_text","quantity","unit","amount_g","energy_kcal","protein_g","fat_g","carb_g","fiber_g","sodium_mg","consumed_fraction","provenance","grouping_origin","estimate","evidence_note")
  val item=source.filter{it.key in writable&&it.value!=JsonNull}.toMutableMap()
  require(draft.name.trim().isNotEmpty()){"请填写食物名称"}
  item["name"]=JsonPrimitive(draft.name.trim())
  if(draft.name.trim()!=original.name){item.remove("food_ref_id");item["free_text"]=JsonPrimitive(draft.name.trim());item["provenance"]=JsonPrimitive("manual")}
  require(draft.quantity.isBlank()==draft.unit.isBlank()){"份量和单位需要一起填写"}
  listOf("quantity" to draft.quantity,"energy_kcal" to draft.energyKcal,"protein_g" to draft.proteinG,"fat_g" to draft.fatG,"carb_g" to draft.carbG).forEach{(field,text)->
    if(text.isBlank())item.remove(field)else{
      val number=text.toBigDecimalOrNull()?:error("请填写有效数字")
      require(number>=BigDecimal.ZERO&&(field!="quantity"||number>BigDecimal.ZERO)){"请检查份量与营养数值"}
      item[field]=JsonPrimitive(number.stripTrailingZeros().toPlainString())
    }
  }
  if(draft.unit.isBlank())item.remove("unit")else item["unit"]=JsonPrimitive(draft.unit.trim())
  fraction?.let { item["consumed_fraction"] = JsonPrimitive(it) }
  return buildJsonObject{put("item_id",original.id);put("expected_revision",original.revision);put("item",JsonObject(item));put("reason","用户在餐次详情中更正食物")}
}
