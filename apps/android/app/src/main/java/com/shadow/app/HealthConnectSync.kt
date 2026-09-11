package com.shadow.app

import android.content.Context
import android.provider.Settings
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.changes.DeletionChange
import androidx.health.connect.client.changes.UpsertionChange
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.Record
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.records.WeightRecord
import androidx.health.connect.client.request.ChangesTokenRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.room.withTransaction
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.util.UUID
import kotlin.reflect.KClass

object HealthConnectSync {
  private val recordTypes=setOf(WeightRecord::class,StepsRecord::class,SleepSessionRecord::class,ExerciseSessionRecord::class)
  val permissions:Set<String> = recordTypes.map(HealthPermission::getReadPermission).toSet()
  fun available(context:Context)=HealthConnectClient.getSdkStatus(context)==HealthConnectClient.SDK_AVAILABLE
}

object HealthConnectScheduler {
  fun workName(accountId:String)="shadow-health-connect-$accountId"
  fun schedule(context:Context,accountId:String)=enqueue(context,accountId,UUID.randomUUID().toString())
  fun resume(context:Context,accountId:String)=enqueue(context,accountId,null)
  private fun enqueue(context:Context,accountId:String,startRequestId:String?){
    val request=OneTimeWorkRequestBuilder<HealthConnectSyncWorker>()
      .setInputData(workDataOf("account_id" to accountId,"start_request_id" to startRequestId))
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(workName(accountId),if(startRequestId==null)ExistingWorkPolicy.APPEND_OR_REPLACE else ExistingWorkPolicy.KEEP,request)
  }
}

class HealthConnectSyncWorker(context:Context,params:WorkerParameters):CoroutineWorker(context,params){
  override suspend fun doWork():Result=withContext(Dispatchers.IO){
    val accountId=inputData.getString("account_id")?:return@withContext Result.failure()
    val app=applicationContext as ShadowApp
    val fresh=when(val refresh=app.sessions.fresh(accountId,applicationContext)){
      is SessionRefresh.Ready->refresh.value
      SessionRefresh.Retryable->return@withContext Result.retry()
      SessionRefresh.ReauthRequired->return@withContext Result.failure(workDataOf("reason" to "reauth_required"))
    }
    val session=fresh.session
    val dao=app.database.commands()
    val store=QueuedHealthRoundStore(app,session)
    if(prepareHealthSyncRound(inputData.getString("start_request_id"),store)==null)return@withContext Result.success(workDataOf("state" to "up_to_date"))
    if(dao.inFlight(accountId,session.subjectId,"health.ingest_batch")>0||dao.inFlight(accountId,session.subjectId,"health.set_source_state")>0){
      SyncScheduler.schedule(applicationContext,accountId,ensureNext=true)
      return@withContext Result.success(workDataOf("state" to "waiting_for_receipt"))
    }
    if(!HealthConnectSync.available(applicationContext))return@withContext Result.failure(workDataOf("reason" to "health_connect_unavailable"))
    val client=HealthConnectClient.getOrCreate(applicationContext)
    val granted=client.permissionController.getGrantedPermissions()
    val deviceId=deviceId(applicationContext)
    val instanceKey="android-hc-$deviceId"
    val relevant=granted.intersect(HealthConnectSync.permissions)
    val fingerprint=sha256(relevant.sorted().joinToString("\n"))
    val source=try{fetchSource(session,fresh.accessToken,instanceKey)}catch(_:Exception){return@withContext Result.retry()}
    if(!granted.containsAll(HealthConnectSync.permissions)){
      if(source?.permissionState!="revoked"||source.fingerprint!=fingerprint){
        enqueueState(app,session,instanceKey,fingerprint,(source?.syncEpoch?:0)+1,"revoked","Health Connect permission is incomplete")
        SyncScheduler.schedule(applicationContext,accountId,ensureNext=true)
      }
      return@withContext Result.failure(workDataOf("reason" to "permissions_required"))
    }
    val specs=listOf(
      HealthSpec(WeightRecord::class,"body",HealthConnectEncoder::weight),
      HealthSpec(StepsRecord::class,"steps_interval",HealthConnectEncoder::steps),
      HealthSpec(SleepSessionRecord::class,"sleep",HealthConnectEncoder::sleep),
      HealthSpec(ExerciseSessionRecord::class,"workout",HealthConnectEncoder::exercise)
    )
    try{
      if(source?.permissionState=="revoked")store.current()?.takeIf{it.ready}?.let{store.save(it.copy(typeIndex=0))}
      val result=runHealthSyncRound(inputData.getString("start_request_id"),store){recordType->
        val spec=specs.first{it.serverType==recordType}
        val cursor=source?.cursors?.firstOrNull{it.deviceId==deviceId&&it.recordType==spec.serverType}
        if(source?.permissionState=="rescan_required"&&cursor?.state=="active")return@runHealthSyncRound HealthRoundRead.Skip
        val epoch=HealthSyncPolicy.epoch(source?.syncEpoch,source?.fingerprint==fingerprint,source?.permissionState=="revoked")
        val page=if(cursor?.cursor.isNullOrBlank()||cursor?.state!="active")bootstrap(client,spec,relevant) else changes(client,spec,cursor!!.cursor!!)
        if(page.expired){
          HealthRoundRead.Reset(sourceStateCommand(instanceKey,fingerprint,maxOf(epoch,source?.syncEpoch?.plus(1)?:1),"rescan_required","Health Connect changes token expired"))
        }else{
          HealthRoundRead.Page(HealthBatchContext(accountId,session.subjectId,instanceKey,fingerprint,deviceId,spec.serverType,epoch,cursor?.cursor),page)
        }
      }
      if(result!=HealthRoundResult.COMPLETE)SyncScheduler.schedule(applicationContext,accountId,ensureNext=true)
      Result.success(workDataOf("state" to when(result){
        HealthRoundResult.QUEUED->"queued"
        HealthRoundResult.WAITING_FOR_RECEIPT->"waiting_for_receipt"
        HealthRoundResult.COMPLETE->"up_to_date"
      }))
    }catch(error:CancellationException){throw error
    }catch(_:HealthScanTooLargeException){Result.failure(workDataOf("reason" to "bootstrap_too_large"))
    }catch(_:SecurityException){
      if(source?.permissionState!="revoked"){enqueueState(app,session,instanceKey,fingerprint,(source?.syncEpoch?:0)+1,"revoked","Health Connect permission was revoked");SyncScheduler.schedule(applicationContext,accountId,ensureNext=true)}
      Result.failure(workDataOf("reason" to "permissions_revoked"))
    }catch(error:Exception){Result.retry()}
  }

  private suspend fun enqueueState(app:ShadowApp,session:ProductSession,instanceKey:String,fingerprint:String,epoch:Int,state:String,reason:String){
    val command=sourceStateCommand(instanceKey,fingerprint,epoch,state,reason)
    app.queue.enqueueCommand(session,command.commandId,command.capability,command.body)
  }
}

private fun sourceStateCommand(instanceKey:String,fingerprint:String,epoch:Int,state:String,reason:String):HealthQueuedCommand{
  val commandId="cmd_hc_state_${UUID.randomUUID().toString().replace("-","")}"
  val capability="health.set_source_state"
  val body=JSONObject().put("protocol","shadow.command").put("capability",capability).put("command_id",commandId).put("input",JSONObject().put("source_type","health_connect").put("source_instance_key",instanceKey).put("source_fingerprint",fingerprint).put("sync_epoch",epoch).put("permission_state",state).put("reason",reason)).toString()
  return HealthQueuedCommand(commandId,capability,body)
}

private class QueuedHealthRoundStore(private val app:ShadowApp,private val session:ProductSession):HealthRoundStore{
  private val dao=app.database.commands()
  override suspend fun current()=dao.healthRound(session.accountId,session.subjectId)?.progress
  override suspend fun save(state:HealthRoundState)=dao.saveHealthRound(HealthSyncRoundRow(session.accountId,session.subjectId,state))
  override suspend fun enqueue(command:HealthQueuedCommand,state:HealthRoundState){
    app.database.withTransaction{
      app.queue.enqueueCommand(session,command.commandId,command.capability,command.body)
      // A replay already committed locally must not leave a continuation waiting forever.
      save(if(dao.command(command.commandId)?.state=="committed")state.confirmed(command.commandId) else state)
    }
  }
}

private data class HealthSpec<T:Record>(val recordClass:KClass<T>,val serverType:String,val encode:(T)->JSONObject)
private data class ServerCursor(val deviceId:String,val recordType:String,val cursor:String?,val state:String)
private data class ServerSource(val permissionState:String,val syncEpoch:Int,val fingerprint:String?,val cursors:List<ServerCursor>)

private suspend fun <T:Record> bootstrap(client:HealthConnectClient,spec:HealthSpec<T>,permissions:Set<String>):HealthPage{
  val end=Instant.now()
  val scan=CompleteHealthScan<JSONObject>(end.minus(Duration.ofDays(30)),end)
  val changesToken=client.getChangesToken(ChangesTokenRequest(setOf(spec.recordClass)))
  var pageToken:String?=null
  do {
    val response=client.readRecords(ReadRecordsRequest(spec.recordClass,TimeRangeFilter.between(scan.start,scan.end),pageSize=1_000,pageToken=pageToken))
    scan.page(response.records.map{upsert(it,spec.encode(it))},response.pageToken!=null)
    pageToken=response.pageToken
    if(client.permissionController.getGrantedPermissions().intersect(HealthConnectSync.permissions)!=permissions)throw SecurityException("Health Connect permission changed during scan")
  } while(pageToken!=null)
  val records=scan.complete(client.permissionController.getGrantedPermissions().intersect(HealthConnectSync.permissions)==permissions)
  val rescan=JSONObject().put("generation","hcscan_${UUID.randomUUID().toString().replace("-","")}")
    .put("window_start",scan.start.toString()).put("window_end",scan.end.toString()).put("complete",true)
  return HealthPage(records,changesToken,rescan=rescan)
}

private suspend fun <T:Record> changes(client:HealthConnectClient,spec:HealthSpec<T>,cursor:String):HealthPage{
  val response=client.getChanges(cursor)
  if(response.changesTokenExpired)return HealthPage(emptyList(),cursor,true)
  val records=response.changes.mapNotNull{change->when(change){
    is UpsertionChange->{@Suppress("UNCHECKED_CAST") val record=change.record as? T;record?.let{upsert(it,spec.encode(it))}}
    is DeletionChange->JSONObject().put("client_record_id",change.recordId).put("provider_record_id",change.recordId).put("record_version",System.currentTimeMillis()).put("change_kind","delete")
    else->null
  }}
  return HealthPage(records,response.nextChangesToken,hasMore=response.hasMore)
}

private fun upsert(record:Record,payload:JSONObject):JSONObject{
  val metadata=record.metadata
  // DeletionChange only carries the provider record ID, so use the same identity for upserts.
  val id=metadata.id
  return JSONObject().put("client_record_id",id).put("provider_record_id",metadata.id).put("record_version",maxOf(metadata.clientRecordVersion,metadata.lastModifiedTime.toEpochMilli())).put("change_kind","upsert").put("payload",payload)
}

internal fun healthConnectSessionType(exerciseType:Int)=when(exerciseType){
  ExerciseSessionRecord.EXERCISE_TYPE_WALKING->"walking"
  ExerciseSessionRecord.EXERCISE_TYPE_RUNNING->"running"
  ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL->"treadmill_running"
  ExerciseSessionRecord.EXERCISE_TYPE_BIKING->"biking"
  ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY->"stationary_biking"
  ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL->"pool_swimming"
  ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER->"open_water_swimming"
  ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING->"strength_training"
  ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING->"weightlifting"
  ExerciseSessionRecord.EXERCISE_TYPE_HIGH_INTENSITY_INTERVAL_TRAINING->"hiit"
  ExerciseSessionRecord.EXERCISE_TYPE_ROWING->"rowing"
  ExerciseSessionRecord.EXERCISE_TYPE_ROWING_MACHINE->"rowing_machine"
  ExerciseSessionRecord.EXERCISE_TYPE_HIKING->"hiking"
  ExerciseSessionRecord.EXERCISE_TYPE_YOGA->"yoga"
  ExerciseSessionRecord.EXERCISE_TYPE_PILATES->"pilates"
  ExerciseSessionRecord.EXERCISE_TYPE_STRETCHING->"stretching"
  ExerciseSessionRecord.EXERCISE_TYPE_DANCING->"dancing"
  ExerciseSessionRecord.EXERCISE_TYPE_OTHER_WORKOUT->"other"
  else->"health_connect_$exerciseType"
}

private object HealthConnectEncoder{
  private fun zone()=ZoneId.systemDefault()
  private fun decimal(value:Double)=BigDecimal.valueOf(value).stripTrailingZeros().toPlainString()
  fun weight(record:WeightRecord)=JSONObject().put("occurred_on",record.time.atZone(zone()).toLocalDate().toString()).put("occurred_at",record.time.toString()).put("time_zone",zone().id).put("observations",JSONArray().put(JSONObject().put("metric_key","weight").put("value",decimal(record.weight.inKilograms)).put("unit","kg")))
  fun steps(record:StepsRecord):JSONObject{
    val value=HealthSyncPolicy.steps(record.startTime,record.endTime,record.metadata.dataOrigin.packageName,record.count,zone())
    return JSONObject().put("occurred_on",value.date).put("time_zone",value.zone).put("steps",value.count)
      .put("step_interval",JSONObject().put("started_at",value.start).put("ended_at",value.end).put("data_origin",value.origin))
      .put("field_sources",JSONObject().put("steps","health_connect:${value.origin}"))
  }
  fun sleep(record:SleepSessionRecord):JSONObject{
    val stages=record.stages.groupBy{it.stage}.mapValues{(_,items)->items.sumOf{Duration.between(it.startTime,it.endTime).toMinutes()}}
    return JSONObject().put("wake_date",record.endTime.atZone(zone()).toLocalDate().toString()).put("time_zone",zone().id).put("started_at",record.startTime.toString()).put("ended_at",record.endTime.toString()).put("total_minutes",Duration.between(record.startTime,record.endTime).toMinutes())
      .put("deep_minutes",stages[SleepSessionRecord.STAGE_TYPE_DEEP]).put("light_minutes",stages[SleepSessionRecord.STAGE_TYPE_LIGHT]).put("rem_minutes",stages[SleepSessionRecord.STAGE_TYPE_REM]).put("awake_minutes",stages[SleepSessionRecord.STAGE_TYPE_AWAKE])
  }
  fun exercise(record:ExerciseSessionRecord)=JSONObject().put("occurred_on",record.startTime.atZone(zone()).toLocalDate().toString()).put("time_zone",zone().id).put("session_type",healthConnectSessionType(record.exerciseType)).put("started_at",record.startTime.toString()).put("duration_minutes",Duration.between(record.startTime,record.endTime).toMinutes()).put("detail",JSONObject().put("source","health_connect").put("exercise_type",record.exerciseType).put("title",record.title).put("notes",record.notes))
}

private fun fetchSource(session:ProductSession,accessToken:String,instanceKey:String):ServerSource?{
  val connection=URL("${session.apiBase}/api/health/sources").openConnection() as HttpURLConnection
  try{
    connection.requestMethod="GET";connection.connectTimeout=15_000;connection.readTimeout=20_000;connection.setRequestProperty("Authorization","Bearer $accessToken")
    if(connection.responseCode!=200)throw IllegalStateException("Health source lookup failed")
    val items=JSONObject(connection.inputStream.bufferedReader().use{it.readText()}).getJSONArray("items")
    for(index in 0 until items.length()){
      val item=items.getJSONObject(index)
      if(item.optString("source_type")!="health_connect"||item.optString("instance_key")!=instanceKey)continue
      val cursors=item.optJSONArray("cursors")?:JSONArray()
      return ServerSource(item.getString("permission_state"),item.getInt("sync_epoch"),item.optString("fingerprint").takeIf{it.isNotBlank()},List(cursors.length()){position->val cursor=cursors.getJSONObject(position);ServerCursor(cursor.getString("device_id"),cursor.getString("record_type"),cursor.optString("cursor").takeIf{it.isNotBlank()},cursor.getString("state"))})
    }
    return null
  }finally{connection.disconnect()}
}

private fun deviceId(context:Context):String{
  val androidId=Settings.Secure.getString(context.contentResolver,Settings.Secure.ANDROID_ID).orEmpty()
  return sha256("${context.packageName}:$androidId").take(32)
}
private fun sha256(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString(""){"%02x".format(it)}
