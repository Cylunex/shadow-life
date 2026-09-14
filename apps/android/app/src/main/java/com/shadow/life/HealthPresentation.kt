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
