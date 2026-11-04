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
import android.app.KeyguardManager
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

/** Read-only, explicitly allowed packages; no gestures or key interception; screenshots require a separate explicit action. */
class LifeScreenCaptureService:AccessibilityService(), SensorEventListener {
 companion object {var active:LifeScreenCaptureService? by mutableStateOf(null);private set}
 private val screenOff=object:BroadcastReceiver(){
   override fun onReceive(context:Context,intent:Intent){listen(null)}
 }
 override fun onCreate(){super.onCreate();registerReceiver(screenOff,IntentFilter(Intent.ACTION_SCREEN_OFF))}
 override fun onServiceConnected(){super.onServiceConnected();active=this}

 private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
 private var pending:Job?=null
 private val enqueueLock=Mutex()
 private val last=linkedMapOf<String,Pair<String,Long>>()
 private val sensors by lazy { getSystemService(SensorManager::class.java) }
 private val settings by lazy { getSharedPreferences("activity_capture",MODE_PRIVATE) }
 private var listening:Pair<String,String>?=null
 private var gesture=BillShakeGesture()

 private fun listen(target:Pair<String,String>?){
   if(target==listening)return
   sensors.unregisterListener(this);listening=null;gesture=BillShakeGesture()
   if(target!=null && sensors.registerListener(this,sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER),SensorManager.SENSOR_DELAY_GAME))listening=target
 }
 override fun onAccuracyChanged(sensor:Sensor?,accuracy:Int){}
 override fun onSensorChanged(event:SensorEvent){
   val (account,pkg)=listening?:return
   if(!gesture.sample(event.timestamp/1_000_000,event.values[0],event.values[1],event.values[2]))return
   val app=application as ShadowApp
   if(app.sessions.active()?.accountId!=account || !settings.getBoolean(shakeKey(account,pkg),false) ||
      getSystemService(KeyguardManager::class.java).isKeyguardLocked || !getSystemService(PowerManager::class.java).isInteractive){listen(null);return}
   val root=rootInActiveWindow?:return
   if(root.packageName?.toString()!=pkg){listen(null);return}
   val text=readCapturePage(root,billOnly=true)
   if(text==null || !resemblesBillDetail(text)){
     Toast.makeText(this,"未读到单笔账单详情，请展开交易详情或回 Life 手动记账",Toast.LENGTH_LONG).show();return
   }
   scope.launch(Dispatchers.Main){
     try{
       savePage(app,account,pkg,text,true)
     }catch(e:CancellationException){throw e}catch(_:Exception){Toast.makeText(this@LifeScreenCaptureService,"账单未保存，请回 Life 检查登录与存储",Toast.LENGTH_LONG).show()}
   }
 }
 override fun onAccessibilityEvent(event:AccessibilityEvent?){
   if(event==null||event.eventType !in setOf(AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED))return
   pending?.cancel()
   val name=event.packageName?.toString()
   val app=application as ShadowApp;val session=app.sessions.active()
   listen(if(session!=null && name!=null && name in billPlatforms && settings.getBoolean(shakeKey(session.accountId,name),false))session.accountId to name else null)
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
     if(shaken)Toast.makeText(this,"这页账单近期已收录，可在 Life 查看同步状态",Toast.LENGTH_SHORT).show()
     return
   }
   val digest=hash("$name:${now.toEpochMilli()}:$text")
   val item=JSONObject().put("source_id","screen_$digest").put("kind","screen_text").put("title",if(shaken)"摇一摇补记 · "+(if(billPlatforms[name]=="wechat")"微信" else "支付宝") else text.lineSequence().first().take(200)).put("text",text).put("app_package",name).put("started_at",now.toString()).put("ended_at",now.toString()).put("time_zone",ZoneId.systemDefault().id)
   NativeLifeRepository(this,app).saveActivities(JSONArray().put(item),account)
   last[key]=contentHash to now.epochSecond;if(last.size>50)last.remove(last.keys.first())
   if(shaken && app.sessions.active()?.accountId==account)Toast.makeText(this,"账单已加入同步队列，可在 Life「订单」查看记账结果",Toast.LENGTH_LONG).show()
 }
 override fun onInterrupt(){listen(null);pending?.cancel()}
 override fun onDestroy(){unregisterReceiver(screenOff);listen(null);active=null;scope.cancel();super.onDestroy()}
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
