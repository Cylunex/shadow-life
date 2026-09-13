package com.shadow.life

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.bluetooth.BluetoothAdapter
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
import android.os.ParcelUuid
import android.util.Log
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.math.BigDecimal
import java.security.MessageDigest
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.Locale
import kotlin.math.roundToLong

class ScaleScanService:Service(){
  private data class Measurement(val key:String,val address:String,val frame:XiaomiScaleFrame,val instant:Instant,val zone:ZoneId)
  private val handler=Handler(Looper.getMainLooper());private val scope=CoroutineScope(SupervisorJob()+Dispatchers.IO)
  private val bodyUuid=ParcelUuid.fromString("0000181b-0000-1000-8000-00805f9b34fb");private val miBeaconUuid=ParcelUuid.fromString("0000fe95-0000-1000-8000-00805f9b34fb")
  private var scanner:BluetoothLeScanner?=null;private var callback:ScanCallback?=null;private var accountId:String?=null;private var sawAdvertisement=false
  private val pending=mutableMapOf<String,Measurement>();private val s400=mutableMapOf<String,Measurement>();private val sent=mutableMapOf<String,Long>()
  private val pendingFlush=mutableMapOf<String,Runnable>();private val s400Flush=mutableMapOf<String,Runnable>();private var lastBindkeyWarningMs=0L
  private val finish=Runnable{update("没有收到稳定读数，请重新开秤");updateStatus("timeout","三分钟内未收到稳定读数");stopSelf()}

  override fun onBind(intent:Intent?):IBinder?=null
  override fun onCreate(){super.onCreate();getSystemService(NotificationManager::class.java).createNotificationChannel(NotificationChannel(CHANNEL,"体脂秤称重",NotificationManager.IMPORTANCE_LOW))}
  override fun onStartCommand(intent:Intent?,flags:Int,startId:Int):Int{
    accountId=intent?.getStringExtra(EXTRA_ACCOUNT_ID);sawAdvertisement=false;updateStatus("scanning","正在扫描，三分钟内上秤即可");startForeground(NOTIFICATION_ID,notification("三分钟内上秤即可记录"));handler.removeCallbacks(finish);handler.postDelayed(finish,TIMEOUT_MS);restartScan();return START_NOT_STICKY
  }
  override fun onDestroy(){handler.removeCallbacksAndMessages(null);stopScan();scope.cancel();super.onDestroy()}

  private fun restartScan(){stopScan();val manager=getSystemService(BluetoothManager::class.java);val adapter=manager?.adapter;if(adapter==null||!adapter.isEnabled){update("蓝牙未开启");updateStatus("error","蓝牙未开启");return};scanner=adapter.bluetoothLeScanner;if(scanner==null){update("蓝牙不可用");updateStatus("error","蓝牙扫描不可用");return}
    val active=object:ScanCallback(){
      override fun onScanResult(callbackType:Int,result:ScanResult){val record=result.scanRecord?:return;val address=result.device?.address?:"unknown";record.getServiceData(bodyUuid)?.let{data->handler.post{advertisement("体脂秤 2");XiaomiScaleParser.parseScale2(data)?.let{accept(address,it)}}};record.getServiceData(miBeaconUuid)?.let{data->handler.post{advertisement("S400");acceptS400(address,data)}}}
      override fun onScanFailed(errorCode:Int){Log.w(TAG,"BLE scan failed code=$errorCode");update("扫描失败（$errorCode），请重试");updateStatus("error","扫描失败（$errorCode）");callback=null;scanner=null}
    };callback=active
    val settings=ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES).setMatchMode(ScanSettings.MATCH_MODE_AGGRESSIVE).setReportDelay(0).build()
    val filters=listOf(ScanFilter.Builder().setServiceData(bodyUuid,byteArrayOf()).build(),ScanFilter.Builder().setServiceData(miBeaconUuid,byteArrayOf()).build())
    try{scanner?.startScan(filters,settings,active);Log.i(TAG,"BLE scan started")}catch(_:Exception){try{scanner?.startScan(null,settings,active);Log.i(TAG,"BLE fallback scan started")}catch(_:Exception){callback=null;scanner=null;update("没有蓝牙扫描权限");updateStatus("error","没有蓝牙扫描权限")}}
  }
  private fun stopScan(){val active=callback;if(active!=null)runCatching{scanner?.stopScan(active)};callback=null;scanner=null}

  private fun acceptS400(address:String,data:ByteArray){val prefs=runCatching{ScalePreferences(this).current()}.getOrNull();val frame=XiaomiScaleParser.parseS400(data,address,prefs?.s400Bindkey)
    if(frame==null){val now=System.currentTimeMillis();if(XiaomiScaleParser.isS400(data)&&now-lastBindkeyWarningMs>30_000){lastBindkeyWarningMs=now;update("检测到 S400，请先配置正确的 bindkey");updateStatus("needs_config","检测到 S400，请配置正确的 bindkey")};return}
    val device=address.uppercase(Locale.US);if(frame.reset){s400Flush.remove(device)?.let(handler::removeCallbacks);s400.remove(device)?.let(::enqueue);return}
    if(frame.weightKg!=null){val next=measurement(device,frame);val previous=s400[device];s400Flush.remove(device)?.let(handler::removeCallbacks);if(previous!=null&&previous.key!=next.key)enqueue(previous);val merged=previous?.takeIf{it.key==next.key}?.copy(frame=previous.frame.copy(weightKg=frame.weightKg,impedanceLow=frame.impedanceLow?:previous.frame.impedanceLow,heartRate=frame.heartRate?:previous.frame.heartRate,profileId=frame.profileId))?:next;s400[device]=merged;val flush=Runnable{s400Flush.remove(device);s400.remove(device)?.let(::enqueue)};s400Flush[device]=flush;handler.postDelayed(flush,SETTLE_MS)}
    else if(frame.impedanceHigh!=null){val previous=s400.remove(device)?:return;s400Flush.remove(device)?.let(handler::removeCallbacks);if(previous.frame.profileId==frame.profileId)enqueue(previous.copy(frame=previous.frame.copy(impedanceHigh=frame.impedanceHigh))) else enqueue(previous)}
  }
  private fun accept(address:String,frame:XiaomiScaleFrame){val next=measurement(address,frame);val old=pending[next.key];val merged=old?.copy(frame=old.frame.copy(weightKg=frame.weightKg?:old.frame.weightKg,impedanceLow=frame.impedanceLow?:old.frame.impedanceLow,measuredAt=frame.measuredAt?:old.frame.measuredAt))?:next;pending[next.key]=merged;pendingFlush.remove(next.key)?.let(handler::removeCallbacks);if(merged.frame.impedanceLow!=null)pending.remove(next.key)?.let(::enqueue) else {val flush=Runnable{pendingFlush.remove(next.key);pending.remove(next.key)?.let(::enqueue)};pendingFlush[next.key]=flush;handler.postDelayed(flush,SETTLE_MS)}}
  private fun measurement(address:String,frame:XiaomiScaleFrame):Measurement{val zone=ZoneId.systemDefault();val instant=normalize(frame.measuredAt,zone);val weight=frame.weightKg?:0.0;val key="${instant.epochSecond/60}-${kotlin.math.round(weight*200)}-${sha256(address).take(12)}";return Measurement(key,address,frame,instant,zone)}
  private fun normalize(value:LocalDateTime?,zone:ZoneId):Instant{val now=Instant.now();if(value==null)return now.epochSecond.let{Instant.ofEpochSecond(it-it%60)};val candidate=runCatching{value.atZone(zone).toInstant()}.getOrElse{return now};val delta=Duration.between(candidate,now).toMillis();if(kotlin.math.abs(delta)<=10*60_000)return candidate;val quantum=15*60_000L;return candidate.plusMillis((delta.toDouble()/quantum).roundToLong()*quantum)}

  private fun enqueue(measurement:Measurement){val now=System.currentTimeMillis();sent.entries.removeIf{now-it.value>10*60_000};if(sent.putIfAbsent(measurement.key,now)!=null)return;val weight=measurement.frame.weightKg?:return;update("已收到稳定读数，正在安全保存…");updateStatus("reading","已收到稳定读数，正在安全保存")
    scope.launch{val app=application as ShadowApp;val session=app.sessions.active()?.takeIf{it.accountId==accountId};if(session==null){update("登录已失效，读数未保存");updateStatus("error","登录已失效，读数未保存");return@launch}
      val settings=runCatching{ScalePreferences(this@ScaleScanService).current()}.getOrNull();val observations=JSONArray().put(observation("weight",decimal(weight),"kg","${measurement.frame.model}:weight"))
      measurement.frame.impedanceLow?.let{observations.put(observation("impedance_low",decimal(it),"ohm","${measurement.frame.model}:impedance_low"))};measurement.frame.impedanceHigh?.let{observations.put(observation("impedance_high",decimal(it),"ohm","${measurement.frame.model}:impedance_high"))};measurement.frame.heartRate?.let{observations.put(observation("heart_rate",it.toString(),"bpm","${measurement.frame.model}:heart_rate"))}
      val profile=settings?.profile();val impedance=measurement.frame.impedanceLow;val composition=if(profile!=null&&impedance!=null)xiaomiBodyComposition(weight,impedance,profile,measurement.instant.atZone(measurement.zone).toLocalDate()) else null
      composition?.let{observations.put(observation("body_fat",decimal(it.bodyFatPct),"%","xiaomi-bia-v1"));observations.put(observation("muscle_mass",decimal(it.muscleMassKg),"kg","xiaomi-bia-v1"));observations.put(observation("body_water",decimal(it.bodyWaterKg),"kg","xiaomi-bia-v1"));observations.put(observation("visceral_fat",decimal(it.visceralFatLevel),"level","xiaomi-bia-v1"));observations.put(observation("bmr",decimal(it.bmrKcal),"kcal/day","xiaomi-bia-v1"))}
      val date=measurement.instant.atZone(measurement.zone).toLocalDate().toString();val payload=JSONObject().put("occurred_on",date).put("occurred_at",measurement.instant.toString()).put("time_zone",measurement.zone.id).put("group_kind","measurement").put("observations",observations)
      val instance="android-scale-${sha256(measurement.address).take(24)}";val fingerprint=sha256("${measurement.frame.model}|${measurement.address}")
      val command=healthDeviceRecordCommand(session.accountId,session.subjectId,"scale",instance,fingerprint,"body",measurement.key,measurement.instant.toEpochMilli(),payload,"xiaomi-ble-2")
      try{app.queue.enqueueCommand(session,command.commandId,command.capability,command.body);app.deviceSync.recordScale(session.accountId,decimal(weight),measurement.frame.model,measurement.instant.toEpochMilli());SyncScheduler.schedule(this@ScaleScanService,session.accountId);Log.i(TAG,"stable measurement queued model=${measurement.frame.model}");update("已保存 ${decimal(weight)} kg${if(composition!=null)"，含体成分" else if(impedance!=null)"，请补档案以计算体成分" else ""}");handler.postDelayed({stopSelf()},4_000)}catch(error:Exception){Log.w(TAG,"measurement queue failed",error);update("读数保存失败，请重试");updateStatus("error","读数保存失败，请重试")}
    }
  }
  private fun observation(metric:String,value:String,unit:String,source:String)=JSONObject().put("metric_key",metric).put("value",value).put("unit",unit).put("original_field",source).put("autofilled",false)
  private fun decimal(value:Double)=BigDecimal.valueOf(value).stripTrailingZeros().toPlainString()
  private fun sha256(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString(""){"%02x".format(it)}
  private fun notification(text:String):Notification{val open=PendingIntent.getActivity(this,0,Intent(this,MainActivity::class.java),PendingIntent.FLAG_IMMUTABLE);return NotificationCompat.Builder(this,CHANNEL).setSmallIcon(R.mipmap.ic_launcher).setContentTitle("Shadow Life 体脂秤").setContentText(text).setContentIntent(open).setOngoing(true).build()}
  private fun update(text:String){handler.post{getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID,notification(text))}}
  private fun advertisement(model:String){if(sawAdvertisement)return;sawAdvertisement=true;Log.i(TAG,"BLE advertisement detected model=$model");updateStatus("detected","已发现 $model 广播，等待稳定读数")}
  private fun updateStatus(state:String,message:String){accountId?.let{(application as ShadowApp).deviceSync.updateScale(it,state,message)}}
  companion object{const val EXTRA_ACCOUNT_ID="account_id";private const val TAG="ScaleScan";private const val CHANNEL="shadow-life-scale";private const val NOTIFICATION_ID=1201;private const val TIMEOUT_MS=3*60_000L;private const val SETTLE_MS=12_000L}
}
