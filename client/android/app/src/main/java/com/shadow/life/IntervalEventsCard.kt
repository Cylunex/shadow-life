package com.shadow.life

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.KeyboardArrowUp
import androidx.compose.material3.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId

@Composable internal fun IntervalEventsCard(accountId:String,initiallyOpen:Boolean=false){
  val context=LocalContext.current
  val app=context.applicationContext as ShadowApp
  val repository=remember(accountId){NativeLifeRepository(context,app)}
  val scope=rememberCoroutineScope()
  var open by rememberSaveable{mutableStateOf(initiallyOpen)}
  var selected by rememberSaveable{mutableStateOf("")}
  var name by rememberSaveable{mutableStateOf("")}
  var events by remember{mutableStateOf<List<JSONObject>>(emptyList())}
  var after by remember{mutableStateOf<String?>(null)}
  var date by rememberSaveable{mutableStateOf(LocalDate.now().toString())}
  var note by rememberSaveable{mutableStateOf("")}
  var busy by remember{mutableStateOf(false)}
  var queue by rememberSaveable{mutableStateOf<String?>(null)}
  var message by remember{mutableStateOf("")}
  fun load(more:Boolean=false){
    busy=true
    scope.launch{
      try{
        check(app.sessions.active()?.accountId==accountId){"账号已切换"}
        val result=repository.intervalEvents(LocalDate.now().toString(),if(more)after else null)
        events=((if(more)events else emptyList())+result.getJSONArray("events").trainingObjects()).distinctBy{it.getString("id")}
        after=result.optString("next").takeUnless{it=="null"||it.isEmpty()}
      }catch(e:CancellationException){throw e}catch(e:Exception){message=e.message?:"读取失败"}finally{busy=false}
    }
  }
  LaunchedEffect(accountId,open){if(open)load()}
  fun save(capability:String,input:JSONObject){
    busy=true
    scope.launch{
      try{queue=repository.captureWrite(capability,input,accountId).commandId;message="已保存到本机，待同步"}
      catch(e:CancellationException){throw e}catch(e:Exception){message=e.message?:"保存失败"}finally{busy=false}
    }
  }
  LaunchedEffect(accountId,queue){
    val id=queue?:return@LaunchedEffect
    val session=app.sessions.active()?.takeIf{it.accountId==accountId}?:return@LaunchedEffect
    app.database.commands().observeCommandState(accountId,session.subjectId,id).collect{state->
      when(state){
        "committed"->{queue=null;message="已同步";name="";note="";load()}
        "blocked","failed"->{queue=null;message="同步失败，请核对后重试";load()}
      }
    }
  }
  fun occurrence(day:String){
    val local=runCatching{LocalDate.parse(day)}.getOrNull()
    if(local==null||local.isAfter(LocalDate.now())){message="请输入已发生的日期";return}
    save("life.record_occurrence",JSONObject().put("event_id",selected).put("occurred_on",day).put("time_zone",ZoneId.systemDefault().id).put("note",note))
  }
  val available=!busy&&queue==null
  LifeCard{
    if(!initiallyOpen)TextButton(onClick={open=!open},enabled=!busy){Text("上次是什么时候")}
    if(open){
      OutlinedTextField(name,{name=it},Modifier.fillMaxWidth(),label={Text("新事项，例如换滤芯")})
      TextButton(enabled=available&&name.isNotBlank(),onClick={save("life.save_interval_event",JSONObject().put("name",name.trim()))}){Text("创建事项")}
      events.forEach{event->
        val history=event.getJSONArray("history").trainingObjects()
        val id=event.getString("id")
        val latest=history.firstOrNull()
        HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant)
        Row(Modifier.fillMaxWidth().clickable(role=Role.Button){selected=if(selected==id)"" else id}
          .heightIn(min=56.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(8.dp)){
          Column(Modifier.weight(1f)){
            Text(event.getString("name"),style=MaterialTheme.typography.titleMedium)
            Text(latest?.let{"上次 ${it.getString("occurred_on")}"}?:"暂无记录",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
          }
          latest?.let{
            Surface(shape=MaterialTheme.shapes.small,color=MaterialTheme.colorScheme.secondaryContainer){
              Text("距今 ${it.getInt("days_ago")} 天",Modifier.padding(horizontal=10.dp,vertical=6.dp),
                style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.onSecondaryContainer)
            }
          }
          Icon(if(selected==id)Icons.Default.KeyboardArrowUp else Icons.Default.KeyboardArrowDown,if(selected==id)"收起记录" else "展开记录")
        }
        if(selected==event.getString("id")){
          history.forEach{row->Text(row.getString("occurred_on")+(if(row.isNull("interval_days"))"" else " · 间隔 ${row.getInt("interval_days")} 天")+" "+row.optString("note").takeUnless{it=="null"}.orEmpty())}
          if(!event.getBoolean("archived")){
            Button(enabled=available,onClick={occurrence(LocalDate.now().toString())}){Text("今天做了")}
            LifeDateField(date,{date=it},"补记日期",enabled=available)
            OutlinedTextField(note,{note=it},Modifier.fillMaxWidth(),label={Text("备注")})
            TextButton(enabled=available,onClick={occurrence(date)}){Text("补记一次")}
          }
        }
      }
      if(after!=null)TextButton(enabled=!busy,onClick={load(true)}){Text("更多事项")}
      if(message.isNotEmpty())Text(message)
    }
  }
}
