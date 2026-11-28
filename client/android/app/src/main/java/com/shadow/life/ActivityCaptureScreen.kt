package com.shadow.life

import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.Alignment
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowDropDown
import androidx.compose.material.icons.filled.Check
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
import org.json.JSONArray
import org.json.JSONObject

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun ActivityCaptureScreen(accountId:String,onBack:()->Unit,onSource:(String)->Unit={},initialTab:String="应用与活动",onMoneyRecord:(String)->Unit={}){
  val context=LocalContext.current;val app=context.applicationContext as ShadowApp
  val repository=remember(accountId){NativeLifeRepository(context,app)};val scope=rememberCoroutineScope()
  val preferences=remember(accountId){context.getSharedPreferences("activity_capture",Context.MODE_PRIVATE)}
  var packages by remember(accountId){mutableStateOf(preferences.getStringSet("screen_packages_$accountId",emptySet()).orEmpty().toSet())}
  val launchers=remember{context.packageManager.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER),0).distinctBy{it.activityInfo.packageName}.filter{it.activityInfo.packageName!=context.packageName}.sortedBy{it.loadLabel(context.packageManager).toString()}}
  var workspace by androidx.compose.runtime.saveable.rememberSaveable(accountId,initialTab){mutableStateOf(initialTab)}
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
  Scaffold(containerColor=MaterialTheme.colorScheme.background,topBar={
    TopAppBar(title={Text("活动与采集")},navigationIcon={LifeBackButton(onBack)})
  }) { padding ->
    Column(Modifier.fillMaxSize().padding(padding).consumeWindowInsets(padding).imePadding()
      .verticalScroll(rememberScrollState()).padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)) {
      val sections=listOf(
        "待核对与订单" to listOf("订单","截图"),
        "时间线与录音" to listOf("应用与活动","录音","地点","回顾"),
        "分析与设置" to listOf("分析","检索","设置与导出")
      )
      var choosing by remember { mutableStateOf(false) }
      Box {
        AssistChip(onClick={choosing=true},label={Text(workspace)},trailingIcon={Icon(Icons.Default.ArrowDropDown,"切换采集页面")})
        DropdownMenu(choosing,{choosing=false}) {
          sections.forEach { (group,pages) ->
            Text(group,Modifier.padding(horizontal=16.dp,vertical=6.dp),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
            pages.forEach { page ->
              DropdownMenuItem(text={Text(page)},onClick={workspace=page;choosing=false},
                trailingIcon={if(page==workspace) Icon(Icons.Default.Check,"当前页面")})
            }
          }
        }
      }
      LifeDateField(date.toString(),{date=LocalDate.parse(it)},"查看日期",!busy)
      if(workspace in setOf("分析","检索","设置与导出"))key(workspace){CaptureCompletionPanel(accountId,date,workspace)}
      if(workspace in setOf("录音","地点","截图","订单","回顾"))key(workspace){CaptureSuitePanel(accountId,date,workspace,onMoneyRecord)}
      if(workspace=="设置与导出"){
        LifeCard {
          Text("设备采集权限",style=MaterialTheme.typography.titleMedium)
          TextButton(onClick={context.startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))}){Text("授权应用使用情况访问")}
          Row(Modifier.fillMaxWidth().toggleable(value=automatic,role=Role.Switch,onValueChange={
            automatic=it;ActivityCaptureScheduler.setEnabled(context,accountId,it)
          }).padding(vertical=8.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)) {
            Column(Modifier.weight(1f)) {
              Text("自动采集应用使用",style=MaterialTheme.typography.titleSmall)
              Text("定期采集今天及昨天的完整区间，已入队记录会继续同步。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Switch(checked=automatic,onCheckedChange=null)
          }
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
        }
        LifeCard {
          Text("手动记活动",style=MaterialTheme.typography.titleMedium)
          OutlinedTextField(value=title,onValueChange={title=it.take(200)},label={Text("活动名称（结束于现在）")},modifier=Modifier.fillMaxWidth())
          OutlinedTextField(value=duration,onValueChange={duration=it.take(4)},label={Text("实际持续分钟（1–1440）")},modifier=Modifier.fillMaxWidth())
          Button(enabled=!busy&&date==LocalDate.now()&&title.isNotBlank()&&duration.toLongOrNull() in 1L..1440L,onClick={run{val end=Instant.now();val zone=ZoneId.systemDefault();repository.saveActivities(JSONArray().put(JSONObject().put("source_id","manual_${java.util.UUID.randomUUID().toString().replace("-","")}").put("kind","manual").put("title",title.trim()).put("started_at",end.minusSeconds(duration.toLong()*60).toString()).put("ended_at",end.toString()).put("time_zone",zone.id)),accountId);title="";duration="";message="活动已进入加密同步队列，实际上传状态见设置。"}}){Text("保存活动")}
        }
      }
      message?.let{Text(it)};if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
      if(workspace=="应用与活动"){
        LifeCard {
          Text("仅统计已捕获的完整应用区间，缺失时段保持未知；应用时长不等于专注时间。")
          data?.let{Text("已记录使用：${it.usageSeconds/60} 分钟 · ${it.total} 条活动",style=MaterialTheme.typography.titleLarge)}
          TextButton(enabled=!busy,onClick={run{read();message=null}}){Text("刷新已同步记录")}
        }
        data?.items?.sortedBy{it.startedAt}?.forEach{item->LifeCard {
          Text(captureActivityTitle(context,item.title,item.appPackage),style=MaterialTheme.typography.titleMedium)
          Text(captureActivityInterval(item.startedAt,item.endedAt,item.timeZone),
            style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
          item.latitude?.let{Text("坐标 $it, ${item.longitude} · 精度 ${item.accuracyM} 米")}
          item.text?.let{Text(it)}
          LifeTextAction(onClick={onSource(item.id)}){Text("分类、项目与长期保留")}
          if(item.kind.wireValue=="screen_text"&&item.text!=null)TextButton(enabled=!busy,onClick={run{val value=repository.activityOrder(item.id);if(app.sessions.active()?.accountId==accountId)order=value}}){Text("查看订单字段")};Row{if(item.text!=null)TextButton(enabled=!busy&&item.libraryItemId==null,onClick={run{repository.activityAction("life.archive_activity",item.id,accountId);message="已进入加密归档队列，完成后可在资料中检索；请稍后刷新。"}}){Text(if(item.libraryItemId==null)"另存到资料" else "已归档")};TextButton(enabled=!busy,onClick={deleteId=item.id}){Text("删除采集记录")}}
        }}
        data?.nextBeforeId?.let{before->TextButton(enabled=!busy,onClick={run{read(before)}}){Text("加载更多")}}
      }
    }
  }
  order?.let{value->AlertDialog(onDismissRequest={order=null},title={Text("页面中的订单信息")},text={Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)){Text("以下仅列出页面字段；实际账目关联请看采集工作区的订单页。");listOf("订单号" to value.orderId,"交易号" to value.transactionId,"商家" to value.merchant,"商品" to value.product,"订单金额" to value.orderAmount,"实付金额" to value.paidAmount,"退款金额" to value.refundAmount,"付款时间" to value.paymentTime).forEach{(label,field)->Text("$label：${field?:"未识别"}")};value.issues.forEach{Text(it)}}},confirmButton={TextButton(onClick={order=null}){Text("关闭")}})}
  deleteId?.let{id->AlertDialog(onDismissRequest={deleteId=null},title={Text("删除这条采集记录？")},text={Text("采集内容将删除且相同来源重传不会恢复；录音来源同时删除音频与转写的访问。你另存到资料的副本会保留。")},confirmButton={TextButton(onClick={deleteId=null;run{repository.activityAction("life.delete_activity",id,accountId);message="删除请求已进入加密同步队列，完成后刷新确认。"}}){Text("删除")}},dismissButton={TextButton(onClick={deleteId=null}){Text("取消")}})}
}
internal fun captureActivityTitle(context:Context,title:String,packageName:String?):String {
  val name=packageName?.takeIf(String::isNotBlank)
    ?:title.takeIf{it.matches(Regex("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+"))}
    ?:return title
  if(title!=name&&title.isNotBlank())return title
  val manager=context.packageManager
  return runCatching{
    @Suppress("DEPRECATION")
    manager.getApplicationInfo(name,0).loadLabel(manager).toString()
  }.getOrNull()?.takeUnless{it.isBlank()||it==name}?:"未知应用"
}

internal fun captureActivityInterval(start:String,end:String,zone:String):String =
  "${localDateTime(start,zone)?:start} — ${localDateTime(end,zone)?:end}"
