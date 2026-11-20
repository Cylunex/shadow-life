package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import org.json.JSONObject

@Composable internal fun RecordWriteScreen(
  accountId:String,title:String,capability:String,onBack:()->Unit,onSaved:()->Unit,
  content:@Composable ColumnScope.(Boolean,(() -> JSONObject)->Unit)->Unit
){
  val context=LocalContext.current
  val app=context.applicationContext as ShadowApp
  val repo=remember(accountId){NativeLifeRepository(context,app)}
  val scope=rememberCoroutineScope()
  var pending by rememberSaveable{mutableStateOf<String?>(null)}
  var enqueueing by remember{mutableStateOf(false)}
  var error by rememberSaveable{mutableStateOf<String?>(null)}
  val enabled=!enqueueing&&pending==null
  LaunchedEffect(accountId,pending){
    val command=pending?:return@LaunchedEffect
    val session=app.sessions.active()?.takeIf{it.accountId==accountId}?:return@LaunchedEffect
    val status=app.database.commands().observeCommandState(accountId,session.subjectId,command)
      .first{it in setOf("committed","failed","blocked")}
    pending=null
    if(status=="committed")onSaved()
    else error="同步未完成，输入已保留。可在同步设置查看原因。"
  }
  val save: (() -> JSONObject)->Unit = { input->
    if(!enqueueing&&pending==null){
      enqueueing=true
      error=null
      scope.launch{
        try{pending=repo.captureWrite(capability,input(),accountId).commandId}
        catch(failure:CancellationException){throw failure}
        catch(failure:Exception){error=failure.message?:"无法保存记录"}
        finally{enqueueing=false}
      }
    }
  }
  LifeFullScreen(title,{if(!enqueueing)onBack()}){
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(bottom=24.dp),
      verticalArrangement=Arrangement.spacedBy(12.dp)){
      content(enabled,save)
      if(pending!=null)Text("已保存到本机，待同步",color=MaterialTheme.colorScheme.primary)
      error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
    }
  }
}

internal fun JSONObject.putText(key:String,text:String):JSONObject=apply{
  text.trim().takeIf(String::isNotEmpty)?.let{put(key,it)}
}
