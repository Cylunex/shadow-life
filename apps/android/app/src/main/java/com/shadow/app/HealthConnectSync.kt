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
  fun schedule(context:Context,accountId:String){
    val request=OneTimeWorkRequestBuilder<HealthConnectSyncWorker>()
      .setInputData(workDataOf("account_id" to accountId))
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(workName(accountId),ExistingWorkPolicy.KEEP,request)
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
    if(dao.inFlight(accountId,session.subjectId,"health.ingest_batch")>0||dao.inFlight(accountId,session.subjectId,"health.set_source_state")>0){
      SyncScheduler.schedule(applicationContext,accountId)
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
        SyncScheduler.schedule(applicationContext,accountId)
      }
      return@withContext Result.failure(workDataOf("reason" to "permissions_required"))
    }
    val specs=listOf(
      HealthSpec(WeightRecord::class,"body",HealthConnectEncoder::weight),
      HealthSpec(StepsRecord::class,"daily_activity",HealthConnectEncoder::steps),
      HealthSpec(SleepSessionRecord::class,"sleep",HealthConnectEncoder::sleep),
      HealthSpec(ExerciseSessionRecord::class,"workout",HealthConnectEncoder::exercise)
    )
    try{
      for(spec in specs){
        val cursor=source?.cursors?.firstOrNull{it.deviceId==deviceId&&it.recordType==spec.serverType}
        val epoch=if(source==null)1 else if(source.fingerprint!=fingerprint||source.permissionState!="granted")source.syncEpoch+1 else source.syncEpoch
        val page=if(cursor?.cursor.isNullOrBlank()||cursor?.state!="active")bootstrap(client,spec) else changes(client,spec,cursor!!.cursor!!)
        if(page.expired){
          enqueueState(app,session,instanceKey,fingerprint,maxOf(epoch,source?.syncEpoch?.plus(1)?:1),"rescan_required","Health Connect changes token expired")
          SyncScheduler.schedule(applicationContext,accountId)
          return@withContext Result.success(workDataOf("state" to "rescan_required"))
        }
        if(page.records.isEmpty()&&page.nextCursor==cursor?.cursor)continue
        val commandId="cmd_hc_${sha256("$accountId:${spec.serverType}:${cursor?.cursor.orEmpty()}:${page.nextCursor}").take(32)}"
        val body=JSONObject().put("protocol","shadow.command").put("capability","health.ingest_batch").put("command_id",commandId).put("input",JSONObject()
          .put("source_type","health_connect").put("source_instance_key",instanceKey).put("source_fingerprint",fingerprint)
          .put("device_id",deviceId).put("record_type",spec.serverType).put("permission_fingerprint",fingerprint)
          .put("sync_epoch",epoch).put("previous_cursor",cursor?.cursor?:JSONObject.NULL).put("next_cursor",page.nextCursor)
          .put("parse_version","health-connect-1").put("records",JSONArray(page.records))).toString()
        app.queue.enqueueCommand(session,commandId,"health.ingest_batch",body)
        SyncScheduler.schedule(applicationContext,accountId)
        return@withContext Result.success(workDataOf("state" to "queued","record_type" to spec.serverType,"records" to page.records.size))
      }
      Result.success(workDataOf("state" to "up_to_date"))
    }catch(error:CancellationException){throw error
    }catch(_:BootstrapTooLargeException){Result.failure(workDataOf("reason" to "bootstrap_too_large"))
    }catch(_:SecurityException){
      if(source?.permissionState!="revoked"){enqueueState(app,session,instanceKey,fingerprint,(source?.syncEpoch?:0)+1,"revoked","Health Connect permission was revoked");SyncScheduler.schedule(applicationContext,accountId)}
      Result.failure(workDataOf("reason" to "permissions_revoked"))
    }catch(error:Exception){Result.retry()}
  }

  private suspend fun enqueueState(app:ShadowApp,session:ProductSession,instanceKey:String,fingerprint:String,epoch:Int,state:String,reason:String){
    val commandId="cmd_hc_state_${UUID.randomUUID().toString().replace("-","")}"
    val body=JSONObject().put("protocol","shadow.command").put("capability","health.set_source_state").put("command_id",commandId).put("input",JSONObject().put("source_type","health_connect").put("source_instance_key",instanceKey).put("source_fingerprint",fingerprint).put("sync_epoch",epoch).put("permission_state",state).put("reason",reason)).toString()
    app.queue.enqueueCommand(session,commandId,"health.set_source_state",body)
  }
}

private data class HealthSpec<T:Record>(val recordClass:KClass<T>,val serverType:String,val encode:(T)->JSONObject)
private data class HealthPage(val records:List<JSONObject>,val nextCursor:String,val expired:Boolean=false)
private data class ServerCursor(val deviceId:String,val recordType:String,val cursor:String?,val state:String)
private data class ServerSource(val permissionState:String,val syncEpoch:Int,val fingerprint:String?,val cursors:List<ServerCursor>)
private class BootstrapTooLargeException:IllegalStateException("Health Connect bootstrap exceeded one safe batch")

private suspend fun <T:Record> bootstrap(client:HealthConnectClient,spec:HealthSpec<T>):HealthPage{
  val changesToken=client.getChangesToken(ChangesTokenRequest(setOf(spec.recordClass)))
  val response=client.readRecords(ReadRecordsRequest(spec.recordClass,TimeRangeFilter.after(Instant.now().minus(Duration.ofDays(30))),pageSize=1_000))
  if(response.pageToken!=null)throw BootstrapTooLargeException()
  return HealthPage(response.records.map{upsert(it,spec.encode(it))},changesToken)
}

private suspend fun <T:Record> changes(client:HealthConnectClient,spec:HealthSpec<T>,cursor:String):HealthPage{
  val response=client.getChanges(cursor)
  if(response.changesTokenExpired)return HealthPage(emptyList(),cursor,true)
  val records=response.changes.mapNotNull{change->when(change){
    is UpsertionChange->{@Suppress("UNCHECKED_CAST") val record=change.record as? T;record?.let{upsert(it,spec.encode(it))}}
    is DeletionChange->JSONObject().put("client_record_id",change.recordId).put("provider_record_id",change.recordId).put("record_version",System.currentTimeMillis()).put("change_kind","delete")
    else->null
  }}
  return HealthPage(records,response.nextChangesToken)
}

private fun upsert(record:Record,payload:JSONObject):JSONObject{
  val metadata=record.metadata
  // DeletionChange only carries the provider record ID, so use the same identity for upserts.
  val id=metadata.id
  return JSONObject().put("client_record_id",id).put("provider_record_id",metadata.id).put("record_version",maxOf(metadata.clientRecordVersion,metadata.lastModifiedTime.toEpochMilli())).put("change_kind","upsert").put("payload",payload)
}

private object HealthConnectEncoder{
  private fun zone()=ZoneId.systemDefault()
  private fun decimal(value:Double)=BigDecimal.valueOf(value).stripTrailingZeros().toPlainString()
  fun weight(record:WeightRecord)=JSONObject().put("occurred_on",record.time.atZone(zone()).toLocalDate().toString()).put("occurred_at",record.time.toString()).put("time_zone",zone().id).put("observations",JSONArray().put(JSONObject().put("metric_key","weight").put("value",decimal(record.weight.inKilograms)).put("unit","kg")))
  fun steps(record:StepsRecord)=JSONObject().put("occurred_on",record.endTime.atZone(zone()).toLocalDate().toString()).put("time_zone",zone().id).put("steps",record.count).put("field_sources",JSONObject().put("steps","health_connect:${record.metadata.dataOrigin.packageName}"))
  fun sleep(record:SleepSessionRecord):JSONObject{
    val stages=record.stages.groupBy{it.stage}.mapValues{(_,items)->items.sumOf{Duration.between(it.startTime,it.endTime).toMinutes()}}
    return JSONObject().put("wake_date",record.endTime.atZone(zone()).toLocalDate().toString()).put("time_zone",zone().id).put("started_at",record.startTime.toString()).put("ended_at",record.endTime.toString()).put("total_minutes",Duration.between(record.startTime,record.endTime).toMinutes())
      .put("deep_minutes",stages[SleepSessionRecord.STAGE_TYPE_DEEP]).put("light_minutes",stages[SleepSessionRecord.STAGE_TYPE_LIGHT]).put("rem_minutes",stages[SleepSessionRecord.STAGE_TYPE_REM]).put("awake_minutes",stages[SleepSessionRecord.STAGE_TYPE_AWAKE])
  }
  fun exercise(record:ExerciseSessionRecord)=JSONObject().put("occurred_on",record.startTime.atZone(zone()).toLocalDate().toString()).put("time_zone",zone().id).put("session_type",ExerciseSessionRecord.EXERCISE_TYPE_INT_TO_STRING_MAP[record.exerciseType]?:"other").put("started_at",record.startTime.toString()).put("duration_minutes",Duration.between(record.startTime,record.endTime).toMinutes()).put("detail",JSONObject().put("source","health_connect").put("title",record.title).put("notes",record.notes))
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
