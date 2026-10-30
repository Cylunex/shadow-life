package com.shadow.life
import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.location.*
import android.os.*
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.compose.runtime.*
import kotlinx.coroutines.*
import org.json.*
import java.io.File
import java.time.*
object LifeLocationState{var accountId:String? by mutableStateOf(null);var running:Boolean by mutableStateOf(false);var message:String by mutableStateOf("")}
class LifeLocationService:Service(),LocationListener {
 private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO);private val detector=StayDetector()
 private var zone=ZoneId.systemDefault().id
 private var session:ProductSession?=null;private var label="停留地点";private var manager:LocationManager?=null
 private val handler=Handler(Looper.getMainLooper())
 private val accountWatch=object:Runnable{override fun run(){if((application as ShadowApp).sessions.active()?.accountId!=session?.accountId)stopSelf() else handler.postDelayed(this,5000)}}
 override fun onBind(intent:Intent?):IBinder?=null
 override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int{
  if(intent?.action=="stop"){finish();stopSelf();return START_NOT_STICKY}
  if(LifeLocationState.running)return START_NOT_STICKY
  val app=application as ShadowApp;val active=app.sessions.active()?:run{stopSelf();return START_NOT_STICKY}
  if(ContextCompat.checkSelfPermission(this,Manifest.permission.ACCESS_FINE_LOCATION)!=PackageManager.PERMISSION_GRANTED&&ContextCompat.checkSelfPermission(this,Manifest.permission.ACCESS_COARSE_LOCATION)!=PackageManager.PERMISSION_GRANTED){stopSelf();return START_NOT_STICKY}
  session=active;
  val previous=checkpoint(active);if(previous.exists()&&!previous.renameTo(File(previous.parentFile,"location-recovery-${java.util.UUID.randomUUID()}.pending"))){LifeLocationState.message="上次地点检查点尚未恢复，请先恢复后开始。";stopSelf();return START_NOT_STICKY}
  zone=ZoneId.systemDefault().id;label=intent?.getStringExtra("label")?.trim()?.take(200)?.ifBlank{"停留地点"}?:"停留地点"
  getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel("life_location","Life 地点记录",NotificationManager.IMPORTANCE_LOW))
  val stop=PendingIntent.getService(this,5202,Intent(this,LifeLocationService::class.java).setAction("stop"),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  startForeground(5202,NotificationCompat.Builder(this,"life_location").setSmallIcon(android.R.drawable.ic_menu_mylocation).setContentTitle("Life 正在记录停留地点").setContentText("仅保存满足停留条件的区间，可随时结束").setOngoing(true).addAction(0,"结束",stop).build())
  LifeLocationState.accountId=active.accountId;LifeLocationState.running=true;LifeLocationState.message=if(ContextCompat.checkSelfPermission(this,Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED)"等待精度足够的定位，停留至少五分钟后形成记录。" else "当前仅授权大致位置；精度不足时不形成停留，可在系统设置授予精确位置。"
  manager=getSystemService(LocationManager::class.java)
  try{
   var requested=0
   for(provider in listOf(LocationManager.NETWORK_PROVIDER,LocationManager.GPS_PROVIDER))if(manager!!.isProviderEnabled(provider))try{manager!!.requestLocationUpdates(provider,60_000L,0f,this,Looper.getMainLooper());requested++}catch(_:SecurityException){}
   check(requested>0){"没有可用定位来源，请检查系统位置开关与权限"}
   handler.post(accountWatch)
  }catch(_:Exception){LifeLocationState.message="位置来源不可用，请检查系统开关和权限。";stopSelf()}
  return START_NOT_STICKY
 }
 override fun onLocationChanged(location:Location){
  val active=session?:return;if((application as ShadowApp).sessions.active()?.accountId!=active.accountId){stopSelf();return}
  if(kotlin.math.abs(System.currentTimeMillis()-location.time)>120_000)return
  val sample=StaySample(location.time,location.latitude,location.longitude,location.accuracy.toDouble())
  val completed=detector.accept(sample);if(completed!=null){save(completed);val distance=FloatArray(1);Location.distanceBetween(completed.start.latitude,completed.start.longitude,sample.latitude,sample.longitude,distance);if(distance[0]>100)label="停留地点"}
  detector.current?.let{stay->
   persistStay(checkpoint(active),active,stay,label,zone)
   LifeLocationState.message="已取得 ${stay.samples} 次有效采样；当前停留 ${(stay.last.at-stay.start.at)/60_000} 分钟。"
  }
 }
 private fun checkpoint(session:ProductSession)=File(recordingDirectory(this,session).also{it.mkdirs()},"location.checkpoint")
 private fun save(stay:CapturedStay){
  val active=session?:return;val app=application as ShadowApp;val savedLabel=label;val savedZone=zone
  val pending=File(recordingDirectory(this,active),"location-${stay.sourceId}.pending")
  persistStay(pending,active,stay,savedLabel,savedZone)
  scope.launch{try{saveCapturedStay(this@LifeLocationService,app,active,stay,savedLabel,savedZone);pending.delete()}catch(e:CancellationException){throw e}catch(_:Exception){LifeLocationState.message="地点保存待重试，请返回 Life 恢复记录。"}}
 }
 private fun finish(){detector.finish()?.let{save(it)};session?.let{checkpoint(it).delete()}}
 override fun onDestroy(){handler.removeCallbacks(accountWatch);manager?.removeUpdates(this);finish();LifeLocationState.running=false;stopForeground(STOP_FOREGROUND_REMOVE);super.onDestroy()}
}
private suspend fun saveCapturedStay(context:Context,app:ShadowApp,session:ProductSession,stay:CapturedStay,label:String,zone:String){
 val input=JSONObject().put("source_id",stay.sourceId).put("kind","stay").put("title",label).put("started_at",Instant.ofEpochMilli(stay.start.at).toString()).put("ended_at",Instant.ofEpochMilli(stay.last.at).toString()).put("time_zone",zone).put("latitude",stay.start.latitude).put("longitude",stay.start.longitude).put("accuracy_m",maxOf(stay.start.accuracy,stay.last.accuracy))
 NativeLifeRepository(context,app).saveActivities(JSONArray().put(input),session.accountId)
}
private fun persistStay(file:File,session:ProductSession,stay:CapturedStay,label:String,zone:String){
 fun sample(s:StaySample)=JSONObject().put("at",s.at).put("lat",s.latitude).put("lon",s.longitude).put("accuracy",s.accuracy)
 val raw=JSONObject().put("source_id",stay.sourceId).put("start",sample(stay.start)).put("last",sample(stay.last)).put("samples",stay.samples).put("label",label).put("time_zone",zone)
 val atomic=android.util.AtomicFile(file);val output=atomic.startWrite()
 try{output.write(QueueCrypto().encryptLocal(session.accountId,session.subjectId,"location_checkpoint",raw.toString()).toByteArray());atomic.finishWrite(output)}catch(e:Exception){atomic.failWrite(output);throw e}
}
internal suspend fun recoverLocationCheckpoint(context:Context,app:ShadowApp,session:ProductSession):String=withContext(Dispatchers.IO){
 check(!LifeLocationState.running){"请先结束地点记录再恢复检查点"}
 val files=recordingDirectory(context,session).listFiles().orEmpty().filter{it.name=="location.checkpoint"||it.name.startsWith("location-")&&it.name.endsWith(".pending")}
 var recovered=0
 for(file in files){
  val raw=JSONObject(QueueCrypto().decryptLocal(session.accountId,session.subjectId,"location_checkpoint",file.readText()))
  fun sample(o:JSONObject)=StaySample(o.getLong("at"),o.getDouble("lat"),o.getDouble("lon"),o.getDouble("accuracy"))
  val stay=CapturedStay(raw.getString("source_id"),sample(raw.getJSONObject("start")),sample(raw.getJSONObject("last")),raw.getInt("samples"))
  if(stay.samples>=3&&stay.last.at-stay.start.at>=300_000){saveCapturedStay(context,app,session,stay,raw.optString("label","停留地点"),raw.optString("time_zone",ZoneId.systemDefault().id));recovered++}
  file.delete()
 }
 "已恢复 $recovered 份地点检查点，仅包含最后一次实际采样之前的停留。"
}
