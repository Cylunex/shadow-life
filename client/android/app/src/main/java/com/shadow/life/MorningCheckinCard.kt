package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

@Composable internal fun MorningCheckinCard(accountId:String) {
  val context=LocalContext.current
  val app=context.applicationContext as ShadowApp
  val repository=remember(accountId){NativeLifeRepository(context,app)}
  val scope=rememberCoroutineScope()
  val zone=ZoneId.systemDefault().id
  var end by rememberSaveable(accountId){mutableStateOf(LocalDate.now().toString())}
  var selected by rememberSaveable(accountId){mutableStateOf(end)}
  var rows by remember(accountId,end){mutableStateOf<List<JSONObject>>(emptyList())}
  var refresh by remember{mutableIntStateOf(0)}
  var message by remember(accountId){mutableStateOf("")}
  var pending by rememberSaveable(accountId){mutableStateOf<String?>(null)}
  var busy by remember(accountId){mutableStateOf(false)}
  LaunchedEffect(accountId,end,zone,refresh){
    try { rows=repository.morningWindow(end,zone).trainingObjects() }
    catch(e:CancellationException){throw e}
    catch(e:Exception){message=e.message?:"晨评读取失败"}
  }
  LaunchedEffect(pending,accountId){
    val id=pending?:return@LaunchedEffect
    val session=app.sessions.active()?.takeIf{it.accountId==accountId}?:return@LaunchedEffect
    app.database.commands().observeCommandState(accountId,session.subjectId,id).collect { state->
      when(state){
        "committed"->{pending=null;message="晨评已同步";refresh++}
        "blocked","failed"->{pending=null;message="晨评未同步，请核对最新记录";refresh++}
      }
    }
  }
  LifeCard {
    Text("睡眠与晨起感受",style=MaterialTheme.typography.titleLarge)
    Row {
      TextButton(enabled=!busy,onClick={end=LocalDate.parse(end).minusDays(14).toString();selected=end}){Text("前两周")}
      TextButton(enabled=!busy&&end<LocalDate.now().toString(),onClick={end=minOf(LocalDate.now(),LocalDate.parse(end).plusDays(14)).toString();selected=end}){Text("后两周")}
    }
    var expanded by rememberSaveable(accountId){mutableStateOf(false)}
    val activeSleep=rows.find{it.getString("wake_date")==selected}?.optJSONObject("sleep")
    Text(activeSleep?.let{"主睡眠 ${it.getInt("minutes")} 分钟"}?:"暂无当天睡眠记录")
    TextButton(onClick={expanded=!expanded}){Text(if(expanded)"收起对照" else "近 14 天对照")}
    if(expanded)rows.forEach { day->
      val date=day.getString("wake_date")
      val sleep=day.optJSONObject("sleep")?.getInt("minutes")?.let{"睡眠 ${it} 分钟"}?:"无睡眠记录"
      val checkin=day.optJSONObject("checkin")
      val summary=if(checkin==null)"未填晨评" else "精力 ${checkin.optIntOrNull("energy_level")?:"—"} · 质量 ${checkin.optIntOrNull("sleep_quality")?:"—"}"
      TextButton(enabled=!busy,onClick={selected=date}){Text("$date · $sleep · $summary")}
    }
    val row=rows.find{it.getString("wake_date")==selected}
    val previous=row?.optJSONObject("checkin")
    key(accountId,selected,previous?.optInt("revision")){
      var energy by rememberSaveable{mutableStateOf(previous?.optIntOrNull("energy_level")?.toString().orEmpty())}
      var quality by rememberSaveable{mutableStateOf(previous?.optIntOrNull("sleep_quality")?.toString().orEmpty())}
      var notes by rememberSaveable{mutableStateOf(previous?.takeUnless{it.isNull("notes")}?.getString("notes").orEmpty())}
      if(row!=null || pending==null){
        Text("$selected 醒来感受")
        OutlinedTextField(energy,{if(it.isEmpty()||it.toIntOrNull() in 0..10)energy=it},label={Text("精力（0–10）")})
        OutlinedTextField(quality,{if(it.isEmpty()||it.toIntOrNull() in 0..10)quality=it},label={Text("睡眠质量（0–10）")})
        OutlinedTextField(notes,{if(it.length<=2000)notes=it},label={Text("备注")})
        Button(enabled=!busy&&pending==null&&(energy.isNotEmpty()||quality.isNotEmpty()||notes.isNotBlank()),onClick={
          busy=true
          val input=JSONObject().put("wake_date",selected).put("time_zone",zone)
            .put("filled_at",previous?.getString("filled_at")?:Instant.now().toString())
            .put("energy_level",energy.toIntOrNull()?:JSONObject.NULL)
            .put("sleep_quality",quality.toIntOrNull()?:JSONObject.NULL)
            .put("notes",notes.trim().takeIf{it.isNotEmpty()}?:JSONObject.NULL)
          previous?.let{input.put("expected_revision",it.getInt("revision"))}
          scope.launch{
            try{val receipt=repository.saveMorningCheckin(input,accountId);pending=receipt.commandId;message="晨评已保存到本机"}
            catch(e:CancellationException){throw e}
            catch(e:Exception){message=e.message?:"晨评保存失败"}
            finally{busy=false}
          }
        }){Text("保存晨评")}
      }
    }
    if(message.isNotEmpty())Text(message)
    TextButton(onClick={refresh++}){Text("刷新晨评")}
  }
}

private fun JSONObject.optIntOrNull(key:String):Int? = if(isNull(key))null else getInt(key)
