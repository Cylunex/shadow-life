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
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import kotlinx.coroutines.*
import org.json.*
import java.time.LocalDate

@Composable internal fun CaptureSuitePanel(accountId:String,date:LocalDate,initialSection:String="录音",onMoneyRecord:(String)->Unit={}){
 val context=LocalContext.current;val app=context.applicationContext as ShadowApp;val scope=rememberCoroutineScope();val repository=remember(accountId){NativeLifeRepository(context,app)}
 var data by remember(accountId){mutableStateOf<CaptureWorkspaceResultDto?>(null)};var busy by remember(accountId){mutableStateOf(false)};var message by remember(accountId){mutableStateOf<String?>(null)}
 var section by remember(accountId,initialSection){mutableStateOf(initialSection)};var placeName by remember(accountId){mutableStateOf("")};var player by remember(accountId){mutableStateOf<MediaPlayer?>(null)}
 var source by remember(accountId){mutableStateOf<ActivitySourceResultDto?>(null)}
 var deleteSegment by remember(accountId){mutableStateOf<String?>(null)};var editing by remember(accountId){mutableStateOf<CaptureWorkspaceResultDtoRecordingsEntry?>(null)};var editIndex by remember(accountId){mutableIntStateOf(0)};var editText by remember(accountId){mutableStateOf("")}
 var showOrderSettings by rememberSaveable(accountId){mutableStateOf(false)}
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
 Text(if(section=="订单")"采集结果" else "采集与回顾",style=MaterialTheme.typography.titleLarge)

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
  val prefs=remember { context.getSharedPreferences("activity_capture",Context.MODE_PRIVATE) }
  val hasSensor=remember { context.getSystemService(android.hardware.SensorManager::class.java).getDefaultSensor(android.hardware.Sensor.TYPE_ACCELEROMETER)!=null }
  fun selectApp(pkg:String){
   selectedApp=pkg;val rule=data?.rules?.firstOrNull{it.appPackage==pkg}
   val localAuto=runCatching{JSONObject(prefs.getString(paymentAutoKey(accountId,pkg),null)?:"{}")}.getOrNull()
   platform=localAuto?.optString("platform")?.takeIf{it.isNotBlank()}?:rule?.platform?.wireValue?:billPlatforms[pkg]?:"generic";sourceAccount=localAuto?.optString("source_account")?.takeIf{it.isNotBlank()}?:rule?.sourceAccount?:"default"
   associate=rule?.enabled?:true;autoAccounting=rule?.autoAccounting?:false;showApps=false
  }
  if(data==null)Text("正在读取采集结果…")
  else if(data!!.orders.isEmpty())Text("这一天暂无采集订单。")
  data?.orders?.groupBy{it.recordId?:it.relatedRecordId?:it.id}?.values?.map{group->
    val shown=group.firstOrNull{runCatching{JSONObject(it.fields).has("takeout")}.getOrDefault(false)}?:group.first()
    shown.copy(sourceCount=group.sumOf{it.sourceCount},relatedRecordId=shown.relatedRecordId?:group.firstNotNullOfOrNull{it.recordId})
  }?.forEach{order->
    var expandedOrder by rememberSaveable(order.id){mutableStateOf(false)}
    val fields=runCatching{JSONObject(order.fields)}.getOrNull()
    val rules=data!!.rules.filter{it.platform.wireValue==order.platform&&it.sourceAccount==order.sourceAccount}
    val reason=when{
      order.conflict->"来源存在冲突，需要核对"
      capturedOrderField(fields,"paid_amount").isNullOrBlank()->"材料中未识别到明确实付金额"
      capturedOrderField(fields,"payment_time").isNullOrBlank()->"材料中未识别到明确付款时间"
      order.status!="paid"->"尚未识别为已支付账单"
      else->"付款身份、币种或采集规则需核对"
    }
    Card(Modifier.fillMaxWidth()){Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
      Text(capturedOrderField(fields,"merchant")?:capturedOrderField(fields,"product")?:capturePlatformName(order.platform),style=MaterialTheme.typography.titleMedium,maxLines=2,overflow=TextOverflow.Ellipsis)
      Text("${capturePlatformName(order.platform)} · ${order.sourceCount} 份材料",style=MaterialTheme.typography.bodySmall)
      mapOf("paid_amount" to "实付","order_amount" to "订单金额","payment_time" to "付款时间").forEach{(key,label)->capturedOrderField(fields,key)?.let{Text("$label：$it",maxLines=2,overflow=TextOverflow.Ellipsis)}}
      TextButton(onClick={expandedOrder=!expandedOrder}){Text(if(expandedOrder)"收起订单详情" else "订单详情")}
      if(expandedOrder){
        Text("订单号：${order.externalId}",style=MaterialTheme.typography.bodySmall)
        Text("状态：${mapOf("paid" to "已支付","pending" to "待付款","refunded" to "已退款","refund_pending" to "退款中","cancelled" to "已取消","unknown" to "未明确")[order.status]?:order.status}",style=MaterialTheme.typography.bodySmall)
        mapOf("merchant" to "商家","product" to "商品","refund_amount" to "退款金额","logistics_no" to "物流单号").forEach{(key,label)->capturedOrderField(fields,key)?.let{Text("$label：$it")}}
        if(order.conflict)Text("来源存在冲突，未自动覆盖",color=MaterialTheme.colorScheme.error)
      }
      if(fields?.has("takeout")==true){
        val detail=fields.getJSONObject("takeout");val items=detail.optJSONArray("items")
        Text(if(detail.optBoolean("amounts_reconciled"))"商品与费用已核对" else "部分信息待补充")
        fun amount(data:JSONObject,key:String)=if(data.isNull(key))"待识别" else "¥${data.optString(key)}"
        if(expandedOrder&&items!=null)for(i in 0 until items.length()){val item=items.getJSONObject(i);Text("${item.optString("name")} ×${item.optInt("quantity")} · ${amount(item,"paid_amount")}")}
        if(expandedOrder){Text("打包费 ${amount(detail,"packing_fee")} · 配送费 ${amount(detail,"delivery_fee")}");val issues=detail.optJSONArray("issues");if(issues!=null)for(i in 0 until issues.length())Text(issues.getString(i))}
        Text("订单已收录；付款以支付账单为准，不重复记账。")
        order.relatedRecordId?.let{id->TextButton(onClick={onMoneyRecord(id)}){Text("对应付款 · 查看已有消费 →")}}
      }else if(order.recordId==null){
        Text("尚未入账 · $reason",color=MaterialTheme.colorScheme.onSurfaceVariant)
        TextButton(onClick={showOrderSettings=true;rules.firstOrNull()?.let{selectApp(it.appPackage)}}){Text("查看采集规则")}
      }else TextButton(onClick={onMoneyRecord(order.recordId!!)}){Text("已入账 · 查看消费详情 →")}
    }}
  }
  TextButton(onClick={showOrderSettings=!showOrderSettings}){Text(if(showOrderSettings)"收起采集设置" else "摇一摇与自动记账设置")}
  if(showOrderSettings){
  Text("摇一摇记账",style=MaterialTheme.typography.titleMedium)
  Text("每个应用需要单独开启。先点下方应用名称，再打开出现的摇一摇开关；新增来源应用默认关闭。")
  Text("选择应用，打开订单顶部后摇一下。美团可读页面使用无障碍文字，其他页面采集长截图；长截图会自动滚动，可点“我来滑”慢滑并停稳，点“完成保存”结束。也可分享系统长截图。")
  FlowRow{(billPlatforms+takeoutPackages).forEach{(pkg,value)->FilterChip(selected=selectedApp==pkg,onClick={selectApp(pkg)},label={Text(apps.firstOrNull{it.activityInfo.packageName==pkg}?.loadLabel(context.packageManager)?.toString()?:mapOf("com.taobao.taobao" to "淘宝内闪购","me.ele.mall" to "闪购零售","com.sankuai.meituan.takeoutnew" to "美团外卖")[pkg]?:capturePlatformName(value))})}}
  Box{TextButton(onClick={showApps=true}){Text(apps.firstOrNull{it.activityInfo.packageName==selectedApp}?.loadLabel(context.packageManager)?.toString()?:"选择其他订单来源应用")};DropdownMenu(expanded=showApps,onDismissRequest={showApps=false}){apps.forEach{info->DropdownMenuItem(text={Text(info.loadLabel(context.packageManager).toString())},onClick={selectApp(info.activityInfo.packageName)})}}}
  if(selectedApp.isNotBlank()){
   val key=shakeKey(accountId,selectedApp)
   var enabled by remember(key){mutableStateOf(prefs.getBoolean(key,false))}
   Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){Text("此应用摇一摇采集",Modifier.weight(1f));Switch(checked=enabled,onCheckedChange={enabled=it;prefs.edit().putBoolean(key,it).apply()},enabled=hasSensor||enabled)}
   Text(BillShakeStatus.message)
   Text("可留在此页摇动测试；识别成功会显示提示，随后再进入单笔账单详情。",style=MaterialTheme.typography.bodySmall)
   Text(if(LifeScreenCaptureService.active==null)"屏幕内容服务：未连接" else "屏幕内容服务：已连接")
   if(!hasSensor)Text("此设备没有加速度传感器，请手动记账。")
   TextButton(onClick={context.startActivity(Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS))}){Text("启用 Life 屏幕内容服务")}
   Text("支付账单证据完整时入账；订单材料不重复新增付款。长截图按所选方式交给 LLM 或 Losna，不使用本地 OCR。",style=MaterialTheme.typography.bodySmall)
  }
  OrderImageProcessingSettings(context,accountId,data?.screenshotModels.orEmpty().map{it.id to it.name})
  if(selectedApp.isNotBlank()&&platform in setOf("wechat","alipay")){
   val automaticKey=paymentAutoKey(accountId,selectedApp)
   var automaticEnabled by remember(automaticKey){mutableStateOf(prefs.contains(automaticKey))}
   Row(verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){Text("付款后自动识别",Modifier.weight(1f));Switch(checked=automaticEnabled,enabled=automaticEnabled||!busy&&sourceAccount.isNotBlank(),onCheckedChange={value->
     if(!value){automaticEnabled=false;prefs.edit().remove(automaticKey).apply()}
     else{
       val binding=JSONObject().put("platform",platform).put("source_account",sourceAccount.trim())
       val rule=JSONObject().put("app_package",selectedApp).put("platform",platform).put("source_account",sourceAccount.trim()).put("enabled",associate).put("auto_accounting",autoAccounting)
       run{
         // Queue the same account scope first so later shake captures use this binding too.
         write("life.set_order_capture",rule)
         check(app.sessions.active()?.accountId==accountId){"账号已切换"}
         prefs.edit().putString(automaticKey,binding.toString()).apply();automaticEnabled=true
       }
     }
   })}
   Text("仅在此应用可读的支付成功页采集；信息完整后自动入消费，不需要摇动。第三方应用须选择实际付款平台，不能覆盖所有 SDK 页面。",style=MaterialTheme.typography.bodySmall)
   if(PaymentAutoStatus.accountId==accountId)Text(PaymentAutoStatus.message,style=MaterialTheme.typography.bodySmall)
   Text(if(LifeScreenCaptureService.active==null)"屏幕内容服务未连接，自动识别尚未运行" else "屏幕内容服务已连接")
   TextButton(onClick={context.startActivity(Intent(android.provider.Settings.ACTION_ACCESSIBILITY_SETTINGS))}){Text("检查屏幕内容服务")}
   TextButton(onClick={context.startActivity(Intent(android.provider.Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))}){Text("检查系统后台限制")}
  }
  Box{TextButton(onClick={showPlatforms=true}){Text("平台：${capturePlatformName(platform)}")};DropdownMenu(expanded=showPlatforms,onDismissRequest={showPlatforms=false}){listOf("generic","taobao","jd","meituan","alipay","wechat").forEach{value->DropdownMenuItem(text={Text(capturePlatformName(value))},onClick={platform=value;showPlatforms=false})}}}
  OutlinedTextField(value=sourceAccount,onValueChange={sourceAccount=it.take(200)},label={Text("平台账号标识（与账单导入保持一致）")},modifier=Modifier.fillMaxWidth())
  Row{Text("自动关联新采集的订单");Switch(checked=associate,onCheckedChange={associate=it})}
  Row{Text("后台自动采集：证据完整时记账");Switch(checked=autoAccounting,onCheckedChange={autoAccounting=it})}
  Text("自动记账要求订单或交易身份、明确实付和付款时间、人民币证据以及写入权限；冲突和缺失只保留观察。")
  Button(enabled=!busy&&selectedApp.isNotBlank()&&sourceAccount.isNotBlank(),onClick={run{write("life.set_order_capture",JSONObject().put("app_package",selectedApp).put("platform",platform).put("source_account",sourceAccount.trim()).put("enabled",associate).put("auto_accounting",autoAccounting));if(prefs.contains(paymentAutoKey(accountId,selectedApp))){prefs.edit().apply{if(platform in setOf("wechat","alipay"))putString(paymentAutoKey(accountId,selectedApp),JSONObject().put("platform",platform).put("source_account",sourceAccount.trim()).toString()) else remove(paymentAutoKey(accountId,selectedApp))}.apply()}}}){Text("保存此应用的规则")}
  }

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

private fun capturePlatformName(value:String)=mapOf("generic" to "通用","taobao" to "淘宝","jd" to "京东","eleme" to "淘宝闪购","meituan" to "美团","alipay" to "支付宝","wechat" to "微信")[value]?:value

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun OrderImageProcessingSettings(context:Context,accountId:String,models:List<Pair<String,String>>){
 val prefs=remember(context){context.getSharedPreferences("activity_capture",Context.MODE_PRIVATE)}
 var mode by remember(accountId){mutableStateOf(OrderCaptureSettings.mode(context,accountId))}
 var model by remember(accountId){mutableStateOf(OrderCaptureSettings.model(context,accountId))}
 var choices by remember(accountId){mutableStateOf(false)}
 Text("长截图与分享图片",style=MaterialTheme.typography.titleMedium)
 FlowRow{listOf("losna" to "Losna 自动识别","llm" to "LLM 识图","save" to "仅保存，稍后识别").forEach{(value,label)->FilterChip(selected=mode==value,onClick={mode=value;prefs.edit().putString(OrderCaptureSettings.modeKey(accountId),value).apply()},label={Text(label)})}}
 if(mode=="llm"||mode=="save"){
  Box{TextButton(onClick={choices=true}){Text(models.firstOrNull{it.first==model}?.second?:"默认视觉模型")};DropdownMenu(expanded=choices,onDismissRequest={choices=false}){models.forEach{(id,label)->DropdownMenuItem(text={Text(label)},onClick={model=id;prefs.edit().putString(OrderCaptureSettings.modelKey(accountId),id).apply();choices=false})}}}
  if(models.isEmpty())Text("尚未配置 LLM 视觉模型，原图会保存，暂不自动识别。")
 }
 if(mode=="save")Text("保存后可在资料详情点“用所选 LLM 识图”；模型在这里选择。")
 Text("无障碍可读的美团订单直接保存文字；长图保留原件，识别结果不等同于新增付款。",style=MaterialTheme.typography.bodySmall)
}

private fun capturedOrderField(fields:JSONObject?,key:String):String? = fields?.takeUnless{it.isNull(key)}?.optString(key)?.takeIf{it.isNotBlank()&&it!="null"}
