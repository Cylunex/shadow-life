package com.shadow.life

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import android.app.*
import androidx.core.app.NotificationCompat
import android.content.pm.ServiceInfo
import android.hardware.*
import android.os.Build
import android.os.PowerManager
import android.widget.Toast
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId

internal object BillShakeStatus{
 var sampling:Boolean by mutableStateOf(false)
 var message:String by mutableStateOf("等待启用屏幕内容服务")
}

/** Read-only, explicitly allowed packages; no gestures or key interception; screenshots require a separate explicit action. */
class LifeScreenCaptureService:AccessibilityService(), SensorEventListener {
 companion object {var active:LifeScreenCaptureService? by mutableStateOf(null);private set}
 private val screenState=object:BroadcastReceiver(){
   override fun onReceive(context:Context,intent:Intent){refreshShake()}
 }
 private val preferenceWatch=android.content.SharedPreferences.OnSharedPreferenceChangeListener{_,_->refreshShake()}
 override fun onCreate(){
   super.onCreate()
   registerReceiver(screenState,IntentFilter(Intent.ACTION_SCREEN_OFF).apply{addAction(Intent.ACTION_SCREEN_ON);addAction(Intent.ACTION_USER_PRESENT)})
 }
 override fun onServiceConnected(){
   super.onServiceConnected();active=this
   settings.registerOnSharedPreferenceChangeListener(preferenceWatch)
   refreshShake()
   scope.launch(Dispatchers.Main){while(isActive){delay(5000);refreshShake()}}
 }

 private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
 private var pending:Job?=null
 private val enqueueLock=Mutex()
 private val last=linkedMapOf<String,Pair<String,Long>>()
 private val sensors by lazy { getSystemService(SensorManager::class.java) }
 private val settings by lazy { getSharedPreferences("activity_capture",MODE_PRIVATE) }
 private var listeningAccount:String?=null
 private var foreground=false
 private var listeningSince=0L
 private var gesture=BillShakeGesture()

 private fun refreshShake(){
   val account=(application as ShadowApp).sessions.active()?.accountId
   val enabled=account!=null && billPlatforms.keys.any{settings.getBoolean(shakeKey(account,it),false)}
   if(!enabled){
     listen(null);if(foreground){stopForeground(STOP_FOREGROUND_REMOVE);foreground=false}
     BillShakeStatus.message="摇一摇未开启";return
   }
   if(!foreground)try{
     getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel("life_bill_shake","Life 摇一摇记账",NotificationManager.IMPORTANCE_LOW))
     val open=PendingIntent.getActivity(this,5204,packageManager.getLaunchIntentForPackage(packageName),PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
     val notification=NotificationCompat.Builder(this,"life_bill_shake").setSmallIcon(android.R.drawable.ic_menu_edit)
       .setContentTitle("Life 摇一摇记账已开启").setContentText("打开支付账单详情后摇动；可回 Life 关闭").setContentIntent(open).setOngoing(true).build()
     if(Build.VERSION.SDK_INT>=34)startForeground(5204,notification,ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) else startForeground(5204,notification)
     foreground=true
   }catch(_:Exception){listen(null);BillShakeStatus.message="系统未允许后台监听，请回 Life 关闭再开启摇一摇";return}
   val unlocked=getSystemService(PowerManager::class.java).isInteractive && !getSystemService(KeyguardManager::class.java).isKeyguardLocked
   listen(account.takeIf{unlocked})
   if(!unlocked)BillShakeStatus.message="锁屏时暂停摇动检测"
   else if(listeningAccount!=null && !BillShakeStatus.sampling && android.os.SystemClock.elapsedRealtime()-listeningSince>5000)
     BillShakeStatus.message="尚未收到传感器数据，请检查系统后台限制或重新启用屏幕内容服务"
 }
 private fun listen(account:String?){
   if(account==listeningAccount)return
   sensors.unregisterListener(this);listeningAccount=null;gesture=BillShakeGesture()
   BillShakeStatus.sampling=false
   if(account!=null){
     if(sensors.registerListener(this,sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER),SensorManager.SENSOR_DELAY_GAME)){
       listeningAccount=account;listeningSince=android.os.SystemClock.elapsedRealtime();BillShakeStatus.message="等待传感器，可在这里摇动测试"
     }else BillShakeStatus.message="加速度传感器不可用"
   }
 }
 override fun onAccuracyChanged(sensor:Sensor?,accuracy:Int){}
 override fun onSensorChanged(event:SensorEvent){
   val account=listeningAccount?:return
   if(!BillShakeStatus.sampling){BillShakeStatus.sampling=true;BillShakeStatus.message="已收到传感器数据，可摇动测试"}
   if(!gesture.sample(event.timestamp/1_000_000,event.values[0],event.values[1],event.values[2]))return
   val app=application as ShadowApp
   if(app.sessions.active()?.accountId!=account ||
      getSystemService(KeyguardManager::class.java).isKeyguardLocked || !getSystemService(PowerManager::class.java).isInteractive){refreshShake();return}
   val root=rootInActiveWindow
   val pkg=root?.packageName?.toString()
   if(pkg==packageName){feedback("已识别摇动。现在打开支付宝或微信的单笔账单详情再摇动");return}
   if(pkg==null){feedback("已识别摇动，但当前页面不可读取，请打开单笔账单详情");return}
   if(pkg !in billPlatforms || !settings.getBoolean(shakeKey(account,pkg),false))return
   val text=readCapturePage(root,billOnly=true)
   if(text==null || !resemblesBillDetail(text)){
     feedback("已识别摇动，未读到单笔账单详情；请点进一笔账单并展开交易号");return
   }
   feedback("已识别摇动，正在收录账单")
   scope.launch(Dispatchers.Main){
     try{savePage(app,account,pkg,text,true)}
     catch(e:CancellationException){throw e}catch(_:Exception){feedback("账单未保存，请回 Life 检查登录与存储")}
   }
 }
 private fun feedback(message:String){BillShakeStatus.message=message;Toast.makeText(this,message,Toast.LENGTH_LONG).show()}
 override fun onAccessibilityEvent(event:AccessibilityEvent?){
   if(event==null||event.eventType !in setOf(AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED))return
   pending?.cancel()
   val name=event.packageName?.toString()
   val app=application as ShadowApp;val session=app.sessions.active()
   if(name==null||session==null)return
   if(name==packageName||!settings.getStringSet("screen_packages_${session.accountId}",emptySet()).orEmpty().contains(name))return
   // Capture on the service's main thread after the page settles, keeping no plaintext cache.
   pending=scope.launch(Dispatchers.Main){
     delay(1200)
     if(app.sessions.active()?.accountId!=session.accountId)return@launch
     if(!settings.getStringSet("screen_packages_${session.accountId}",emptySet()).orEmpty().contains(name))return@launch
     val root=rootInActiveWindow?:return@launch
     if(root.packageName?.toString()!=name)return@launch
     val text=readCapturePage(root)?:return@launch
     try{savePage(app,session.accountId,name,text,false)}catch(e:CancellationException){throw e}catch(_:Exception){/* Later events can retry. */}
   }
 }

 private suspend fun savePage(app:ShadowApp,account:String,name:String,text:String,shaken:Boolean):Unit=enqueueLock.withLock {
   if(app.sessions.active()?.accountId!=account)return
   val now=Instant.now()
   fun hash(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString(""){"%02x".format(it)}
   val contentHash=hash(text);val key="$account:$name"
   val previous=last[key]
   if(previous!=null&&previous.first==contentHash&&now.epochSecond-previous.second<600){
     if(shaken)feedback("这页账单近期已收录，可在 Life 查看同步状态")
     return
   }
   val digest=hash("$name:${now.toEpochMilli()}:$text")
   val item=JSONObject().put("source_id","screen_$digest").put("kind","screen_text").put("title",if(shaken)"摇一摇补记 · "+(if(billPlatforms[name]=="wechat")"微信" else "支付宝") else text.lineSequence().first().take(200)).put("text",text).put("app_package",name).put("started_at",now.toString()).put("ended_at",now.toString()).put("time_zone",ZoneId.systemDefault().id)
   NativeLifeRepository(this,app).saveActivities(JSONArray().put(item),account)
   last[key]=contentHash to now.epochSecond;if(last.size>50)last.remove(last.keys.first())
   if(shaken && app.sessions.active()?.accountId==account)feedback("账单已加入同步队列，可在 Life「订单」查看记账结果")
 }
 override fun onInterrupt(){pending?.cancel()}
 override fun onDestroy(){settings.unregisterOnSharedPreferenceChangeListener(preferenceWatch);unregisterReceiver(screenState);listen(null);stopForeground(STOP_FOREGROUND_REMOVE);BillShakeStatus.message="屏幕内容服务已断开";active=null;scope.cancel();super.onDestroy()}
}

/** Shared bounded text reader for automatic allowlisted pages and explicit screenshot requests. */
internal fun readCapturePage(root:AccessibilityNodeInfo,billOnly:Boolean=false):String?{
 val lines=linkedSetOf<String>();var visited=0;var chars=0;var sensitive=false
 fun read(node:AccessibilityNodeInfo,depth:Int){
  if(++visited>250||depth>25||chars>=12000)return
  if(node.isPassword||(Build.VERSION.SDK_INT>=34&&node.isAccessibilityDataSensitive)){sensitive=true;return}
  if(node.isEditable){if(billOnly && node.isVisibleToUser)sensitive=true;return}
  if(node.isVisibleToUser){(node.text?:node.contentDescription.takeIf{billOnly})?.toString()?.trim()?.takeIf{it.isNotEmpty()}?.take(1000)?.let{if(lines.add(it))chars+=it.length}}
  for(index in 0 until minOf(node.childCount,100)){if(visited>=250||chars>=12000||sensitive)break;node.getChild(index)?.let{read(it,depth+1)}}
 }
 read(root,0);return if(sensitive||lines.isEmpty())null else lines.joinToString("\n").take(12000)
}
