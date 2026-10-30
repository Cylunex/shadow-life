package com.shadow.life

import android.Manifest
import android.app.*
import android.content.*
import android.content.pm.PackageManager
import android.media.*
import android.os.IBinder
import android.os.Handler
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.compose.runtime.*
import kotlinx.coroutines.*
import org.json.JSONObject
import java.io.*
import java.time.*
import java.util.UUID

object LifeRecordingState {
 var accountId:String? by mutableStateOf(null)
 var status:String by mutableStateOf("idle")
 var message:String by mutableStateOf("")
}
class LifeRecordingService:Service(){
 private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
 private var job:Job?=null
 @Volatile private var running=false
 private var account:String?=null;private var sessionId="";private var index=0
 private var recorder:AudioRecord?=null
 private val handler=Handler(Looper.getMainLooper())
 private val accountWatch=object:Runnable{override fun run(){if(account!=null&&(application as ShadowApp).sessions.active()?.accountId!=account){running=false;recorder?.let{runCatching{it.stop()}};LifeRecordingState.status="interrupted";LifeRecordingState.message="账号已切换，录音已结束。";scope.launch{job?.join();withContext(Dispatchers.Main){stopSelf()}}}else handler.postDelayed(this,5000)}}
 override fun onBind(intent:Intent?):IBinder?=null
 override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int{
  when(intent?.action){
   "pause"->{running=false;recorder?.let{runCatching{it.stop()}};LifeRecordingState.status="paused";createNotification(true)}
   "stop"->{running=false;recorder?.let{runCatching{it.stop()}};LifeRecordingState.status="finishing";scope.launch{job?.join();withContext(Dispatchers.Main){LifeRecordingState.status="idle";stopForeground(STOP_FOREGROUND_REMOVE);stopSelf()}}}
   else->{
    val app=application as ShadowApp;val current=app.sessions.active()?:run{stopSelf();return START_NOT_STICKY}
    if(ContextCompat.checkSelfPermission(this,Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){stopSelf();return START_NOT_STICKY}
    if(account!=null&&account!=current.accountId){stopSelf();return START_NOT_STICKY}
    account=current.accountId;LifeRecordingState.accountId=current.accountId;handler.removeCallbacks(accountWatch);handler.postDelayed(accountWatch,5000)
    if(sessionId.isBlank())sessionId="recording_${UUID.randomUUID().toString().replace("-","")}"
    if(job?.isActive==true){if(LifeRecordingState.status=="paused")scope.launch{job?.join();withContext(Dispatchers.Main){onStartCommand(Intent(this@LifeRecordingService,LifeRecordingService::class.java),0,0)}};return START_NOT_STICKY}
    createNotification()
    running=true;LifeRecordingState.status="recording";LifeRecordingState.message="录音按短片段加密保存；离线可继续记录。"
    job=scope.launch{try{while(running&&app.sessions.active()?.accountId==current.accountId){recordSegment(app,current)};if(app.sessions.active()?.accountId!=current.accountId||LifeRecordingState.status=="interrupted"){running=false;LifeRecordingState.status="interrupted";withContext(Dispatchers.Main){stopForeground(STOP_FOREGROUND_REMOVE);stopSelf()}}}catch(e:CancellationException){throw e}catch(_:Exception){LifeRecordingState.message="录音已中断，已封存的片段仍在同步队列。";LifeRecordingState.status="interrupted";running=false;withContext(Dispatchers.Main){stopForeground(STOP_FOREGROUND_REMOVE);stopSelf()}}}
   }
  };return START_NOT_STICKY
 }
 private fun createNotification(paused:Boolean=false){
  val manager=getSystemService(NotificationManager::class.java);manager.createNotificationChannel(NotificationChannel("life_recording","Life 录音",NotificationManager.IMPORTANCE_LOW))
  fun action(value:String)=PendingIntent.getService(this,value.hashCode(),Intent(this,LifeRecordingService::class.java).setAction(value),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  val open=PendingIntent.getActivity(this,5201,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
  startForeground(5201,NotificationCompat.Builder(this,"life_recording").setSmallIcon(android.R.drawable.ic_btn_speak_now).setContentTitle(if(paused)"Life 录音已暂停" else "Life 正在录音").setContentText("音频在本机加密保存，可暂停或结束").setContentIntent(open).setOngoing(true).addAction(0,if(paused)"继续" else "暂停",action(if(paused)"start" else "pause")).addAction(0,"结束",action("stop")).build())
 }
 private suspend fun recordSegment(app:ShadowApp,session:ProductSession){
  if(ContextCompat.checkSelfPermission(this,Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)throw SecurityException("Microphone permission withdrawn")
  val rate=16000;val size=maxOf(AudioRecord.getMinBufferSize(rate,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT),8192)
  val audio=AudioRecord(MediaRecorder.AudioSource.MIC,rate,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,size)
  check(audio.state==AudioRecord.STATE_INITIALIZED){"Microphone unavailable"};recorder=audio
  val recordingCallback=object:AudioManager.AudioRecordingCallback(){override fun onRecordingConfigChanged(configs:MutableList<AudioRecordingConfiguration>){if(configs.any{it.isClientSilenced}){running=false;LifeRecordingState.status="interrupted";LifeRecordingState.message="麦克风被系统或其他录音占用，录音已中断。";runCatching{audio.stop()}}}}
  audio.registerAudioRecordingCallback(ContextCompat.getMainExecutor(this),recordingCallback)
  val id="audio_${UUID.randomUUID().toString().replace("-","")}"
  val root=recordingDirectory(this,session);root.mkdirs();val file=File(root,"$id.pcm.enc");val metaFile=File(root,"$id.meta")
  val metadata=JSONObject().put("segment_id",id).put("session_id",sessionId).put("segment_index",index++).put("title","录音 ${LocalDate.now()}").put("time_zone",ZoneId.systemDefault().id)
  val crypto=QueueCrypto();var count=0L
  try{
   audio.startRecording();val start=Instant.now();metadata.put("started_at",start.toString());writeRecordingMetadata(metaFile,crypto.encryptLocal(session.accountId,session.subjectId,id,metadata.toString()))
   crypto.encryptedAttachmentOutput(session.accountId,session.subjectId,id,file.outputStream()).use{output->
    val buffer=ByteArray(8192)
    while(running&&count<rate*2*90&&app.sessions.active()?.accountId==session.accountId){
     val n=audio.read(buffer,0,minOf(buffer.size,rate*2*90-count.toInt()))
     if(n<=0){if(running)error("Microphone interrupted");break}
     output.write(buffer,0,n);count+=n
    }
   }
   runCatching{audio.stop()}
   if(count<rate/5){file.delete();metaFile.delete();return}
   metadata.put("ended_at",start.plusNanos(count*1_000_000_000L/(rate*2)).toString())
   writeRecordingMetadata(metaFile,crypto.encryptLocal(session.accountId,session.subjectId,id,metadata.toString()))
   enqueueRecording(this,app,session,file,metaFile,metadata)
  }finally{audio.unregisterAudioRecordingCallback(recordingCallback);audio.release();recorder=null}
 }
 override fun onDestroy(){handler.removeCallbacks(accountWatch);running=false;recorder?.let{runCatching{it.stop()}};scope.cancel();if(LifeRecordingState.status=="recording"){LifeRecordingState.status="interrupted";LifeRecordingState.message="录音服务已停止，请打开 Life 继续。"};super.onDestroy()}
}
internal fun recordingDirectory(context:Context,session:ProductSession)=File(context.filesDir,"recording-capture/${java.security.MessageDigest.getInstance("SHA-256").digest((session.accountId+"\u0000"+session.subjectId).toByteArray()).joinToString(""){"%02x".format(it)}}")
private suspend fun enqueueRecording(context:Context,app:ShadowApp,session:ProductSession,file:File,meta:File,metadata:JSONObject){
 val id=metadata.getString("segment_id");val pcm=ByteArrayOutputStream()
 check(file.length()<=10_000_000)
 file.inputStream().use{QueueCrypto().decryptAttachment(PendingAttachment(id,session.accountId,session.subjectId,"cmd_$id",file.path,"audio/wav",encryptionVersion=1),it,pcm)}
 val wave=captureWave(pcm.toByteArray())
 app.queue.enqueueAttachment(session,id,"cmd_$id","audio/wav",Instant.parse(metadata.getString("started_at")).atZone(ZoneId.of(metadata.getString("time_zone"))).toLocalDate().toString(),metadata.getString("title"),wave.inputStream(),File(context.filesDir,"attachments/$id.enc"),metadata.toString())
 file.delete();meta.delete();SyncScheduler.schedule(context,session.accountId)
}
internal suspend fun recoverRecordingSegments(context:Context,app:ShadowApp,session:ProductSession):String=withContext(Dispatchers.IO){
 check(LifeRecordingState.accountId!=session.accountId||LifeRecordingState.status !in listOf("recording","paused","finishing")){"请先结束当前录音再恢复片段"}
 var recovered=0;var incomplete=0
 for(meta in recordingDirectory(context,session).listFiles().orEmpty().filter{it.name.endsWith(".meta")}){
  val id=meta.name.removeSuffix(".meta");try{
   val value=JSONObject(QueueCrypto().decryptLocal(session.accountId,session.subjectId,id,meta.readText()))
   if(!value.has("ended_at")){
    val bytes=ByteArrayOutputStream();val sealed=File(meta.parentFile,"$id.pcm.enc");check(sealed.length()<=10_000_000)
    sealed.inputStream().use{QueueCrypto().decryptAttachment(PendingAttachment(id,session.accountId,session.subjectId,"cmd_$id",sealed.path,"audio/wav",encryptionVersion=1),it,bytes)}
    check(bytes.size()>=3200&&bytes.size()%2==0)
    value.put("ended_at",Instant.parse(value.getString("started_at")).plusNanos(bytes.size().toLong()*1_000_000_000L/32000).toString())
   }
   enqueueRecording(context,app,session,File(meta.parentFile,"$id.pcm.enc"),meta,value);recovered++
  }catch(e:CancellationException){throw e}catch(_:Exception){incomplete++}
 }
 "恢复 $recovered 个已封存片段；$incomplete 个中断片段无法自动恢复。"
}

private fun writeRecordingMetadata(file:File,text:String){val atomic=android.util.AtomicFile(file);val output=atomic.startWrite();try{output.write(text.toByteArray());atomic.finishWrite(output)}catch(e:Exception){atomic.failWrite(output);throw e}}
