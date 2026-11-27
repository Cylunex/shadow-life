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
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
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
    val request=OneTimeWorkRequestBuilder<SyncWorker>()
      .setInputData(workDataOf("account_id" to accountId))
      .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
      .setBackoffCriteria(BackoffPolicy.EXPONENTIAL,10,TimeUnit.SECONDS)
      .build()
    WorkManager.getInstance(context).enqueueUniqueWork(workName(accountId),ExistingWorkPolicy.REPLACE,request)
  }
}

class SyncWorker(context:Context,params:WorkerParameters):CoroutineWorker(context,params){
  override suspend fun doWork():Result=withContext(Dispatchers.IO){
    // A canceled worker may still be returning from a blocking HTTP call.
    uploadMutex.withLock { sync() }
  }

  private suspend fun sync():Result {
    val accountId=inputData.getString("account_id")?:return Result.failure()
    val app=applicationContext as ShadowApp
    // Persist a rotated refresh token even if manual retry cancels this worker mid-refresh.
    val fresh=when(val refresh=withContext(NonCancellable){app.sessions.fresh(accountId,applicationContext)}){
      is SessionRefresh.Ready->refresh.value
      SessionRefresh.Retryable->{Log.w(TAG,"sync waiting for session refresh");return Result.retry()}
      SessionRefresh.ReauthRequired->return Result.failure(workDataOf("reason" to "reauth_required"))
    }
    val session=fresh.session
    val accessToken=fresh.accessToken
    val dao=app.database.commands()
    dao.pruneCommittedCaptures(accountId,session.subjectId,System.currentTimeMillis()-7L*86_400_000)
    var needsRetry=false
    var recoveredCommands=0
    var committedCommands=0
    Log.i(TAG,"sync started")

    reconcileReceipts(app,session,accessToken)?.let{return it}

    for(attachment in dao.readyAttachments(accountId,session.subjectId,CaptureLocalSettings.canSync(applicationContext,app,accountId),MAX_ATTACHMENTS_PER_RUN)){
      if(attachment.captureMetadata.isNotBlank()&&!CaptureLocalSettings.canSync(applicationContext,app,accountId))continue
      val file=File(attachment.localPath)
      if(!file.isFile){dao.markAttachment(attachment.id,"failed","file_missing");continue}
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
        file.inputStream().use{input->activeConnection.outputStream.use{output->app.queue.copyAttachment(attachment,input,object:java.io.FilterOutputStream(output){override fun write(bytes:ByteArray,offset:Int,length:Int){if(attachment.captureMetadata.isNotBlank()&&!CaptureLocalSettings.canSync(applicationContext,app,accountId))throw CaptureSyncPaused();out.write(bytes,offset,length)};override fun write(value:Int){if(attachment.captureMetadata.isNotBlank()&&!CaptureLocalSettings.canSync(applicationContext,app,accountId))throw CaptureSyncPaused();out.write(value)}})}}
        val code=activeConnection.responseCode
        if(code==401){dao.markAttachment(attachment.id,"unknown");app.sessions.revoke(accountId);return Result.failure(workDataOf("reason" to "reauth_required"))}
        if(code !in listOf(200,201)){
          if(code==429||code>=500){if(attachment.attempts>=7)dao.markAttachment(attachment.id,"failed",queueHttpIssue(code))else{dao.markAttachment(attachment.id,"unknown");needsRetry=true};continue}
          dao.markAttachment(attachment.id,if(code in listOf(403,409,413,422))"blocked" else "failed",queueHttpIssue(code))
          continue
        }
        val uploadedText=activeConnection.inputStream.bufferedReader().use{it.readText()}
        val uploaded=runCatching{JSONObject(uploadedText)}.getOrNull()
        val assetVersionId=uploaded?.optString("asset_version_id").orEmpty()
        val valid=uploaded?.optString("protocol")=="shadow.asset"&&assetVersionId.isNotBlank()&&uploaded.optString("sha256").isNotBlank()&&uploaded.optString("media_type")==attachment.mediaType
        if(!valid){if(attachment.attempts>=7)dao.markAttachment(attachment.id,"failed","unverified")else{dao.markAttachment(attachment.id,"unknown");needsRetry=true};continue}
        val capturedOn=attachment.capturedOn.ifBlank{Instant.ofEpochMilli(attachment.createdAt).atZone(ZoneOffset.UTC).toLocalDate().toString()}
        val isImage=attachment.mediaType.startsWith("image/")
        val input=JSONObject().put("title",attachment.displayName.ifBlank{if(isImage)"来自 Android 的图片" else "来自 Android 的文件"}).put("item_type",if(isImage)"image" else "document").put("tags",JSONArray().apply{if(attachment.commandId.startsWith("cmd_android_share_")){put("losna:process");put("losna:batch:${attachment.commandId.removePrefix("cmd_android_share_").substringBeforeLast("_")}")}}).put("source",JSONObject().put("kind",if(isImage)"image" else "import").put("captured_on",capturedOn).put("asset_version_id",assetVersionId))
        val recording=app.queue.attachmentMetadata(attachment)?.let{JSONObject(it)}
        val capability=if(recording==null)"library.capture" else recording.optString("capability","life.register_recording")
        val commandInput=(recording?.optJSONObject("input")?:recording)?.put("asset_version_id",assetVersionId)?:input
        val body=JSONObject().put("protocol","shadow.command").put("capability",capability).put("command_id",attachment.commandId).put("input",commandInput).toString()
        app.queue.enqueueCommand(session,attachment.commandId,capability,body)
        dao.markAttachment(attachment.id,"committed")
        if(!file.exists()||file.delete())dao.clearTerminalAttachment(attachment.id)
      }catch(_:CaptureSyncPaused){dao.markAttachment(attachment.id,"pending")
      }catch(error:CancellationException){dao.markAttachment(attachment.id,"unknown");throw error
      }catch(_:QueueKeyUnavailableException){dao.markAttachment(attachment.id,"blocked","key_unavailable")
      }catch(_:Exception){if(attachment.attempts>=7)dao.markAttachment(attachment.id,"failed","transport")else{dao.markAttachment(attachment.id,"unknown");needsRetry=true}
      }finally{connection?.disconnect()}
    }

    val pendingCommands=dao.readyCommands(accountId,session.subjectId,CaptureLocalSettings.canSync(applicationContext,app,accountId),MAX_COMMANDS_PER_RUN)
    val handledByBatch=mutableSetOf<String>()
    val batchCandidates=mutableListOf<Pair<PendingCommand,String>>()
    for(command in pendingCommands.filter{it.capability=="health.ingest_raw"}){
      try{batchCandidates+=command to app.queue.commandBody(command)}
      catch(_:QueueKeyUnavailableException){dao.setCommandState(command.commandId,"blocked","key_unavailable");handledByBatch+=command.commandId}
    }
    for(batch in healthCommandBatches(batchCandidates)){
      val outcome=uploadHealthBatch(app,session,accessToken,batch)
      if(outcome.reauthRequired)return Result.failure(workDataOf("reason" to "reauth_required"))
      if(!outcome.fallbackToSingles)handledByBatch+=batch.map{it.first.commandId}
      needsRetry=needsRetry||outcome.needsRetry
      recoveredCommands+=outcome.recovered
      committedCommands+=outcome.committed
    }

    for(command in pendingCommands.filterNot{it.commandId in handledByBatch}){
      if(command.capability in CaptureLocalSettings.commands&&!CaptureLocalSettings.canSync(applicationContext,app,accountId))continue
      val body=try{app.queue.commandBody(command)}catch(_:QueueKeyUnavailableException){dao.setCommandState(command.commandId,"blocked","key_unavailable");continue}
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
        activeConnection.outputStream.use{if(command.capability in CaptureLocalSettings.commands&&!CaptureLocalSettings.canSync(applicationContext,app,accountId))throw CaptureSyncPaused();it.write(body.toByteArray(StandardCharsets.UTF_8))}
        val code=activeConnection.responseCode
        if(code==401){dao.setCommandState(command.commandId,"unknown");app.sessions.revoke(accountId);return Result.failure(workDataOf("reason" to "reauth_required"))}
        if(code in listOf(200,201)){
          val receiptText=activeConnection.inputStream.bufferedReader().use{it.readText()}
          val verified=receiptText.takeIf{validReceipt(it,command)}?:lookupReceipt(session,accessToken,command).verifiedBody
          if(verified!=null){commitVerified(app,command,verified);committedCommands++;continue}
          if(command.attempts>=7)dao.setCommandState(command.commandId,"failed","unverified")else{dao.setCommandState(command.commandId,"unknown");needsRetry=true};continue
        }
        val errorBody=activeConnection.errorStream?.bufferedReader()?.use{it.readText()}.orEmpty()
        if(code==503&&retryableNotApplied(errorBody)){
          dao.setCommandState(command.commandId,"pending");showWriteFence(app,command);Log.w("SyncWorker","server kept ${command.capability} behind a migration write fence");needsRetry=true;continue
        }
        if(code==429||code>=500){
          val recovered=if(code>=500)lookupReceipt(session,accessToken,command).verifiedBody else null
          if(recovered!=null){commitVerified(app,command,recovered);recoveredCommands++}
          else if(command.attempts>=7)dao.setCommandState(command.commandId,"failed",queueHttpIssue(code))
          else{dao.setCommandState(command.commandId,"unknown");needsRetry=true}
          continue
        }
        val terminal=if(isDeterministicCommandFailure(code))"blocked" else "failed"
        recordRejection(app,command,terminal,code,errorBody)
      }catch(_:CaptureSyncPaused){dao.setCommandState(command.commandId,"pending")
      }catch(error:CancellationException){throw error
      }catch(_:QueueKeyUnavailableException){dao.setCommandState(command.commandId,"blocked","key_unavailable")
      }catch(_:Exception){
        val recovered=lookupReceipt(session,accessToken,command).verifiedBody
        if(recovered!=null){commitVerified(app,command,recovered);recoveredCommands++}else if(command.attempts>=7)dao.setCommandState(command.commandId,"failed","unverified")else{dao.setCommandState(command.commandId,"unknown");needsRetry=true}
      }finally{connection?.disconnect()}
    }
    // Also recovers a process death after the atomic receipt commit but before the wake-up.
    if(HealthConnectSync.enabled()&&dao.healthRound(accountId,session.subjectId)?.progress?.ready==true)HealthConnectScheduler.resume(applicationContext,accountId)
    val includeCaptures=CaptureLocalSettings.canSync(applicationContext,app,accountId)
    val remaining=dao.readyCommands(accountId,session.subjectId,includeCaptures,1).size+dao.readyAttachments(accountId,session.subjectId,includeCaptures,1).size
    val awaitingReceipt=dao.commandsAwaitingReceipt(accountId,session.subjectId,includeCaptures,1).isNotEmpty()
    if(!needsRetry&&(remaining>0||awaitingReceipt))SyncScheduler.schedule(applicationContext,accountId,ensureNext=true)
    Log.i(TAG,"sync finished recovered=$recoveredCommands committed=$committedCommands retry=$needsRetry remaining=$remaining")
    return if(needsRetry)Result.retry()else Result.success()
  }

  private suspend fun reconcileReceipts(app:ShadowApp,session:ProductSession,accessToken:String):Result? {
    val dao=app.database.commands()
    var checked=0
    var recovered=0
    var missing=0
    var deferred=0
    try {
      while(true){
        val includeCaptures=CaptureLocalSettings.canSync(applicationContext,app,session.accountId)
        val commands=dao.commandsAwaitingReceipt(session.accountId,session.subjectId,includeCaptures,MAX_COMMANDS_PER_RUN)
        if(commands.isEmpty())return null
        val results=commands.chunked(MAX_CONCURRENT_RECEIPT_LOOKUPS).flatMap { group->
          coroutineScope {
            group.map{command->async{lookupReceipt(session,accessToken,command)}}.awaitAll()
          }
        }
        for((command,result) in commands.zip(results)){
          checked++
          when(result){
            is ReceiptLookup.Verified->{commitVerified(app,command,result.verifiedBody);recovered++}
            ReceiptLookup.Missing->{dao.setCommandState(command.commandId,"pending");missing++}
            ReceiptLookup.ReauthRequired->{
              app.sessions.revoke(session.accountId)
              return Result.failure(workDataOf("reason" to "reauth_required"))
            }
            ReceiptLookup.Deferred->deferred++
          }
        }
        if(deferred>0)return Result.retry()
      }
    } finally {
      if(checked>0)Log.i(TAG,"receipt reconciliation checked=$checked recovered=$recovered missing=$missing deferred=$deferred")
    }
  }

  private suspend fun commitVerified(app:ShadowApp,command:PendingCommand,receipt:String){
    try{app.queue.commit(command,receipt)}catch(_:QueueKeyUnavailableException){app.database.commands().commitWithHealthRound(command,"")}
    when{command.commandId.startsWith("cmd_scale_")->app.deviceSync.updateScale(command.accountId,"committed","称重数据已同步到 Life");command.commandId.startsWith("cmd_samsung_")->app.deviceSync.recordSamsungUpload(command.accountId)}
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
        if(isDeterministicCommandFailure(code)){batch.forEach{(command,_)->recordRejection(app,command,"blocked",code,errorBody)};return BatchUploadOutcome()}
        return recoverBatchAfterUnknown(app,session,accessToken,batch)
      }
      val response=JSONObject(activeConnection.inputStream.bufferedReader().use{it.readText()})
      if(response.optString("protocol")!="shadow.command-batch-result")return recoverBatchAfterUnknown(app,session,accessToken,batch)
      val byId=response.optJSONArray("items")?.let{items->(0 until items.length()).mapNotNull{items.optJSONObject(it)}.associateBy{it.optString("command_id")}}.orEmpty()
      var committed=0;var retry=false
      for((command,_) in batch){
        val item=byId[command.commandId]
        if(item==null){
          if(command.attempts>=7)dao.setCommandState(command.commandId,"failed","unverified")
          else{dao.setCommandState(command.commandId,"unknown");retry=true}
          continue
        }
        val itemCode=item.optInt("http_status",500)
        val result=item.optJSONObject("result")?.toString()
        val errorBody=item.optJSONObject("error")?.toString().orEmpty()
        when{
          itemCode in listOf(200,201)&&result!=null&&validReceipt(result,command)->{commitVerified(app,command,result);committed++}
          itemCode==503&&retryableNotApplied(errorBody)->{dao.setCommandState(command.commandId,"pending");showWriteFence(app,command);retry=true}
          isDeterministicCommandFailure(itemCode)->recordRejection(app,command,"blocked",itemCode,errorBody)
          itemCode in listOf(200,201)||itemCode==429||itemCode>=500->{
            if(command.attempts>=7){
              val reason=if(itemCode<300)"unverified" else queueHttpIssue(itemCode)
              dao.setCommandState(command.commandId,"failed",reason)
            }else{dao.setCommandState(command.commandId,"unknown");retry=true}
          }
          else->recordRejection(app,command,"failed",itemCode,errorBody)
        }
      }
      Log.i(TAG,"batch upload commands=${batch.size} committed=$committed retry=$retry")
      return BatchUploadOutcome(committed=committed,needsRetry=retry)
    }catch(error:CancellationException){throw error
    }catch(error:Exception){Log.w(TAG,"batch upload outcome unknown commands=${batch.size} type=${error.javaClass.simpleName}");return recoverBatchAfterUnknown(app,session,accessToken,batch)
    }finally{connection?.disconnect()}
  }

  private suspend fun recoverBatchAfterUnknown(app:ShadowApp,session:ProductSession,accessToken:String,batch:List<Pair<PendingCommand,String>>):BatchUploadOutcome{
    val dao=app.database.commands();var recovered=0;var retry=false
    for((command,_) in batch){
      val receipt=lookupReceipt(session,accessToken,command).verifiedBody
      if(receipt!=null){commitVerified(app,command,receipt);recovered++}
      else if(command.attempts>=7)dao.setCommandState(command.commandId,"failed","unverified")
      else{dao.setCommandState(command.commandId,"unknown");retry=true}
    }
    return BatchUploadOutcome(recovered=recovered,needsRetry=retry)
  }

  private fun lookupReceipt(session:ProductSession,accessToken:String,command:PendingCommand):ReceiptLookup{
    var connection:HttpURLConnection?=null
    return try{
      val encoded=URLEncoder.encode(command.commandId,StandardCharsets.UTF_8.toString())
      val active=(URL("${session.apiBase}/api/operations/by-command/$encoded").openConnection() as HttpURLConnection).apply {
        requestMethod="GET";connectTimeout=15_000;readTimeout=20_000
        setRequestProperty("Authorization","Bearer $accessToken")
        setRequestProperty("X-Request-Id",requestId(command.commandId,command.attempts,"receipt"))
      }
      connection=active
      val status=active.responseCode
      val stream=if(status==200)active.inputStream else active.errorStream
      val result=classifyReceiptLookup(status,stream?.bufferedReader()?.use{it.readText()}.orEmpty(),command)
      if(result==ReceiptLookup.Deferred)Log.w(TAG,"receipt lookup deferred status=$status capability=${command.capability}")
      result
    }catch(error:CancellationException){
      throw error
    }catch(error:Exception){
      Log.w(TAG,"receipt lookup transport failure capability=${command.capability} type=${error.javaClass.simpleName}")
      ReceiptLookup.Deferred
    }finally{connection?.disconnect()}
  }

  private fun retryableNotApplied(text:String)=runCatching{JSONObject(text).optString("code")=="retryable_not_applied"}.getOrDefault(false)
  private fun requestId(commandId:String,attempts:Int,phase:String)="android-$phase-${commandId.takeLast(16)}-${attempts.coerceAtLeast(0)}"
  private fun showWriteFence(app:ShadowApp,command:PendingCommand){when{command.commandId.startsWith("cmd_scale_")->app.deviceSync.updateScale(command.accountId,"error","Life 健康写入正在迁移保护中，读数已安全保留")}}
  private suspend fun recordRejection(app:ShadowApp,command:PendingCommand,state:String,status:Int,body:String){
    val code=runCatching{JSONObject(body).optString("code")}.getOrDefault("")
    app.database.commands().setCommandState(command.commandId,state,queueHttpIssue(status,code))
    val message=when(code){"conflict"->"服务器拒绝了旧版本或冲突数据，请重新发起同步";"validation"->"数据字段与服务器不兼容，请升级后重新同步";"permission_denied"->"当前账户没有健康数据写入权限";else->"数据上传失败（HTTP $status），请在数据状态中重试"}
    when{command.commandId.startsWith("cmd_scale_")->app.deviceSync.updateScale(command.accountId,"error",message)}
    Log.w(TAG,"command rejected status=$status code=${code.ifBlank{"unknown"}} capability=${command.capability}")
  }
  companion object{
    private const val TAG="SyncWorker"
    private const val MAX_COMMANDS_PER_RUN=24
    private const val MAX_ATTACHMENTS_PER_RUN=4
    private const val MAX_CONCURRENT_RECEIPT_LOOKUPS=4
    private val uploadMutex=Mutex()
  }
}

internal sealed class ReceiptLookup(open val verifiedBody:String?=null){
  data class Verified(override val verifiedBody:String):ReceiptLookup(verifiedBody)
  data object Missing:ReceiptLookup()
  data object ReauthRequired:ReceiptLookup()
  data object Deferred:ReceiptLookup()
}

internal fun classifyReceiptLookup(status:Int,body:String,command:PendingCommand):ReceiptLookup=when{
  status==200&&validReceipt(body,command)->ReceiptLookup.Verified(body)
  status==401->ReceiptLookup.ReauthRequired
  status==404&&runCatching {
    val error=JSONObject(body)
    error.optString("protocol")=="shadow.error"&&error.optString("code")=="not_found"
  }.getOrDefault(false)->ReceiptLookup.Missing
  else->ReceiptLookup.Deferred
}

private fun validReceipt(text:String,command:PendingCommand):Boolean=runCatching{
  val receipt=JSONObject(text)
  receipt.optString("protocol")=="shadow.execution-result"&&receipt.optString("status")=="committed"&&receipt.optString("command_id")==command.commandId&&receipt.optString("capability")==command.capability&&receipt.optString("execution_id").isNotBlank()
}.getOrDefault(false)

internal data class BatchUploadOutcome(val committed:Int=0,val recovered:Int=0,val needsRetry:Boolean=false,val reauthRequired:Boolean=false,val fallbackToSingles:Boolean=false)
internal fun queueHttpIssue(status:Int,code:String=""):String=when{
  status==403||code=="permission_denied"->"permission"
  status==409||code=="conflict"->"conflict"
  status==413->"too_large"
  status in listOf(400,415,422)||code=="validation"->"validation"
  status==429||status>=500->"service_unavailable"
  else->"server_rejected"
}
internal fun isDeterministicCommandFailure(status:Int)=status in listOf(400,403,409,413,415,422)
internal fun healthCommandBatches(commands:List<Pair<PendingCommand,String>>,maxCommands:Int=12,maxBytes:Int=350_000):List<List<Pair<PendingCommand,String>>>{
  val batches=mutableListOf<MutableList<Pair<PendingCommand,String>>>();var bytes=0
  for(command in commands){val size=command.second.toByteArray(StandardCharsets.UTF_8).size+1;if(batches.isEmpty()||batches.last().size>=maxCommands||bytes+size>maxBytes){batches.add(mutableListOf());bytes=0};batches.last().add(command);bytes+=size}
  return batches
}

private class CaptureSyncPaused:java.io.IOException()
