package com.shadow.life

import java.math.BigDecimal
import java.math.RoundingMode
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val healthMetricLabels=mapOf(
  "weight" to "体重","height" to "身高","bmi" to "BMI","body_fat" to "体脂率","fat_mass" to "脂肪量","lean_mass" to "去脂体重",
  "skeletal_muscle" to "骨骼肌","muscle_mass" to "肌肉量","muscle_rate" to "肌肉率","body_water" to "身体水分量","body_water_rate" to "身体水分率",
  "bone_mass" to "骨量","bone_rate" to "骨量率","visceral_fat" to "内脏脂肪等级","bmr" to "基础代谢","impedance_low" to "低频阻抗",
  "impedance_high" to "高频阻抗","waist" to "腰围","chest" to "胸围","hip" to "臀围","heart_rate" to "心率",
  "blood_pressure_systolic" to "收缩压","blood_pressure_diastolic" to "舒张压","temperature" to "体温","spo2" to "血氧",
  "blood_glucose" to "血糖","lab_value" to "检验结果","fitness_value" to "体能测试"
)

internal fun healthMetricLabel(key:String):String=healthMetricLabels[key.trim().lowercase()]?:key.replace('_',' ')

internal fun healthValueText(value:String,unit:String):String{
  val number=value.toBigDecimalOrNull()?:return value
  val scale=when(unit.lowercase()){
    "bpm","次/分","mmhg","level","级","kcal/day","kcal/天","kcal","ohm","步","分钟"->0
    "kg","%","kg/m²","cm","c","°c","mmol/l","mg/dl"->1
    else->2
  }
  return number.setScale(scale,RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
}

internal fun healthValueText(value:Double,unit:String):String=healthValueText(BigDecimal.valueOf(value).toPlainString(),unit)

internal fun localDateTime(instant:String?,timeZone:String?,includeDate:Boolean=true):String?{
  if(instant.isNullOrBlank())return null
  return runCatching{
    val zone=timeZone?.takeIf(String::isNotBlank)?.let(ZoneId::of)?:ZoneId.systemDefault()
    Instant.parse(instant).atZone(zone).format(DateTimeFormatter.ofPattern(if(includeDate)"yyyy-MM-dd HH:mm" else "HH:mm"))
  }.getOrElse{instant}
}

internal enum class HealthTone { Low, Good, High, Neutral }
internal data class HealthAssessment(val tone:HealthTone,val label:String,val basis:String)
internal data class HealthReference(val low:Double?,val high:Double?,val unit:String,val basis:String="自定参考",val highExclusive:Boolean=false)

internal fun assessHealth(value:Double?,unit:String,reference:HealthReference?,goal:Boolean=false):HealthAssessment {
  if(value==null||!value.isFinite())return HealthAssessment(HealthTone.Neutral,"未记录","等待数据")
  if(reference==null||!unit.equals(reference.unit,true))return HealthAssessment(HealthTone.Neutral,"仅记录","未设置适用参考范围")
  val low=reference.low;val high=reference.high
  val tone=when{low!=null&&value<low->HealthTone.Low;high!=null&&(value>high||(reference.highExclusive&&value==high))->HealthTone.High;else->HealthTone.Good}
  val label=if(goal)when(tone){HealthTone.Low->"未达目标";HealthTone.Good->"已达目标";else->"超过目标"} else when(tone){HealthTone.Low->"偏低";HealthTone.High->"偏高";HealthTone.Good->"合格";else->"仅记录"}
  val range=when{low!=null&&high!=null->"${healthValueText(low,unit)}–${healthValueText(high,unit)}${if(reference.highExclusive)"（不含上限）" else ""}";low!=null->"≥ ${healthValueText(low,unit)}";else->"≤ ${high?.let{healthValueText(it,unit)}}"}
  return HealthAssessment(tone,label,"${reference.basis} · $range $unit")
}
internal fun defaultHealthReference(key:String):HealthReference?=when(key){
  "bmi"->HealthReference(18.5,24.0,"kg/m²","中国成人 BMI 参考",true)
  "sleep_minutes"->HealthReference(420.0,null,"分钟","18–60 岁成人睡眠参考")
  else->null
}
/** Keep provider extrema and wrist skin temperature out of generic vital series. */
internal fun healthSeriesKey(key:String,field:String?):String=when {
  key=="heart_rate"&&field=="samsung:daily_min"->"heart_rate_daily_min"
  key=="heart_rate"&&field=="samsung:daily_max"->"heart_rate_daily_max"
  key=="temperature"&&field?.contains("skin_temperature")==true->when{field.contains("min_")->"skin_temperature_min";field.contains("max_")->"skin_temperature_max";else->"skin_temperature"}
  key=="spo2"&&field?.contains("min_oxygen")==true->"spo2_min"
  key=="spo2"&&field?.contains("max_oxygen")==true->"spo2_max"
  else->key
}
internal fun healthSeriesLabel(key:String):String=mapOf("heart_rate_daily_min" to "全天最低心率","heart_rate_daily_max" to "全天最高心率","skin_temperature" to "皮肤温度","skin_temperature_min" to "最低皮肤温度","skin_temperature_max" to "最高皮肤温度","spo2_min" to "最低血氧","spo2_max" to "最高血氧")[key]?:healthMetricLabel(key)
internal fun macroAssessment(nutrition:MealNutrition,key:String):HealthAssessment {
  if(!nutrition.completeMacros)return HealthAssessment(HealthTone.Neutral,if(nutrition.totalItems==0)"未记录" else "部分已记录","有食物未记录三大营养素，暂不比较供能占比")
  val total=nutrition.protein!!*4+nutrition.carb!!*4+nutrition.fat!!*9
  if(total<=0)return HealthAssessment(HealthTone.Neutral,"暂无占比","已记录供能为 0")
  val (energy,range)=when(key){"protein"->nutrition.protein*4 to (10.0 to 35.0);"carb"->nutrition.carb*4 to (45.0 to 65.0);else->nutrition.fat*9 to (20.0 to 35.0)}
  val percent=energy/total*100
  return assessHealth(percent,"%",HealthReference(range.first,range.second,"%","成人供能占比参考")).let{it.copy(label="占比${it.label}",basis="${healthValueText(percent,"%")} % · 参考 ${range.first.toInt()}–${range.second.toInt()} %")}
}
internal fun workoutPerformance(workout:HealthWorkoutSummary):Pair<String,String>? {
  val distance=workout.distanceKm?.toDoubleOrNull()?.takeIf{it.isFinite()&&it>0}?:return null
  val minutes=workout.durationMinutes?.takeIf{it>0}?:return null
  val key=workout.sessionType.lowercase()
  return when {
    listOf("walk","run","jog","hik").any{key.contains(it)}->{val seconds=kotlin.math.round(minutes*60.0/distance).toLong();"平均配速" to "${seconds/60}′${(seconds%60).toString().padStart(2,'0')}″ /km"}
    listOf("cycl","bik").any{key.contains(it)}->"平均速度" to "${healthValueText(distance*60/minutes,"km/h")} km/h"
    else->null
  }
}

internal fun adultWeightReference(heightCm:String,birthDate:String,today:java.time.LocalDate=java.time.LocalDate.now()):HealthReference? {
  val height=heightCm.toDoubleOrNull()?.takeIf{it.isFinite()&&it in 100.0..250.0}?:return null
  val age=runCatching{java.time.Period.between(java.time.LocalDate.parse(birthDate),today).years}.getOrNull()?:return null
  if(age !in 18..120)return null
  val square=(height/100)*(height/100)
  return HealthReference(18.5*square,24.0*square,"kg","按已设置身高的成人 BMI 参考",true)
}
