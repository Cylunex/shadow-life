package com.shadow.life

import android.app.Activity
import android.content.Context
import android.util.Base64
import android.util.Log
import android.widget.Toast
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
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
import com.samsung.android.sdk.health.data.HealthDataService
import com.samsung.android.sdk.health.data.HealthDataStore
import com.samsung.android.sdk.health.data.data.AggregatedData
import com.samsung.android.sdk.health.data.data.HealthDataPoint
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
import com.samsung.android.sdk.health.data.request.ReadDataRequest
import java.math.BigDecimal
import java.math.RoundingMode
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

object SamsungSync {
  private val scope=CoroutineScope(Dispatchers.Main)
  private val readableTypes=listOf(
    DataTypes.STEPS,DataTypes.ACTIVITY_SUMMARY,DataTypes.SLEEP,DataTypes.HEART_RATE,
    DataTypes.EXERCISE,DataTypes.EXERCISE_LOCATION,DataTypes.SKIN_TEMPERATURE,
    DataTypes.BLOOD_OXYGEN,DataTypes.FLOORS_CLIMBED,DataTypes.BLOOD_GLUCOSE,
    DataTypes.BLOOD_PRESSURE,DataTypes.BODY_COMPOSITION,DataTypes.SLEEP_GOAL,
    DataTypes.STEPS_GOAL,DataTypes.ACTIVE_CALORIES_BURNED_GOAL,DataTypes.ACTIVE_TIME_GOAL,
    DataTypes.WATER_INTAKE,DataTypes.WATER_INTAKE_GOAL,DataTypes.NUTRITION,
    DataTypes.NUTRITION_GOAL,DataTypes.ENERGY_SCORE,DataTypes.USER_PROFILE,
    DataTypes.SLEEP_APNEA,DataTypes.IRREGULAR_HEART_RHYTHM_NOTIFICATION,DataTypes.BODY_TEMPERATURE
  )
  @JvmField val PERMISSIONS:Set<Permission> = readableTypes.mapTo(linkedSetOf()){Permission.of(it,AccessType.READ)}

  @JvmStatic fun enable(activity:Activity,accountId:String){scope.launch{
    status(activity).updateSamsung(accountId,"authorizing","正在请求 Samsung Health 全量读取权限")
    try{
      val store=HealthDataService.getStore(activity.applicationContext)
      var granted=store.getGrantedPermissions(PERMISSIONS)
      if(!granted.containsAll(PERMISSIONS))granted=store.requestPermissions(PERMISSIONS,activity)
      if(granted.isEmpty()){
        status(activity).updateSamsung(accountId,"needs_permission","尚未授权，点此重新连接")
        Toast.makeText(activity,"未授予 Samsung Health 读取权限",Toast.LENGTH_LONG).show()
        return@launch
      }
      val missing=PERMISSIONS.size-granted.size
      status(activity).updateSamsung(accountId,"syncing",if(missing==0)"权限已就绪，正在完整读取" else "已授权 ${granted.size}/${PERMISSIONS.size} 类，正在读取")
      schedule(activity,accountId)
      Toast.makeText(activity,if(missing==0)"Samsung Health 全量同步已启动" else "已按现有授权启动，仍有 $missing 类未授权",Toast.LENGTH_SHORT).show()
    }catch(error:Exception){
      Log.w("SamsungSync","Samsung Health connection failed",error)
      status(activity).updateSamsung(accountId,"error","连接失败：${error.message?:"未知错误"}")
      Toast.makeText(activity,"Samsung Health 连接失败：${error.message}",Toast.LENGTH_LONG).show()
    }
  }}

  @JvmStatic fun startIfAuthorized(context:Context,accountId:String){scope.launch{
    try{
      val granted=withContext(Dispatchers.IO){HealthDataService.getStore(context.applicationContext).getGrantedPermissions(PERMISSIONS)}
      if(granted.isEmpty()){
        status(context).updateSamsung(accountId,"needs_permission","尚未授权，点此连接")
        return@launch
      }
      status(context).updateSamsung(accountId,"syncing","已自动启动 Samsung Health 同步")
      schedule(context,accountId,2)
    }catch(error:Exception){
      Log.w("SamsungSync","automatic Samsung sync unavailable",error)
      status(context).updateSamsung(accountId,"error","自动同步启动失败：${error.message?:"未知错误"}")
    }
  }}

  private fun schedule(context:Context,accountId:String,initialDelaySeconds:Long=0){
    val data=workDataOf("account_id" to accountId)
    val constraints=Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
    val work=WorkManager.getInstance(context)
    work.enqueueUniquePeriodicWork("shadow-samsung-$accountId",ExistingPeriodicWorkPolicy.UPDATE,PeriodicWorkRequestBuilder<SamsungSyncWorker>(1,TimeUnit.HOURS).setInputData(data).setConstraints(constraints).build())
    val immediate=OneTimeWorkRequestBuilder<SamsungSyncWorker>().setInputData(data).setConstraints(constraints).apply{if(initialDelaySeconds>0)setInitialDelay(initialDelaySeconds,TimeUnit.SECONDS)}.build()
    work.enqueueUniqueWork("shadow-samsung-now-$accountId",ExistingWorkPolicy.KEEP,immediate)
  }
  private fun status(context:Context)=(context.applicationContext as ShadowApp).deviceSync
}

private data class SamsungReadResult(val commandCount:Int,val failedTypes:Set<String>)

class SamsungSyncWorker(context:Context,params:WorkerParameters):CoroutineWorker(context,params){
  override suspend fun doWork():Result {
    if(!workerMutex.tryLock()){
      Log.i("SamsungSyncWorker","another Samsung read is already active; skipping duplicate worker")
      return Result.success(workDataOf("reason" to "already_running"))
    }
    try{return runSync()}finally{workerMutex.unlock()}
  }

  private suspend fun runSync():Result {
    val accountId=inputData.getString("account_id")?:return Result.failure()
    val app=applicationContext as ShadowApp
    val status=app.deviceSync
    val session=app.sessions.active()?.takeIf{it.accountId==accountId}?:run{
      status.updateSamsung(accountId,"error","登录已失效，无法同步")
      return Result.failure()
    }
    status.updateSamsung(accountId,"syncing","正在分页读取 Samsung Health")
    return try{
      val store=HealthDataService.getStore(applicationContext)
      val granted=store.getGrantedPermissions(SamsungSync.PERMISSIONS)
      if(granted.isEmpty()){
        status.updateSamsung(accountId,"needs_permission","权限已撤销，点此重新连接")
        return Result.success(workDataOf("reason" to "permissions_required"))
      }
      val now=System.currentTimeMillis()
      val prefs=applicationContext.getSharedPreferences("samsung-health-sync",Context.MODE_PRIVATE)
      val last=prefs.getLong("last_sync_$accountId",0)
      val permissionFingerprint=sha256(granted.map{it.toString()}.sorted().joinToString("|"))
      val permissionsChanged=prefs.getString("permission_fingerprint_$accountId",null)!=permissionFingerprint
      val days=if(last==0L||permissionsChanged)30 else (((now-last)/86_400_000L).toInt()+2).coerceIn(2,30)
      val end=LocalDate.now()
      val start=end.minusDays((days-1).toLong())
      val healthConnectPermissions=if(HealthConnectSync.available(applicationContext))HealthConnectClient.getOrCreate(applicationContext).permissionController.getGrantedPermissions() else emptySet()
      val read=readCommands(store,session,start,end,now,granted,healthConnectPermissions){command->app.queue.enqueueCommand(session,command.commandId,command.capability,command.body)}
      if(read.commandCount>0)SyncScheduler.schedule(applicationContext,accountId)
      val missing=SamsungSync.PERMISSIONS.size-granted.size
      if(read.failedTypes.isEmpty())prefs.edit().putLong("last_sync_$accountId",now).putString("permission_fingerprint_$accountId",permissionFingerprint).apply()
      val state=if(missing>0||read.failedTypes.isNotEmpty())"needs_permission" else if(read.commandCount==0)"complete" else "queued"
      val message=when{
        read.failedTypes.isNotEmpty()->"已读取 ${read.commandCount} 条；${read.failedTypes.size} 类暂时失败，将自动重试"
        missing>0->"已读取 ${read.commandCount} 条；仍有 $missing 类权限未授予"
        read.commandCount==0->"读取完成，暂无新数据"
        else->"已完整读取 ${read.commandCount} 条，正在上传"
      }
      status.updateSamsung(accountId,state,message,read.commandCount)
      Log.i("SamsungSyncWorker","Samsung read completed records=${read.commandCount} granted=${granted.size}/${SamsungSync.PERMISSIONS.size} failed=${read.failedTypes.joinToString()}")
      Result.success(workDataOf("records" to read.commandCount,"failed_types" to read.failedTypes.size,"missing_permissions" to missing))
    }catch(error:CancellationException){
      throw error
    }catch(error:Exception){
      Log.w("SamsungSyncWorker","Samsung read failed",error)
      status.updateSamsung(accountId,"error","读取失败：${error.message?:"未知错误"}")
      Result.retry()
    }
  }

  private suspend fun readCommands(store:HealthDataStore,session:ProductSession,start:LocalDate,end:LocalDate,version:Long,samsungPermissions:Set<Permission>,healthConnectPermissions:Set<String>,enqueue:suspend(HealthQueuedCommand)->Long):SamsungReadResult{
    var commandCount=0
    val failed=linkedSetOf<String>()
    val zone=ZoneId.systemDefault()
    val instance="android-samsung-${sha256(android.provider.Settings.Secure.getString(applicationContext.contentResolver,android.provider.Settings.Secure.ANDROID_ID)?:"unknown").take(24)}"
    val fingerprint=sha256(samsungPermissions.map{it.toString()}.sorted().joinToString("|"))
    val timeFilter=LocalTimeFilter.of(start.atStartOfDay(),end.plusDays(1).atStartOfDay())
    val dateFilter=LocalDateFilter.of(start,end,true,true)
    suspend fun add(type:String,id:String,payload:JSONObject,recordVersion:Long=version){
      val command=healthDeviceRecordCommand(session.accountId,session.subjectId,"samsung",instance,fingerprint,type,id,recordVersion,payload,SAMSUNG_PARSE_VERSION)
      if(enqueue(command)>=0)commandCount++
    }
    fun pointVersion(point:HealthDataPoint)=(point.updateTime?:point.endTime?:point.startTime)?.toEpochMilli()?:version
    fun dailyVersion(day:LocalDate)=if(day==end)version else day.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
    fun permitted(type:DataType)=Permission.of(type,AccessType.READ) in samsungPermissions
    suspend fun attempt(type:DataType,block:suspend()->Unit){
      if(!permitted(type))return
      try{block()}catch(error:CancellationException){throw error}catch(error:Exception){failed+=type.name;Log.w("SamsungSyncWorker","${type.name} read failed",error)}
    }
    suspend fun archive(type:DataType,point:HealthDataPoint){
      val payload=samsungHealthPointPayload(type,point)
      val identity=point.uid?:sha256(payload.toString()).take(32)
      val clientId="samsung-archive-${typeKey(type)}-$identity"
      val encoded=payload.toString()
      val recordVersion=pointVersion(point)
      if(encoded.toByteArray(Charsets.UTF_8).size<=600_000)add("archive",clientId,payload,recordVersion)
      else{
        // Exercise routes can approach the SDK's 1 MB compressed limit. Keep each
        // command safely below the API envelope limit. Base64 keeps chunk boundaries
        // byte-exact even when comments or custom titles contain supplementary Unicode.
        val chunks=Base64.encodeToString(encoded.toByteArray(Charsets.UTF_8),Base64.NO_WRAP).chunked(300_000)
        chunks.forEachIndexed{index,chunk->add("archive","$clientId-part-${index+1}",JSONObject()
          .put("samsung_data_type",type.name).put("sdk_schema_version",SAMSUNG_SDK_SCHEMA_VERSION)
          .put("archive_encoding","chunked-base64-json-utf8").put("archive_identity",identity)
          .put("chunk_index",index).put("chunk_count",chunks.size).put("content",chunk),recordVersion)}
      }
    }
    suspend fun archiveAggregates(type:DataType,operation:String,points:List<AggregatedData<*>>){points.forEach{point->
      val day=point.getStartLocalDateTime().toLocalDate()
      add("archive","samsung-aggregate-${typeKey(type)}-$operation-$day",samsungAggregatePayload(type,operation,point.startTime?.toString(),point.endTime?.toString(),point.value),dailyVersion(day))
    }}

    val activity=mutableMapOf<LocalDate,JSONObject>()
    fun activityPayload(day:LocalDate)=activity.getOrPut(day){JSONObject().put("occurred_on",day.toString()).put("time_zone",zone.id).put("field_sources",JSONObject())}
    attempt(DataTypes.STEPS){
      val points=store.aggregateData(DataType.StepsType.TOTAL.requestBuilder.setLocalTimeFilterWithGroup(timeFilter,LocalTimeGroup.of(LocalTimeGroupUnit.DAILY,1)).build()).dataList
      archiveAggregates(DataTypes.STEPS,"total",points)
      if(HealthPermission.getReadPermission(StepsRecord::class) !in healthConnectPermissions)points.forEach{point->point.value?.takeIf{it>0}?.let{steps->
        val payload=activityPayload(point.getStartLocalDateTime().toLocalDate());payload.put("steps",steps);payload.getJSONObject("field_sources").put("steps","samsung_data_sdk")
      }}
    }
    attempt(DataTypes.ACTIVITY_SUMMARY){
      val group=LocalTimeGroup.of(LocalTimeGroupUnit.DAILY,1)
      val activeTime=store.aggregateData(DataType.ActivitySummaryType.TOTAL_ACTIVE_TIME.requestBuilder.setLocalTimeFilterWithGroup(timeFilter,group).build()).dataList
      val activeCalories=store.aggregateData(DataType.ActivitySummaryType.TOTAL_ACTIVE_CALORIES_BURNED.requestBuilder.setLocalTimeFilterWithGroup(timeFilter,group).build()).dataList
      val totalCalories=store.aggregateData(DataType.ActivitySummaryType.TOTAL_CALORIES_BURNED.requestBuilder.setLocalTimeFilterWithGroup(timeFilter,group).build()).dataList
      val distance=store.aggregateData(DataType.ActivitySummaryType.TOTAL_DISTANCE.requestBuilder.setLocalTimeFilterWithGroup(timeFilter,group).build()).dataList
      archiveAggregates(DataTypes.ACTIVITY_SUMMARY,"total_active_time",activeTime);archiveAggregates(DataTypes.ACTIVITY_SUMMARY,"total_active_calories_burned",activeCalories)
      archiveAggregates(DataTypes.ACTIVITY_SUMMARY,"total_calories_burned",totalCalories);archiveAggregates(DataTypes.ACTIVITY_SUMMARY,"total_distance",distance)
      activeTime.forEach{point->point.value?.toMinutes()?.takeIf{it>0}?.let{minutes->val payload=activityPayload(point.getStartLocalDateTime().toLocalDate());payload.put("active_minutes",minutes);payload.getJSONObject("field_sources").put("active_minutes","samsung_data_sdk")}}
      activeCalories.forEach{point->point.value?.takeIf{it>0}?.let{calories->val payload=activityPayload(point.getStartLocalDateTime().toLocalDate());payload.put("device_calories_kcal",decimal(calories.toDouble()));payload.getJSONObject("field_sources").put("device_calories_kcal","samsung_data_sdk")}}
    }
    for((day,payload) in activity.toSortedMap())add("daily_activity","samsung-activity-$day",payload,dailyVersion(day))

    attempt(DataTypes.HEART_RATE){
      forEachDual(store,DataTypes.HEART_RATE,timeFilter){archive(DataTypes.HEART_RATE,it)}
      val daily=LocalDateGroup.of(LocalDateGroupUnit.DAILY,1)
      val mins=store.aggregateData(DataType.HeartRateType.MIN.requestBuilder.setLocalDateFilterWithGroup(dateFilter,daily).build()).dataList.associate{it.getStartLocalDateTime().toLocalDate() to it.value}
      val maxes=store.aggregateData(DataType.HeartRateType.MAX.requestBuilder.setLocalDateFilterWithGroup(dateFilter,daily).build()).dataList.associate{it.getStartLocalDateTime().toLocalDate() to it.value}
      (mins.keys+maxes.keys).forEach{day->val observations=JSONArray();mins[day]?.let{observations.put(observation("heart_rate",decimal(it.toDouble()),"bpm","samsung:daily_min"))};maxes[day]?.let{observations.put(observation("heart_rate",decimal(it.toDouble()),"bpm","samsung:daily_max"))};if(observations.length()>0)add("body","samsung-heart-$day",bodyPayload(day,null,zone,observations),dailyVersion(day))}
    }

    attempt(DataTypes.SLEEP){forEachDual(store,DataTypes.SLEEP,timeFilter){point->
      archive(DataTypes.SLEEP,point)
      if(HealthPermission.getReadPermission(SleepSessionRecord::class) in healthConnectPermissions)return@forEachDual
      val uid=point.uid?:return@forEachDual;val endTime=point.endTime?:return@forEachDual;var light=0L;var deep=0L;var rem=0L;var awake=0L
      point.getValue(DataType.SleepType.SESSIONS)?.forEach{sessionPoint->sessionPoint.stages?.forEach{stage->val minutes=Duration.between(stage.startTime,stage.endTime).toMinutes();when(stage.stage){DataType.SleepType.StageType.LIGHT->light+=minutes;DataType.SleepType.StageType.DEEP->deep+=minutes;DataType.SleepType.StageType.REM->rem+=minutes;DataType.SleepType.StageType.AWAKE->awake+=minutes;else->Unit}}}
      val total=point.getValue(DataType.SleepType.DURATION)?.toMinutes()?:Duration.between(point.startTime,endTime).toMinutes();val wake=endTime.atZone(zone).toLocalDate()
      add("sleep","samsung-sleep-$uid",JSONObject().put("wake_date",wake.toString()).put("time_zone",zone.id).put("started_at",point.startTime.toString()).put("ended_at",endTime.toString()).put("total_minutes",total).put("light_minutes",light).put("deep_minutes",deep).put("rem_minutes",rem).put("awake_minutes",awake),pointVersion(point))
    }}

    attempt(DataTypes.EXERCISE){forEachDual(store,DataTypes.EXERCISE,timeFilter){point->
      archive(DataTypes.EXERCISE,point)
      if(HealthPermission.getReadPermission(ExerciseSessionRecord::class) in healthConnectPermissions)return@forEachDual
      val uid=point.uid?:return@forEachDual;val started=point.startTime?:return@forEachDual;val sessionPoint=point.getValue(DataType.ExerciseType.SESSIONS)?.firstOrNull();val predefined=point.getValue(DataType.ExerciseType.EXERCISE_TYPE);val customTitle=point.getValue(DataType.ExerciseType.CUSTOM_TITLE)?.trim()?.takeIf{it.isNotBlank()};val mapping=samsungExerciseMapping(predefined?.name,customTitle)
      val detail=JSONObject().put("source","samsung_health").putOpt("provider_type",predefined?.name).putOpt("custom_title",customTitle).put("excluded_from_activity",mapping.releaseEvent);sessionPoint?.autoDetected?.let{detail.put("auto_detected",it)}
      val payload=JSONObject().put("occurred_on",started.atZone(zone).toLocalDate().toString()).put("time_zone",zone.id).put("session_type",mapping.sessionType).put("started_at",started.toString()).put("detail",detail)
      sessionPoint?.let{runCatching{it.duration.toMinutes()}.getOrNull()?.let{value->payload.put("duration_minutes",value)};it.distance?.let{value->payload.put("distance_km",decimal(value.toDouble()/1000))};if(it.calories>0)payload.put("calories_kcal",decimal(it.calories.toDouble()));it.meanHeartRate?.let{value->payload.put("heart_rate_avg",value.toInt())}}
      add("workout","samsung-exercise-$uid",payload,pointVersion(point))
    }}

    attempt(DataTypes.BODY_COMPOSITION){forEachDual(store,DataTypes.BODY_COMPOSITION,timeFilter){point->
      archive(DataTypes.BODY_COMPOSITION,point)
      val observations=JSONArray();if(HealthPermission.getReadPermission(WeightRecord::class) !in healthConnectPermissions)point.getValue(DataType.BodyCompositionType.WEIGHT)?.let{observations.put(observation("weight",decimal(it.toDouble()),"kg","samsung:weight"))};point.getValue(DataType.BodyCompositionType.HEIGHT)?.let{observations.put(observation("height",decimal(it.toDouble()),"cm","samsung:height"))};point.getValue(DataType.BodyCompositionType.BODY_MASS_INDEX)?.let{observations.put(observation("bmi",decimal(it.toDouble()),"kg/m²","samsung:bmi"))};point.getValue(DataType.BodyCompositionType.BODY_FAT)?.let{observations.put(observation("body_fat",decimal(it.toDouble()),"%","samsung:body_fat"))};point.getValue(DataType.BodyCompositionType.BODY_FAT_MASS)?.let{observations.put(observation("fat_mass",decimal(it.toDouble()),"kg","samsung:fat_mass"))};(point.getValue(DataType.BodyCompositionType.FAT_FREE_MASS)?:point.getValue(DataType.BodyCompositionType.FAT_FREE))?.let{observations.put(observation("lean_mass",decimal(it.toDouble()),"kg","samsung:lean_mass"))};(point.getValue(DataType.BodyCompositionType.SKELETAL_MUSCLE_MASS)?:point.getValue(DataType.BodyCompositionType.SKELETAL_MUSCLE))?.let{observations.put(observation("skeletal_muscle",decimal(it.toDouble()),"kg","samsung:skeletal_muscle"))};point.getValue(DataType.BodyCompositionType.MUSCLE_MASS)?.let{observations.put(observation("muscle_mass",decimal(it.toDouble()),"kg","samsung:muscle_mass"))};point.getValue(DataType.BodyCompositionType.TOTAL_BODY_WATER)?.let{observations.put(observation("body_water",decimal(it.toDouble()),"kg","samsung:body_water"))};point.getValue(DataType.BodyCompositionType.BASAL_METABOLIC_RATE)?.let{observations.put(observation("bmr",decimal(it.toDouble()),"kcal/day","samsung:bmr"))}
      if(observations.length()>0){val instant=point.startTime?:return@forEachDual;add("body","samsung-body-${point.uid?:instant.toEpochMilli()}",bodyPayload(instant.atZone(zone).toLocalDate(),instant,zone,observations),pointVersion(point))}
    }}

    suspend fun vital(type:DataType.Readable<HealthDataPoint,ReadDataRequest.DualTimeBuilder<HealthDataPoint>>,prefix:String,values:(HealthDataPoint)->JSONArray){
      val dataType=type as DataType
      attempt(dataType){forEachDual(store,type,timeFilter){point->archive(dataType,point);val observations=values(point);if(observations.length()>0){val instant=point.startTime?:return@forEachDual;add("body","samsung-$prefix-${point.uid?:instant.toEpochMilli()}",bodyPayload(instant.atZone(zone).toLocalDate(),instant,zone,observations),pointVersion(point))}}}
    }
    vital(DataTypes.BLOOD_OXYGEN,"oxygen"){point->JSONArray().also{items->point.getValue(DataType.BloodOxygenType.OXYGEN_SATURATION)?.let{items.put(observation("spo2",decimal(it.toDouble()),"%","samsung:oxygen_saturation"))};point.getValue(DataType.BloodOxygenType.MIN_OXYGEN_SATURATION)?.let{items.put(observation("spo2",decimal(it.toDouble()),"%","samsung:min_oxygen_saturation"))};point.getValue(DataType.BloodOxygenType.MAX_OXYGEN_SATURATION)?.let{items.put(observation("spo2",decimal(it.toDouble()),"%","samsung:max_oxygen_saturation"))}}}
    vital(DataTypes.SKIN_TEMPERATURE,"skin-temperature"){point->JSONArray().also{items->point.getValue(DataType.SkinTemperatureType.SKIN_TEMPERATURE)?.let{items.put(observation("temperature",decimal(it.toDouble()),"°C","samsung:skin_temperature"))};point.getValue(DataType.SkinTemperatureType.MIN_SKIN_TEMPERATURE)?.let{items.put(observation("temperature",decimal(it.toDouble()),"°C","samsung:min_skin_temperature"))};point.getValue(DataType.SkinTemperatureType.MAX_SKIN_TEMPERATURE)?.let{items.put(observation("temperature",decimal(it.toDouble()),"°C","samsung:max_skin_temperature"))}}}
    vital(DataTypes.BLOOD_GLUCOSE,"blood-glucose"){point->JSONArray().also{items->point.getValue(DataType.BloodGlucoseType.GLUCOSE_LEVEL)?.let{items.put(observation("blood_glucose",decimal(it.toDouble()),"mmol/L","samsung:glucose_level"))}}}
    vital(DataTypes.BLOOD_PRESSURE,"blood-pressure"){point->JSONArray().also{items->point.getValue(DataType.BloodPressureType.SYSTOLIC)?.let{items.put(observation("blood_pressure_systolic",decimal(it.toDouble()),"mmHg","samsung:systolic"))};point.getValue(DataType.BloodPressureType.DIASTOLIC)?.let{items.put(observation("blood_pressure_diastolic",decimal(it.toDouble()),"mmHg","samsung:diastolic"))};point.getValue(DataType.BloodPressureType.PULSE_RATE)?.let{items.put(observation("heart_rate",it.toString(),"bpm","samsung:pulse_rate"))}}}
    vital(DataTypes.BODY_TEMPERATURE,"body-temperature"){point->JSONArray().also{items->point.getValue(DataType.BodyTemperatureType.BODY_TEMPERATURE)?.let{items.put(observation("temperature",decimal(it.toDouble()),"°C","samsung:body_temperature"))}}}

    val archiveOnlyDual=listOf(
      DataTypes.FLOORS_CLIMBED,DataTypes.WATER_INTAKE,DataTypes.NUTRITION,
      DataTypes.SLEEP_APNEA,DataTypes.IRREGULAR_HEART_RHYTHM_NOTIFICATION
    )
    archiveOnlyDual.forEach{type->attempt(type){forEachDual(store,type,timeFilter){archive(type,it)}}}

    attempt(DataTypes.ENERGY_SCORE){forEachLocalDate(store,DataTypes.ENERGY_SCORE,dateFilter){archive(DataTypes.ENERGY_SCORE,it)}}
    attempt(DataTypes.USER_PROFILE){store.readData(DataTypes.USER_PROFILE.readDataRequestBuilder.build()).dataList.forEachIndexed{index,point->add("archive","samsung-user-profile-$index",samsungUserProfilePayload(DataTypes.USER_PROFILE,point))}}

    val goalGroup=LocalDateGroup.of(LocalDateGroupUnit.DAILY,1)
    attempt(DataTypes.SLEEP_GOAL){archiveAggregates(DataTypes.SLEEP_GOAL,"last_bed_time",store.aggregateData(DataType.SleepGoalType.LAST_BED_TIME.requestBuilder.setLocalDateFilterWithGroup(dateFilter,goalGroup).build()).dataList);archiveAggregates(DataTypes.SLEEP_GOAL,"last_wake_up_time",store.aggregateData(DataType.SleepGoalType.LAST_WAKE_UP_TIME.requestBuilder.setLocalDateFilterWithGroup(dateFilter,goalGroup).build()).dataList)}
    attempt(DataTypes.STEPS_GOAL){archiveAggregates(DataTypes.STEPS_GOAL,"last",store.aggregateData(DataType.StepsGoalType.LAST.requestBuilder.setLocalDateFilterWithGroup(dateFilter,goalGroup).build()).dataList)}
    attempt(DataTypes.ACTIVE_CALORIES_BURNED_GOAL){archiveAggregates(DataTypes.ACTIVE_CALORIES_BURNED_GOAL,"last",store.aggregateData(DataType.ActiveCaloriesBurnedGoalType.LAST.requestBuilder.setLocalDateFilterWithGroup(dateFilter,goalGroup).build()).dataList)}
    attempt(DataTypes.ACTIVE_TIME_GOAL){archiveAggregates(DataTypes.ACTIVE_TIME_GOAL,"last",store.aggregateData(DataType.ActiveTimeGoalType.LAST.requestBuilder.setLocalDateFilterWithGroup(dateFilter,goalGroup).build()).dataList)}
    attempt(DataTypes.WATER_INTAKE_GOAL){archiveAggregates(DataTypes.WATER_INTAKE_GOAL,"last",store.aggregateData(DataType.WaterIntakeGoalType.LAST.requestBuilder.setLocalDateFilterWithGroup(dateFilter,goalGroup).build()).dataList)}
    attempt(DataTypes.NUTRITION_GOAL){archiveAggregates(DataTypes.NUTRITION_GOAL,"last_calories",store.aggregateData(DataType.NutritionGoalType.LAST_CALORIES.requestBuilder.setLocalDateFilterWithGroup(dateFilter,goalGroup).build()).dataList)}
    return SamsungReadResult(commandCount,failed)
  }

  private suspend fun forEachDual(store:HealthDataStore,type:DataType.Readable<HealthDataPoint,ReadDataRequest.DualTimeBuilder<HealthDataPoint>>,filter:LocalTimeFilter,onPoint:suspend(HealthDataPoint)->Unit){
    val seen=mutableSetOf<String>();var token:String?=null
    do{
      val builder=type.readDataRequestBuilder.setLocalTimeFilter(filter).setPageSize(500);token?.let{builder.setPageToken(it)}
      val response=store.readData(builder.build());for(point in response.dataList)onPoint(point);val next=response.pageToken?.takeIf{it.isNotBlank()&&seen.add(it)};token=next
    }while(token!=null)
  }

  private suspend fun forEachLocalDate(store:HealthDataStore,type:DataType.Readable<HealthDataPoint,ReadDataRequest.LocalDateBuilder<HealthDataPoint>>,filter:LocalDateFilter,onPoint:suspend(HealthDataPoint)->Unit){
    val seen=mutableSetOf<String>();var token:String?=null
    do{
      val builder=type.readDataRequestBuilder.setLocalDateFilter(filter).setPageSize(500);token?.let{builder.setPageToken(it)}
      val response=store.readData(builder.build());for(point in response.dataList)onPoint(point);val next=response.pageToken?.takeIf{it.isNotBlank()&&seen.add(it)};token=next
    }while(token!=null)
  }

  private fun typeKey(type:DataType)=type.name.substringAfterLast('.').replace(Regex("[^a-zA-Z0-9_-]"),"_")
  private fun bodyPayload(date:LocalDate,instant:Instant?,zone:ZoneId,observations:JSONArray)=JSONObject().put("occurred_on",date.toString()).apply{if(instant!=null)put("occurred_at",instant.toString())}.put("time_zone",zone.id).put("group_kind","measurement").put("observations",observations)
  private fun observation(metric:String,value:String,unit:String,source:String)=JSONObject().put("metric_key",metric).put("value",value).put("unit",unit).put("original_field",source).put("autofilled",false)
  private fun decimal(value:Double)=BigDecimal.valueOf(value).setScale(6,RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
  private fun sha256(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString(""){"%02x".format(it)}
  companion object { private val workerMutex=Mutex() }
}
