package com.shadow.life

import android.content.Context
import android.net.Uri
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
import kotlinx.coroutines.*
import org.json.*
import java.time.LocalDate

internal object CaptureLocalSettings {
 private fun preferences(context:Context)=context.getSharedPreferences("activity_capture",Context.MODE_PRIVATE)
 fun sync(context:Context,account:String)=preferences(context).getBoolean("capture_sync_$account",true)
 fun canSync(context:Context,app:ShadowApp,account:String)=sync(context,account)&&app.sessions.active()?.accountId==account
 fun setSync(context:Context,account:String,enabled:Boolean){preferences(context).edit().putBoolean("capture_sync_$account",enabled).apply();SyncScheduler.schedule(context,account)}
 val commands=setOf("life.ingest_activity","life.capture_screenshot","life.register_recording","life.restore_activities","life.restore_recording")
}
internal val captureBehaviors=listOf("unknown" to "未分类","reading" to "阅读","browsing" to "浏览","communication" to "沟通","shopping" to "购物","media" to "影音娱乐","work" to "工作","learning" to "学习","exercise" to "运动","travel" to "出行","rest" to "休息","other" to "其他")
internal val captureDomains=listOf("unknown" to "未分类","work" to "工作","growth" to "成长","life" to "生活","health" to "健康","relationships" to "关系","leisure" to "休闲")
@Composable internal fun CaptureChoice(label:String,value:String,options:List<Pair<String,String>>,choose:(String)->Unit){var expanded by remember{mutableStateOf(false)};Box{TextButton(onClick={expanded=true}){Text("$label：${options.firstOrNull{it.first==value}?.second?:value}")};DropdownMenu(expanded=expanded,onDismissRequest={expanded=false}){options.forEach{(key,title)->DropdownMenuItem(text={Text(title)},onClick={choose(key);expanded=false})}}}}

@Composable internal fun CaptureCompletionPanel(accountId:String,date:LocalDate){
 val context=LocalContext.current;val app=context.applicationContext as ShadowApp;val repository=remember(accountId){NativeLifeRepository(context,app)};val scope=rememberCoroutineScope()
 var tab by remember(accountId){mutableStateOf("分析")};var period by remember(accountId){mutableStateOf("day")};var insight by remember(accountId){mutableStateOf<CaptureInsightsResultDto?>(null)};var policy by remember(accountId){mutableStateOf<CapturePolicyResultDto?>(null)};var search by remember(accountId){mutableStateOf<CaptureSearchResultDto?>(null)}
 var busy by remember(accountId){mutableStateOf(false)};var message by remember(accountId){mutableStateOf<String?>(null)};var sync by remember(accountId){mutableStateOf(CaptureLocalSettings.sync(context,accountId))};var local by remember(accountId){mutableStateOf<List<String>>(emptyList())}
 var query by remember(accountId){mutableStateOf("")};var kind by remember(accountId){mutableStateOf("")};var behavior by remember(accountId){mutableStateOf("")};var project by remember(accountId){mutableStateOf("")}
 var selectedSource by remember(accountId){mutableStateOf<String?>(null)};var goalTitle by remember(accountId){mutableStateOf("")};var goalMinutes by remember(accountId){mutableStateOf("60")};var goalPeriod by remember(accountId){mutableStateOf("day")};var goalDirection by remember(accountId){mutableStateOf("at_least")};var goalId by remember(accountId){mutableStateOf<String?>(null)};var goalRevision by remember(accountId){mutableStateOf<Long?>(null)};var withOriginals by remember(accountId){mutableStateOf(false)}
 val active=app.sessions.active()?.takeIf{it.accountId==accountId};val queue=active?.let{app.queue.observeStatus(it)?.collectAsState(initial=QueueSummary(0,0,0,0,0))?.value}
 val currentDate=rememberUpdatedState(date);val currentPeriod=rememberUpdatedState(period)
 fun run(block:suspend()->Unit){if(busy)return;busy=true;scope.launch{try{check(app.sessions.active()?.accountId==accountId){"账号已切换"};block()}catch(e:CancellationException){throw e}catch(e:Exception){message=e.message?:"操作失败"}finally{busy=false}}}
 suspend fun refresh(){val requested=date;val requestedPeriod=period;val result=repository.captureInsights(date,period);val settings=repository.capturePolicy();if(app.sessions.active()?.accountId==accountId&&currentDate.value==requested&&currentPeriod.value==requestedPeriod){insight=result;policy=settings}}
 fun saveGoal(activeGoal:Boolean=true){run{repository.captureWrite("life.set_capture_goal",JSONObject().put("title",goalTitle.trim()).put("minutes",goalMinutes.toInt()).put("period",goalPeriod).put("direction",goalDirection).put("behavior",behavior.ifBlank{null}?:JSONObject.NULL).put("life_domain",JSONObject.NULL).put("project_id",project.ifBlank{null}?:JSONObject.NULL).put("active",activeGoal).apply{goalId?.let{put("id",it);put("expected_revision",goalRevision)}},accountId);goalId=null;goalRevision=null;goalTitle="";message="目标已进入同步队列，完成后会显示在个人目标和下方对照中。"}}
 val export=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/zip")){uri->if(uri!=null)run{val value=insight?:error("请先读取日期范围");message=exportCaptureArchive(context,app,repository,accountId,uri,value.fromOn,value.toOnExclusive,withOriginals)}}
 val restore=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->if(uri!=null)run{message=restoreCaptureArchive(context,app,repository,accountId,uri)}}
 LaunchedEffect(date,period,accountId,queue?.completed){try{refresh()}catch(e:CancellationException){throw e}catch(e:Exception){message=e.message};try{local=localCapturePreview(app,accountId)}catch(_:Exception){}}
 Text("活动分析与来源",style=MaterialTheme.typography.titleLarge)
 Row{listOf("分析","检索","设置与导出").forEach{label->TextButton(onClick={tab=label}){Text(label)}}}
 when(tab){
 "分析"->{
  Row{listOf("day" to "日","week" to "周","month" to "月").forEach{(value,label)->TextButton(onClick={period=value}){Text(if(period==value)"● $label" else label)}}}
  insight?.let{data->
   Text("${data.fromOn} — ${data.toOnExclusive}（结束日不含）");Text("应用使用 ${data.appUsageSeconds/60} 分钟 · ${data.sourceCount} 项来源")
   Text("只统计已观察到的区间，重叠取并集。分类之间可能重叠；应用时长不等于专注时间。",style=MaterialTheme.typography.bodySmall)
   data.apps.take(20).forEach{Text("${it.title}：${it.seconds/60} 分钟 · ${it.intervals} 段")}
   data.groups.forEach{group->Text("${captureBehaviors.firstOrNull{it.first==group.behavior.wireValue}?.second} / ${captureDomains.firstOrNull{it.first==group.lifeDomain.wireValue}?.second}：${group.seconds/60} 分钟")}
   if(data.projects.isNotEmpty()){Text("项目投入",style=MaterialTheme.typography.titleMedium);data.projects.forEach{Text("${it.title}：${it.seconds/60} 分钟 · ${it.count} 项来源")}}
   if(data.dailyFacts.isNotEmpty()){Text("所选日期的生活事实",style=MaterialTheme.typography.titleMedium);data.dailyFacts.forEach{Text("${it.label}：${it.value} ${it.unit}")}}
   Text("明确目标与已记录投入",style=MaterialTheme.typography.titleMedium)
   data.goals.forEach{goal->Card{Column(Modifier.padding(10.dp)){Text(goal.title);Text("${goal.fromOn} — ${goal.toOnExclusive} · ${if(goal.direction.wireValue=="at_least")"至少" else "至多"} ${goal.targetMinutes} 分钟；已记录 ${goal.observedSeconds/60} 分钟");Text("采集覆盖可能不完整，不据此判断全天未达标。",style=MaterialTheme.typography.bodySmall);TextButton(onClick={goalId=goal.id;goalRevision=goal.revision;goalTitle=goal.title;goalMinutes=goal.targetMinutes.toString();goalPeriod=goal.period.wireValue;goalDirection=goal.direction.wireValue;behavior=goal.behavior?.wireValue.orEmpty();project=goal.projectId.orEmpty()}){Text("修改或停用")}}}}
  }
  CaptureChoice("目标行为",behavior,listOf("" to "全部行为")+captureBehaviors){behavior=it};CaptureChoice("项目",project,listOf("" to "不限定项目")+insight?.projects.orEmpty().map{it.id to it.title}){project=it}
  OutlinedTextField(goalTitle,{goalTitle=it.take(200)},label={Text("我明确希望做什么")},modifier=Modifier.fillMaxWidth());OutlinedTextField(goalMinutes,{goalMinutes=it.filter(Char::isDigit).take(4)},label={Text("目标分钟（1–1440）")})
  CaptureChoice("目标周期",goalPeriod,listOf("day" to "每天","week" to "每周")){goalPeriod=it};CaptureChoice("方向",goalDirection,listOf("at_least" to "至少","at_most" to "至多")){goalDirection=it}
  Row{Button(enabled=!busy&&goalTitle.isNotBlank()&&goalMinutes.toIntOrNull() in 1..1440,onClick={saveGoal()}){Text(if(goalId==null)"保存个人目标" else "更新目标")};if(goalId!=null)TextButton(enabled=!busy,onClick={saveGoal(false)}){Text("停用")}}
 }
 "检索"->{
  OutlinedTextField(query,{query=it.take(200)},label={Text("搜索原文、订单、地点或转写")},modifier=Modifier.fillMaxWidth())
  CaptureChoice("类型",kind,listOf("" to "全部","app_usage" to "应用使用","screen_text" to "屏幕／截图","recording" to "录音转写","stay" to "停留地点","manual" to "手动活动")){kind=it};CaptureChoice("行为",behavior,listOf("" to "全部")+captureBehaviors){behavior=it};CaptureChoice("项目",project,listOf("" to "全部")+insight?.projects.orEmpty().map{it.id to it.title}){project=it}
  Button(enabled=!busy,onClick={run{val range=insight?:error("请先加载日期范围");search=repository.captureSearch(range.fromOn,range.toOnExclusive,query,kind.ifBlank{null},behavior.ifBlank{null},project.ifBlank{null})}}){Text("检索所选范围")}
  search?.items?.forEach{row->TextButton(onClick={selectedSource=row.id}){Text("${row.title} · ${row.startedAt}")}}
  search?.nextBeforeId?.let{cursor->TextButton(enabled=!busy,onClick={run{val range=insight!!;val next=repository.captureSearch(range.fromOn,range.toOnExclusive,query,kind.ifBlank{null},behavior.ifBlank{null},project.ifBlank{null},cursor);search=next.copy(items=search!!.items+next.items)}}){Text("加载更多")}}
 }
 else->{
  Row{Text("采集材料上传到 Life",Modifier.weight(1f));Switch(sync,{sync=it;CaptureLocalSettings.setSync(context,accountId,it)})}
  Text(if(sync)"应用、屏幕、截图和录音进入账号绑定的同步队列。" else "继续在本机加密记录，后续采集暂停上传；已有云端记录仍可查看。")
  policy?.let{settings->CapturePolicyEditor(settings,busy){input->run{repository.captureWrite("life.set_capture_policy",input,accountId);message="处理与保留策略已进入同步队列。"}};Text("待转写 ${settings.queuedRecordings} 段 · 失败 ${settings.failedRecordings} 段 · 音频 ${settings.audioBytes/1024/1024} MB");Text("今日已处理 ${settings.processedTodaySeconds.toLong()/60} 分钟（UTC 日预算）");if(settings.recentDeletions.isNotEmpty()){Text("近期删除（正文已清理）",style=MaterialTheme.typography.titleMedium);settings.recentDeletions.forEach{Text("${it.capturedAt} · ${if(it.kind=="recording")"录音" else "采集材料"} · 已删除")}}}
  if(local.isNotEmpty()){Text("本机未同步材料（最近一批）",style=MaterialTheme.typography.titleMedium);local.take(30).forEach{Text(it)}}
  Row{Text("导出包含可用音频原件");Switch(withOriginals,{withOriginals=it})}
  Text("导出所选范围为 ZIP，包含原文、时间、时区、分类、修订及校验。导出文件由你选择保存位置。",style=MaterialTheme.typography.bodySmall)
  Row{Button(enabled=!busy&&insight!=null,onClick={export.launch("Life-records-$date.zip")}){Text("导出材料")};TextButton(enabled=!busy,onClick={restore.launch(arrayOf("application/zip","application/octet-stream"))}){Text("恢复导出材料")}}
 }
 }
 TextButton(enabled=!busy,onClick={run{refresh();local=localCapturePreview(app,accountId);message="已刷新"}}){Text("刷新分析与策略")};if(busy)LinearProgressIndicator(Modifier.fillMaxWidth());message?.let{Text(it)}
 selectedSource?.let{id->AlertDialog(onDismissRequest={selectedSource=null},title={Text("采集来源")},text={Box(Modifier.heightIn(max=600.dp)){CaptureSourceContent(accountId,id)}},confirmButton={TextButton(onClick={selectedSource=null}){Text("关闭")}})}
}
@Composable private fun CapturePolicyEditor(state:CapturePolicyResultDto,busy:Boolean,save:(JSONObject)->Unit){
 var audio by remember(state.revision){mutableStateOf(state.policy.processRecordings)};var screenshot by remember(state.revision){mutableStateOf(state.policy.processScreenshots)};var minutes by remember(state.revision){mutableStateOf(state.policy.dailyAudioMinutes.toString())};var screenshotLimit by remember(state.revision){mutableStateOf(state.policy.dailyScreenshots.toString())};var screenDays by remember(state.revision){mutableStateOf(state.policy.screenKeepDays?.toString().orEmpty())};var audioDays by remember(state.revision){mutableStateOf(state.policy.audioKeepDays?.toString().orEmpty())}
 Row{Text("同步后转写录音",Modifier.weight(1f));Switch(audio,{audio=it})};Row{Text("自动识别新截图",Modifier.weight(1f));Switch(screenshot,{screenshot=it})}
 OutlinedTextField(minutes,{minutes=it.filter(Char::isDigit).take(4)},label={Text("每日转写分钟上限（0–1440）")});OutlinedTextField(screenshotLimit,{screenshotLimit=it.filter(Char::isDigit).take(4)},label={Text("每日自动截图识别次数（0–1000）")})
 OutlinedTextField(screenDays,{screenDays=it.filter(Char::isDigit).take(3)},label={Text("屏幕材料保留天数，留空长期保留")});OutlinedTextField(audioDays,{audioDays=it.filter(Char::isDigit).take(3)},label={Text("转写成功后音频额外保留天数")})
 Text("保留设置只清理已同步材料。未转写成功、手动长期保留和独立归档原件受保护；音频到期后仍保留转写。",style=MaterialTheme.typography.bodySmall)
 val valid=minutes.toIntOrNull() in 0..1440&&screenshotLimit.toIntOrNull() in 0..1000&&(screenDays.isBlank()||screenDays.toIntOrNull() in 1..365)&&(audioDays.isBlank()||audioDays.toIntOrNull() in 1..365)
 Button(enabled=!busy&&valid,onClick={save(JSONObject().put("expected_revision",state.revision).put("process_recordings",audio).put("process_screenshots",screenshot).put("daily_audio_minutes",minutes.toInt()).put("daily_screenshots",screenshotLimit.toInt()).put("screen_keep_days",screenDays.toIntOrNull()?:JSONObject.NULL).put("audio_keep_days",audioDays.toIntOrNull()?:JSONObject.NULL))}){Text("保存处理与保留设置")}
}
@Composable internal fun CaptureSourceScreen(accountId:String,id:String,onBack:()->Unit){Column(Modifier.fillMaxSize().padding(20.dp)){TextButton(onClick=onBack){Text("← 返回")};CaptureSourceContent(accountId,id)}}
@Composable internal fun CaptureSourceContent(accountId:String,id:String){
 val context=LocalContext.current;val app=context.applicationContext as ShadowApp;val repository=remember(accountId){NativeLifeRepository(context,app)};val scope=rememberCoroutineScope();var source by remember(id,accountId){mutableStateOf<ActivitySourceResultDto?>(null)};var projects by remember(accountId){mutableStateOf<List<Pair<String,String>>>(emptyList())};var behavior by remember(id,accountId){mutableStateOf("unknown")};var domain by remember(id,accountId){mutableStateOf("unknown")};var project by remember(id,accountId){mutableStateOf("")};var rememberApp by remember(id){mutableStateOf(false)};var message by remember(id){mutableStateOf<String?>(null)}
 suspend fun load(){val row=repository.activitySource(id);check(app.sessions.active()?.accountId==accountId);source=row;behavior=row.behavior;domain=row.lifeDomain;project=row.projectId.orEmpty();projects=repository.captureInsights(LocalDate.now(),"day").projects.map{it.id to it.title}}
 fun run(block:suspend()->Unit){scope.launch{try{check(app.sessions.active()?.accountId==accountId);block()}catch(e:CancellationException){throw e}catch(e:Exception){message=e.message}}}
 LaunchedEffect(accountId,id){try{load()}catch(e:CancellationException){throw e}catch(e:Exception){message=e.message}}
 Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)){
  source?.let{row->Text(row.title,style=MaterialTheme.typography.titleLarge);Text("${row.startedAt} — ${row.endedAt}");Text(row.text?:"此来源只有已观察的活动区间。");row.latitude?.let{Text("坐标 $it, ${row.longitude} · 精度 ${row.accuracyM} 米")};Text("分类依据：${mapOf("user" to "用户更正","app_rule" to "应用默认规则","app_category" to "按应用类别","content_suggestion" to "由可见内容推断","unknown" to "尚未分类")[row.classificationOrigin]?:row.classificationOrigin}")
   CaptureChoice("行为",behavior,captureBehaviors){behavior=it};CaptureChoice("领域",domain,captureDomains){domain=it};CaptureChoice("项目",project,listOf("" to "不关联")+projects){project=it}
   if(row.appPackage!=null)Row{Text("作为此应用以后的默认分类");Switch(rememberApp,{rememberApp=it})}
   Button(onClick={run{repository.captureWrite("life.classify_activity",JSONObject().put("id",id).put("expected_revision",row.classificationRevision).put("behavior",behavior).put("life_domain",domain).put("project_id",project.ifBlank{null}?:JSONObject.NULL).put("remember_app",rememberApp),accountId);message="分类更正已进入同步队列，完成后刷新。"}}){Text("保存分类与项目")}
   TextButton(onClick={run{repository.captureWrite("life.protect_capture",JSONObject().put("id",id).put("kind","activity").put("protected",!row.protectedValue),accountId);message="保留设置已进入同步队列。"}}){Text(if(row.protectedValue)"取消长期保留" else "长期保留此来源")}
   TextButton(onClick={run{load();message="已刷新"}}){Text("刷新来源")}
  };message?.let{Text(it)}
 }
}
private suspend fun localCapturePreview(app:ShadowApp,account:String):List<String> =withContext(Dispatchers.IO){val session=app.sessions.active()?.takeIf{it.accountId==account}?:return@withContext emptyList();val dao=app.database.commands();val lines=mutableListOf<String>();for(row in dao.localCaptures(account,session.subjectId)){val input=JSONObject(app.queue.commandBody(row)).optJSONObject("input")?:continue;val items=input.optJSONArray("items");if(items!=null)for(i in 0 until minOf(items.length(),100)){val item=items.getJSONObject(i);lines+="${item.optString("title")} · ${item.optString("started_at")}"}else lines+=input.optString("title","采集材料")};for(file in dao.pendingAttachments(account,session.subjectId,100))if(file.captureMetadata.isNotBlank())lines+="${file.displayName} · 等待上传";lines.takeLast(100)}

@Composable internal fun HomeCaptureSummary(accountId:String,onOpen:()->Unit){
 val context=LocalContext.current;val app=context.applicationContext as ShadowApp;val repository=remember(accountId){NativeLifeRepository(context,app)};var summary by remember(accountId){mutableStateOf<CaptureInsightsResultDto?>(null)};var processing by remember(accountId){mutableStateOf<CapturePolicyResultDto?>(null)}
 val session=app.sessions.active()?.takeIf{it.accountId==accountId};val status=session?.let{app.queue.observeStatus(it).collectAsState(initial=QueueSummary(0,0,0,0,0)).value}
 LaunchedEffect(accountId,status?.completed){try{val now=repository.captureInsights(LocalDate.now(),"day");val queued=repository.capturePolicy();if(app.sessions.active()?.accountId==accountId){summary=now;processing=queued}}catch(e:CancellationException){throw e}catch(_:Exception){}}
 Card(onClick=onOpen,modifier=Modifier.fillMaxWidth()){Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){Text("采集与回顾",style=MaterialTheme.typography.titleMedium);Text(summary?.let{"应用使用 ${it.appUsageSeconds/60} 分钟 · ${it.sourceCount} 项来源"}?:"查看应用使用、录音、停留与自动收录");processing?.let{Text("待转写 ${it.queuedRecordings} 段 · 本机待同步 ${status?.waiting?:0} 项",style=MaterialTheme.typography.bodySmall)};Text("仅统计已观察的区间，缺失时段保持未知。",style=MaterialTheme.typography.bodySmall)}}
}
