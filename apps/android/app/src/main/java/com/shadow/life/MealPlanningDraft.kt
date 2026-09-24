package com.shadow.life

import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.time.LocalDate
import java.time.ZoneId

data class NativeMealPlanEntryDraft(val date:String,val mealType:String,val title:String,val servings:String,val recipeId:String?=null,val recipeRevision:Long?=null)
data class NativeMealPlanDraft(
  val title:String,val startsOn:String,val endsOn:String,val entries:List<NativeMealPlanEntryDraft>,
  val planId:String?=null,val revision:Long?=null,val state:String="active"
)

internal fun mealPlanPayload(draft:NativeMealPlanDraft,zone:ZoneId):JSONObject{
  val start=LocalDate.parse(draft.startsOn);val end=LocalDate.parse(draft.endsOn)
  require(!end.isBefore(start)){"结束日期不能早于开始日期"}
  require(draft.title.trim().isNotEmpty()){ "填写餐单名称" }
  require(draft.entries.isNotEmpty()){ "至少安排一餐" }
  require((draft.planId==null)==(draft.revision==null)){ "餐单版本已变化，请刷新" }
  val rows=JSONArray()
  draft.entries.forEach{entry->
    val date=LocalDate.parse(entry.date)
    require(date in start..end){ "餐次日期需要在餐单期间内" }
    require(entry.title.trim().isNotEmpty()){ "填写想吃的内容" }
    require(entry.mealType in setOf("breakfast","lunch","dinner","snack","other")){ "餐次类型无效" }
    require(entry.servings.toBigDecimalOrNull()?.let{it>BigDecimal.ZERO}==true){ "份数需要大于零" }
    require((entry.recipeId==null)==(entry.recipeRevision==null)){ "食谱版本已变化，请刷新" }
    rows.put(JSONObject().put("plan_date",entry.date).put("meal_type",entry.mealType).put("title",entry.title.trim()).put("servings",entry.servings.toBigDecimal().stripTrailingZeros().toPlainString()).apply{if(entry.recipeId!=null){put("recipe_id",entry.recipeId);put("recipe_revision",entry.recipeRevision)}})
  }
  return JSONObject().put("title",draft.title.trim()).put("starts_on",draft.startsOn).put("ends_on",draft.endsOn)
    .put("time_zone",zone.id).put("state",draft.state).put("entries",rows).apply{
      if(draft.planId!=null){put("meal_plan_id",draft.planId);put("expected_revision",draft.revision);put("reason","更新餐单安排")}
    }
}
