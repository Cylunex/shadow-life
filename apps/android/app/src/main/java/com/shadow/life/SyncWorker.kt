package com.shadow.life

import android.content.Context
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.ZoneOffset
import java.util.concurrent.TimeUnit

object SyncScheduler {
  fun workName(accountId:String)="shadow-sync-$accountId"
  fun schedule(context:Context,accountId:String,ensureNext:Boolean=true){
    val request=OneTimeWorkRequestBuilder<SyncWorker>()
      .setInputData(workDataOf("account_id" to accountId))
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL,10,TimeUnit.SECONDS)
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(workName(accountId),if(ensureNext)ExistingWorkPolicy.APPEND_OR_REPLACE else ExistingWorkPolicy.KEEP,request)
  }
  fun retryNow(context:Context,accountId:String){
    val request=OneTimeWorkRequestBuilder<SyncWorker>().setInputData(workDataOf("account_id" to accountId)).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).setBackoffCriteria(BackoffPolicy.EXPONENTIAL,10,TimeUnit.SECONDS).build()
    WorkManager.getInstance(context).enqueueUniqueWork(workName(accountId),ExistingWorkPolicy.REPLACE,request)
  }
}

class SyncWorker(context:Context,params:WorkerParameters):CoroutineWorker(context,params){
  override suspend fun doWork():Result=withContext(Dispatchers.IO){
    val accountId=inputData.getString("account_id")?:return@withContext Result.failure()
    val app=applicationContext as ShadowApp
    val fresh=when(val refresh=app.sessions.fresh(accountId,applicationContext)){
      is SessionRefresh.Ready->refresh.value
      SessionRefresh.Retryable->return@withContext Result.retry()
      SessionRefresh.ReauthRequired->return@withContext Result.failure(workDataOf("reason" to "reauth_required"))
    }
    val session=fresh.session
    val accessToken=fresh.accessToken
    val dao=app.database.commands()
    var needsRetry=false
    var recoveredCommands=0
    var committedCommands=0
    Log.i(TAG,"sync started")

    for(attachment in dao.pendingAttachments(accountId,session.subjectId)){
      val file=File(attachment.localPath)
      if(!file.isFile){dao.markAttachment(attachment.id,"failed");continue}
      dao.markAttachmentAttempt(attachment.id,"uploading")
      var connection:HttpURLConnection?=null
      try{
        val activeConnection=(URL("${session.apiBase}/api/assets").openConnection() as HttpURLConnection).apply{
          requestMethod="POST";connectTimeout=15_000;readTimeout=30_000
          setRequestProperty("Authorization","Bearer $accessToken");setRequestProperty("Content-Type",attachment.mediaType)
          setRequestProperty("X-Request-Id",requestId(attachment.commandId,attachment.attempts,"asset"))
          doOutput=true;setChunkedStreamingMode(64*1024)
        }
        connection=activeConnection
        file.inputStream().use{input->activeConnection.outputStream.use{output->app.queue.copyAttachment(attachment,input,output)}}
        val code=activeConnection.responseCode
        if(code==401){dao.markAttachment(attachment.id,"unknown");app.sessions.revoke(accountId);return@withContext Result.failure(workDataOf("reason" to "reauth_required"))}
        if(code !in listOf(200,201)){
          if(code==429||code>=500){if(attachment.attempts>=7)dao.markAttachment(attachment.id,"failed")else{dao.markAttachment(attachment.id,"unknown");needsRetry=true};continue}
          dao.markAttachment(attachment.id,if(code in listOf(403,409,413,422))"blocked" else "failed")
          continue
        }
        val uploadedText=activeConnection.inputStream.bufferedReader().use{it.readText()}
        val uploaded=runCatching{JSONObject(uploadedText)}.getOrNull()
        val assetVersionId=uploaded?.optString("asset_version_id").orEmpty()
        val valid=uploaded?.optString("protocol")=="shadow.asset"&&assetVersionId.isNotBlank()&&uploaded.optString("sha256").isNotBlank()&&uploaded.optString("media_type")==attachment.mediaType
        if(!valid){if(attachment.attempts>=7)dao.markAttachment(attachment.id,"failed")else{dao.markAttachment(attachment.id,"unknown");needsRetry=true};continue}
        val capturedOn=attachment.capturedOn.ifBlank{Instant.ofEpochMilli(attachment.createdAt).atZone(ZoneOffset.UTC).toLocalDate().toString()}
        val isImage=attachment.mediaType.startsWith("image/")
        val input=JSONObject().put("title",attachment.displayName.ifBlank{if(isImage)"来自 Android 的图片" else "来自 Android 的文件"}).put("item_type",if(isImage)"image" else "document").put("tags",JSONArray()).put("source",JSONObject().put("kind",if(isImage)"image" else "import").put("captured_on",capturedOn).put("asset_version_id",assetVersionId))
        val body=JSONObject().put("protocol","shadow.command").put("capability","library.capture").put("command_id",attachment.commandId).put("input",input).toString()
        app.queue.enqueueCommand(session,attachment.commandId,"library.capture",body)
        dao.markAttachment(attachment.id,"committed")
        if(!file.exists()||file.delete())dao.clearTerminalAttachment(attachment.id)
      }catch(error:CancellationException){dao.markAttachment(attachment.id,"unknown");throw error
      }catch(_:QueueKeyUnavailableException){dao.markAttachment(attachment.id,"blocked")
      }catch(_:Exception){if(attachment.attempts>=7)dao.markAttachment(attachment.id,"failed")else{dao.markAttachment(attachment.id,"unknown");needsRetry=true}
      }finally{connection?.disconnect()}
    }

    val pendingCommands=dao.pending(accountId,session.subjectId)
    val handledByBatch=mutableSetOf<String>()
    val batchCandidates=mutableListOf<Pair<PendingCommand,String>>()
    for(command in pendingCommands.filter{it.capability=="health.ingest_raw"}){
      try{batchCandidates+=command to app.queue.commandBody(command)}
      catch(_:QueueKeyUnavailableException){dao.setCommandState(command.commandId,"blocked");handledByBatch+=command.commandId}
    }
    for(batch in healthCommandBatches(batchCandidates)){
      val outcome=uploadHealthBatch(app,session,accessToken,batch)
      if(outcome.reauthRequired)return@withContext Result.failure(workDataOf("reason" to "reauth_required"))
      if(!outcome.fallbackToSingles)handledByBatch+=batch.map{it.first.commandId}
      needsRetry=needsRetry||outcome.needsRetry
      recoveredCommands+=outcome.recovered
      committedCommands+=outcome.committed
    }

    for(command in pendingCommands.filterNot{it.commandId in handledByBatch}){
      if(command.state=="unknown"){
        val recovered=lookupReceipt(session,accessToken,command)
        if(recovered!=null){commitVerified(app,command,recovered);recoveredCommands++;continue}
      }
      val body=try{app.queue.commandBody(command)}catch(_:QueueKeyUnavailableException){dao.setCommandState(command.commandId,"blocked");continue}
      dao.mark(command.commandId,"uploading")
      var connection:HttpURLConnection?=null
      try{
        val activeConnection=(URL("${session.apiBase}/api/commands/${command.capability}").openConnection() as HttpURLConnection).apply{
          requestMethod="POST";connectTimeout=15_000;readTimeout=30_000
          setRequestProperty("Authorization","Bearer $accessToken");setRequestProperty("Content-Type","application/json")
          setRequestProperty("X-Request-Id",requestId(command.commandId,command.attempts,"command"))
          doOutput=true
        }
        connection=activeConnection
        activeConnection.outputStream.use{it.write(body.toByteArray(StandardCharsets.UTF_8))}
        val code=activeConnection.responseCode
        if(code==401){dao.setCommandState(command.commandId,"unknown");app.sessions.revoke(accountId);return@withContext Result.failure(workDataOf("reason" to "reauth_required"))}
        if(code in listOf(200,201)){
          val receiptText=activeConnection.inputStream.bufferedReader().use{it.readText()}
          val verified=receiptText.takeIf{validReceipt(it,command)}?:lookupReceipt(session,accessToken,command)
          if(verified!=null){commitVerified(app,command,verified);committedCommands++;continue}
          if(command.attempts>=7)dao.setCommandState(command.commandId,"failed")else{dao.setCommandState(command.commandId,"unknown");needsRetry=true};continue
        }
        val errorBody=activeConnection.errorStream?.bufferedReader()?.use{it.readText()}.orEmpty()
        if(code==503&&retryableNotApplied(errorBody)){
          dao.setCommandState(command.commandId,"pending");showWriteFence(app,command);Log.w("SyncWorker","server kept ${command.capability} behind a migration write fence");needsRetry=true;continue
        }
        if(code==429||code>=500){
          val recovered=if(code>=500)lookupReceipt(session,accessToken,command) else null
          if(recovered!=null){commitVerified(app,command,recovered);recoveredCommands++}
          else if(command.attempts>=7)dao.setCommandState(command.commandId,"failed")
          else{dao.setCommandState(command.commandId,"unknown");needsRetry=true}
          continue
        }
        val terminal=if(isDeterministicCommandFailure(code))"blocked" else "failed"
        dao.setCommandState(command.commandId,terminal)
        showRejected(app,command,code,errorBody)
      }catch(error:CancellationException){dao.setCommandState(command.commandId,"unknown");throw error
      }catch(_:QueueKeyUnavailableException){dao.setCommandState(command.commandId,"blocked")
      }catch(_:Exception){
        val recovered=lookupReceipt(session,accessToken,command)
        if(recovered!=null){commitVerified(app,command,recovered);recoveredCommands++}else if(command.attempts>=7)dao.setCommandState(command.commandId,"failed")else{dao.setCommandState(command.commandId,"unknown");needsRetry=true}
      }finally{connection?.disconnect()}
    }
    // Also recovers a process death after the atomic receipt commit but before the wake-up.
    if(HealthConnectSync.enabled()&&dao.healthRound(accountId,session.subjectId)?.progress?.ready==true)HealthConnectScheduler.resume(applicationContext,accountId)
    Log.i(TAG,"sync finished recovered=$recoveredCommands committed=$committedCommands retry=$needsRetry")
    if(needsRetry)Result.retry()else Result.success()
  }

  private suspend fun commitVerified(app:ShadowApp,command:PendingCommand,receipt:String){
    try{app.queue.commit(command,receipt)}catch(_:QueueKeyUnavailableException){app.database.commands().commitWithHealthRound(command,"")}
    when{command.commandId.startsWith("cmd_scale_")->app.deviceSync.updateScale(command.accountId,"committed","称重数据已同步到 Life");command.commandId.startsWith("cmd_samsung_")->app.deviceSync.updateSamsung(command.accountId,"committed","Samsung Health 数据已同步到 Life")}
  }

  private suspend fun uploadHealthBatch(app:ShadowApp,session:ProductSession,accessToken:String,batch:List<Pair<PendingCommand,String>>):BatchUploadOutcome{
    val dao=app.database.commands()
    batch.forEach{(command,_)->dao.mark(command.commandId,"uploading")}
    val payload=JSONObject().put("commands",JSONArray(batch.map{JSONObject(it.second)})).toString()
    var connection:HttpURLConnection?=null
    try{
      val activeConnection=(URL("${session.apiBase}/api/commands/batch").openConnection() as HttpURLConnection).apply{
        requestMethod="POST";connectTimeout=15_000;readTimeout=60_000
        setRequestProperty("Authorization","Bearer $accessToken");setRequestProperty("Content-Type","application/json")
        setRequestProperty("X-Request-Id","android-batch-${batch.first().first.commandId.takeLast(12)}-${batch.size}")
        doOutput=true
      }
      connection=activeConnection
      activeConnection.outputStream.use{it.write(payload.toByteArray(StandardCharsets.UTF_8))}
      val code=activeConnection.responseCode
      if(code==401){batch.forEach{dao.setCommandState(it.first.commandId,"unknown")};app.sessions.revoke(session.accountId);return BatchUploadOutcome(reauthRequired=true)}
      if(code==404)return BatchUploadOutcome(fallbackToSingles=true)
      if(code!=200){
        val errorBody=activeConnection.errorStream?.bufferedReader()?.use{it.readText()}.orEmpty()
        if(code==503&&retryableNotApplied(errorBody)){batch.forEach{dao.setCommandState(it.first.commandId,"pending")};return BatchUploadOutcome(needsRetry=true)}
        if(isDeterministicCommandFailure(code)){batch.forEach{(command,_)->dao.setCommandState(command.commandId,"blocked");showRejected(app,command,code,errorBody)};return BatchUploadOutcome()}
        return recoverBatchAfterUnknown(app,session,accessToken,batch)
      }
      val response=JSONObject(activeConnection.inputStream.bufferedReader().use{it.readText()})
      if(response.optString("protocol")!="shadow.command-batch-result")return recoverBatchAfterUnknown(app,session,accessToken,batch)
      val byId=response.optJSONArray("items")?.let{items->(0 until items.length()).mapNotNull{items.optJSONObject(it)}.associateBy{it.optString("command_id")}}.orEmpty()
      var committed=0;var retry=false
      for((command,_) in batch){
        val item=byId[command.commandId]
        if(item==null){dao.setCommandState(command.commandId,"unknown");retry=true;continue}
        val itemCode=item.optInt("http_status",500)
        val result=item.optJSONObject("result")?.toString()
        val errorBody=item.optJSONObject("error")?.toString().orEmpty()
        when{
          itemCode in listOf(200,201)&&result!=null&&validReceipt(result,command)->{commitVerified(app,command,result);committed++}
          itemCode==503&&retryableNotApplied(errorBody)->{dao.setCommandState(command.commandId,"pending");showWriteFence(app,command);retry=true}
          isDeterministicCommandFailure(itemCode)->{dao.setCommandState(command.commandId,"blocked");showRejected(app,command,itemCode,errorBody)}
          itemCode==429||itemCode>=500->{if(command.attempts>=7)dao.setCommandState(command.commandId,"failed")else{dao.setCommandState(command.commandId,"unknown");retry=true}}
          else->dao.setCommandState(command.commandId,"failed")
        }
      }
      Log.i(TAG,"batch upload commands=${batch.size} committed=$committed retry=$retry")
      return BatchUploadOutcome(committed=committed,needsRetry=retry)
    }catch(error:CancellationException){batch.forEach{dao.setCommandState(it.first.commandId,"unknown")};throw error
    }catch(error:Exception){Log.w(TAG,"batch upload outcome unknown commands=${batch.size} type=${error.javaClass.simpleName}");return recoverBatchAfterUnknown(app,session,accessToken,batch)
    }finally{connection?.disconnect()}
  }

  private suspend fun recoverBatchAfterUnknown(app:ShadowApp,session:ProductSession,accessToken:String,batch:List<Pair<PendingCommand,String>>):BatchUploadOutcome{
    val dao=app.database.commands();var recovered=0;var retry=false
    for((command,_) in batch){
      val receipt=lookupReceipt(session,accessToken,command)
      if(receipt!=null){commitVerified(app,command,receipt);recovered++}
      else if(command.attempts>=7)dao.setCommandState(command.commandId,"failed")
      else{dao.setCommandState(command.commandId,"unknown");retry=true}
    }
    return BatchUploadOutcome(recovered=recovered,needsRetry=retry)
  }

  private fun lookupReceipt(session:ProductSession,accessToken:String,command:PendingCommand):String?{
    val encoded=URLEncoder.encode(command.commandId,StandardCharsets.UTF_8.toString())
    val connection=URL("${session.apiBase}/api/operations/by-command/$encoded").openConnection() as HttpURLConnection
    return try{
      connection.requestMethod="GET";connection.connectTimeout=15_000;connection.readTimeout=20_000
      connection.setRequestProperty("Authorization","Bearer $accessToken")
      val requestId=requestId(command.commandId,command.attempts,"receipt");connection.setRequestProperty("X-Request-Id",requestId)
      val code=connection.responseCode
      if(code!=200){val errorCode=runCatching{JSONObject(connection.errorStream?.bufferedReader()?.use{it.readText()}.orEmpty()).optString("code")}.getOrNull()?.takeIf(String::isNotBlank);Log.w(TAG,"receipt lookup request_id=$requestId status=$code code=${errorCode?:"unknown"} capability=${command.capability}");null}
      else connection.inputStream.bufferedReader().use{it.readText()}.takeIf{validReceipt(it,command)}.also{if(it==null)Log.w(TAG,"receipt lookup request_id=$requestId returned an invalid envelope capability=${command.capability}")}
    }catch(error:Exception){
      Log.w(TAG,"receipt lookup transport failure request_id=${requestId(command.commandId,command.attempts,"receipt")} capability=${command.capability} type=${error.javaClass.simpleName}");null
    }finally{connection.disconnect()}
  }

  private fun validReceipt(text:String,command:PendingCommand):Boolean=runCatching{
    val receipt=JSONObject(text)
    receipt.optString("protocol")=="shadow.execution-result"&&receipt.optString("status")=="committed"&&receipt.optString("command_id")==command.commandId&&receipt.optString("capability")==command.capability&&receipt.optString("execution_id").isNotBlank()
  }.getOrDefault(false)
  private fun retryableNotApplied(text:String)=runCatching{JSONObject(text).optString("code")=="retryable_not_applied"}.getOrDefault(false)
  private fun requestId(commandId:String,attempts:Int,phase:String)="android-$phase-${commandId.takeLast(16)}-${attempts.coerceAtLeast(0)}"
  private fun showWriteFence(app:ShadowApp,command:PendingCommand){when{command.commandId.startsWith("cmd_scale_")->app.deviceSync.updateScale(command.accountId,"error","Life 健康写入正在迁移保护中，读数已安全保留");command.commandId.startsWith("cmd_samsung_")->app.deviceSync.updateSamsung(command.accountId,"error","Life 健康写入正在迁移保护中，数据已安全保留")}}
  private fun showRejected(app:ShadowApp,command:PendingCommand,status:Int,body:String){
    val code=runCatching{JSONObject(body).optString("code")}.getOrDefault("")
    val message=when(code){"conflict"->"服务器拒绝了旧版本或冲突数据，请重新发起同步";"validation"->"数据字段与服务器不兼容，请升级后重新同步";"permission_denied"->"当前账户没有健康数据写入权限";else->"数据上传失败（HTTP $status），请在数据状态中重试"}
    when{command.commandId.startsWith("cmd_scale_")->app.deviceSync.updateScale(command.accountId,"error",message);command.commandId.startsWith("cmd_samsung_")->app.deviceSync.updateSamsung(command.accountId,"error",message)}
    Log.w(TAG,"command rejected status=$status code=${code.ifBlank{"unknown"}} capability=${command.capability}")
  }
  companion object{private const val TAG="SyncWorker"}
}

internal data class BatchUploadOutcome(val committed:Int=0,val recovered:Int=0,val needsRetry:Boolean=false,val reauthRequired:Boolean=false,val fallbackToSingles:Boolean=false)
internal fun isDeterministicCommandFailure(status:Int)=status in listOf(400,403,409,413,415,422)
internal fun healthCommandBatches(commands:List<Pair<PendingCommand,String>>,maxCommands:Int=40,maxBytes:Int=850_000):List<List<Pair<PendingCommand,String>>>{
  val batches=mutableListOf<MutableList<Pair<PendingCommand,String>>>();var bytes=0
  for(command in commands){val size=command.second.toByteArray(StandardCharsets.UTF_8).size+1;if(batches.isEmpty()||batches.last().size>=maxCommands||bytes+size>maxBytes){batches.add(mutableListOf());bytes=0};batches.last().add(command);bytes+=size}
  return batches
}
