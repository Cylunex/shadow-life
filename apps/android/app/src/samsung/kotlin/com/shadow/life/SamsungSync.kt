package com.shadow.life

import android.app.Activity
import android.content.Context
import android.util.Log
import android.widget.Toast
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import com.samsung.android.sdk.health.data.HealthDataService
import com.samsung.android.sdk.health.data.HealthDataStore
import com.samsung.android.sdk.health.data.permission.AccessType
import com.samsung.android.sdk.health.data.permission.Permission
import com.samsung.android.sdk.health.data.request.DataType
import com.samsung.android.sdk.health.data.request.DataTypes
import com.samsung.android.sdk.health.data.request.LocalDateFilter
import com.samsung.android.sdk.health.data.request.LocalDateGroup
import com.samsung.android.sdk.health.data.request.LocalDateGroupUnit
import com.samsung.android.sdk.health.data.request.LocalTimeFilter
import com.samsung.android.sdk.health.data.request.LocalTimeGroup
import com.samsung.android.sdk.health.data.request.LocalTimeGroupUnit
import java.math.BigDecimal
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

object SamsungSync {
  private val scope=CoroutineScope(Dispatchers.Main)
  @JvmField val PERMISSIONS:Set<Permission> = setOf(
    Permission.of(DataTypes.STEPS,AccessType.READ),Permission.of(DataTypes.SLEEP,AccessType.READ),Permission.of(DataTypes.HEART_RATE,AccessType.READ),Permission.of(DataTypes.EXERCISE,AccessType.READ),Permission.of(DataTypes.BODY_COMPOSITION,AccessType.READ)
  )
  @JvmStatic fun enable(activity:Activity,accountId:String){scope.launch{status(activity).updateSamsung(accountId,"authorizing","正在请求 Samsung Health 权限");try{val store=HealthDataService.getStore(activity.applicationContext);var granted=store.getGrantedPermissions(PERMISSIONS);if(!granted.containsAll(PERMISSIONS))granted=store.requestPermissions(PERMISSIONS,activity);if(granted.isEmpty()){status(activity).updateSamsung(accountId,"needs_permission","尚未授权，点此重新连接");Toast.makeText(activity,"未授予 Samsung Health 读取权限",Toast.LENGTH_LONG).show();return@launch};status(activity).updateSamsung(accountId,"syncing","权限已就绪，正在读取");schedule(activity,accountId);Toast.makeText(activity,"Samsung Health 同步已启动",Toast.LENGTH_SHORT).show()}catch(error:Exception){Log.w("SamsungSync","Samsung Health connection failed",error);status(activity).updateSamsung(accountId,"error","连接失败：${error.message?:"未知错误"}");Toast.makeText(activity,"Samsung Health 连接失败：${error.message}",Toast.LENGTH_LONG).show()}}}
  @JvmStatic fun startIfAuthorized(context:Context,accountId:String){scope.launch{try{val granted=HealthDataService.getStore(context.applicationContext).getGrantedPermissions(PERMISSIONS);if(granted.isEmpty()){status(context).updateSamsung(accountId,"needs_permission","尚未授权，点此连接");return@launch};status(context).updateSamsung(accountId,"syncing","已自动启动同步");schedule(context,accountId)}catch(error:Exception){Log.w("SamsungSync","automatic Samsung sync unavailable",error);status(context).updateSamsung(accountId,"error","自动同步启动失败：${error.message?:"未知错误"}")}}}
  private fun schedule(context:Context,accountId:String){val data=workDataOf("account_id" to accountId);val constraints=Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build();val work=WorkManager.getInstance(context);work.enqueueUniquePeriodicWork("shadow-samsung-$accountId",ExistingPeriodicWorkPolicy.UPDATE,PeriodicWorkRequestBuilder<SamsungSyncWorker>(1,TimeUnit.HOURS).setInputData(data).setConstraints(constraints).build());work.enqueueUniqueWork("shadow-samsung-now-$accountId",ExistingWorkPolicy.KEEP,OneTimeWorkRequestBuilder<SamsungSyncWorker>().setInputData(data).setConstraints(constraints).build())}
  private fun status(context:Context)=(context.applicationContext as ShadowApp).deviceSync
}

class SamsungSyncWorker(context:Context,params:WorkerParameters):CoroutineWorker(context,params){
  override suspend fun doWork():Result {
    val accountId=inputData.getString("account_id")?:return Result.failure();val app=applicationContext as ShadowApp;val status=app.deviceSync;val session=app.sessions.active()?.takeIf{it.accountId==accountId}?:run{status.updateSamsung(accountId,"error","登录已失效，无法同步");return Result.failure()}
    status.updateSamsung(accountId,"syncing","正在读取 Samsung Health")
    return try{val store=HealthDataService.getStore(applicationContext);val granted=store.getGrantedPermissions(SamsungSync.PERMISSIONS);if(granted.isEmpty()){status.updateSamsung(accountId,"needs_permission","权限已撤销，点此重新连接");return Result.success(workDataOf("reason" to "permissions_required"))};val now=System.currentTimeMillis();val prefs=applicationContext.getSharedPreferences("samsung-health-sync",Context.MODE_PRIVATE);val last=prefs.getLong("last_sync_$accountId",0);val days=if(last==0L)7 else (((now-last)/86_400_000L).toInt()+2).coerceIn(2,30);val end=LocalDate.now();val start=end.minusDays((days-1).toLong());val healthConnectPermissions=if(HealthConnectSync.available(applicationContext))HealthConnectClient.getOrCreate(applicationContext).permissionController.getGrantedPermissions() else emptySet();val commands=readCommands(store,session,start,end,now,granted,healthConnectPermissions);commands.forEach{app.queue.enqueueCommand(session,it.commandId,it.capability,it.body)};if(commands.isNotEmpty())SyncScheduler.schedule(applicationContext,accountId);prefs.edit().putLong("last_sync_$accountId",now).apply();status.updateSamsung(accountId,if(commands.isEmpty())"complete" else "queued",if(commands.isEmpty())"读取完成，暂无新数据" else "已读取 ${commands.size} 条，正在上传",commands.size);Log.i("SamsungSyncWorker","Samsung read completed records=${commands.size}");Result.success(workDataOf("records" to commands.size))}catch(error:Exception){Log.w("SamsungSyncWorker","Samsung read failed",error);status.updateSamsung(accountId,"error","读取失败：${error.message?:"未知错误"}");Result.retry()}
  }

  private suspend fun readCommands(store:HealthDataStore,session:ProductSession,start:LocalDate,end:LocalDate,version:Long,samsungPermissions:Set<Permission>,healthConnectPermissions:Set<String>):List<HealthQueuedCommand>{
    val out=mutableListOf<HealthQueuedCommand>();val zone=ZoneId.systemDefault();val instance="android-samsung-${sha256(android.provider.Settings.Secure.getString(applicationContext.contentResolver,android.provider.Settings.Secure.ANDROID_ID)?:"unknown").take(24)}";val fingerprint=sha256(samsungPermissions.map{it.toString()}.sorted().joinToString("|"));val timeFilter=LocalTimeFilter.of(start.atStartOfDay(),end.plusDays(1).atStartOfDay())
    fun add(type:String,id:String,payload:JSONObject){out+=healthDeviceRecordCommand(session.accountId,session.subjectId,"samsung",instance,fingerprint,type,id,version,payload,"samsung-data-1")}
    if(Permission.of(DataTypes.STEPS,AccessType.READ) in samsungPermissions && HealthPermission.getReadPermission(StepsRecord::class) !in healthConnectPermissions)runCatching{val request=DataType.StepsType.TOTAL.requestBuilder.setLocalTimeFilterWithGroup(timeFilter,LocalTimeGroup.of(LocalTimeGroupUnit.DAILY,1)).build();store.aggregateData(request).dataList.forEach{point->point.value?.takeIf{it>0}?.let{steps->val day=point.getStartLocalDateTime().toLocalDate();add("daily_activity","samsung-steps-$day",JSONObject().put("occurred_on",day.toString()).put("time_zone",zone.id).put("steps",steps).put("field_sources",JSONObject().put("steps","samsung_data_sdk")))}}}.onFailure{Log.w("SamsungSyncWorker","steps read failed",it)}
    if(Permission.of(DataTypes.HEART_RATE,AccessType.READ) in samsungPermissions)runCatching{val dateFilter=LocalDateFilter.of(start,end,true,true);val daily=LocalDateGroup.of(LocalDateGroupUnit.DAILY,1);val mins=store.aggregateData(DataType.HeartRateType.MIN.requestBuilder.setLocalDateFilterWithGroup(dateFilter,daily).build()).dataList.associate{it.getStartLocalDateTime().toLocalDate() to it.value};val maxes=store.aggregateData(DataType.HeartRateType.MAX.requestBuilder.setLocalDateFilterWithGroup(dateFilter,daily).build()).dataList.associate{it.getStartLocalDateTime().toLocalDate() to it.value};(mins.keys+maxes.keys).forEach{day->val observations=JSONArray();mins[day]?.let{observations.put(observation("heart_rate",decimal(it.toDouble()),"bpm","samsung:daily_min"))};maxes[day]?.let{observations.put(observation("heart_rate",decimal(it.toDouble()),"bpm","samsung:daily_max"))};if(observations.length()>0)add("body","samsung-heart-$day",bodyPayload(day,null,zone,observations))}}.onFailure{Log.w("SamsungSyncWorker","heart rate read failed",it)}
    if(Permission.of(DataTypes.SLEEP,AccessType.READ) in samsungPermissions && HealthPermission.getReadPermission(SleepSessionRecord::class) !in healthConnectPermissions)runCatching{store.readData(DataTypes.SLEEP.readDataRequestBuilder.setLocalTimeFilter(timeFilter).build()).dataList.forEach{point->val uid=point.uid?:return@forEach;val endTime=point.endTime?:return@forEach;var light=0L;var deep=0L;var rem=0L;var awake=0L;point.getValue(DataType.SleepType.SESSIONS)?.forEach{sessionPoint->sessionPoint.stages?.forEach{stage->val minutes=Duration.between(stage.startTime,stage.endTime).toMinutes();when(stage.stage){DataType.SleepType.StageType.LIGHT->light+=minutes;DataType.SleepType.StageType.DEEP->deep+=minutes;DataType.SleepType.StageType.REM->rem+=minutes;DataType.SleepType.StageType.AWAKE->awake+=minutes;else->Unit}}};val total=point.getValue(DataType.SleepType.DURATION)?.toMinutes()?:Duration.between(point.startTime,endTime).toMinutes();val wake=Instant.parse(endTime.toString()).atZone(zone).toLocalDate();add("sleep","samsung-sleep-$uid",JSONObject().put("wake_date",wake.toString()).put("time_zone",zone.id).put("started_at",point.startTime.toString()).put("ended_at",endTime.toString()).put("total_minutes",total).put("light_minutes",light).put("deep_minutes",deep).put("rem_minutes",rem).put("awake_minutes",awake))}}.onFailure{Log.w("SamsungSyncWorker","sleep read failed",it)}
    if(Permission.of(DataTypes.EXERCISE,AccessType.READ) in samsungPermissions && HealthPermission.getReadPermission(ExerciseSessionRecord::class) !in healthConnectPermissions)runCatching{store.readData(DataTypes.EXERCISE.readDataRequestBuilder.setLocalTimeFilter(timeFilter).build()).dataList.forEach{point->val uid=point.uid?:return@forEach;val started=Instant.parse(point.startTime.toString());val sessionPoint=point.getValue(DataType.ExerciseType.SESSIONS)?.firstOrNull();val predefined=point.getValue(DataType.ExerciseType.EXERCISE_TYPE);val type=predefined?.name?.lowercase()?.takeUnless{it in setOf("undefined","other") }?:point.getValue(DataType.ExerciseType.CUSTOM_TITLE)?.trim()?.lowercase()?.takeIf{it.isNotBlank()}?:"other";val payload=JSONObject().put("occurred_on",started.atZone(zone).toLocalDate().toString()).put("time_zone",zone.id).put("session_type",type).put("started_at",started.toString());sessionPoint?.let{runCatching{it.duration.toMinutes()}.getOrNull()?.let{value->payload.put("duration_minutes",value)};it.distance?.let{value->payload.put("distance_km",decimal(value.toDouble()/1000))};if(it.calories>0)payload.put("calories_kcal",decimal(it.calories.toDouble()));it.meanHeartRate?.let{value->payload.put("heart_rate_avg",value.toInt())}};add("workout","samsung-exercise-$uid",payload)}}.onFailure{Log.w("SamsungSyncWorker","exercise read failed",it)}
    if(Permission.of(DataTypes.BODY_COMPOSITION,AccessType.READ) in samsungPermissions)runCatching{val healthConnectHasWeight=HealthPermission.getReadPermission(WeightRecord::class) in healthConnectPermissions;store.readData(DataTypes.BODY_COMPOSITION.readDataRequestBuilder.setLocalTimeFilter(timeFilter).build()).dataList.forEach{point->val observations=JSONArray();if(!healthConnectHasWeight)point.getValue(DataType.BodyCompositionType.WEIGHT)?.let{observations.put(observation("weight",decimal(it.toDouble()),"kg","samsung:weight"))};point.getValue(DataType.BodyCompositionType.BODY_FAT)?.let{observations.put(observation("body_fat",decimal(it.toDouble()),"%","samsung:body_fat"))};(point.getValue(DataType.BodyCompositionType.SKELETAL_MUSCLE_MASS)?:point.getValue(DataType.BodyCompositionType.SKELETAL_MUSCLE))?.let{observations.put(observation("skeletal_muscle",decimal(it.toDouble()),"kg","samsung:skeletal_muscle"))};point.getValue(DataType.BodyCompositionType.MUSCLE_MASS)?.let{observations.put(observation("muscle_mass",decimal(it.toDouble()),"kg","samsung:muscle_mass"))};point.getValue(DataType.BodyCompositionType.TOTAL_BODY_WATER)?.let{observations.put(observation("body_water",decimal(it.toDouble()),"kg","samsung:body_water"))};point.getValue(DataType.BodyCompositionType.BASAL_METABOLIC_RATE)?.let{observations.put(observation("bmr",decimal(it.toDouble()),"kcal/day","samsung:bmr"))};if(observations.length()>0){val instant=Instant.parse(point.startTime.toString());add("body","samsung-body-${point.uid?:instant.toEpochMilli()}",bodyPayload(instant.atZone(zone).toLocalDate(),instant,zone,observations))}}}.onFailure{Log.w("SamsungSyncWorker","body composition read failed",it)}
    return out
  }
  private fun bodyPayload(date:LocalDate,instant:Instant?,zone:ZoneId,observations:JSONArray)=JSONObject().put("occurred_on",date.toString()).apply{if(instant!=null)put("occurred_at",instant.toString())}.put("time_zone",zone.id).put("group_kind","measurement").put("observations",observations)
  private fun observation(metric:String,value:String,unit:String,source:String)=JSONObject().put("metric_key",metric).put("value",value).put("unit",unit).put("original_field",source).put("autofilled",false)
  private fun decimal(value:Double)=BigDecimal.valueOf(value).stripTrailingZeros().toPlainString()
  private fun sha256(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString(""){"%02x".format(it)}
}
