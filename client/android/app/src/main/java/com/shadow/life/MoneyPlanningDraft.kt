package com.shadow.life

import org.json.JSONObject
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.LocalDate
import java.time.ZoneId

private fun cny(value:String):String{
  val amount=value.trim().toBigDecimalOrNull()?:error("填写有效金额")
  require(amount>BigDecimal.ZERO){"金额需要大于零"}
  return runCatching{amount.setScale(2,RoundingMode.UNNECESSARY).toPlainString()}.getOrElse{error("金额最多保留两位小数")}
}

data class NativeBudgetDraft(val period:String,val category:String,val amount:String,val revision:Long?=null)
internal fun budgetPayload(draft:NativeBudgetDraft):JSONObject{
  require(Regex("^\\d{4}-(0[1-9]|1[0-2])$").matches(draft.period)){"月份格式为 YYYY-MM"}
  return JSONObject().put("period",draft.period).put("amount",cny(draft.amount)).put("currency","CNY").apply{
    draft.category.trim().takeIf(String::isNotEmpty)?.let{put("category",it)}
    draft.revision?.let{put("expected_revision",it)}
  }
}

data class NativeRecurringDraft(val title:String,val amount:String,val cadence:String,val nextDueOn:String,val category:String="",val original:MoneyPlanningResultDtoRecurringPlansEntry?=null,val state:String?=null)
data class NativeSpendingIntentDraft(val title:String,val amount:String,val intendedOn:String,val original:MoneyPlanningResultDtoSpendingIntentsEntry?=null,val state:String="planned",val linkedRecordId:String?=null)
internal fun spendingIntentPayload(draft:NativeSpendingIntentDraft):JSONObject{
  val title=draft.title.trim();require(title.isNotEmpty()&&title.length<=200){"请填写想买的内容（最多 200 字）"}
  require(draft.state in setOf("planned","purchased","cancelled")){"不支持的意向状态"}
  require(draft.state!="purchased"||!draft.linkedRecordId.isNullOrBlank()){ "标记已买时请选择实际消费记录" }
  val date=draft.intendedOn.trim().takeIf{it.isNotEmpty()}?.let{runCatching{LocalDate.parse(it)}.getOrElse{throw IllegalArgumentException("请输入有效日期")}}
  val amount=draft.amount.trim().takeIf{it.isNotEmpty()}?.let(::cny)
  return JSONObject().put("title",title).put("state",draft.state).apply{
    draft.original?.let{put("intent_id",it.id);put("expected_revision",it.revision)}
    if(draft.state=="purchased")draft.linkedRecordId?.takeIf{it.isNotBlank()}?.let{put("linked_record_id",it)}
    if(amount!=null){put("expected_amount",amount);put("currency","CNY")}
    else if(draft.original?.expectedAmount!=null){put("expected_amount",JSONObject.NULL);put("currency",JSONObject.NULL)}
    date?.let{put("intended_on",it.toString())}
  }
}
internal fun recurringPayload(draft:NativeRecurringDraft,zone:ZoneId):JSONObject{
  require(draft.title.trim().isNotEmpty()){ "填写周期计划名称" }
  require(draft.cadence in setOf("daily","weekly","monthly","yearly")||(draft.cadence=="interval"&&draft.original?.intervalDays!=null)){ "周期类型无效" }
  LocalDate.parse(draft.nextDueOn)
  val original=draft.original
  require(original==null||draft.nextDueOn>=original.anchorOn){"下次日期不能早于计划起始日期 ${original?.anchorOn.orEmpty()}"}
  return JSONObject().put("title",draft.title.trim()).put("cadence",draft.cadence).put("next_due_on",draft.nextDueOn)
    .put("time_zone",original?.timeZone?:zone.id).put("state",draft.state?:original?.state?.wireValue?:"active").apply{
      draft.amount.trim().takeIf(String::isNotEmpty)?.let{put("amount",cny(it));put("currency","CNY")}
      draft.category.trim().takeIf(String::isNotEmpty)?.let{put("category",it)}
      if(original!=null){
        put("plan_id",original.id);put("expected_revision",original.revision)
        put("anchor_on",original.anchorOn);put("missing_date_policy",original.missingDatePolicy.wireValue)
        original.localTime?.let{put("local_time",it)}
        original.recurrenceRule.takeIf(String::isNotEmpty)?.let{put("recurrence_rule",it)}
        original.intervalDays?.let{put("interval_days",it)}
        original.endedOn?.let{put("ended_on",it)}
      }
    }
}
