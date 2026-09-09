package com.shadow.app

import android.content.Context
import androidx.work.*
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.io.File
import java.time.LocalDate

object SyncScheduler {
  fun schedule(context:Context, accountId:String) {
    val request=OneTimeWorkRequestBuilder<SyncWorker>().setInputData(workDataOf("account_id" to accountId)).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()).build()
    WorkManager.getInstance(context).enqueueUniqueWork("shadow-sync-$accountId",ExistingWorkPolicy.KEEP,request)
  }
}

class SyncWorker(context:Context,params:WorkerParameters):CoroutineWorker(context,params) {
  override suspend fun doWork():Result=withContext(Dispatchers.IO) {
    val accountId=inputData.getString("account_id")?:return@withContext Result.failure()
    val app=applicationContext as ShadowApp
    val fresh=app.sessions.fresh(accountId,applicationContext)?:return@withContext Result.failure(workDataOf("reason" to "reauth_required"))
    val session=fresh.session
    val accessToken=fresh.accessToken
    for(attachment in app.database.commands().pendingAttachments(accountId,session.subjectId)){
      try{val file=File(attachment.localPath);val connection=URL("${session.apiBase}/api/assets").openConnection() as HttpURLConnection;connection.requestMethod="POST";connection.setRequestProperty("Authorization","Bearer $accessToken");connection.setRequestProperty("Content-Type",attachment.mediaType);connection.doOutput=true;file.inputStream().use{input->connection.outputStream.use(input::copyTo)};if(connection.responseCode==401){app.sessions.revoke(accountId);return@withContext Result.failure(workDataOf("reason" to "reauth_required"))};if(connection.responseCode !in listOf(200,201))return@withContext if(connection.responseCode in listOf(429,500,502,503,504))Result.retry() else Result.failure();val uploaded=JSONObject(connection.inputStream.bufferedReader().readText());if(uploaded.optString("protocol")!="shadow.asset")return@withContext Result.retry();val input=JSONObject().put("title","来自 Android 的图片").put("item_type","image").put("tags",org.json.JSONArray()).put("source",JSONObject().put("kind","image").put("captured_on",LocalDate.now().toString()).put("asset_version_id",uploaded.getString("asset_version_id")));val body=JSONObject().put("protocol","shadow.command").put("capability","library.capture").put("command_id",attachment.commandId).put("input",input).toString();app.database.commands().enqueue(PendingCommand(attachment.commandId,session.accountId,session.subjectId,"library.capture",body));app.database.commands().markAttachment(attachment.id,"uploaded");file.delete()}catch(_:Exception){return@withContext Result.retry()}
    }
    for(command in app.database.commands().pending(accountId,session.subjectId)) {
      try {
        val connection=URL("${session.apiBase}/api/commands/${command.capability}").openConnection() as HttpURLConnection
        connection.requestMethod="POST";connection.connectTimeout=15_000;connection.readTimeout=30_000
        connection.setRequestProperty("Authorization","Bearer $accessToken");connection.setRequestProperty("Content-Type","application/json");connection.doOutput=true
        connection.outputStream.use{it.write(command.body.toByteArray())}
        val code=connection.responseCode
        if(code==200||code==201) {
          val receipt=runCatching{JSONObject(connection.inputStream.bufferedReader().readText())}.getOrNull()
          val valid=receipt?.optString("protocol")=="shadow.execution-result"&&receipt.optString("status")=="committed"&&receipt.optString("command_id")==command.commandId&&receipt.optString("capability")==command.capability&&receipt.optString("execution_id").isNotBlank()
          if(valid||committedOperation(session,accessToken,command))app.database.commands().mark(command.commandId,"committed") else return@withContext Result.retry()
        } else when(code) {
          401->{app.sessions.revoke(accountId);return@withContext Result.failure(workDataOf("reason" to "reauth_required"))}
          403,409,422->app.database.commands().mark(command.commandId,"rejected")
          429,500,502,503,504->return@withContext Result.retry()
          else->if(committedOperation(session,accessToken,command))app.database.commands().mark(command.commandId,"committed") else return@withContext Result.retry()
        }
      } catch(_:Exception) { return@withContext Result.retry() }
    }
    Result.success()
  }
  private fun committedOperation(session:ProductSession,accessToken:String,command:PendingCommand):Boolean=runCatching{val connection=URL("${session.apiBase}/api/operations/by-command/${java.net.URLEncoder.encode(command.commandId,"UTF-8")}").openConnection() as HttpURLConnection;connection.requestMethod="GET";connection.setRequestProperty("Authorization","Bearer $accessToken");if(connection.responseCode!=200)return@runCatching false;val receipt=JSONObject(connection.inputStream.bufferedReader().readText());receipt.optString("protocol")=="shadow.execution-result"&&receipt.optString("status")=="committed"&&receipt.optString("command_id")==command.commandId&&receipt.optString("capability")==command.capability}.getOrDefault(false)
}
