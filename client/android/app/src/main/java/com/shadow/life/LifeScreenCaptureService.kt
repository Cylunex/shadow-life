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
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume

internal object PaymentAutoStatus{
 var accountId:String? by mutableStateOf(null)
 var message:String by mutableStateOf("付款后识别未开启")
}

internal object BillShakeStatus{
 var sampling:Boolean by mutableStateOf(false)
 var message:String by mutableStateOf("等待启用屏幕内容服务")
}

/** Read-only, explicitly allowed packages; no gestures or key interception; screenshots require a separate explicit action. */
class LifeScreenCaptureService:AccessibilityService(), SensorEventListener {
 companion object {var active:LifeScreenCaptureService? by mutableStateOf(null);private set}
 private val screenState=object:BroadcastReceiver(){
   override fun onReceive(context:Context,intent:Intent){if(intent.action==Intent.ACTION_SCREEN_OFF){autoCycle.invalidate();automatic?.cancel();pending?.cancel()};refreshShake()}
 }
 private val preferenceWatch=android.content.SharedPreferences.OnSharedPreferenceChangeListener{_,key->
   if(key?.startsWith("payment_auto:")==true){autoCycle.invalidate();automatic?.cancel();automatic=null}
   if(key?.startsWith("bill_shake:")==true)refreshShake()
 }
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
 private var automatic:Job?=null
 private val paymentReader=Executors.newSingleThreadExecutor()
 private val paymentReading=AtomicBoolean(false)
 private suspend fun readPaymentFrame(pkg:String,window:Int):String?=withTimeoutOrNull(650){
   suspendCancellableCoroutine { continuation ->
     if(!paymentReading.compareAndSet(false,true)){continuation.resume(null);return@suspendCancellableCoroutine}
     try{paymentReader.execute{
       val text=try{
         val root=rootInActiveWindow
         if(root==null)null else if(root.packageName?.toString()!=pkg||root.windowId!=window){root.recycle();null}
         else readCapturePage(root,billOnly=true)
       }catch(_:Exception){null}finally{paymentReading.set(false)}
       // A late Binder response must not authorize capture of the old window.
       if(continuation.isActive)continuation.resume(text)
     }}catch(_:java.util.concurrent.RejectedExecutionException){paymentReading.set(false);continuation.resume(null)}
   }
 }
 private val autoCycle=PaymentReadCycle()
 private var automaticTarget:String?=null
 private val activityByWindow=linkedMapOf<Int,Pair<String,String>>()
 private fun autoRule(account:String,pkg:String):PaymentAutoRule?=runCatching{
   val value=JSONObject(settings.getString(paymentAutoKey(account,pkg),null)?:return null)
   PaymentAutoRule(value.getString("platform"),value.getString("source_account")).takeIf{it.platform in setOf("wechat","alipay")&&it.sourceAccount.isNotBlank()}
 }.getOrNull()
 private fun unlocked()=getSystemService(PowerManager::class.java).isInteractive&&!getSystemService(KeyguardManager::class.java).isKeyguardLocked
 private fun autoStatus(account:String,message:String){PaymentAutoStatus.accountId=account;PaymentAutoStatus.message=message}
 private fun schedulePaymentRead(account:String,pkg:String,window:Int){
   val rule=autoRule(account,pkg)?:return
   val target="$account:$pkg:$window"
   val token=autoCycle.select(target)
   if(automatic?.isActive==true&&automaticTarget==target)return
   automatic?.cancel();automaticTarget=target
   automatic=scope.launch(Dispatchers.Main){
     var collected=false
     // Read a finite number of frames even under a constant burst of content events.
     for(wait in listOf(120L,250L,550L,1000L)){
       delay(wait)
       if(!autoCycle.current(target,token)||(application as ShadowApp).sessions.active()?.accountId!=account||autoRule(account,pkg)!=rule||!unlocked())return@launch
       val activity=activityByWindow[window]?.takeIf{it.first==pkg}?.second?:""
       val text=readPaymentFrame(pkg,window)?:continue
       if(!autoCycle.current(target,token)||(application as ShadowApp).sessions.active()?.accountId!=account||autoRule(account,pkg)!=rule||!unlocked())return@launch
       val result=paymentResultPage(pkg,activity,text,rule)?:continue
       val marker="payment_seen:$account:${result.identity}:${if(result.complete)"complete" else paymentCaptureHash(text)}"
       if(settings.contains(marker)){collected=true;if(result.complete){autoStatus(account,"这笔付款已处理，未重复提交");return@launch};continue}
       if(!autoCycle.current(target,token)||autoRule(account,pkg)!=rule)return@launch
       try{
         // The captured frame is immutable once it is in the encrypted queue.
         savePage(application as ShadowApp,account,pkg,text,false,rule);collected=true
         if((application as ShadowApp).sessions.active()?.accountId!=account)return@launch
         val editor=settings.edit().putLong(marker,System.currentTimeMillis())
         settings.all.filterKeys{it.startsWith("payment_seen:$account:")}.entries.sortedBy{(it.value as? Long)?:0}.dropLast(255).forEach{editor.remove(it.key)}
         editor.apply()
         autoStatus(account,if(result.complete)"付款结果已保存，入账状态见首页最近信息" else "付款材料已保存；缺少交易号或付款时间时暂不入账，可打开详情摇一摇补录")
       }catch(e:CancellationException){throw e}catch(_:Exception){autoStatus(account,"付款材料未保存，请检查登录与同步队列")}
       if(result.complete)return@launch
     }
     if(!collected&&autoCycle.current(target,token))autoStatus(account,"未读到完整支付结果；可打开账单详情摇一摇补录")
   }
 }
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
   if(event==null||event.eventType !in setOf(AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED,AccessibilityEvent.TYPE_WINDOWS_CHANGED))return
   val app=application as ShadowApp;val session=app.sessions.active()?:return
   if(!unlocked()){autoCycle.invalidate();automatic?.cancel();pending?.cancel();return}
   var name=event.packageName?.toString();var window=event.windowId
   if(event.eventType==AccessibilityEvent.TYPE_WINDOWS_CHANGED){
     val root=rootInActiveWindow?:return
     name=root.packageName?.toString();window=root.windowId;root.recycle()
   }
   val pkg=name?:return
   if(event.eventType!=AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED&&automaticTarget!="${session.accountId}:$pkg:$window"){
     autoCycle.invalidate();automatic?.cancel();automatic=null
   }
   if(event.eventType==AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED){
     val activity=event.className?.toString().orEmpty()
     if(!activity.startsWith("android.")&&!activity.startsWith("androidx."))activityByWindow[window]=pkg to activity
     while(activityByWindow.size>20)activityByWindow.remove(activityByWindow.keys.first())
   }
   if(pkg==packageName)return
   if(autoRule(session.accountId,pkg)!=null){schedulePaymentRead(session.accountId,pkg,window);return}
   if(!settings.getStringSet("screen_packages_${session.accountId}",emptySet()).orEmpty().contains(pkg))return
   if(pending?.isActive==true)return
   pending=scope.launch(Dispatchers.Main){
     delay(700)
     if(app.sessions.active()?.accountId!=session.accountId||!unlocked())return@launch
     if(!settings.getStringSet("screen_packages_${session.accountId}",emptySet()).orEmpty().contains(pkg))return@launch
     val root=rootInActiveWindow?:return@launch
     if(root.packageName?.toString()!=pkg){root.recycle();return@launch}
     val text=readCapturePage(root)?:return@launch
     try{savePage(app,session.accountId,pkg,text,false)}catch(e:CancellationException){throw e}catch(_:Exception){/* A later page event can retry. */}
   }
 }

 private suspend fun savePage(app:ShadowApp,account:String,name:String,text:String,shaken:Boolean,paymentRule:PaymentAutoRule?=null):Unit=enqueueLock.withLock {
   if(app.sessions.active()?.accountId!=account)return
   if(paymentRule!=null&&(autoRule(account,name)!=paymentRule||!unlocked()))throw CancellationException("付款识别已关闭")
   val now=Instant.now()
   fun hash(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString(""){"%02x".format(it)}
   val contentHash=hash(text);val key="$account:$name:${if(paymentRule!=null)"automatic" else if(shaken)"expense" else "observe"}"
   val previous=last[key]
   if(previous!=null&&previous.first==contentHash&&now.epochSecond-previous.second<600){
     if(shaken)feedback("这页账单近期已提交记账，回 Life 首页「最近信息」查看")
     return
   }
   val digest=hash("$name:${now.toEpochMilli()}:$text")
   val item=JSONObject().put("source_id","screen_$digest").put("kind","screen_text").put("title",if(paymentRule!=null)"付款自动识别 · "+(if(paymentRule.platform=="wechat")"微信" else "支付宝") else if(shaken)"摇一摇补记 · "+(if(billPlatforms[name]=="wechat")"微信" else "支付宝") else text.lineSequence().first().take(200)).put("text",text).put("app_package",name).put("started_at",now.toString()).put("ended_at",now.toString()).put("time_zone",ZoneId.systemDefault().id)
   if(paymentRule!=null)item.put("payment_context",JSONObject().put("platform",paymentRule.platform).put("source_account",paymentRule.sourceAccount).put("trigger","payment_success"))
   NativeLifeRepository(this,app).saveActivities(JSONArray().put(item),account,recordExpenses=shaken||paymentRule!=null)
   last[key]=contentHash to now.epochSecond;if(last.size>50)last.remove(last.keys.first())
   if(shaken && app.sessions.active()?.accountId==account)feedback("账单已提交记账，完整已支付账单会记为消费；回首页查看结果")
 }
 override fun onInterrupt(){pending?.cancel();automatic?.cancel();autoCycle.invalidate()}
 override fun onDestroy(){settings.unregisterOnSharedPreferenceChangeListener(preferenceWatch);unregisterReceiver(screenState);listen(null);stopForeground(STOP_FOREGROUND_REMOVE);BillShakeStatus.message="屏幕内容服务已断开";active=null;autoCycle.invalidate();automatic?.cancel();paymentReader.shutdownNow();scope.cancel();super.onDestroy()}
}

/** Reads visible text and descriptions; a truncated or sensitive tree is never accepted. */
internal fun readCapturePage(root:AccessibilityNodeInfo,billOnly:Boolean=false):String? = readCompleteCaptureText(AndroidCaptureTextNode(root),billOnly)
private class AndroidCaptureTextNode(private val node:AccessibilityNodeInfo):CaptureTextNode{
 override val visible get()=node.isVisibleToUser
 override val editable get()=node.isEditable
 override val secret get()=node.isPassword||(Build.VERSION.SDK_INT>=34&&node.isAccessibilityDataSensitive)
 override val text get()=node.text?.toString()
 override val description get()=node.contentDescription?.toString()
 override val childCount get()=node.childCount
 override fun child(index:Int)=node.getChild(index)?.let(::AndroidCaptureTextNode)
 override fun release(){node.recycle()}
}
