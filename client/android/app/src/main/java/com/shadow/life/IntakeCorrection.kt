package com.shadow.life

import kotlinx.serialization.json.*
import java.math.BigDecimal
import java.math.RoundingMode

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
  val writable=setOf("name","food_ref_id","free_text","quantity","unit","amount_g","weight_basis","energy_kcal","protein_g","fat_g","carb_g","fiber_g","sodium_mg","calcium_mg","iron_mg","consumed_fraction","provenance","grouping_origin","estimate","evidence_note")
  val item=source.filter{it.key in writable&&it.value!=JsonNull}.toMutableMap()
  val name=draft.name.trim()
  val unit=draft.unit.trim()
  require(name.isNotEmpty()){"请填写食物名称"}
  require(draft.quantity.isBlank()==unit.isBlank()){"份量和单位需要一起填写"}
  val quantity=draft.quantity.takeUnless(String::isBlank)?.let{
    val number=it.trim().toBigDecimalOrNull()?:error("请填写有效数字")
    require(number>BigDecimal.ZERO){"请检查份量与营养数值"}
    number
  }
  val oldQuantity=original.quantity?.toBigDecimal()
  val renamed=name!=original.name
  val sameUnit=unit==original.unit.orEmpty()
  val portionChanged=!sameUnit||quantity?.stripTrailingZeros()!=oldQuantity?.stripTrailingZeros()
  val scale=portionChanged&&!renamed&&sameUnit&&quantity!=null&&oldQuantity!=null&&oldQuantity>BigDecimal.ZERO
  val changedBasis=renamed||portionChanged&&!scale
  fun scaled(old:String):String=old.toBigDecimal().multiply(checkNotNull(quantity))
    .divide(checkNotNull(oldQuantity),6,RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()

  item["name"]=JsonPrimitive(name)
  if(renamed){
    item.remove("food_ref_id")
    item["free_text"]=JsonPrimitive(name)
  }
  var scaledValues=false
  val otherValues=listOf("amount_g","fiber_g","sodium_mg","calcium_mg","iron_mg")
  if(changedBasis){
    (otherValues+listOf("weight_basis","estimate","evidence_note")).forEach(item::remove)
    item["provenance"]=JsonPrimitive("manual")
  }else if(scale){
    otherValues.forEach{field->
      val value=item[field]?.jsonPrimitive?.content?.let(::scaled)?:return@forEach
      if(field=="amount_g"&&value=="0"){
        item.remove(field)
        item.remove("weight_basis")
      }else{
        item[field]=JsonPrimitive(value)
        scaledValues=true
      }
    }
    item.remove("weight_basis")
  }

  if(quantity==null)item.remove("quantity")else item["quantity"]=JsonPrimitive(quantity.stripTrailingZeros().toPlainString())
  if(unit.isEmpty())item.remove("unit")else item["unit"]=JsonPrimitive(unit)
  listOf(
    Triple("energy_kcal",draft.energyKcal,original.energyKcal),
    Triple("protein_g",draft.proteinG,original.proteinG),
    Triple("fat_g",draft.fatG,original.fatG),
    Triple("carb_g",draft.carbG,original.carbG)
  ).forEach{(field,text,before)->
    if(text.isBlank()){
      item.remove(field)
    }else{
      val number=text.trim().toBigDecimalOrNull()?:error("请填写有效数字")
      require(number>=BigDecimal.ZERO){"请检查份量与营养数值"}
      val unchanged=before!=null&&number.compareTo(before.toBigDecimal())==0
      if(unchanged&&changedBasis)item.remove(field)
      else if(unchanged&&scale){
        item[field]=JsonPrimitive(scaled(text.trim()))
        scaledValues=true
      }else item[field]=JsonPrimitive(number.stripTrailingZeros().toPlainString())
    }
  }
  if(scaledValues){
    item["estimate"]=JsonPrimitive(true)
    val basis="按原份量 ${original.quantity} ${original.unit} 等比例换算。"
    item["evidence_note"]=JsonPrimitive((basis+original.evidenceNote.orEmpty()).take(500))
  }
  fraction?.let { item["consumed_fraction"] = JsonPrimitive(it) }
  return buildJsonObject{put("item_id",original.id);put("expected_revision",original.revision);put("item",JsonObject(item));put("reason","用户在餐次详情中更正食物")}
}
