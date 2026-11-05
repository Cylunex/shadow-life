package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.clickable
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.text.style.TextOverflow
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.*
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun HomeRecentInfoCard(accountId:String,onDetail:(LifeDomain,String,String)->Unit,onRecords:()->Unit,onOrders:()->Unit,onSettings:()->Unit){
  val context=LocalContext.current
  val app=context.applicationContext as ShadowApp
  val model:HomeRecentInfoModel=viewModel(key="home-recent:$accountId"){HomeRecentInfoModel(app,accountId)}
  val session=app.sessions.active()?.takeIf{it.accountId==accountId}
  val localFlow=remember(accountId,session?.subjectId){
    if(session==null)flowOf(emptyList()) else app.database.commands().observeRecentCaptures(accountId,session.subjectId).map{commands->
      commands.flatMap{command->
        try{recentCaptureEntries(command.commandId,command.createdAt,command.state,app.queue.commandBody(command),if(command.state=="committed")app.queue.receiptBody(command) else null)}catch(e:CancellationException){throw e}catch(_:Exception){emptyList()}
      }.take(8)
    }.distinctUntilChanged().flowOn(Dispatchers.IO)
  }
  val local by localFlow.collectAsStateWithLifecycle(initialValue=emptyList())
  var expanded by rememberSaveable(accountId){mutableStateOf(false)}
  val resolved=model.resolved
  val remote=model.remote
  val loading=model.loading
  val error=model.error
  var preview by remember(accountId){mutableStateOf<HomeRecentInfo?>(null)}
  val lifecycle=LocalLifecycleOwner.current.lifecycle
  var resumed by remember{mutableStateOf(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))}
  DisposableEffect(lifecycle){val observer=LifecycleEventObserver{_,event->if(event==Lifecycle.Event.ON_RESUME){resumed=true}else if(event==Lifecycle.Event.ON_PAUSE)resumed=false};lifecycle.addObserver(observer);onDispose{lifecycle.removeObserver(observer)}}
  LaunchedEffect(accountId,local,resumed){if(resumed)model.refresh(local)}
  val localRows=local.mapNotNull{item->if(item.state=="committed"&&resolved.containsKey(item.key))resolved[item.key] else HomeRecentInfo(item.key,item.at,item.title,recentCaptureState(item.state),preview=item.preview,localState=item.state)}
  val rows=mergeHomeRecentInfo(localRows,remote)
  LifeCard{
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text("最近信息",style=MaterialTheme.typography.titleMedium);TextButton(onClick={model.refresh(local,manual=true)},enabled=!loading){Text(if(loading)"更新中" else "刷新")}}
    if(rows.isEmpty())Text(if(loading)"正在读取最近信息…" else "暂无最近信息，摇一摇收录后可在这里查看。",style=MaterialTheme.typography.bodySmall)
    rows.take(if(expanded)5 else 2).forEach{row->key(row.key){
      Column(Modifier.fillMaxWidth().clickable{if(row.domain!=null&&row.targetId!=null)onDetail(row.domain,row.targetId,row.title) else preview=row}.padding(vertical=6.dp),verticalArrangement=Arrangement.spacedBy(3.dp)){
        Text(row.title,maxLines=1,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodyMedium)
        Text("${row.status} · ${DateTimeFormatter.ofPattern("M/d HH:mm").withZone(ZoneId.systemDefault()).format(Instant.ofEpochMilli(row.at))}",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=2,overflow=TextOverflow.Ellipsis)
      }
    }}
    error?.let{Text(it,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.error)}
    FlowRow(horizontalArrangement=Arrangement.spacedBy(4.dp)){
      TextButton(onClick=onOrders){Text("采集结果")}
      if(rows.size>2)TextButton(onClick={expanded=!expanded}){Text(if(expanded)"收起" else "展开 ${rows.size} 条")}
      TextButton(onClick=onRecords){Text("全部记录")}
    }
  }

  preview?.let{row->AlertDialog(onDismissRequest={preview=null},title={Text(row.title)},text={Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)){Text(row.status);row.preview?.let{Text(it)};Text("同步完成后刷新最近信息，可打开实际记录。")}},confirmButton={TextButton(onClick={preview=null;if(row.localState in setOf("pending","uploading","unknown","failed","blocked"))onSettings() else onOrders()}){Text(if(row.localState in setOf("pending","uploading","unknown","failed","blocked"))"查看同步队列" else "查看采集订单")}},dismissButton={TextButton(onClick={preview=null}){Text("关闭")}})}
}
