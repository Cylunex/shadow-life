package com.shadow.life

import android.Manifest
import android.app.StatusBarManager
import android.content.*
import android.content.pm.PackageManager
import android.graphics.drawable.Icon
import android.media.*
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import org.json.*
import java.time.LocalDate

@Composable internal fun CaptureSuitePanel(accountId:String,date:LocalDate){
 val context=LocalContext.current;val app=context.applicationContext as ShadowApp;val scope=rememberCoroutineScope();val repository=remember(accountId){NativeLifeRepository(context,app)}
 var data by remember(accountId){mutableStateOf<CaptureWorkspaceResultDto?>(null)};var busy by remember(accountId){mutableStateOf(false)};var message by remember(accountId){mutableStateOf<String?>(null)}
 var section by remember(accountId){mutableStateOf("录音")};var placeName by remember(accountId){mutableStateOf("")};var player by remember(accountId){mutableStateOf<MediaPlayer?>(null)}
 var source by remember(accountId){mutableStateOf<ActivitySourceResultDto?>(null)}
 var deleteSegment by remember(accountId){mutableStateOf<String?>(null)};var editing by remember(accountId){mutableStateOf<CaptureWorkspaceResultDtoRecordingsEntry?>(null)};var editIndex by remember(accountId){mutableIntStateOf(0)};var editText by remember(accountId){mutableStateOf("")}
 var selectedApp by remember(accountId){mutableStateOf("")};var platform by remember(accountId){mutableStateOf("generic")};var sourceAccount by remember(accountId){mutableStateOf("default")};var associate by remember(accountId){mutableStateOf(true)};var autoAccounting by remember(accountId){mutableStateOf(false)};var showApps by remember{mutableStateOf(false)};var showPlatforms by remember{mutableStateOf(false)}
 val apps=remember{context.packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER),0).distinctBy{it.activityInfo.packageName}.filter{it.activityInfo.packageName!=context.packageName}.sortedBy{it.loadLabel(context.packageManager).toString()}}
 var generation by remember(accountId){mutableIntStateOf(0)}
 val selectedDate=rememberUpdatedState(date)
 suspend fun refresh(){val token=++generation;val requested=date;val result=repository.captureWorkspace(requested);if(token==generation&&app.sessions.active()?.accountId==accountId&&selectedDate.value==requested)data=result}
 fun run(block:suspend()->Unit){if(busy)return;busy=true;scope.launch{try{check(app.sessions.active()?.accountId==accountId){"账号已切换"};block()}catch(e:CancellationException){throw e}catch(e:Exception){if(app.sessions.active()?.accountId==accountId)message=e.message?:"操作失败"}finally{busy=false}}}
 suspend fun write(capability:String,input:JSONObject){repository.captureWrite(capability,input,accountId);message="请求已进入加密同步队列，完成后可刷新查看。"}
 fun recordStart(){ContextCompat.startForegroundService(context,Intent(context,LifeRecordingService::class.java))}
 val microphonePermission=rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()){if(it)recordStart() else message="未授权麦克风，录音未开始。"}
 fun startLocation(){ContextCompat.startForegroundService(context,Intent(context,LifeLocationService::class.java).putExtra("label",placeName))}
 val locationPermission=rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()){if(it[Manifest.permission.ACCESS_FINE_LOCATION]==true||it[Manifest.permission.ACCESS_COARSE_LOCATION]==true)startLocation() else message="未授权位置，地点记录未开始。"}
 LaunchedEffect(date,accountId){data=null;try{refresh()}catch(e:CancellationException){throw e}catch(e:Exception){message=e.message}}
 DisposableEffect(accountId){onDispose{player?.release();player=null}}
 Text("采集与回顾",style=MaterialTheme.typography.titleLarge)
 Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(4.dp)){listOf("录音","地点","订单","回顾","截图").forEach{label->TextButton(onClick={section=label},modifier=Modifier.weight(1f),contentPadding=PaddingValues(2.dp)){Text(label)}}}
 when(section){
 "录音"->{
  Text(if(LifeRecordingState.accountId==accountId)"录音状态：${mapOf("idle" to "未录音","recording" to "正在录音","paused" to "已暂停","finishing" to "正在封存","interrupted" to "已中断")[LifeRecordingState.status]?:LifeRecordingState.status}" else "录音尚未开始")
  if(LifeRecordingState.accountId==accountId)Text(LifeRecordingState.message)
  Row{Button(onClick={if(ContextCompat.checkSelfPermission(context,Manifest.permission.RECORD_AUDIO)==PackageManager.PERMISSION_GRANTED)recordStart()else microphonePermission.launch(Manifest.permission.RECORD_AUDIO)}){Text(if(LifeRecordingState.status=="paused")"继续录音" else "开始录音")};TextButton(onClick={context.startService(Intent(context,LifeRecordingService::class.java).setAction("pause"))},enabled=LifeRecordingState.accountId==accountId&&LifeRecordingState.status=="recording"){Text("暂停")};TextButton(onClick={context.startService(Intent(context,LifeRecordingService::class.java).setAction("stop"))},enabled=LifeRecordingState.accountId==accountId&&LifeRecordingState.status in listOf("recording","paused")){Text("结束")}}
  Text("音频先加密保存，按短片段上传。系统终止后不会自动重启麦克风。",style=MaterialTheme.typography.bodySmall)
  TextButton(enabled=!busy,onClick={run{message=recoverRecordingSegments(context,app,app.sessions.active()?:error("请先登录"))}}){Text("恢复已封存片段")}
  if(data?.transcriptionAvailable==false)Text("转写处理器尚未配置或不可用，原音频仍会保存。")
  data?.recordings?.forEach{record->Card(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
   Text(record.title,style=MaterialTheme.typography.titleMedium);Text(record.startedAt);Text("转写：${mapOf("queued" to "等待处理","running" to "处理中","completed" to "已完成","failed" to "失败")[record.state.wireValue]}");record.error?.let{Text(it)};if(!record.audioAvailable)Text("音频已按保留策略清理，转写仍保留。")
   Row{Text("长期保留音频");Switch(checked=record.protectedValue,onCheckedChange={keep->run{write("life.protect_capture",JSONObject().put("id",record.id).put("kind","recording").put("protected",keep))}})}
   fun play(at:Int){run{val bytes=repository.assetPreview(record.assetVersionId);check(app.sessions.active()?.accountId==accountId){"账号已切换"};player?.release();val next=MediaPlayer();player=next;next.setDataSource(object:MediaDataSource(){override fun getSize()=bytes.size.toLong();override fun readAt(position:Long,buffer:ByteArray,offset:Int,size:Int):Int{if(position>=bytes.size)return -1;val count=minOf(size,bytes.size-position.toInt());bytes.copyInto(buffer,offset,position.toInt(),position.toInt()+count);return count};override fun close(){bytes.fill(0)}});next.setOnPreparedListener{it.seekTo(at);it.start()};next.prepareAsync()}}
   Row{TextButton(enabled=!busy&&record.audioAvailable,onClick={play(0)}){Text("回听")};if(record.state.wireValue=="failed")TextButton(enabled=!busy,onClick={run{write("life.retry_recording",JSONObject().put("segment_id",record.id))}}){Text("重试转写")};TextButton(onClick={deleteSegment=record.id}){Text("删除录音")}}
   record.spans.forEachIndexed{index,span->Text("${span.startMs/1000}s · ${span.speaker?:"语音"}：${span.text}");Row{TextButton(enabled=!busy&&record.audioAvailable,onClick={play(span.startMs.toInt())}){Text("从这里回听")};TextButton(onClick={editing=record;editIndex=index;editText=span.text}){Text("更正")}}}
  }}}
  data?.recordingsNextBeforeId?.let{before->TextButton(enabled=!busy,onClick={run{val requested=date;val token=++generation;val next=repository.captureWorkspace(requested,before);if(token==generation&&app.sessions.active()?.accountId==accountId&&selectedDate.value==requested)data=next.copy(recordings=(data?.recordings.orEmpty()+next.recordings).distinctBy{it.id})}}){Text("加载更早的录音片段")}}
  if(player!=null)TextButton(onClick={player?.release();player=null}){Text("停止播放")}
 }
 "地点"->{
  OutlinedTextField(value=placeName,onValueChange={placeName=it.take(200)},label={Text("地点名称（可选，如家、公司）")},modifier=Modifier.fillMaxWidth())
  Text("只保存精度足够、至少三次采样且持续五分钟的停留。移动到新地点后恢复通用名称，附近商家不会自动认作已到访。")
  Button(enabled=!LifeLocationState.running,onClick={locationPermission.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION))}){Text("开始记录停留地点")}
  TextButton(enabled=LifeLocationState.running&&LifeLocationState.accountId==accountId,onClick={context.startService(Intent(context,LifeLocationService::class.java).setAction("stop"))}){Text("结束地点记录")}
  if(LifeLocationState.accountId==accountId)Text(LifeLocationState.message)
  TextButton(enabled=!busy&&!LifeLocationState.running,onClick={run{message=recoverLocationCheckpoint(context,app,app.sessions.active()?:error("请先登录"))}}){Text("恢复地点检查点")}
  Text("已同步的停留会出现在下方活动列表中，含坐标与精度。",style=MaterialTheme.typography.bodySmall)
 }
 "订单"->{
  Box{TextButton(onClick={showApps=true}){Text(apps.firstOrNull{it.activityInfo.packageName==selectedApp}?.loadLabel(context.packageManager)?.toString()?:"选择订单来源应用")};DropdownMenu(expanded=showApps,onDismissRequest={showApps=false}){apps.forEach{info->DropdownMenuItem(text={Text(info.loadLabel(context.packageManager).toString())},onClick={selectedApp=info.activityInfo.packageName;val rule=data?.rules?.firstOrNull{it.appPackage==selectedApp};if(rule!=null){platform=rule.platform.wireValue;sourceAccount=rule.sourceAccount;associate=rule.enabled;autoAccounting=rule.autoAccounting}else{platform="generic";sourceAccount="default";associate=true;autoAccounting=false};showApps=false})}}}
  Box{TextButton(onClick={showPlatforms=true}){Text("平台：${capturePlatformName(platform)}")};DropdownMenu(expanded=showPlatforms,onDismissRequest={showPlatforms=false}){listOf("generic","taobao","jd","meituan","alipay","wechat").forEach{value->DropdownMenuItem(text={Text(capturePlatformName(value))},onClick={platform=value;showPlatforms=false})}}}
  OutlinedTextField(value=sourceAccount,onValueChange={sourceAccount=it.take(200)},label={Text("平台账号标识（与账单导入保持一致）")},modifier=Modifier.fillMaxWidth())
  Row{Text("自动关联新采集的订单");Switch(checked=associate,onCheckedChange={associate=it})}
  Row{Text("证据完整时自动记账");Switch(checked=autoAccounting,onCheckedChange={autoAccounting=it})}
  Text("自动记账要求订单或交易身份、明确实付和付款时间、人民币证据以及写入权限；冲突和缺失只保留观察。")
  Button(enabled=!busy&&selectedApp.isNotBlank()&&sourceAccount.isNotBlank(),onClick={run{write("life.set_order_capture",JSONObject().put("app_package",selectedApp).put("platform",platform).put("source_account",sourceAccount.trim()).put("enabled",associate).put("auto_accounting",autoAccounting))}}){Text("保存此应用的规则")}
  data?.orders?.forEach{order->Card(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp)){Text("${capturePlatformName(order.platform)} · ${order.externalId}");Text("${mapOf("paid" to "已支付","pending" to "待付款","refunded" to "已退款","refund_pending" to "退款中","cancelled" to "已取消","unknown" to "状态未明确")[order.status]?:order.status} · ${order.sourceCount} 份材料");if(order.conflict)Text("来源存在冲突，未自动覆盖");val fields=runCatching{JSONObject(order.fields)}.getOrNull();mapOf("merchant" to "商家","product" to "商品","paid_amount" to "实付","order_amount" to "订单金额","payment_time" to "付款时间","logistics_no" to "物流单号").forEach{(key,label)->fields?.optString(key)?.takeIf{it.isNotBlank()}?.let{Text("$label：$it")}};Text(if(order.recordId==null)"尚未关联账目" else "已关联账目，同一身份不重复记账")}}}
 }
 "回顾"->{
  Text("按已采集来源生成十分钟材料、小时主线、日概览及周／月汇总。来源变化后可重算。")
  Row{listOf("day" to "日","week" to "周","month" to "月").forEach{(period,label)->TextButton(enabled=!busy,onClick={run{write("life.generate_activity_review",JSONObject().put("date",date.toString()).put("time_zone",java.time.ZoneId.systemDefault().id).put("period",period))}}){Text("生成${label}回顾")}}}
  data?.reviews?.forEach{review->Card(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp)){Text("${review.fromOn} — ${review.toOnExclusive} · 修订 ${review.revision}");if(review.stale)Text("来源已变化，需要重算");Text(review.body);review.sourceRefs.forEachIndexed{index,ref->TextButton(enabled=!busy,onClick={run{val found=repository.activitySource(ref.id);check(app.sessions.active()?.accountId==accountId);source=found}}){Text("来源 ${index+1}：${ref.title}")}}}}}
 }
 "截图"->{
  Text(if(Build.VERSION.SDK_INT>=30)"下拉快捷设置后，点“截图到 Life”，当前页面会直接截图、加密并进入收录队列。首次需启用 Life 屏幕内容服务。" else "当前系统请使用系统截图后分享给 Life；直接截图磁贴需要 Android 11 及以上。")
  TextButton(onClick={context.startActivity(Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS))}){Text("启用 Life 屏幕内容服务")}
  if(Build.VERSION.SDK_INT>=33)Button(onClick={context.getSystemService(StatusBarManager::class.java).requestAddTileService(ComponentName(context,LifeScreenshotTile::class.java),"截图到 Life",Icon.createWithResource(context,android.R.drawable.ic_menu_camera),context.mainExecutor){code->message=if(code==StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ADDED||code==StatusBarManager.TILE_ADD_REQUEST_RESULT_TILE_ALREADY_ADDED)"截图磁贴已就绪，可下拉快捷设置使用。" else "可在快捷设置的编辑页手动添加“截图到 Life”。"}}){Text("添加截图快捷磁贴")}
  Text("也支持：系统截图 → 分享 → Shadow Life。受保护页面按系统限制处理。",style=MaterialTheme.typography.bodySmall)
 }
 }
 TextButton(enabled=!busy,onClick={run{refresh();message=null}}){Text("刷新采集工作区")};if(busy)LinearProgressIndicator(Modifier.fillMaxWidth());message?.let{Text(it)};if(data?.truncated==true)Text("本日还有更多记录；录音可继续加载更早片段。")
 source?.let{value->AlertDialog(onDismissRequest={source=null},title={Text(value.title)},text={Column(Modifier.verticalScroll(rememberScrollState())){Text("${value.startedAt} — ${value.endedAt}");Text(value.text?:"此来源仅记录已观察到的活动区间。");value.latitude?.let{Text("坐标：$it, ${value.longitude}；精度 ${value.accuracyM} 米")}}},confirmButton={TextButton(onClick={source=null}){Text("关闭")}})}
 editing?.let{record->AlertDialog(onDismissRequest={editing=null},title={Text("更正转写")},text={OutlinedTextField(value=editText,onValueChange={editText=it.take(4000)},label={Text("这段实际说了什么")})},confirmButton={TextButton(enabled=editText.isNotBlank(),onClick={val spans=JSONArray();record.spans.forEachIndexed{index,span->spans.put(JSONObject().put("start_ms",span.startMs).put("end_ms",span.endMs).put("text",if(index==editIndex)editText.trim() else span.text).put("speaker",span.speaker?:JSONObject.NULL))};editing=null;run{write("life.revise_transcript",JSONObject().put("segment_id",record.id).put("expected_revision",record.revision).put("spans",spans).put("reason","用户更正转写"))}}){Text("保存")}},dismissButton={TextButton(onClick={editing=null}){Text("取消")}})}
 deleteSegment?.let{id->AlertDialog(onDismissRequest={deleteSegment=null},title={Text("删除录音与转写？")},text={Text("删除后不再可回听或检索，相同片段重传不会恢复。")},confirmButton={TextButton(onClick={deleteSegment=null;player?.release();player=null;run{write("life.delete_recording",JSONObject().put("segment_id",id))}}){Text("删除")}},dismissButton={TextButton(onClick={deleteSegment=null}){Text("取消")}})}
}

private fun capturePlatformName(value:String)=mapOf("generic" to "通用","taobao" to "淘宝","jd" to "京东","meituan" to "美团","alipay" to "支付宝","wechat" to "微信")[value]?:value
