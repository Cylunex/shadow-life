package com.shadow.life

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Notification
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.concurrent.TimeUnit

object NotificationSyncScheduler{
  fun onceName(accountId:String)="shadow-notifications-once-$accountId"
  fun periodicName(accountId:String)="shadow-notifications-periodic-$accountId"
  fun schedule(context:Context,accountId:String){
    val constraints=Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()
    val data=workDataOf("account_id" to accountId)
    WorkManager.getInstance(context).enqueueUniqueWork(onceName(accountId),ExistingWorkPolicy.REPLACE,OneTimeWorkRequestBuilder<NotificationSyncWorker>().setInputData(data).setConstraints(constraints).build())
    WorkManager.getInstance(context).enqueueUniquePeriodicWork(periodicName(accountId),ExistingPeriodicWorkPolicy.UPDATE,PeriodicWorkRequestBuilder<NotificationSyncWorker>(15,TimeUnit.MINUTES).setInputData(data).setConstraints(constraints).build())
  }
  fun cancel(context:Context,accountId:String){WorkManager.getInstance(context).cancelUniqueWork(onceName(accountId));WorkManager.getInstance(context).cancelUniqueWork(periodicName(accountId))}
}

class NotificationSyncWorker(context:Context,params:WorkerParameters):CoroutineWorker(context,params){
  override suspend fun doWork():Result=withContext(Dispatchers.IO){
    val accountId=inputData.getString("account_id")?:return@withContext Result.failure()
    val app=applicationContext as ShadowApp
    val fresh=when(val value=app.sessions.fresh(accountId,applicationContext)){is SessionRefresh.Ready->value.value;SessionRefresh.Retryable->return@withContext Result.retry();SessionRefresh.ReauthRequired->return@withContext Result.failure()}
    val response=runCatching{get(fresh)}.getOrElse{return@withContext Result.retry()}
    if(!response.optJSONObject("preferences").let{it?.optBoolean("enabled",true)?:true})return@withContext Result.success()
    if(Build.VERSION.SDK_INT>=33&&applicationContext.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return@withContext Result.success()
    val manager=applicationContext.getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel(CHANNEL_ID,"生活提醒",NotificationManager.IMPORTANCE_DEFAULT).apply{description="周期、健康、物品和资料处理提醒";setShowBadge(true)})
    val installationId=app.sessions.installationId()
    for(item in response.optJSONArray("items").objects().filter{candidate->candidate.optString("delivery_state")=="ready"&&candidate.optJSONArray("deliveries").objects().none{it.optString("installation_id")==installationId&&it.optString("state") in setOf("scheduled","delivered")}}){
      val id=item.getString("id")
      val intent=Intent(applicationContext,MainActivity::class.java).putExtra(OPEN_INBOX_EXTRA,true).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
      val pending=PendingIntent.getActivity(applicationContext,id.hashCode(),intent,PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
      manager.notify(id.hashCode(),Notification.Builder(applicationContext,CHANNEL_ID).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle("Shadow Life").setContentText("有一项生活安排待处理").setContentIntent(pending).setAutoCancel(true).setCategory(Notification.CATEGORY_REMINDER).setVisibility(Notification.VISIBILITY_PRIVATE).build())
      val input=JSONObject().put("notification_id",id).put("installation_id",installationId).put("state","delivered").put("attempt",1)
      val commandId="cmd_android_delivery_${digest("$id:$installationId").take(48)}"
      val body=JSONObject().put("protocol","shadow.command").put("capability","notifications.set_delivery_state").put("command_id",commandId).put("input",input).toString()
      app.queue.enqueueCommand(fresh.session,commandId,"notifications.set_delivery_state",body)
    }
    SyncScheduler.schedule(applicationContext,accountId)
    Result.success()
  }

  private fun get(fresh:FreshSession):JSONObject{
    val connection=URL("${fresh.session.apiBase}/api/notifications?limit=100").openConnection() as HttpURLConnection
    try{connection.requestMethod="GET";connection.connectTimeout=10_000;connection.readTimeout=20_000;connection.setRequestProperty("Authorization","Bearer ${fresh.accessToken}");connection.setRequestProperty("Accept","application/json");if(connection.responseCode !in 200..299)error("notification query failed");return JSONObject(connection.inputStream.bufferedReader().use{it.readText()})}finally{connection.disconnect()}
  }
}

private fun JSONArray?.objects():List<JSONObject>{if(this==null)return emptyList();return (0 until length()).mapNotNull{optJSONObject(it)}}
private fun digest(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString(""){"%02x".format(it)}
internal const val OPEN_INBOX_EXTRA="com.shadow.life.OPEN_INBOX"
private const val CHANNEL_ID="shadow_life_reminders"
