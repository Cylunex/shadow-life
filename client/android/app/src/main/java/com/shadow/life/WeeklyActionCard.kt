package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters

internal fun weeklyGoalStarts(on: LocalDate): List<LocalDate> {
  val monday=on.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
  return listOf(monday.minusWeeks(1), monday, monday.plusWeeks(1))
}
@Composable internal fun WeeklyActionCard(accountId:String, on:String, repository:NativeLifeRepository) {
  val app=LocalContext.current.applicationContext as ShadowApp
  val weeks=remember(on){weeklyGoalStarts(LocalDate.parse(on))}
  val keys=remember(weeks){weeks.map{"wellness.week.$it"}}
  var goals by remember{mutableStateOf<List<JSONObject>?>(null)}
  var retry by remember{mutableIntStateOf(0)}
  var draft by rememberSaveable{mutableStateOf("")}
  var message by rememberSaveable{mutableStateOf("")}
  var queuedId by rememberSaveable{mutableStateOf<String?>(null)}
  var busy by remember{mutableStateOf(false)}
  val scope=rememberCoroutineScope()
  LaunchedEffect(accountId,on,retry){
    goals=null
    try{goals=repository.weeklyGoals(on,keys)}
    catch(error:CancellationException){throw error}
    catch(error:Exception){message=error.message?:"周行动读取失败"}
  }
  LaunchedEffect(queuedId,accountId){
    val id=queuedId?:return@LaunchedEffect
    val session=app.sessions.active()?.takeIf{it.accountId==accountId}?:return@LaunchedEffect
    app.database.commands().observeCommandState(accountId,session.subjectId,id).collect { state ->
      when(state){
        "committed"->{queuedId=null;message="周行动已同步";retry++}
        "failed","blocked",null->{queuedId=null;message="请核对同步状态后重试";retry++}
      }
    }
  }
  fun save(index:Int,outcome:String?=null){
    if(busy||queuedId!=null||goals==null)return
    val existing=goals?.find{it.optString("key")==keys[index]}
    val text=if(outcome!=null)existing?.getString("statement").orEmpty() else draft.trim()
    if(text.isBlank())return
    busy=true
    scope.launch{
      try{
        val input=JSONObject().put("key",keys[index]).put("scope","health").put("kind","goal").put("category","goal")
          .put("statement",text).put("assertion","explicit").put("state","active").put("valid_from",weeks[index].toString())
          .put("valid_to_exclusive",weeks[index].plusWeeks(1).toString()).put("goal_outcome",outcome?:JSONObject.NULL)
        existing?.let { input.put("id",it.getString("id")).put("expected_revision",it.getInt("revision")).put("reason","本人在周复盘中更新行动") }
        val receipt=repository.savePersonalFoundation("agent.set_intention",input,accountId)
        queuedId=receipt.commandId;message="已存本机，等待同步";draft=""
      }catch(error:CancellationException){throw error}
      catch(error:Exception){message=error.message?:"周行动保存失败"}
      finally{busy=false}
    }
  }
  LifeCard{
    Text("每周一个行动",style=MaterialTheme.typography.titleLarge)
    if(message.isNotBlank())Text(message)
    if(goals==null)TextButton(onClick={retry++}){Text("重新读取周行动")}
    else for((index,start) in weeks.withIndex()){
      val goal=goals?.find{it.optString("key")==keys[index]}
      Text("${listOf("上周","本周","下周")[index]} · ${start} 起",style=MaterialTheme.typography.titleSmall)
      Text(goal?.optString("statement")?:"当周没有约定")
      if(goal!=null){
        Text(if(goal.optString("state")=="archived")"已归档" else when(goal.optString("goal_outcome")){"completed"->"已完成";"not_done"->"本人记录未完成";else->"尚未记录执行结果"})
        if(index<2 && goal.optString("state")=="active"){
          Row{for((result,label) in listOf("completed" to "记为已完成","not_done" to "记为未完成")){
            TextButton(enabled=!busy&&queuedId==null&&goal.optString("goal_outcome")!=result,onClick={save(index,result)}){Text(label)}
          }}
        }
      }
      if(index==2){
        OutlinedTextField(draft,{draft=it.take(300)},label={Text("下一周想做的一件事")},modifier=Modifier.fillMaxWidth())
        Button(enabled=!busy&&queuedId==null&&draft.isNotBlank(),onClick={save(index)}){Text(if(goal==null)"保存下周行动" else "更新下周行动")}
      }
    }
  }
}
