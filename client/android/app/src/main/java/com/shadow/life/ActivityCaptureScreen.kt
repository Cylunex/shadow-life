package com.shadow.life

import android.app.AppOpsManager
import android.app.usage.UsageStatsManager
import android.app.usage.UsageEvents
import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.os.Process
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.ZoneId
import java.time.Instant
import java.security.MessageDigest
import org.json.JSONArray
import org.json.JSONObject

@Composable internal fun ActivityCaptureScreen(accountId:String,onBack:()->Unit,onSource:(String)->Unit={}){
  val context=LocalContext.current;val app=context.applicationContext as ShadowApp
  val repository=remember(accountId){NativeLifeRepository(context,app)};val scope=rememberCoroutineScope()
  val preferences=remember(accountId){context.getSharedPreferences("activity_capture",Context.MODE_PRIVATE)}
  var packages by remember(accountId){mutableStateOf(preferences.getStringSet("screen_packages_$accountId",emptySet()).orEmpty().toSet())}
  val launchers=remember{context.packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER),0).distinctBy{it.activityInfo.packageName}.filter{it.activityInfo.packageName!=context.packageName}.sortedBy{it.loadLabel(context.packageManager).toString()}}
  var workspace by androidx.compose.runtime.saveable.rememberSaveable(accountId){mutableStateOf("应用与活动")}
  var showApps by remember(accountId){mutableStateOf(false)}
  var order by remember(accountId){mutableStateOf<ActivityOrderResultDto?>(null)}
  var deleteId by remember(accountId){mutableStateOf<String?>(null)}
  var date by remember(accountId){mutableStateOf(LocalDate.now())};var data by remember(accountId){mutableStateOf<ActivitiesResultDto?>(null)}
  var automatic by remember(accountId){mutableStateOf(ActivityCaptureScheduler.enabled(context,accountId))}
  var message by remember(accountId){mutableStateOf<String?>(null)};var busy by remember(accountId){mutableStateOf(false)}
  var duration by remember(accountId){mutableStateOf("")};var title by remember(accountId){mutableStateOf("")};var request by remember(accountId){mutableIntStateOf(0)}
  suspend fun read(before:String?=null){val current=++request;val result=repository.activities(date,before);if(app.sessions.active()?.accountId==accountId&&current==request)data=if(before==null)result else result.copy(items=data?.items.orEmpty()+result.items)}
  fun run(block:suspend()->Unit){if(busy)return;busy=true;scope.launch{try{check(app.sessions.active()?.accountId==accountId){"账号已切换"};block()}catch(e:CancellationException){throw e}catch(e:Exception){if(app.sessions.active()?.accountId==accountId)message=e.message?:"读取失败"}finally{busy=false}}}
  LaunchedEffect(date,accountId){data=null;message=null;try{read()}catch(e:CancellationException){throw e}catch(e:Exception){message=e.message?:"活动暂时无法读取"}}
  Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
    Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){LifeBackButton(onBack);Text("活动与采集",style=MaterialTheme.typography.headlineMedium)}
    LifeDateField(date.toString(),{date=LocalDate.parse(it)},"查看日期",!busy)
    LifeTabs(workspace,{workspace=it},listOf("应用与活动","录音","地点","截图","订单","回顾","分析","检索","设置与导出").map{it to it})
    if(workspace in setOf("分析","检索","设置与导出"))key(workspace){CaptureCompletionPanel(accountId,date,workspace)}
    if(workspace in setOf("录音","地点","截图","订单","回顾"))key(workspace){CaptureSuitePanel(accountId,date,workspace)}
    if(workspace=="应用与活动"){
    HorizontalDivider()
    Text("仅统计已捕获的完整应用区间，缺失时段保持未知；应用时长不等于专注时间。")
    data?.let{Text("已记录使用：${it.usageSeconds/60} 分钟 · ${it.total} 条活动",style=MaterialTheme.typography.titleLarge)}
    TextButton(onClick={context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))}){Text("授权应用使用情况访问")}
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text("自动采集应用使用");Switch(checked=automatic,onCheckedChange={automatic=it;ActivityCaptureScheduler.setEnabled(context,accountId,it)})}
    Text("开启后定期采集今天及昨天的完整区间；关闭停止后续采集，已入队记录继续同步。",style=MaterialTheme.typography.bodySmall)
    Button(enabled=!busy,onClick={run{
      val items=withContext(Dispatchers.IO){readUsage(context,date)}
      if(items.isEmpty())message="没有可采集的完整使用区间；请检查权限或稍后重试。"
      else{for(batch in items.chunked(100))repository.saveActivities(JSONArray(batch),accountId);message="${items.size} 条区间已进入加密同步队列。"}
    }}){Text("采集这一天的应用使用")}
    TextButton(onClick={showApps=!showApps}){Text("屏幕内容：选择允许记录的应用（${packages.size}）")}
    if(showApps){
      Text("仅记录选择的应用中可读取的页面文字，并同步到 Life。密码与系统标记的敏感内容跳过；可随时取消选择。")
      TextButton(onClick={context.startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))}){Text("前往系统启用 Life 屏幕内容服务")}
      launchers.forEach{info->val name=info.activityInfo.packageName;Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text(info.loadLabel(context.packageManager).toString(),Modifier.weight(1f));Checkbox(checked=name in packages,onCheckedChange={checked->packages=if(checked)packages+name else packages-name;preferences.edit().putStringSet("screen_packages_$accountId",packages).apply()})}}
    }
    OutlinedTextField(value=title,onValueChange={title=it.take(200)},label={Text("活动名称（结束于现在）")},modifier=Modifier.fillMaxWidth())
    OutlinedTextField(value=duration,onValueChange={duration=it.take(4)},label={Text("实际持续分钟（1–1440）")},modifier=Modifier.fillMaxWidth())
    Button(enabled=!busy&&date==LocalDate.now()&&title.isNotBlank()&&duration.toLongOrNull() in 1L..1440L,onClick={run{val end=Instant.now();val zone=ZoneId.systemDefault();repository.saveActivities(JSONArray().put(JSONObject().put("source_id","manual_${java.util.UUID.randomUUID().toString().replace("-","")}").put("kind","manual").put("title",title.trim()).put("started_at",end.minusSeconds(duration.toLong()*60).toString()).put("ended_at",end.toString()).put("time_zone",zone.id)),accountId);title="";duration="";message="活动已进入加密同步队列，实际上传状态见设置。"}}){Text("保存活动")}
    TextButton(enabled=!busy,onClick={run{read();message=null}}){Text("刷新已同步记录")}
    message?.let{Text(it)};if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
    data?.items?.sortedBy{it.startedAt}?.forEach{item->Card(Modifier.fillMaxWidth()){Column(Modifier.padding(14.dp)){Text(item.title,style=MaterialTheme.typography.titleMedium);TextButton(onClick={onSource(item.id)}){Text("分类、项目与长期保留")};Text("${item.startedAt} — ${item.endedAt}",style=MaterialTheme.typography.bodySmall);item.latitude?.let{Text("坐标 $it, ${item.longitude} · 精度 ${item.accuracyM} 米")};item.text?.let{Text(it)}
      if(item.kind.wireValue=="screen_text"&&item.text!=null)TextButton(enabled=!busy,onClick={run{val value=repository.activityOrder(item.id);if(app.sessions.active()?.accountId==accountId)order=value}}){Text("查看订单字段")};Row{if(item.text!=null)TextButton(enabled=!busy&&item.libraryItemId==null,onClick={run{repository.activityAction("life.archive_activity",item.id,accountId);message="已进入加密归档队列，完成后可在资料中检索；请稍后刷新。"}}){Text(if(item.libraryItemId==null)"另存到资料" else "已归档")};TextButton(enabled=!busy,onClick={deleteId=item.id}){Text("删除采集记录")}}
    }}}
    data?.nextBeforeId?.let{before->TextButton(enabled=!busy,onClick={run{read(before)}}){Text("加载更多")}}
    }
  }
  order?.let{value->AlertDialog(onDismissRequest={order=null},title={Text("页面中的订单信息")},text={Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)){Text("以下仅列出页面字段；实际账目关联请看采集工作区的订单页。");listOf("订单号" to value.orderId,"交易号" to value.transactionId,"商家" to value.merchant,"商品" to value.product,"订单金额" to value.orderAmount,"实付金额" to value.paidAmount,"退款金额" to value.refundAmount,"付款时间" to value.paymentTime).forEach{(label,field)->Text("$label：${field?:"未识别"}")};value.issues.forEach{Text(it)}}},confirmButton={TextButton(onClick={order=null}){Text("关闭")}})}
  deleteId?.let{id->AlertDialog(onDismissRequest={deleteId=null},title={Text("删除这条采集记录？")},text={Text("采集内容将删除且相同来源重传不会恢复；录音来源同时删除音频与转写的访问。你另存到资料的副本会保留。")},confirmButton={TextButton(onClick={deleteId=null;run{repository.activityAction("life.delete_activity",id,accountId);message="删除请求已进入加密同步队列，完成后刷新确认。"}}){Text("删除")}},dismissButton={TextButton(onClick={deleteId=null}){Text("取消")}})}
}
internal fun readUsage(context:Context,date:LocalDate):List<JSONObject>{
  val ops=context.getSystemService(AppOpsManager::class.java)
  check(ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS,Process.myUid(),context.packageName)==AppOpsManager.MODE_ALLOWED){"请先授予应用使用情况访问权限"}
  val zone=ZoneId.systemDefault();val from=date.atStartOfDay(zone).toInstant().toEpochMilli();val to=minOf(date.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli(),System.currentTimeMillis())
  val manager=context.getSystemService(UsageStatsManager::class.java);val source=manager.queryEvents(from-86_400_000,to)?:error("设备尚未解锁，使用事件不可读取")
  val events=mutableListOf<AppUsageEvent>();val event=UsageEvents.Event()
  while(source.hasNextEvent()){source.getNextEvent(event);when(event.eventType){
    UsageEvents.Event.ACTIVITY_RESUMED->events+=AppUsageEvent(event.timeStamp,event.packageName.orEmpty(),resumed=true)
    UsageEvents.Event.ACTIVITY_PAUSED->events+=AppUsageEvent(event.timeStamp,event.packageName.orEmpty())
    UsageEvents.Event.SCREEN_NON_INTERACTIVE,UsageEvents.Event.DEVICE_SHUTDOWN->events+=AppUsageEvent(event.timeStamp,"",screenOff=true)
  }}
  return appUsageIntervals(events,from,to).map{value->
    val key="${value.packageName}:${value.start}:${value.end}";val hash=MessageDigest.getInstance("SHA-256").digest(key.toByteArray()).joinToString(""){"%02x".format(it)}
    JSONObject().put("app_category",runCatching{when(context.packageManager.getApplicationInfo(value.packageName,0).category){android.content.pm.ApplicationInfo.CATEGORY_PRODUCTIVITY->"productivity";android.content.pm.ApplicationInfo.CATEGORY_NEWS->"news";android.content.pm.ApplicationInfo.CATEGORY_SOCIAL->"social";android.content.pm.ApplicationInfo.CATEGORY_AUDIO->"audio";android.content.pm.ApplicationInfo.CATEGORY_VIDEO->"video";android.content.pm.ApplicationInfo.CATEGORY_GAME->"game";android.content.pm.ApplicationInfo.CATEGORY_MAPS->"maps";else->"unknown"}}.getOrDefault("unknown")).put("source_id","usage_$hash").put("kind","app_usage").put("title",value.packageName.take(200)).put("app_package",value.packageName).put("started_at",Instant.ofEpochMilli(value.start).toString()).put("ended_at",Instant.ofEpochMilli(value.end).toString()).put("time_zone",zone.id)
  }
}
