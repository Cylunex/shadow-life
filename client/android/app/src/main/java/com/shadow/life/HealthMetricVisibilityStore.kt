package com.shadow.life

import android.content.Context

internal fun decodeHiddenHealthMetrics(raw:String?):Set<String> = raw?.split(',')?.map(String::trim)?.filter{it.matches(Regex("[a-z][a-z0-9_]{0,99}"))}?.toSet().orEmpty()

internal class HealthMetricVisibilityStore(context:Context,accountId:String){
  private val preferences=context.applicationContext.getSharedPreferences("life_health_metric_visibility",Context.MODE_PRIVATE)
  private val key="hidden:$accountId"
  fun hidden():Set<String> = decodeHiddenHealthMetrics(preferences.getString(key,null))
  fun save(hidden:Set<String>){preferences.edit().putString(key,hidden.sorted().joinToString(",")).apply()}
}
