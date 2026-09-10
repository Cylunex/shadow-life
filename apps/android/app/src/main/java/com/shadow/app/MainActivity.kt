package com.shadow.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.time.LocalDate
import java.util.UUID

class MainActivity:ComponentActivity(){
  private lateinit var oidc:OidcSessions
  private var activeSession by mutableStateOf<ProductSession?>(null)
  private var loginMessage by mutableStateOf<String?>(null)
  private var recoverableCommands by mutableIntStateOf(0)
  private var queueStates by mutableStateOf<Map<String,Int>>(emptyMap())
  private var lastReceipt by mutableStateOf<String?>(null)
  private var healthSyncMessage by mutableStateOf<String?>(null)
  private var saving by mutableStateOf(false)
  private var queueObservation:Job?=null
  private var pendingSharedImage:Uri?=null
  private val healthPermissionResult=registerForActivityResult(PermissionController.createRequestPermissionResultContract()){granted->
    val session=activeSession
    if(session==null){loginMessage="请先登录再同步健康数据";return@registerForActivityResult}
    if(granted.containsAll(HealthConnectSync.permissions)){loginMessage="Health Connect 已授权，正在按类型核对增量";HealthConnectScheduler.schedule(this,session.accountId)}else loginMessage="Health Connect 权限不完整；已保留现有数据并停止同步"
  }
  private val loginResult=registerForActivityResult(ActivityResultContracts.StartActivityForResult()){result->
    val data=result.data
    if(data==null){loginMessage="登录已取消";return@registerForActivityResult}
    oidc.complete(data){session->runOnUiThread{activeSession=session;loginMessage=if(session==null)"登录失败，请重试" else null;session?.let{active->observeQueue(active);lifecycleScope.launch{withContext(Dispatchers.IO){(application as ShadowApp).queue.secureLegacy(active)};pendingSharedImage?.let{uri->pendingSharedImage=null;enqueueImage(uri)};SyncScheduler.schedule(this@MainActivity,active.accountId)}}}}
  }

  override fun onCreate(savedInstanceState:Bundle?){
    super.onCreate(savedInstanceState)
    val app=application as ShadowApp
    oidc=OidcSessions(this,app.sessions);activeSession=app.sessions.active();activeSession?.let(::observeQueue)
    val shared=intent.takeIf{it.action==Intent.ACTION_SEND}?.getStringExtra(Intent.EXTRA_TEXT).orEmpty()
    val image=intent.takeIf{it.action==Intent.ACTION_SEND&&it.type?.startsWith("image/")==true}?.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
    if(image!=null){if(activeSession==null)pendingSharedImage=image else enqueueImage(image)}
    lifecycleScope.launch{app.database.commands().observeRecoverableCount().collect{recoverableCommands=it}}
    setContent{MaterialTheme{Capture(shared,activeSession,oidc.configured,HealthConnectSync.available(this),loginMessage,healthSyncMessage,recoverableCommands,queueStates,lastReceipt,saving,onLogin=::login,onSave=::enqueue,onHealthSync=::syncHealthConnect,onRecover=::recoverLegacyCommands,onRetry=::retryQueue,onClear=::clearQueue)}}
  }

  override fun onDestroy(){oidc.close();super.onDestroy()}

  private fun login(){loginMessage="正在打开登录…";oidc.loginIntent{intent->runOnUiThread{if(intent==null)loginMessage="登录配置不可用" else loginResult.launch(intent)}}}

  private fun enqueue(text:String){
    if(saving)return
    val app=application as ShadowApp;val session=requireActiveSession(app)?:return
    saving=true
    val id="cmd_android_${UUID.randomUUID()}"
    val body=org.json.JSONObject().put("protocol","shadow.command").put("capability","library.capture").put("command_id",id).put("input",org.json.JSONObject().put("title","来自 Android 的分享").put("item_type","note").put("text",text).put("tags",org.json.JSONArray())).toString()
    lifecycleScope.launch{try{withContext(Dispatchers.IO){app.queue.enqueueCommand(session,id,"library.capture",body)};loginMessage="已加密保存到离线队列";SyncScheduler.schedule(this@MainActivity,session.accountId)}catch(error:CancellationException){throw error}catch(_:Exception){loginMessage="无法加密离线内容，请检查设备密钥后重试"}finally{saving=false}}
  }

  private fun enqueueImage(uri:Uri){
    val app=application as ShadowApp;val session=requireActiveSession(app)?:return
    val id="attachment_${UUID.randomUUID().toString().replace("-","")}"
    val commandId="cmd_android_${UUID.randomUUID()}"
    val mediaType=contentResolver.getType(uri)?:"image/jpeg"
    val file=java.io.File(filesDir,"pending-assets/$id.slq")
    val capturedOn=LocalDate.now().toString()
    lifecycleScope.launch{try{val saved=withContext(Dispatchers.IO){contentResolver.openInputStream(uri)?.let{input->app.queue.enqueueAttachment(session,id,commandId,mediaType,capturedOn,input,file)}?:-1};if(saved>=0){loginMessage="图片已加密保存到离线队列";SyncScheduler.schedule(this@MainActivity,session.accountId)}else loginMessage="无法读取分享的图片"}catch(error:CancellationException){throw error}catch(_:Exception){file.delete();loginMessage="无法加密分享的图片，请检查设备密钥后重试"}}
  }

  private fun syncHealthConnect(){
    val session=requireActiveSession(application as ShadowApp)?:return
    if(!HealthConnectSync.available(this)){loginMessage="此设备未提供可用的 Health Connect";return}
    lifecycleScope.launch{val client=androidx.health.connect.client.HealthConnectClient.getOrCreate(this@MainActivity);val granted=client.permissionController.getGrantedPermissions();if(granted.containsAll(HealthConnectSync.permissions)){loginMessage="正在按类型核对 Health Connect 增量";HealthConnectScheduler.schedule(this@MainActivity,session.accountId)}else healthPermissionResult.launch(HealthConnectSync.permissions)}
  }

  private fun recoverLegacyCommands(){
    val app=application as ShadowApp;val session=requireActiveSession(app)?:return
    lifecycleScope.launch{val restored=withContext(Dispatchers.IO){val claimed=app.database.commands().recoverToAccount(session.accountId,session.subjectId);app.queue.secureLegacy(session);claimed};loginMessage="$restored 条历史离线任务已归入当前账号并加密";if(restored>0)SyncScheduler.schedule(this@MainActivity,session.accountId)}
  }

  private fun retryQueue(){
    val app=application as ShadowApp;val session=requireActiveSession(app)?:return
    lifecycleScope.launch{val retried=withContext(Dispatchers.IO){app.queue.retry(session)};loginMessage="$retried 条任务已重新进入核对队列";if(retried>0)SyncScheduler.schedule(this@MainActivity,session.accountId)}
  }

  private fun clearQueue(){
    val app=application as ShadowApp;val session=requireActiveSession(app)?:return
    lifecycleScope.launch{val cleared=withContext(Dispatchers.IO){app.queue.clearTerminal(session)};loginMessage="已清理 $cleared 条终态队列记录"}
  }

  private fun observeQueue(session:ProductSession){
    queueObservation?.cancel()
    val app=application as ShadowApp
    val commands=app.database.commands()
    queueObservation=lifecycleScope.launch{
      commands.observe(session.accountId,session.subjectId).combine(commands.observeAttachments(session.accountId,session.subjectId)){pending,attachments->
        val states=(pending.map{it.state}+attachments.map{it.state}).groupingBy{it}.eachCount()
        val receipt=pending.firstOrNull{it.state=="committed"&&it.receiptBody.isNotBlank()}?.let{command->runCatching{val value=JSONObject(app.queue.receiptBody(command));"${value.optString("capability")} · ${value.optString("execution_id")}"}.getOrNull()}
        QueueView(states,receipt)
      }.flowOn(Dispatchers.IO).collect{queueStates=it.states;lastReceipt=it.receipt}
    }
    val observedAccount=session.accountId
    WorkManager.getInstance(this).getWorkInfosForUniqueWorkLiveData(HealthConnectScheduler.workName(observedAccount)).observe(this){work->
      if(activeSession?.accountId!=observedAccount)return@observe
      val latest=work.maxByOrNull{it.runAttemptCount}?:return@observe
      val state=latest.outputData.getString("state")
      val reason=latest.outputData.getString("reason")
      healthSyncMessage=when{
        state=="queued"->"已加密排队 ${latest.outputData.getInt("records",0)} 条 ${latest.outputData.getString("record_type").orEmpty()} 变更"
        state=="up_to_date"->"Health Connect 已同步到最新"
        state=="waiting_for_receipt"->"正在核对上一页 Health Connect 回执"
        state=="rescan_required"->"Health Connect 游标已过期，正在受控重扫"
        reason=="permissions_required"||reason=="permissions_revoked"->"Health Connect 权限不完整，同步已停止"
        reason=="bootstrap_too_large"->"最近 30 天记录超过安全批次上限，未截断导入"
        reason=="health_connect_unavailable"->"此设备未提供可用的 Health Connect"
        latest.state==WorkInfo.State.RUNNING->"正在核对 Health Connect 来源与游标"
        else->healthSyncMessage
      }
    }
  }

  private fun requireActiveSession(app:ShadowApp):ProductSession?=app.sessions.active()?:run{activeSession=null;loginMessage="会话已失效，请重新登录；离线队列仍保留在原账号下";null}
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun Capture(initial:String,session:ProductSession?,loginConfigured:Boolean,healthConnectAvailable:Boolean,loginMessage:String?,healthSyncMessage:String?,recoverableCommands:Int,queueStates:Map<String,Int>,lastReceipt:String?,saving:Boolean,onLogin:()->Unit,onSave:(String)->Unit,onHealthSync:()->Unit,onRecover:()->Unit,onRetry:()->Unit,onClear:()->Unit){
  var value by remember{mutableStateOf(initial)}
  var confirmClear by remember{mutableStateOf(false)}
  Scaffold(topBar={TopAppBar(title={Text("Shadow Life")})}){padding->Column(Modifier.padding(padding).verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)){
    Text("保存生活中的原始资料",style=MaterialTheme.typography.headlineMedium)
    if(session==null){Button(onClick=onLogin,enabled=loginConfigured){Text("统一账号登录")};if(!loginConfigured)Text("请先配置身份提供方")}
    else {Text("已登录：${session.subjectId}");OutlinedButton(onClick=onHealthSync,enabled=healthConnectAvailable){Text(if(healthConnectAvailable)"同步 Health Connect" else "Health Connect 不可用")};healthSyncMessage?.let{Text(it)};Text("体重、步数、睡眠和训练分别维护增量游标；授权撤销或游标过期时停止并受控重扫。",style=MaterialTheme.typography.bodySmall);if(recoverableCommands>0){Text("发现 $recoverableCommands 条旧版离线任务，账号归属未知。确认后才会同步。");OutlinedButton(onClick=onRecover){Text("归入当前账号")}};if(queueStates.isNotEmpty()){Text(queueStates.entries.sortedBy{it.key}.joinToString(" · "){(state,count)->"${queueStateLabel(state)} $count"});Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){if((queueStates["blocked"]?:0)+(queueStates["failed"]?:0)>0)OutlinedButton(onClick=onRetry){Text("按原 ID 重试")};if((queueStates["committed"]?:0)+(queueStates["blocked"]?:0)+(queueStates["failed"]?:0)>0)TextButton(onClick={confirmClear=true}){Text("清理终态记录")}};if(confirmClear){Text("将删除已完成回执，以及失败或需处理的本地内容；尚未同步的内容删除后无法恢复。",style=MaterialTheme.typography.bodySmall);Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){Button(onClick={confirmClear=false;onClear()}){Text("确认清理")};TextButton(onClick={confirmClear=false}){Text("取消")}}}};lastReceipt?.let{Text("最近回执：$it",style=MaterialTheme.typography.bodySmall)}}
    loginMessage?.let{Text(it)}
    OutlinedTextField(value,{value=it},Modifier.fillMaxWidth(),minLines=6,label={Text("文字或分享内容")})
    Button(onClick={onSave(value)},enabled=value.isNotBlank()&&session!=null&&!saving){Text(if(saving)"正在加密…" else "保存到离线队列")}
    Text("离线事实和附件按账号加密；响应丢失时先查原命令回执，不会换 ID 重复写入。")
  }}
}
private fun queueStateLabel(state:String)=when(state){"pending"->"待同步";"uploading"->"同步中";"unknown"->"结果待查";"committed"->"已保存";"blocked"->"需处理";"failed"->"失败";"needs_encryption"->"待加密";else->state}
private data class QueueView(val states:Map<String,Int>,val receipt:String?)
