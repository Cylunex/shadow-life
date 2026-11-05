package com.shadow.life

import androidx.compose.foundation.layout.*
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

@Composable internal fun HomeRecentInfoCard(accountId:String,onDetail:(LifeDomain,String,String)->Unit,onRecords:()->Unit,onOrders:()->Unit,onSettings:()->Unit){
  val context=LocalContext.current
  val app=context.applicationContext as ShadowApp
  val repository=remember(accountId){NativeLifeRepository(context,app)}
  val session=app.sessions.active()?.takeIf{it.accountId==accountId}
  val localFlow=remember(accountId,session?.subjectId){
    if(session==null)flowOf(emptyList()) else app.database.commands().observeRecentCaptures(accountId,session.subjectId).map{commands->
      commands.flatMap{command->
        try{recentCaptureEntries(command.commandId,command.createdAt,command.state,app.queue.commandBody(command),if(command.state=="committed")app.queue.receiptBody(command) else null)}catch(e:CancellationException){throw e}catch(_:Exception){emptyList()}
      }.take(8)
    }.flowOn(Dispatchers.IO)
  }
  val local by localFlow.collectAsStateWithLifecycle(initialValue=emptyList())
  var resolved by remember(accountId){mutableStateOf<Map<String,HomeRecentInfo?>>(emptyMap())}
  var remote by remember(accountId){mutableStateOf<List<HomeRecentInfo>>(emptyList())}
  var refresh by remember(accountId){mutableIntStateOf(0)}
  var loading by remember(accountId){mutableStateOf(false)}
  var error by remember(accountId){mutableStateOf<String?>(null)}
  var preview by remember(accountId){mutableStateOf<HomeRecentInfo?>(null)}
  val lifecycle=LocalLifecycleOwner.current.lifecycle
  var resumed by remember{mutableStateOf(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))}
  DisposableEffect(lifecycle){val observer=LifecycleEventObserver{_,event->if(event==Lifecycle.Event.ON_RESUME){resumed=true;refresh++}else if(event==Lifecycle.Event.ON_PAUSE)resumed=false};lifecycle.addObserver(observer);onDispose{lifecycle.removeObserver(observer)}}
  LaunchedEffect(accountId,local,refresh,resumed){
    if(!resumed)return@LaunchedEffect
    loading=true;error=null
    try{
      delay(250)
      check(app.sessions.active()?.accountId==accountId)
      coroutineScope{
        launch{
          val entries=local.filter{it.state=="committed"}.map{item->async{
            val row=try{
              when{
                // Financial records can outlive the retention period of their captured source.
                item.moneyRecordId!=null->{
                  val detail=repository.detail(LifeDomain.Money,item.moneyRecordId)
                  HomeRecentInfo(item.key,item.at,listOfNotNull(detail.title,detail.heroValue).joinToString(" · "),if(detail.state=="confirmed")"已入账 · 查看消费详情" else "账目状态已变化 · 查看详情",LifeDomain.Money,item.moneyRecordId)
                }
                item.sourceId!=null->{
                  val source=repository.activitySource(item.sourceId)
                  HomeRecentInfo(item.key,item.at,source.title,"已收录 · 查看采集原文",LifeDomain.Library,"capture:${source.id}")
                }
                else->HomeRecentInfo(item.key,item.at,"采集结果待核对","已同步，请查看采集订单")
              }
            }catch(e:CancellationException){throw e}catch(_:Exception){HomeRecentInfo(item.key,item.at,"采集结果暂不可读取","已同步，可刷新重试")}
            item.key to row
          }}.awaitAll().toMap()
          check(app.sessions.active()?.accountId==accountId);resolved=entries
        }
        launch{
          try{
            val page=repository.timeline()
            check(app.sessions.active()?.accountId==accountId)
            remote=page.items.filter{it.kind!="activity_capture"}.map{item->HomeRecentInfo("record:${item.domain}:${item.recordId?:item.id}",runCatching{Instant.parse(item.happenedAt).toEpochMilli()}.getOrDefault(0),item.title,"${item.domain.label()} · 已记录",item.domain,item.recordId?:item.id)}
          }catch(e:CancellationException){throw e}catch(_:Exception){error="最近记录暂时无法更新，本机采集仍可查看。"}
        }
      }
    }catch(e:CancellationException){throw e}catch(_:Exception){error="暂时无法刷新，请稍后重试。"}finally{loading=false}
  }
  val localRows=local.mapNotNull{item->if(item.state=="committed"&&resolved.containsKey(item.key))resolved[item.key] else HomeRecentInfo(item.key,item.at,item.title,recentCaptureState(item.state),preview=item.preview,localState=item.state)}
  val rows=mergeHomeRecentInfo(localRows,remote)
  LifeCard{
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text("最近信息",style=MaterialTheme.typography.titleLarge);TextButton(onClick={refresh++},enabled=!loading){Text("刷新")}}
    Text("摇一摇后在这里看进度；收录材料与正式入账分别显示。",color=MaterialTheme.colorScheme.onSurfaceVariant)
    if(loading)LinearProgressIndicator(Modifier.fillMaxWidth())
    if(rows.isEmpty()&&!loading)Text("暂无最近信息。摇一摇收录后，会先显示本机同步状态。")
    rows.forEach{row->key(row.key){OutlinedButton(modifier=Modifier.fillMaxWidth(),onClick={if(row.domain!=null&&row.targetId!=null)onDetail(row.domain,row.targetId,row.title) else preview=row}){
      Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(4.dp)){Text(row.title,maxLines=2);Text(row.status,style=MaterialTheme.typography.bodySmall);Text(DateTimeFormatter.ofPattern("M月d日 HH:mm").withZone(ZoneId.systemDefault()).format(Instant.ofEpochMilli(row.at)),style=MaterialTheme.typography.labelSmall)}
    }}}
    error?.let{Text(it,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.error)}
    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){TextButton(onClick=onOrders){Text("采集订单与记账结果 →")};TextButton(onClick=onRecords){Text("全部记录")}}
  }
  preview?.let{row->AlertDialog(onDismissRequest={preview=null},title={Text(row.title)},text={Column(Modifier.verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)){Text(row.status);row.preview?.let{Text(it)};Text("同步完成后刷新最近信息，可打开实际记录。")}},confirmButton={TextButton(onClick={preview=null;if(row.localState in setOf("pending","uploading","unknown","failed","blocked"))onSettings() else onOrders()}){Text(if(row.localState in setOf("pending","uploading","unknown","failed","blocked"))"查看同步队列" else "查看采集订单")}},dismissButton={TextButton(onClick={preview=null}){Text("关闭")}})}
}
