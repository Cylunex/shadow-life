package com.shadow.life

import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter

internal fun connectionLabel(status:String,minutes:Int?):String=when{
  status=="check_stops"->"停留点已调整，请重选"
  status=="check_booking"->"预订已变更，请重选"
  minutes==null->"时间待补"
  minutes<0->"来不及，差 ${-minutes} 分钟"
  else->"可机动 $minutes 分钟"
}

@Composable private fun ConnectionChoice(label:String,options:List<Pair<String,String>>,value:String,select:(String)->Unit){
  var expanded by remember{mutableStateOf(false)}
  TextButton(onClick={expanded=true}){Text("$label · ${options.find{it.first==value}?.second?:"请选择"}")}
  DropdownMenu(expanded=expanded,onDismissRequest={expanded=false}){
    options.forEach{(id,name)->DropdownMenuItem(text={Text(name)},onClick={expanded=false;select(id)})}
  }
}

@Composable internal fun TravelConnectionCard(accountId:String,trip:TravelTripSummary,day:TravelDaySummary){
  val context=LocalContext.current
  val app=context.applicationContext as ShadowApp
  val repository=remember(accountId){NativeLifeRepository(context,app)}
  val scope=rememberCoroutineScope()
  var rows by remember{mutableStateOf<List<JSONObject>>(emptyList())}
  var bookings by remember{mutableStateOf<List<Pair<String,String>>>(emptyList())}
  var loaded by remember{mutableStateOf(false)}
  var retry by remember{mutableIntStateOf(0)}
  var message by remember{mutableStateOf("")}
  var queued by rememberSaveable{mutableStateOf<String?>(null)}
  var busy by remember{mutableStateOf(false)}
  var editing by rememberSaveable{mutableStateOf(false)}
  var from by rememberSaveable{mutableStateOf(day.stops.firstOrNull()?.id.orEmpty())}
  var target by rememberSaveable{mutableStateOf("")}
  val next=day.stops.getOrNull(day.stops.indexOfFirst{it.id==from}+1)
  val old=rows.find{it.optString("from_stop_id")==from && (it.optString("to_stop_id")==target||it.optString("reservation_id")==target)}
  val zone=ZoneId.of(trip.timeZone)
  val format=DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm")
  LaunchedEffect(accountId,day.id,retry){
    loaded=false
    try{
      rows=repository.tripConnections(trip.id).getJSONArray("items").trainingObjects().filter{it.getString("day_plan_id")==day.id}
      bookings=repository.connectionReservations(trip.id).filter{it.optString("state")=="confirmed"}.map{it.getString("id") to it.getString("title")}
      loaded=true
    } catch(e:CancellationException){throw e} catch(e:Exception){message=e.message?:"读取失败"}
  }
  LaunchedEffect(accountId,queued){
    val id=queued?:return@LaunchedEffect
    val session=app.sessions.active()?.takeIf{it.accountId==accountId}?:return@LaunchedEffect
    app.database.commands().observeCommandState(accountId,session.subjectId,id).collect{state->
      when(state){
        "committed"->{queued=null;message="衔接估时已同步";retry++}
        "failed","blocked"->{queued=null;message="请核对日程后重试";retry++}
      }
    }
  }
  LifeCard{
    Text("行程衔接",style=MaterialTheme.typography.titleLarge)
    rows.forEach{row->
      Text("${row.optString("from_title")} → ${row.optString("to_title")} · ${travelLabel(row.getString("mode"))} ${row.optString("travel_minutes").takeUnless{it=="null"}?:"—"} 分钟 · 提前 ${row.getInt("buffer_minutes")} 分钟 · ${connectionLabel(row.getString("status"),row.optString("margin_minutes").toIntOrNull())}")
    }
    if(trip.canEdit)TextButton(enabled=loaded&&!busy&&queued==null&&day.stops.isNotEmpty(),onClick={editing=!editing}){Text(if(editing)"收起估时" else "添加或调整衔接")}
    if(editing&&trip.canEdit){
      ConnectionChoice("离开地点",day.stops.map{it.id to it.title},from){from=it;target=""}
      ConnectionChoice("下一站或预订",listOfNotNull(next?.let{it.id to it.title})+bookings,target){target=it}
      key(from,target,old?.optInt("revision")){
        var departure by rememberSaveable{mutableStateOf(old?.let{Instant.parse(it.getString("departure_at")).atZone(zone).format(format)}?:day.date+" ")}
        var travel by rememberSaveable{mutableStateOf(old?.optString("travel_minutes")?.takeUnless{it=="null"}.orEmpty())}
        var buffer by rememberSaveable{mutableStateOf(old?.optString("buffer_minutes")?:"0")}
        var mode by rememberSaveable{mutableStateOf(old?.optString("mode")?:"walk")}
        ConnectionChoice("交通方式",listOf("walk","metro","bus","rail","taxi","car","other").map{it to travelLabel(it)},mode){mode=it}
        OutlinedTextField(departure,{departure=it},label={Text("离开时刻 yyyy-MM-dd HH:mm · ${trip.timeZone}")})
        OutlinedTextField(travel,{travel=it},label={Text("交通分钟（可空）")})
        OutlinedTextField(buffer,{buffer=it},label={Text("提前到达分钟")})
        Button(enabled=loaded&&!busy&&queued==null&&target.isNotEmpty(),onClick={
          busy=true
          scope.launch{
            try{
              val local=LocalDateTime.parse(departure.trim(),format)
              val value=local.atZone(zone)
              require(value.toLocalDateTime()==local){"当地时间无效"}
              val transport=travel.toIntOrNull()
              require(travel.isBlank()||transport in 0..10080){"请填写有效交通分钟"}
              require(buffer.toIntOrNull() in 0..10080){"请填写有效提前分钟"}
              val input=JSONObject().put("trip_id",trip.id).put("day_plan_id",day.id).put("plan_revision",day.revision)
                .put("from_stop_id",from).put(if(target==next?.id)"to_stop_id" else "reservation_id",target)
                .put("departure_at",value.toInstant().toString()).put("mode",mode)
                .put("travel_minutes",transport?:JSONObject.NULL).put("buffer_minutes",buffer.toInt())
              old?.let{input.put("expected_revision",it.getInt("revision"))}
              val receipt=repository.captureWrite("travel.save_connection",input,accountId)
              queued=receipt.commandId;editing=false;message="估时已保存到本机"
            } catch(e:CancellationException){throw e} catch(e:Exception){message=e.message?:"保存失败"} finally{busy=false}
          }
        }){Text("保存衔接")}
      }
    }
    if(message.isNotBlank()){Text(message);TextButton(onClick={retry++}){Text("重新读取")}}
  }
}
