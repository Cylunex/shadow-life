package com.shadow.life

import android.Manifest
import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothManager
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Intent
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.Build
import android.os.ParcelUuid
import android.os.SystemClock
import android.content.pm.PackageManager
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.job
import kotlinx.coroutines.joinAll
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.math.RoundingMode
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.Locale
import kotlin.math.roundToLong

class ScaleScanService:Service(){
  private data class Measurement(val key:String,val address:String,val frame:XiaomiScaleFrame,val broadcastIds:Set<String>,val instant:Instant,val zone:ZoneId)
  private val handler=Handler(Looper.getMainLooper());private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
  private val bodyUuid=ParcelUuid.fromString("0000181b-0000-1000-8000-00805f9b34fb");private val miBeaconUuid=ParcelUuid.fromString("0000fe95-0000-1000-8000-00805f9b34fb")
  private var scanner:BluetoothLeScanner?=null;private var callback:ScanCallback?=null;private var accountId:String?=null;private var sawAdvertisement=false
  private val pending=ScaleReadingWindow(handler,SETTLE_MS,::enqueue)
  private val s400=ScaleReadingWindow(handler,SETTLE_MS,::enqueue)
  private val scalePreferences by lazy { ScalePreferences(this) }
  private var scanStartedAt=0L
  private var lastBindkeyWarning:String?=null
  @Volatile private var accepting=false
  @Volatile private var scanGeneration=0
  private val finish=Runnable {
    if (!savePending("scan_timeout")) {
      Log.i(TAG,"BLE scan timed out saw_advertisement=$sawAdvertisement")
      endScan("timeout","三分钟内未收到稳定读数")
    }
  }

  override fun onBind(intent:Intent?):IBinder?=null
  override fun onCreate(){super.onCreate();getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL,"体脂秤称重",NotificationManager.IMPORTANCE_LOW))}
  override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int{
    if(intent?.action==ACTION_CANCEL){
      if(accountId==null||accountId==intent.getStringExtra(EXTRA_ACCOUNT_ID)){
        accepting=false;val generation=++scanGeneration
        handler.removeCallbacksAndMessages(null);stopScan();pending.clear();s400.clear()
        updateStatus("cancelled","已取消接收，已保存的读数会继续同步")
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopAfterWrites(generation)
      }
      return START_NOT_STICKY
    }
    scanGeneration++
    handler.removeCallbacksAndMessages(null)
    pending.clear()
    s400.clear()
    accepting=true
    accountId=intent?.getStringExtra(EXTRA_ACCOUNT_ID)
    sawAdvertisement=false
    scanStartedAt=SystemClock.elapsedRealtime()
    lastBindkeyWarning=null
    updateStatus("scanning","正在扫描，三分钟内上秤即可")
    startForeground(NOTIFICATION_ID,notification("三分钟内上秤即可记录"))
    handler.postDelayed(finish,TIMEOUT_MS)
    restartScan()
    return START_NOT_STICKY
  }
  override fun onDestroy(){accepting=false;handler.removeCallbacksAndMessages(null);stopScan();scope.cancel();super.onDestroy()}

  @SuppressLint("MissingPermission")
  private fun restartScan(){
    stopScan()
    if(!hasBluetoothScanPermission()){
      endScan("needs_permission","请授权附近设备后重试")
      return
    }
    val adapter=getSystemService(BluetoothManager::class.java)?.adapter
    if(adapter?.isEnabled!=true){
      endScan("error","蓝牙未开启")
      return
    }
    val bleScanner=adapter.bluetoothLeScanner
    if(bleScanner==null){
      endScan("error","蓝牙扫描不可用")
      return
    }
    scanner=bleScanner
    val generation=scanGeneration
    val active=object:ScanCallback(){
      override fun onScanResult(callbackType:Int,result:ScanResult){
        if(!accepting||generation!=scanGeneration)return
        val record=result.scanRecord?:return
        val address=result.device?.address?:"unknown"
        record.getServiceData(bodyUuid)?.let { data ->
          handler.post {
            if(!accepting||generation!=scanGeneration)return@post
            advertisement("体脂秤 2")
            XiaomiScaleParser.parseScale2(data)?.let{accept(address,it,broadcastId(address,data))}
          }
        }
        record.getServiceData(miBeaconUuid)?.takeIf(XiaomiScaleParser::isS400)?.let { data ->
          handler.post {
            if(!accepting||generation!=scanGeneration)return@post
            advertisement("S400")
            acceptS400(address,data)
          }
        }
      }
      override fun onScanFailed(errorCode:Int){
        handler.post {
          if(!accepting||generation!=scanGeneration)return@post
          Log.w(TAG,"BLE scan failed code=$errorCode")
          if(!savePending("scan_failed"))endScan("error","扫描失败（$errorCode），请重试")
        }
      }
    }
    callback=active
    val settings=ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES).setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE).setReportDelay(0).build()
    val filters=listOf(ScanFilter.Builder().setServiceData(bodyUuid,byteArrayOf()).build(),ScanFilter.Builder().setServiceData(miBeaconUuid,byteArrayOf()).build())
    try{
      bleScanner.startScan(filters,settings,active)
      Log.i(TAG,"BLE scan started")
    }catch(_:Exception){
      try{
        bleScanner.startScan(null,settings,active)
        Log.i(TAG,"BLE fallback scan started")
      }catch(error:Exception){
        Log.w(TAG,"BLE scan start failed type=${error.javaClass.simpleName}")
        endScan("error","蓝牙扫描无法启动，请重试")
      }
    }
  }

  private fun savePending(reason:String):Boolean {
    return s400.finishFirst(reason)||pending.finishFirst(reason)
  }

  private fun endScan(state:String,message:String){
    accepting=false
    handler.removeCallbacks(finish)
    stopScan()
    pending.clear()
    s400.clear()
    updateStatus(state,message)
    stopAfterWrites(scanGeneration)
  }

  private fun stopAfterWrites(generation:Int){
    val writes=scope.coroutineContext.job.children.toList()
    scope.launch{writes.joinAll();handler.post{if(generation==scanGeneration)stopSelf()}}
  }
  @SuppressLint("MissingPermission")
  private fun stopScan(){val active=callback;if(active!=null&&hasBluetoothScanPermission())runCatching{scanner?.stopScan(active)};callback=null;scanner=null}

  private fun hasBluetoothScanPermission():Boolean=if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.S){
    ContextCompat.checkSelfPermission(this,Manifest.permission.BLUETOOTH_SCAN)==PackageManager.PERMISSION_GRANTED&&ContextCompat.checkSelfPermission(this,Manifest.permission.BLUETOOTH_CONNECT)==PackageManager.PERMISSION_GRANTED
  }else ContextCompat.checkSelfPermission(this,Manifest.permission.ACCESS_FINE_LOCATION)==PackageManager.PERMISSION_GRANTED

  private fun acceptS400(address:String,data:ByteArray){val key=runCatching{scalePreferences.s400Bindkey()}.getOrNull();val frame=when(val parsed=XiaomiScaleParser.inspectS400(data,address,key)){
    is S400ParseResult.Measurement->parsed.frame
    S400ParseResult.NotMeasurement,S400ParseResult.InvalidFrame->return
    S400ParseResult.MissingBindkey->{warnBindkey("needs_config","检测到 S400；需要配置这台秤的 32 位 BLE bindkey");return}
    S400ParseResult.BindkeyMismatch->{warnBindkey("key_mismatch","S400 bindkey 已保存，但与当前体脂秤不匹配");return}
  }
    val device=address.uppercase(Locale.US)
    val broadcast=broadcastId(device,data)
    if(!frame.reset && frame.weightKg!=null && alreadySaved(broadcast))return
    if(frame.reset)clearSavedBroadcast(device,frame.profileId)
    val previous=s400[device]
    when {
      frame.reset -> s400.finish(device,"scale_reset")
      frame.weightKg!=null -> {
        // S400 supplies no timestamp. A repeated frame retains its first receive time across minute boundaries.
        if(previous!=null&&(previous.frame.weightKg!=frame.weightKg||previous.frame.profileId!=frame.profileId)){
          s400.finish(device,"next_reading")
          if(!accepting)return
        }
        val buffered=s400[device]
        val next=buffered?.copy(broadcastIds=(buffered.broadcastIds+broadcast).takeLastBroadcasts(),frame=buffered.frame.copy(
          impedanceLow=frame.impedanceLow?:buffered.frame.impedanceLow,
          heartRate=frame.heartRate?:buffered.frame.heartRate
        ))?:measurement(device,frame,broadcast)
        if(s400.collect(device,next))showWeight(next)
      }
      frame.impedanceHigh!=null && previous?.frame?.profileId==frame.profileId ->
        s400.finish(device,"impedance"){it.copy(frame=it.frame.copy(impedanceHigh=frame.impedanceHigh))}
    }
  }
  private fun warnBindkey(state:String,message:String){
    if(lastBindkeyWarning==state)return
    lastBindkeyWarning=state
    Log.i(TAG,"S400 frame could not be read state=$state")
    if(s400.hasReading||pending.hasReading)return
    update(message)
    updateStatus(state,message)
  }
  private fun accept(address:String,frame:XiaomiScaleFrame,broadcast:String){
    if(alreadySaved(broadcast))return
    val next=measurement(address,frame,broadcast)
    val windowKey=listOf(address,frame.model,frame.weightKg,frame.measuredAt).joinToString("|")
    val old=pending[windowKey]
    val merged=old?.copy(broadcastIds=(old.broadcastIds+broadcast).takeLastBroadcasts(),frame=frame.copy(impedanceLow=frame.impedanceLow?:old.frame.impedanceLow))?:next
    if(merged.frame.impedanceLow!=null){
      if(!pending.finish(windowKey,"impedance"){merged})enqueue(merged,"impedance")
    }else if(pending.collect(windowKey,merged))showWeight(merged)
  }
  private fun showWeight(measurement:Measurement){
    val weight=measurement.frame.weightKg?:return
    Log.i(TAG,"Weight received model=${measurement.frame.model} elapsed_ms=${SystemClock.elapsedRealtime()-scanStartedAt}")
    val formatted=decimal(weight)
    update("已收到 $formatted kg，等待体成分")
    updateStatus("collecting","等待体成分",formatted)
  }
  private fun broadcastId(address:String,data:ByteArray)=sha256(address.uppercase(Locale.US)+":"+data.joinToString(""){"%02x".format(it)})
  private fun Set<String>.takeLastBroadcasts()=toList().takeLast(32).toSet()
  private val broadcasts by lazy { getSharedPreferences("scale-broadcasts",MODE_PRIVATE) }
  private fun alreadySaved(id:String):Boolean {
    val account=accountId?:return false
    val key="saved:$account:$id"
    val at=broadcasts.getLong(key,-1)
    return at>=0 && SystemClock.elapsedRealtime()-at in 0..30_000
  }
  private fun clearSavedBroadcast(address:String,profile:Int?) {
    val account=accountId?:return
    val group="group:$account:${sha256(address)}:$profile"
    val ids=broadcasts.getStringSet(group,null).orEmpty()
    val edit=broadcasts.edit().remove(group)
    for(id in ids)edit.remove("saved:$account:$id")
    edit.apply()
  }
  private fun rememberBroadcast(measurement:Measurement,account:String) {
    val group="group:$account:${sha256(measurement.address)}:${measurement.frame.profileId}"
    val edit=broadcasts.edit()
    val now=SystemClock.elapsedRealtime()
    for((key,value) in broadcasts.all)if(key.startsWith("saved:") && value is Long && now-value !in 0..30_000)edit.remove(key)
    if(measurement.frame.profileId!=null)edit.putStringSet(group,measurement.broadcastIds)
    for(id in measurement.broadcastIds)edit.putLong("saved:$account:$id",now)
    edit.apply()
  }

  private fun measurement(address:String,frame:XiaomiScaleFrame,broadcast:String):Measurement{
    val zone=ZoneId.systemDefault()
    val instant=normalize(frame.measuredAt,zone)
    // Use the scale's timestamp when it provides one. For radio-only frames
    // the first observed instant belongs to this scan, independent of rounding.
    val identity=frame.measuredAt?.let{"clock:$it"}?:"received:${instant.toEpochMilli()}"
    val key="scale-v2-"+sha256("$address|$identity|${frame.profileId}|${frame.weightKg}").take(40)
    return Measurement(key,address,frame,setOf(broadcast),instant,zone)
  }
  private fun normalize(value:LocalDateTime?,zone:ZoneId):Instant{val now=Instant.now();if(value==null)return now;val candidate=runCatching{value.atZone(zone).toInstant()}.getOrElse{return now};val delta=Duration.between(candidate,now).toMillis();if(kotlin.math.abs(delta)<=10*60_000)return candidate;val quantum=15*60_000L;return candidate.plusMillis((delta.toDouble()/quantum).roundToLong()*quantum)}

  private fun enqueue(measurement:Measurement,reason:String){
    val weight=measurement.frame.weightKg?:return
    if(!accepting)return
    val generation=scanGeneration
    val receivingAccount=accountId
    accepting=false
    stopScan()
    handler.removeCallbacks(finish)
    pending.clear()
    s400.clear()
    Log.i(TAG,"Saving weight model=${measurement.frame.model} reason=$reason elapsed_ms=${SystemClock.elapsedRealtime()-scanStartedAt}")
    update("正在保存 ${decimal(weight)} kg")
    updateStatus("reading","正在安全保存体重",decimal(weight))
    scope.launch {
      try {
        saveMeasurement(measurement,weight,receivingAccount,generation)
      } catch(error:CancellationException){
        throw error
      } catch(error:Exception){
        Log.w(TAG,"Measurement save failed type=${error.javaClass.simpleName}")
        withContext(Dispatchers.Main.immediate){
          if(generation==scanGeneration){
            endScan("error","读数保存失败，请重试")
          }
        }
      }
    }
  }
  private suspend fun saveMeasurement(measurement:Measurement,weight:Double,receivingAccount:String?,generation:Int){
      val app=application as ShadowApp
      val session=app.sessions.active()?.takeIf{it.accountId==receivingAccount}
      if(session==null){
        withContext(Dispatchers.Main.immediate){
          if(generation==scanGeneration){
            endScan("error","登录已失效，读数未保存")
          }
        }
        return
      }
      val settings=runCatching{scalePreferences.current()}.getOrNull();val observations=JSONArray().put(observation("weight",decimal(weight),"kg","${measurement.frame.model}:weight"))
      measurement.frame.impedanceLow?.let{observations.put(observation("impedance_low",decimal(it),"ohm","${measurement.frame.model}:impedance_low"))};measurement.frame.impedanceHigh?.let{observations.put(observation("impedance_high",decimal(it),"ohm","${measurement.frame.model}:impedance_high"))};measurement.frame.heartRate?.let{observations.put(observation("heart_rate",it.toString(),"bpm","${measurement.frame.model}:heart_rate"))}
      val profile=settings?.profile();val impedance=measurement.frame.impedanceLow;val composition=if(profile!=null&&impedance!=null)xiaomiBodyComposition(weight,impedance,profile,measurement.instant.atZone(measurement.zone).toLocalDate()) else null
      composition?.let{
        observations.put(observation("bmi",decimal(it.bmi),"kg/m²","xiaomi-bia-v1",true));observations.put(observation("body_fat",decimal(it.bodyFatPct),"%","xiaomi-bia-v1",true));observations.put(observation("fat_mass",decimal(it.fatMassKg),"kg","xiaomi-bia-v1",true));observations.put(observation("lean_mass",decimal(it.leanMassKg),"kg","xiaomi-bia-v1",true));observations.put(observation("muscle_mass",decimal(it.muscleMassKg),"kg","xiaomi-bia-v1",true));observations.put(observation("muscle_rate",decimal(it.musclePct),"%","xiaomi-bia-v1",true));observations.put(observation("body_water",decimal(it.bodyWaterKg),"kg","xiaomi-bia-v1",true));observations.put(observation("body_water_rate",decimal(it.bodyWaterPct),"%","xiaomi-bia-v1",true));observations.put(observation("bone_mass",decimal(it.boneMassKg),"kg","xiaomi-bia-v1",true));observations.put(observation("bone_rate",decimal(it.bonePct),"%","xiaomi-bia-v1",true));observations.put(observation("visceral_fat",decimal(it.visceralFatLevel),"level","xiaomi-bia-v1",true));observations.put(observation("bmr",decimal(it.bmrKcal),"kcal/day","xiaomi-bia-v1",true))
      }
      val date=measurement.instant.atZone(measurement.zone).toLocalDate().toString();val payload=JSONObject().put("occurred_on",date).put("occurred_at",measurement.instant.toString()).put("time_zone",measurement.zone.id).put("group_kind","measurement").put("observations",observations)
      val instance="android-scale-${sha256(measurement.address).take(24)}";val fingerprint=sha256("${measurement.frame.model}|${measurement.address}")
      val command=healthDeviceRecordCommand(session.accountId,session.subjectId,"scale",instance,fingerprint,"body",measurement.key,measurement.instant.toEpochMilli(),payload,"xiaomi-ble-2")
      val inserted=app.queue.enqueueCommand(session,command.commandId,command.capability,command.body)>=0
      rememberBroadcast(measurement,session.accountId)
      withContext(Dispatchers.Main.immediate){
        val current=generation==scanGeneration
        app.deviceSync.recordScale(session.accountId,decimal(weight),measurement.frame.model,measurement.instant.toEpochMilli(),updateState=current)
        SyncScheduler.schedule(this@ScaleScanService,session.accountId)
        Log.i(TAG,"Stable measurement queued model=${measurement.frame.model} inserted=$inserted")
        if(current){
          update("已保存 ${decimal(weight)} kg${if(composition!=null)"，含体成分" else if(impedance!=null)"，请补档案以计算体成分" else ""}")
          handler.postDelayed({if(generation==scanGeneration)stopAfterWrites(generation)},4_000)
        }
      }
  }
  private fun observation(metric:String,value:String,unit:String,source:String,autofilled:Boolean=false)=JSONObject().put("metric_key",metric).put("value",value).put("unit",unit).put("original_field",source).put("autofilled",autofilled)
  private fun decimal(value:Double)=BigDecimal.valueOf(value).setScale(6,RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
  private fun sha256(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString(""){"%02x".format(it)}
  private fun notification(text:String):Notification{val open=PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE);return NotificationCompat.Builder(this,CHANNEL).setSmallIcon(R.drawable.ic_life_mark).setContentTitle("Shadow Life 体脂秤").setContentText(text).setContentIntent(open).setOngoing(true).build()}
  private fun update(text:String){getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID,notification(text))}
  private fun advertisement(model:String){if(sawAdvertisement)return;sawAdvertisement=true;Log.i(TAG,"BLE advertisement detected model=$model");updateStatus("detected","已发现 $model 广播，等待稳定读数")}
  private fun updateStatus(state:String,message:String,pendingWeight:String?=null){accountId?.let{(application as ShadowApp).deviceSync.updateScale(it,state,message,pendingWeight)}}
  companion object{const val ACTION_CANCEL="com.shadow.life.CANCEL_SCALE";const val EXTRA_ACCOUNT_ID="account_id";private const val TAG="ScaleScan";private const val CHANNEL="shadow-life-scale";private const val NOTIFICATION_ID=1201;private const val TIMEOUT_MS=3*60_000L;private const val SETTLE_MS=12_000L}
}
