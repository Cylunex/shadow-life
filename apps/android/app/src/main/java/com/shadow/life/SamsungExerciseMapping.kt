package com.shadow.life

import java.util.Locale

internal data class SamsungExerciseMapping(
  val sessionType:String,
  val releaseEvent:Boolean=false
)

private val releaseExerciseNames=setOf("起飞")

internal fun samsungExerciseMapping(providerType:String?,customTitle:String?):SamsungExerciseMapping{
  val title=customTitle?.trim()?.takeIf(String::isNotBlank)
  if(title!=null&&releaseExerciseNames.any{it.equals(title,ignoreCase=true)})return SamsungExerciseMapping("release",true)
  val provider=providerType?.trim()?.uppercase(Locale.ROOT)
  val canonical=when(provider){
    null,"","UNDEFINED","OTHER"->title?:"other"
    "BIKING"->"cycling"
    else->provider.lowercase(Locale.ROOT)
  }
  return SamsungExerciseMapping(canonical)
}
