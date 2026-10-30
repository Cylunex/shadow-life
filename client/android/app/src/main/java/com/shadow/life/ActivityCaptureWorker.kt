package com.shadow.life

import android.content.Context
import androidx.work.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import java.time.LocalDate
import java.util.concurrent.TimeUnit

class ActivityCaptureWorker(context:Context,parameters:WorkerParameters):CoroutineWorker(context,parameters){
 override suspend fun doWork():Result=withContext(Dispatchers.IO){
   val account=inputData.getString("account")?:return@withContext Result.failure()
   val app=applicationContext as ShadowApp
   if(!ActivityCaptureScheduler.enabled(applicationContext,account)||app.sessions.active()?.accountId!=account)return@withContext Result.success()
   try{
     val repository=NativeLifeRepository(applicationContext,app)
     for(date in listOf(LocalDate.now().minusDays(1),LocalDate.now())){
       if(!ActivityCaptureScheduler.enabled(applicationContext,account)||app.sessions.active()?.accountId!=account)return@withContext Result.success()
       for(batch in readUsage(applicationContext,date).chunked(100)){
         if(!ActivityCaptureScheduler.enabled(applicationContext,account))return@withContext Result.success()
         repository.saveActivities(JSONArray(batch),account)
       }
     }
     Result.success()
   }catch(e:CancellationException){throw e}catch(e:IllegalStateException){Result.success()}catch(e:Exception){Result.retry()}
 }
}
object ActivityCaptureScheduler {
 private fun key(account:String)="activity_capture_$account"
 fun enabled(context:Context,account:String)=context.getSharedPreferences("activity_capture",Context.MODE_PRIVATE).getBoolean(key(account),false)
 fun setEnabled(context:Context,account:String,enabled:Boolean){
   context.getSharedPreferences("activity_capture",Context.MODE_PRIVATE).edit().putBoolean(key(account),enabled).apply()
   val manager=WorkManager.getInstance(context)
   if(!enabled){manager.cancelUniqueWork(key(account));return}
   manager.enqueueUniquePeriodicWork(key(account),ExistingPeriodicWorkPolicy.KEEP,PeriodicWorkRequestBuilder<ActivityCaptureWorker>(15,TimeUnit.MINUTES).setInputData(workDataOf("account" to account)).build())
 }
}
