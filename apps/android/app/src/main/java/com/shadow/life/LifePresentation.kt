package com.shadow.life

import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Keep missing days in place so a seven-day chart never compresses gaps. */
internal fun healthWeek(history:List<HealthDailyOverview>,end:LocalDate=LocalDate.now()):List<HealthDailyOverview?> {
  val byDate=history.associateBy{it.occurredOn}
  return (6L downTo 0L).map{byDate[end.minusDays(it).toString()]}
}

internal fun displayDecimal(value:String)=value.toBigDecimalOrNull()?.stripTrailingZeros()?.toPlainString()?:value
internal fun recordCurrency(record:RecordSummary):String?=record.trailing?.substringBefore(' ')?.takeIf{it.matches(Regex("[A-Z]{3}"))}
internal fun recordAmount(record:RecordSummary):BigDecimal?=record.trailing?.substringAfter(' ',"")?.toBigDecimalOrNull()
internal data class MoneyCardTotals(val expense:BigDecimal,val refund:BigDecimal,val income:BigDecimal){val net:BigDecimal get()=expense-refund}
internal fun moneyCardTotals(records:List<RecordSummary>,currency:String):MoneyCardTotals {
  val rows=records.filter{recordCurrency(it)==currency}
  fun sum(type:String)=rows.filter{it.subtype==type}.fold(BigDecimal.ZERO){total,row->total+(recordAmount(row)?:BigDecimal.ZERO)}
  return MoneyCardTotals(sum("expense"),sum("refund"),sum("income"))
}

/** Date-only facts have no time. Instants are grouped in the viewer's local day. */
internal fun recordDate(value:String,zone:ZoneId=ZoneId.systemDefault()):LocalDate? = runCatching{
  if(value.length==10)LocalDate.parse(value) else Instant.parse(value).atZone(zone).toLocalDate()
}.getOrNull()
internal fun recordTime(value:String,zone:ZoneId=ZoneId.systemDefault()):String? =
  if(value.length==10)null else runCatching{Instant.parse(value).atZone(zone).format(DateTimeFormatter.ofPattern("HH:mm"))}.getOrNull()
internal fun inRecordPeriod(date:LocalDate?,period:String,today:LocalDate=LocalDate.now()):Boolean=when(period){
  "today"->date==today
  "week"->date!=null&&date>=today.minusDays(6)&&date<=today
  "month"->date!=null&&date.year==today.year&&date.month==today.month
  else->true
}
internal fun upcomingAgenda(items:List<AgendaItem>,today:LocalDate=LocalDate.now()):List<AgendaItem> =
  items.filter{it.dueOn>=today.toString()&&it.dueOn<=today.plusDays(6).toString()}.sortedWith(compareBy({it.dueOn},{it.dueAt?:""},{it.title}))

internal fun isDetailMetadata(section:DetailSection)=section.title in setOf("来源","原始记录","来源与完整性","更正历史","处理任务","可检索内容","固定原件","已发布计划","成员")
internal fun detailValue(label:String,value:String):String {
  val labels=when(label){
    "状态","类型"->mapOf("active" to "有效","confirmed" to "已确认","draft" to "草稿","voided" to "已作废","archived" to "已归档","cancelled" to "已取消","pending" to "待处理","completed" to "已完成","note" to "笔记","link" to "链接","document" to "文件","image" to "图片","file" to "文件","receipt" to "凭证","ticket" to "票券")
    "支付方式"->mapOf("wechat" to "微信","alipay" to "支付宝","cash" to "现金","bank_card" to "银行卡","other" to "其他")
    "场景"->mapOf("dine_in" to "堂食","takeout" to "外卖","delivery" to "配送","groceries" to "食材采购","online" to "线上","offline" to "线下")
    else->emptyMap()
  }
  return labels[value]?:if(value.matches(Regex("\\d{4}-\\d{2}-\\d{2}T.*")))localDateTime(value,null)?:value else value
}

internal data class MealNutrition(
  val kcal:Double?,val protein:Double?,val fat:Double?,val carb:Double?,
  val knownItems:Int,val totalItems:Int,val estimated:Boolean,val completeMacros:Boolean
)
internal data class MealEnergyCoverage(val recorded:Int,val total:Int)
internal fun mealEnergyCoverage(records:List<RecordSummary>):MealEnergyCoverage {
  val foods=records.flatMap{it.meal?.foods.orEmpty()}
  return MealEnergyCoverage(foods.count{it.energyKcal?.toDoubleOrNull()?.isFinite()==true},foods.size)
}
internal fun mealNutrition(records:List<RecordSummary>):MealNutrition {
  val foods=records.flatMap{it.meal?.foods.orEmpty()}
  fun sum(field:(MealFoodSummary)->String?):Double?=foods.mapNotNull{field(it)?.toDoubleOrNull()?.takeIf(Double::isFinite)}.takeIf{it.isNotEmpty()}?.sum()
  fun zeroEnergyWithoutMacros(food:MealFoodSummary)=food.energyKcal?.toDoubleOrNull()==0.0&&listOf(food.proteinG,food.fatG,food.carbG).all{it==null||it.toDoubleOrNull()==0.0}
  fun macroSum(field:(MealFoodSummary)->String?):Double?=foods.mapNotNull{food->field(food)?.toDoubleOrNull()?.takeIf(Double::isFinite)?:if(zeroEnergyWithoutMacros(food))0.0 else null}.takeIf{it.isNotEmpty()}?.sum()
  return MealNutrition(sum{it.energyKcal},macroSum{it.proteinG},macroSum{it.fatG},macroSum{it.carbG},
    foods.count{it.energyKcal!=null||it.proteinG!=null||it.fatG!=null||it.carbG!=null},foods.size,foods.any{it.estimated},
    foods.isNotEmpty()&&foods.all{(it.proteinG!=null&&it.fatG!=null&&it.carbG!=null)||zeroEnergyWithoutMacros(it)})
}
internal fun tripPhase(trip:TravelTripSummary,today:LocalDate=LocalDate.now(ZoneId.of(trip.timeZone))):String=when{
  trip.active||today.toString() in trip.startsOn..trip.endsOn->"active"
  trip.endsOn<today.toString()->"completed"
  else->"planned"
}
