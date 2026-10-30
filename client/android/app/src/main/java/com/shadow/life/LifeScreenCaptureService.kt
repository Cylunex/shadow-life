package com.shadow.life

import android.accessibilityservice.AccessibilityService
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.os.Build
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.time.Instant
import java.time.ZoneId

/** Read-only, explicitly allowed packages; no gestures, key interception or screenshots. */
class LifeScreenCaptureService:AccessibilityService(){
 private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
 private var pending:Job?=null
 private val last=linkedMapOf<String,Pair<String,Long>>()
 override fun onAccessibilityEvent(event:AccessibilityEvent?){
   if(event==null||event.eventType !in setOf(AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED,AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED))return
   pending?.cancel()
   val name=event.packageName?.toString()?:return
   val app=application as ShadowApp;val session=app.sessions.active()?:return
   val settings=getSharedPreferences("activity_capture",MODE_PRIVATE)
   if(name==packageName||!settings.getStringSet("screen_packages_${session.accountId}",emptySet()).orEmpty().contains(name))return
   // Capture on the service's main thread after the page settles, keeping no plaintext cache.
   pending=scope.launch(Dispatchers.Main){
     delay(1200)
     if(app.sessions.active()?.accountId!=session.accountId)return@launch
     if(!settings.getStringSet("screen_packages_${session.accountId}",emptySet()).orEmpty().contains(name))return@launch
     val root=rootInActiveWindow?:return@launch
     if(root.packageName?.toString()!=name)return@launch
     val lines=linkedSetOf<String>();var visited=0;var chars=0;var sensitive=false
     fun read(node:AccessibilityNodeInfo,depth:Int){
       if(++visited>250||depth>25||chars>=12000)return
       if(node.isPassword||(Build.VERSION.SDK_INT>=34&&node.isAccessibilityDataSensitive)){sensitive=true;return}
       if(node.isVisibleToUser&&!node.isEditable){node.text?.toString()?.trim()?.takeIf{it.isNotEmpty()}?.take(1000)?.let{if(lines.add(it))chars+=it.length}}
       for(index in 0 until minOf(node.childCount,100)){node.getChild(index)?.let{read(it,depth+1)}}
     }
     read(root,0);if(sensitive||lines.isEmpty())return@launch
     val text=lines.joinToString("\n").take(12000);val now=Instant.now()
     val contentHash=MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString(""){"%02x".format(it)}
     val key="${session.accountId}:$name"
     val previous=last[key];if(previous!=null&&previous.first==contentHash&&now.epochSecond-previous.second<600)return@launch
     val digest=MessageDigest.getInstance("SHA-256").digest("$name:${now.toEpochMilli()}:$text".toByteArray()).joinToString(""){"%02x".format(it)}
     val stableTime=now
     val item=JSONObject().put("source_id","screen_$digest").put("kind","screen_text").put("title",lines.first().take(200)).put("text",text).put("app_package",name).put("started_at",stableTime.toString()).put("ended_at",stableTime.toString()).put("time_zone",ZoneId.systemDefault().id)
     try{NativeLifeRepository(this@LifeScreenCaptureService,app).saveActivities(JSONArray().put(item),session.accountId);last[key]=contentHash to now.epochSecond;if(last.size>50)last.remove(last.keys.first())}catch(e:CancellationException){throw e}catch(_:Exception){/* A later page event retries through the same stable source identity. */}
   }
 }
 override fun onInterrupt(){pending?.cancel()}
 override fun onDestroy(){scope.cancel();super.onDestroy()}
}
