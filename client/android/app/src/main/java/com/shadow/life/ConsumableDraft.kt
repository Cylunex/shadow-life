package com.shadow.life

import org.json.JSONObject
import java.math.BigDecimal
import java.time.LocalDate
import java.time.ZoneId

data class NativeUseCycleDraft(
  val name:String,val usageState:String,val startedOn:String,val initialQuantity:String,val quantityUnit:String,
  val quantityLabel:String,val expectedDailyUsage:String,val note:String,
  val original:MoneyPlanningResultDtoUseCyclesEntry?=null,val state:String="active",val endedOn:String?=null
)

data class NativeConsumableUseDraft(
  val cycle:MoneyPlanningResultDtoUseCyclesEntry,val occurredOn:String,val quantity:String,
  val note:String,val original:MoneyPlanningResultDtoUseCyclesEntryUsesEntry?=null,val state:String="active"
)

private fun positiveQuantity(raw:String,label:String):String{
  val value=raw.trim().toBigDecimalOrNull()?:throw IllegalArgumentException("$label 需要有效数字")
  require(value>BigDecimal.ZERO){"$label 需要大于零"}
  val canonical=value.stripTrailingZeros()
  require(canonical.scale()<=6){"$label 最多保留 6 位小数"}
  return canonical.toPlainString()
}

internal fun useCyclePayload(draft:NativeUseCycleDraft,zone:ZoneId):JSONObject{
  val name=draft.name.trim();require(name.isNotEmpty()&&name.length<=200){"请填写消耗品名称（最多 200 字）"}
  val start=runCatching{LocalDate.parse(draft.startedOn)}.getOrElse{throw IllegalArgumentException("请输入有效的启用日期")}
  require(draft.usageState in setOf("pending","in_use")){"使用状态无效"}
  require(draft.quantityUnit in setOf("g","ml","count")){"计量单位无效"}
  require(draft.state in setOf("active","completed","discarded","replenished")){"周期状态无效"}
  val end=draft.endedOn?.let{runCatching{LocalDate.parse(it)}.getOrElse{throw IllegalArgumentException("请输入有效的结束日期")}}
  require(draft.state=="active"||end!=null){"结束周期需要日期"}
  require(end==null||!end.isBefore(start)){"结束日期不能早于启用日期"}
  val existing=draft.original
  require(draft.usageState!="pending"||existing?.matchMode?.wireValue in setOf(null,"none")){"自动匹配的消耗品不能改成待启用"}
  val label=draft.quantityLabel.trim();require(label.length<=16){"单位名称不能超过 16 字"}
  val note=draft.note.trim();require(note.length<=2000){"备注不能超过 2000 字"}
  return JSONObject().put("item_name",name).put("started_on",start.toString()).put("state",draft.state)
    .put("usage_state",draft.usageState).put("quantity_unit",draft.quantityUnit)
    .put("time_zone",existing?.timeZone?:zone.id).put("match_mode",existing?.matchMode?.wireValue?:"none")
    .put("reminder_enabled",existing?.reminderEnabled?:false).apply{
      existing?.let{put("cycle_id",it.id);put("expected_revision",it.revision);it.purchaseRecordId?.let{purchase->put("purchase_record_id",purchase)};it.purchaseItemId?.let{item->put("purchase_item_id",item)};it.matchValue?.let{match->put("match_value",match)};it.replenishThreshold?.let{threshold->put("replenish_threshold",threshold)};it.replenishLeadDays?.let{days->put("replenish_lead_days",days)}}
      draft.initialQuantity.trim().takeIf(String::isNotEmpty)?.let{put("initial_quantity",positiveQuantity(it,"初始数量"))}
      draft.expectedDailyUsage.trim().takeIf(String::isNotEmpty)?.let{put("expected_daily_usage",positiveQuantity(it,"预计每日用量"))}
      if(draft.quantityUnit=="count")label.takeIf(String::isNotEmpty)?.let{put("quantity_label",it)}
      note.takeIf(String::isNotEmpty)?.let{put("note",it)}
      end?.let{put("ended_on",it.toString())}
    }
}

internal fun consumableUsePayload(draft:NativeConsumableUseDraft):JSONObject{
  val date=runCatching{LocalDate.parse(draft.occurredOn)}.getOrElse{throw IllegalArgumentException("请输入有效的使用日期")}
  require(draft.state in setOf("active","voided")){"使用状态无效"}
  require(draft.state!="voided"||draft.original!=null){"只能撤销已有使用记录"}
  require(draft.cycle.matchMode.wireValue=="none"&&draft.cycle.usageState?.wireValue!="pending"&&draft.cycle.quantityUnit!=null){"只能记录已启用的手动消耗品"}
  val note=draft.note.trim();require(note.length<=2000){"备注不能超过 2000 字"}
  return JSONObject().put("cycle_id",draft.cycle.id).put("expected_revision",draft.cycle.revision)
    .put("occurred_on",date.toString()).put("quantity",positiveQuantity(draft.quantity,"使用数量"))
    .put("state",draft.state).apply{
      draft.original?.let{put("use_id",it.id);put("reason",if(draft.state=="voided")"撤销误记的消耗" else "更正实际消耗")}
      note.takeIf(String::isNotEmpty)?.let{put("note",it)}
    }
}
