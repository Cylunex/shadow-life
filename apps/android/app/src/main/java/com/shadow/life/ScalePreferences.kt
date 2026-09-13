package com.shadow.life

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.time.LocalDate

data class ScaleProfileSettings(val sex:String="",val birthDate:String="",val heightCm:String="",val s400Bindkey:String="") {
  fun profile():XiaomiProfile?=runCatching{XiaomiProfile(sex,LocalDate.parse(birthDate),heightCm.toDouble())}.getOrNull()?.takeIf{it.sex in setOf("male","female")&&it.heightCm in 50.0..250.0}
  val hasS400Key get()=Regex("(?i)[0-9a-f]{32}").matches(s400Bindkey)
}

class ScalePreferences(context:Context) {
  private val values=EncryptedSharedPreferences.create(
    context,"shadow-life-scale",
    MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
  )
  fun current()=ScaleProfileSettings(values.getString("sex","").orEmpty(),values.getString("birth_date","").orEmpty(),values.getString("height_cm","").orEmpty(),values.getString("s400_bindkey","").orEmpty())
  fun save(value:ScaleProfileSettings){
    require(value.sex.isBlank()||value.sex in setOf("male","female")){"请选择性别"}
    if(value.birthDate.isNotBlank())require(runCatching{LocalDate.parse(value.birthDate)}.isSuccess){"生日格式应为 YYYY-MM-DD"}
    if(value.heightCm.isNotBlank())require(value.heightCm.toDoubleOrNull()?.let{it in 50.0..250.0}==true){"身高应为 50–250 cm"}
    require(value.s400Bindkey.isBlank()||value.hasS400Key){"S400 bindkey 应为 32 位十六进制"}
    values.edit().putString("sex",value.sex).putString("birth_date",value.birthDate.trim()).putString("height_cm",value.heightCm.trim()).putString("s400_bindkey",value.s400Bindkey.trim().lowercase()).apply()
  }
}
