package com.shadow.life

import java.math.BigDecimal
import java.math.RoundingMode
import java.time.LocalDate
import java.time.Period

data class XiaomiProfile(val sex:String,val birthDate:LocalDate,val heightCm:Double)
data class XiaomiBodyComposition(val bodyFatPct:Double,val muscleMassKg:Double,val bodyWaterKg:Double,val visceralFatLevel:Double,val bmrKcal:Double)

/** Community Xiaomi/Huami BIA formula retained for trend compatibility with Shadow Health. */
fun xiaomiBodyComposition(weightKg:Double,impedance:Double,profile:XiaomiProfile,on:LocalDate):XiaomiBodyComposition? {
  val age=Period.between(profile.birthDate,on).years.toDouble()
  if(profile.sex !in setOf("male","female")||age !in 5.0..120.0||profile.heightCm !in 50.0..250.0||weightKg !in 10.0..300.0||impedance !in 1.0..2999.0)return null
  val height=profile.heightCm;val sex=profile.sex
  val lbm=(height*9.058/100)*(height/100)+weightKg*.32+12.226-impedance*.0068-age*.0542
  val constant=if(sex=="female")if(age<=49)9.25 else 7.25 else .8
  var coefficient=1.0
  if(sex=="male"&&weightKg<61)coefficient=.98
  else if(sex=="female"&&weightKg>60)coefficient=.96*(if(height>160)1.03 else 1.0)
  else if(sex=="female"&&weightKg<50)coefficient=1.02*(if(height>160)1.03 else 1.0)
  var fat=(1-((lbm-constant)*coefficient/weightKg))*100;if(fat>63)fat=75.0;fat=fat.coerceIn(5.0,75.0)
  var water=(100-fat)*.7;val waterCoefficient=if(water<=50)1.02 else .98;water=if(water*waterCoefficient>=65)75.0 else water*waterCoefficient;water=water.coerceIn(35.0,75.0)
  val boneBase=if(sex=="female").245691014 else .18016894
  var bone=(boneBase-lbm*.05158)*-1+if((boneBase-lbm*.05158)*-1>2.2).1 else -.1
  if(sex=="female"&&bone>5.1||sex=="male"&&bone>5.2)bone=8.0;bone=bone.coerceIn(.5,8.0)
  var muscle=weightKg-fat*.01*weightKg-bone;if(sex=="female"&&muscle>=84||sex=="male"&&muscle>=93.5)muscle=120.0;muscle=muscle.coerceIn(10.0,120.0)
  val visceral=if(sex=="female"){
    if(weightKg>(13-height*.5)*-1){val sub=((height*1.45)+(height*.1158)*height)-120;weightKg*500/sub-6+age*.07}
    else {val sub=.691+height*-.0024+height*-.0024;((height*.027-sub*weightKg)*-1)+age*.07-age}
  }else if(height<weightKg*1.6){val sub=(height*.4-height*(height*.0826))*-1;(weightKg*305)/(sub+48)-2.9+age*.15}
  else {val sub=.765+height*-.0015;((height*.143-weightKg*sub)*-1)+age*.15-5}
  var bmr=if(sex=="female")864.6+weightKg*10.2036-height*.39336-age*6.204 else 877.8+weightKg*14.916-height*.726-age*8.976
  if(sex=="female"&&bmr>2996||sex=="male"&&bmr>2322)bmr=5000.0
  fun rounded(value:Double,scale:Int)=BigDecimal.valueOf(value).setScale(scale,RoundingMode.HALF_UP).toDouble()
  return XiaomiBodyComposition(rounded(fat,1),rounded(muscle,2),rounded(water.coerceIn(35.0,75.0)*weightKg/100,2),rounded(visceral.coerceIn(1.0,50.0),0),rounded(bmr.coerceIn(500.0,10000.0),0))
}
