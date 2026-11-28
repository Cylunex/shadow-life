package com.shadow.life

import android.content.Context
import android.content.pm.PackageManager
import java.security.MessageDigest
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import java.time.LocalDate

data class ScaleProfileSettings(val sex:String="",val birthDate:String="",val heightCm:String="",val s400Bindkey:String="") {
  fun profile():XiaomiProfile?=runCatching{XiaomiProfile(sex,LocalDate.parse(birthDate),heightCm.toDouble())}.getOrNull()?.takeIf{it.sex in setOf("male","female")&&it.heightCm in 50.0..250.0}
  val hasS400Key get()=Regex("(?i)[0-9a-f]{32}").matches(s400Bindkey)
}

class ScalePreferences(context:Context) {
  private val accountProfiles = context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA)
    .metaData?.getBoolean("com.shadow.life.ACCOUNT_SCALE_PROFILES", false) == true
  private val values=EncryptedSharedPreferences.create(
    context,"shadow-life-scale",
    MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
  )
  fun current()=ScaleProfileSettings(values.getString("sex","").orEmpty(),values.getString("birth_date","").orEmpty(),values.getString("height_cm","").orEmpty(),values.getString("s400_bindkey","").orEmpty())
  fun s400Bindkey():String?=values.getString("s400_bindkey",null)
  private fun profilePrefix(owner:ProductSession):String {
    val identity=listOf(owner.apiBase.trimEnd('/'),owner.accountId,owner.subjectId).joinToString("\u0000")
    val digest=MessageDigest.getInstance("SHA-256").digest(identity.toByteArray()).joinToString(""){"%02x".format(it)}
    return "profile_${digest}_"
  }

  // The encryption key for a physical S400 belongs to the device. Body measurements
  // derived from a person's height, date of birth and sex belong to the Life subject.
  fun bodyProfile(owner:ProductSession):ScaleProfileSettings {
    val prefix=if(accountProfiles)profilePrefix(owner) else ""
    return ScaleProfileSettings(values.getString(prefix+"sex","").orEmpty(),values.getString(prefix+"birth_date","").orEmpty(),
      values.getString(prefix+"height_cm","").orEmpty())
  }

  fun saveBodyProfile(owner:ProductSession,profile:ScaleProfileSettings) {
    val empty=profile.sex.isBlank() && profile.birthDate.isBlank() && profile.heightCm.isBlank()
    require(empty || (profile.profile()?.birthDate?.let{!it.isAfter(LocalDate.now())}==true)){"请填写有效的体成分档案"}
    val prefix=if(accountProfiles)profilePrefix(owner) else ""
    values.edit().apply {
      if(empty)remove(prefix+"sex").remove(prefix+"birth_date").remove(prefix+"height_cm")
      else putString(prefix+"sex",profile.sex).putString(prefix+"birth_date",profile.birthDate).putString(prefix+"height_cm",profile.heightCm)
    }.apply()
  }

  fun saveS400Bindkey(value:String) {
    val key=value.trim().lowercase()
    require(key.isEmpty()||Regex("[0-9a-f]{32}").matches(key))
    values.edit().putString("s400_bindkey",key).apply()
  }

  fun save(value:ScaleProfileSettings){
    require(value.sex.isBlank()||value.sex in setOf("male","female")){"请选择性别"}
    if(value.birthDate.isNotBlank())require(runCatching{LocalDate.parse(value.birthDate)}.isSuccess){"生日格式应为 YYYY-MM-DD"}
    if(value.heightCm.isNotBlank())require(value.heightCm.toDoubleOrNull()?.let{it in 50.0..250.0}==true){"身高应为 50–250 cm"}
    require(value.s400Bindkey.isBlank()||value.hasS400Key){"S400 bindkey 应为 32 位十六进制"}
    values.edit().putString("sex",value.sex).putString("birth_date",value.birthDate.trim()).putString("height_cm",value.heightCm.trim()).putString("s400_bindkey",value.s400Bindkey.trim().lowercase()).apply()
  }
}
