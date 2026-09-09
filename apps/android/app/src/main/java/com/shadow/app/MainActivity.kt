package com.shadow.app

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

class MainActivity:ComponentActivity(){
  private lateinit var oidc:OidcSessions
  private var activeSession by mutableStateOf<ProductSession?>(null)
  private var loginMessage by mutableStateOf<String?>(null)
  private var pendingSharedImage:Uri?=null
  private val loginResult=registerForActivityResult(ActivityResultContracts.StartActivityForResult()){result->
    val data=result.data
    if(data==null){loginMessage="登录已取消";return@registerForActivityResult}
    oidc.complete(data){session->runOnUiThread{activeSession=session;loginMessage=if(session==null)"登录失败，请重试" else null;session?.let{active->pendingSharedImage?.let{uri->pendingSharedImage=null;enqueueImage(uri)};SyncScheduler.schedule(this,active.accountId)}}}
  }

  override fun onCreate(savedInstanceState:Bundle?){
    super.onCreate(savedInstanceState)
    val app=application as ShadowApp
    oidc=OidcSessions(this,app.sessions);activeSession=app.sessions.active()
    val shared=intent.takeIf{it.action==Intent.ACTION_SEND}?.getStringExtra(Intent.EXTRA_TEXT).orEmpty()
    val image=intent.takeIf{it.action==Intent.ACTION_SEND&&it.type?.startsWith("image/")==true}?.getParcelableExtra<Uri>(Intent.EXTRA_STREAM)
    if(image!=null){if(activeSession==null)pendingSharedImage=image else enqueueImage(image)}
    setContent{MaterialTheme{Capture(shared,activeSession,oidc.configured,loginMessage,onLogin=::login,onSave=::enqueue)}}
  }

  override fun onDestroy(){oidc.close();super.onDestroy()}

  private fun login(){loginMessage="正在打开登录…";oidc.loginIntent{intent->runOnUiThread{if(intent==null)loginMessage="登录配置不可用" else loginResult.launch(intent)}}}

  private fun enqueue(text:String){
    val app=application as ShadowApp;val session=app.sessions.active()?:return
    val id="cmd_android_${UUID.randomUUID()}"
    val body=org.json.JSONObject().put("protocol","shadow.command").put("capability","library.capture").put("command_id",id).put("input",org.json.JSONObject().put("title","来自 Android 的分享").put("item_type","note").put("text",text).put("tags",org.json.JSONArray())).toString()
    lifecycleScope.launch{withContext(Dispatchers.IO){app.database.commands().enqueue(PendingCommand(id,session.accountId,session.subjectId,"library.capture",body))};SyncScheduler.schedule(this@MainActivity,session.accountId)}
  }

  private fun enqueueImage(uri:Uri){
    val app=application as ShadowApp;val session=app.sessions.active()?:return
    val id="attachment_${UUID.randomUUID().toString().replace("-","")}"
    val commandId="cmd_android_${UUID.randomUUID()}"
    val mediaType=contentResolver.getType(uri)?:"image/jpeg"
    val file=java.io.File(filesDir,"pending-assets/$id")
    file.parentFile?.mkdirs();contentResolver.openInputStream(uri)?.use{input->file.outputStream().use(input::copyTo)}?:return
    lifecycleScope.launch{withContext(Dispatchers.IO){app.database.commands().enqueueAttachment(PendingAttachment(id,session.accountId,session.subjectId,commandId,file.absolutePath,mediaType))};SyncScheduler.schedule(this@MainActivity,session.accountId)}
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun Capture(initial:String,session:ProductSession?,loginConfigured:Boolean,loginMessage:String?,onLogin:()->Unit,onSave:(String)->Unit){
  var value by remember{mutableStateOf(initial)}
  Scaffold(topBar={TopAppBar(title={Text("Shadow Life")})}){padding->Column(Modifier.padding(padding).padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)){
    Text("保存生活中的原始资料",style=MaterialTheme.typography.headlineMedium)
    if(session==null){Button(onClick=onLogin,enabled=loginConfigured){Text("统一账号登录")};loginMessage?.let{Text(it)};if(!loginConfigured)Text("请先配置身份提供方")}
    else Text("已登录：${session.subjectId}")
    OutlinedTextField(value,{value=it},Modifier.fillMaxWidth(),minLines=6,label={Text("文字或分享内容")})
    Button(onClick={onSave(value)},enabled=value.isNotBlank()&&session!=null){Text("保存到离线队列")}
    Text("队列按账号隔离；同步前会自动刷新会话，刷新失败时暂停该账号。")
  }}
}
