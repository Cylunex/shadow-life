package com.shadow.life

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.app.usage.UsageEvents
import android.content.Context
import android.os.Process
import java.time.LocalDate
import java.time.ZoneId
import java.time.Instant
import java.security.MessageDigest
import org.json.JSONObject

internal fun readUsage(context:Context,date:LocalDate):List<JSONObject>{
  val ops=context.getSystemService(AppOpsManager::class.java)
  check(ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS,Process.myUid(),context.packageName)==AppOpsManager.MODE_ALLOWED){"请先授予应用使用情况访问权限"}
  val zone=ZoneId.systemDefault();val from=date.atStartOfDay(zone).toInstant().toEpochMilli();val to=minOf(date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli(),System.currentTimeMillis())
  val manager=context.getSystemService(UsageStatsManager::class.java);val source=manager.queryEvents(from-86_400_000,to)?:error("设备尚未解锁，使用事件不可读取")
  val events=mutableListOf<AppUsageEvent>();val event=UsageEvents.Event()
  while(source.hasNextEvent()){source.getNextEvent(event);when(event.eventType){
    UsageEvents.Event.ACTIVITY_RESUMED->events+=AppUsageEvent(event.timeStamp,event.packageName.orEmpty(),resumed=true)
    UsageEvents.Event.ACTIVITY_PAUSED->events+=AppUsageEvent(event.timeStamp,event.packageName.orEmpty())
    UsageEvents.Event.SCREEN_NON_INTERACTIVE,UsageEvents.Event.DEVICE_SHUTDOWN->events+=AppUsageEvent(event.timeStamp,"",screenOff=true)
  }}
  return appUsageIntervals(events,from,to).map{value->
    val key="${value.packageName}:${value.start}:${value.end}";val hash=MessageDigest.getInstance("SHA-256").digest(key.toByteArray()).joinToString(""){"%02x".format(it)}
    JSONObject().put("app_category",runCatching{when(context.packageManager.getApplicationInfo(value.packageName,0).category){android.content.pm.ApplicationInfo.CATEGORY_PRODUCTIVITY->"productivity";android.content.pm.ApplicationInfo.CATEGORY_NEWS->"news";android.content.pm.ApplicationInfo.CATEGORY_SOCIAL->"social";android.content.pm.ApplicationInfo.CATEGORY_AUDIO->"audio";android.content.pm.ApplicationInfo.CATEGORY_VIDEO->"video";android.content.pm.ApplicationInfo.CATEGORY_GAME->"game";android.content.pm.ApplicationInfo.CATEGORY_MAPS->"maps";else->"unknown"}}.getOrDefault("unknown")).put("source_id","usage_$hash").put("kind","app_usage").put("title",value.packageName.take(200)).put("app_package",value.packageName).put("started_at",Instant.ofEpochMilli(value.start).toString()).put("ended_at",Instant.ofEpochMilli(value.end).toString()).put("time_zone",zone.id)
  }
}
