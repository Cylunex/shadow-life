package com.shadow.life

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId

internal val trainingFocusLabels=linkedMapOf("chest" to "胸","core" to "腰腹","back_shoulders" to "背肩","arms" to "胳膊","legs" to "腿")
internal val trainingDifficultyLabels=linkedMapOf("easy" to "入门","moderate" to "进阶","challenging" to "挑战")
internal data class NativeTrainingPlan(val id:String,val title:String,val revision:Int,val schedule:JSONObject,val detail:JSONObject)
internal fun JSONArray.trainingObjects()=(0 until length()).mapNotNull{optJSONObject(it)}
internal fun JSONObject.copyJson()=JSONObject(toString())

private fun trainingTheme(menu:JSONObject):String=menu.getJSONArray("days").trainingObjects().firstOrNull{it.getInt("weekday")==LocalDate.now().dayOfWeek.value}?.getString("focus")?:menu.getJSONArray("priorities").getString(0)

// Older free-form plan detail may use the same key. Do not render an incomplete object.
private fun trainingMenuOrDefault(candidate:JSONObject?,fallback:JSONObject):JSONObject=runCatching{
  val menu=requireNotNull(candidate)
  require(menu.getInt("version")==1)
  val priorities=menu.getJSONArray("priorities");require(priorities.length()==5&&(0 until priorities.length()).map{priorities.getString(it)}.toSet()==trainingFocusLabels.keys)
  val days=menu.getJSONArray("days").trainingObjects();require(days.isNotEmpty()&&days.size<=7);days.forEach{require(it.getInt("weekday") in 1..7&&it.getString("focus") in trainingFocusLabels);it.getJSONArray("secondary")}
  val exercises=menu.getJSONArray("exercises").trainingObjects();require(exercises.isNotEmpty()&&exercises.size<=100)
  exercises.forEach{exercise->listOf("id","name","guidance","caution").forEach{require(exercise.getString(it).isNotBlank())};require(exercise.getString("focus") in trainingFocusLabels);require(exercise.getString("difficulty") in trainingDifficultyLabels);require(exercise.getString("equipment") in setOf("bodyweight","dumbbell"));require(exercise.getString("unit") in setOf("reps","seconds"));require(exercise.getString("source_url").startsWith("https://"))}
  menu.copyJson()
}.getOrElse{fallback.copyJson()}

@Composable internal fun TrainingMenuWorkspace(accountId:String,state:LoadState<List<NativeTrainingPlan>>,submit:SubmitState,onLoad:()->Unit,onSave:(String,JSONObject)->Unit,onReset:()->Unit){
  val context=LocalContext.current
  val builtIn=remember{context.assets.open("home-workout.json").bufferedReader().use{JSONObject(it.readText())}}
  var menu by remember(accountId){mutableStateOf(builtIn.copyJson())}
  var planId by remember(accountId){mutableStateOf("")}
  var name by remember(accountId){mutableStateOf("居家力量 · 自选动作")}
  var focus by remember(accountId){mutableStateOf(trainingTheme(builtIn))}
  var theme by remember(accountId){mutableStateOf(trainingTheme(builtIn))}
  var themePicker by remember(accountId){mutableStateOf(false)}
  var equipment by remember(accountId){mutableStateOf("all")}
  var difficulty by remember(accountId){mutableStateOf("all")}
  var chosen by remember(accountId){mutableStateOf(listOf<JSONObject>())}
  val actual=remember(accountId){mutableStateMapOf<String,String>()}
  val loads=remember(accountId){mutableStateMapOf<String,String>()}
  var error by remember(accountId){mutableStateOf<String?>(null)}
  var settings by remember(accountId){mutableStateOf(false)}
  val plans=(state as? LoadState.Ready)?.value.orEmpty()
  val selected=plans.firstOrNull{it.id==planId}
  val pending=submit is SubmitState.Sending
  LaunchedEffect(accountId){onLoad()}
  // A queued receipt acknowledges local storage, never completion on the server.
  LaunchedEffect(submit){if(submit is SubmitState.Saved&&submit.receipt.capability=="health.record_workout"){chosen=emptyList();actual.clear();loads.clear()}}
  fun choosePlan(plan:NativeTrainingPlan?){onReset();planId=plan?.id.orEmpty();name=plan?.title?:"居家力量 · 自选动作";menu=trainingMenuOrDefault(plan?.detail?.optJSONObject("workout_menu"),builtIn);theme=trainingTheme(menu);focus=theme;chosen=emptyList();actual.clear();loads.clear()}
  Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
    Text("按状态选动作",style=MaterialTheme.typography.titleLarge)
    Text("每天一个主题，从中选几个即可。${menu.getJSONArray("exercises").length()} 个备选，不必全部完成。")
    Text("腰腹训练提升力量，减腰围依靠整体减脂。动作引起或加重疼痛时停止；后腰不适时优先选择有支撑、易控制的版本。",style=MaterialTheme.typography.bodySmall)
    when(state){is LoadState.Failed->{Text(state.message,color=MaterialTheme.colorScheme.error);TextButton(onClick=onLoad){Text("重新读取计划")}};is LoadState.Loading->Text("正在读取计划；可先浏览离线动作库");else->Unit}
    Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
      FilterChip(selected=planId.isEmpty(),enabled=!pending,onClick={choosePlan(null)},label={Text("新建菜单 · 先试选")})
      plans.forEach{plan->FilterChip(selected=planId==plan.id,enabled=!pending,onClick={choosePlan(plan)},label={Text(plan.title)})}
    }
    TextButton(onClick={settings=!settings}){Text(if(settings)"收起每周主题" else "每周主题与优先级")}
    if(settings){
      Text((0 until menu.getJSONArray("priorities").length()).joinToString(" ＞ "){trainingFocusLabels[menu.getJSONArray("priorities").getString(it)].orEmpty()})
      OutlinedTextField(name,{name=it},label={Text("菜单名称")},modifier=Modifier.fillMaxWidth())
      menu.getJSONArray("days").trainingObjects().forEachIndexed{index,day->
        Text("周${"一二三四五六日"[day.getInt("weekday")-1]}主题")
        Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){trainingFocusLabels.forEach{(key,label)->FilterChip(selected=day.getString("focus")==key,onClick={menu=menu.copyJson().apply{getJSONArray("days").getJSONObject(index).apply{put("focus",key);val old=optJSONArray("secondary")?:JSONArray();put("secondary",JSONArray((0 until old.length()).map{old.getString(it)}.filter{it!=key}))}}},label={Text(label)})}}
      }
      Button(enabled=!pending&&state is LoadState.Ready&&!(submit is SubmitState.Saved&&submit.receipt.capability=="health.set_plan")&&name.isNotBlank()&&(planId.isEmpty()||selected!=null),onClick={
        onReset();error=null
        val detail=selected?.detail?.copyJson()?:JSONObject();detail.put("workout_menu",menu)
        val schedule=selected?.schedule?.copyJson()?:JSONObject();schedule.put("days",JSONArray(menu.getJSONArray("days").trainingObjects().map{it.getInt("weekday")}))
        val input=JSONObject().put("kind","workout").put("name",name.trim()).put("state","active").put("schedule",schedule).put("detail",detail)
        selected?.let{input.put("plan_id",it.id).put("expected_revision",it.revision)}
        onSave("health.set_plan",input)
      }){Text(if(selected==null)"保存为新计划" else "保存主题菜单")}
    }
    Box{TextButton(onClick={themePicker=true}){Text("今天主题：${trainingFocusLabels[theme]} ▾")};DropdownMenu(expanded=themePicker,onDismissRequest={themePicker=false}){trainingFocusLabels.forEach{(key,label)->DropdownMenuItem(text={Text(label)},onClick={theme=key;focus=key;themePicker=false})}}}
    Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){trainingFocusLabels.forEach{(key,label)->FilterChip(selected=focus==key,onClick={focus=key},label={Text(label)})}}
    Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){linkedMapOf("all" to "所有器械","bodyweight" to "徒手","dumbbell" to "哑铃").forEach{(key,label)->FilterChip(selected=equipment==key,onClick={equipment=key},label={Text(label)})}}
    Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){(linkedMapOf("all" to "所有难度")+trainingDifficultyLabels).forEach{(key,label)->FilterChip(selected=difficulty==key,onClick={difficulty=key},label={Text(label)})}}
    val exercises=menu.getJSONArray("exercises").trainingObjects().filter{it.getString("focus")==focus&&(equipment=="all"||it.getString("equipment")==equipment)&&(difficulty=="all"||it.getString("difficulty")==difficulty)}
    val uriHandler=androidx.compose.ui.platform.LocalUriHandler.current
    exercises.forEach{exercise->val id=exercise.getString("id");val included=chosen.any{it.getString("id")==id}
      OutlinedCard(Modifier.fillMaxWidth()){Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
        Text(exercise.getString("name"),style=MaterialTheme.typography.titleMedium)
        Text("${if(exercise.getString("equipment")=="dumbbell")"哑铃" else "徒手"} · ${trainingDifficultyLabels[exercise.getString("difficulty")]}")
        Text(exercise.getString("guidance"));Text(exercise.getString("caution"),style=MaterialTheme.typography.bodySmall)
        TextButton(onClick={uriHandler.openUri(exercise.getString("source_url"))}){Text("教学参考（联网）")}
        OutlinedButton(enabled=!pending,onClick={chosen=if(included)chosen.filter{it.getString("id")!=id} else chosen+exercise;if(included){actual.remove(id);loads.remove(id)}}){Text(if(included)"移出今天" else "加入今天")}
      }}
    }
    if(exercises.isEmpty())Text("这个筛选条件下暂无动作，试试其他难度或器械。")
    Text("今天的组合 · ${chosen.size} 个动作",style=MaterialTheme.typography.titleMedium)
    Text("记录日期：${LocalDate.now()} · ${ZoneId.systemDefault().id}",style=MaterialTheme.typography.bodySmall)
    Text("练完填写每组实际次数或秒数，用逗号分开；空白动作不记录。单侧动作按每侧填写，两侧次数不同则分组填写。重量为每只哑铃的公斤数。")
    chosen.forEach{exercise->val id=exercise.getString("id");Text(exercise.getString("name"));OutlinedTextField(actual[id].orEmpty(),{actual[id]=it},enabled=!pending,label={Text(if(exercise.getString("unit")=="reps")"每组实际次数，如 10,10,8" else "每组实际秒数，如 15,15")},modifier=Modifier.fillMaxWidth());if(exercise.getString("equipment")=="dumbbell")OutlinedTextField(loads[id].orEmpty(),{loads[id]=it},enabled=!pending,label={Text("每只哑铃公斤（选填）")},modifier=Modifier.fillMaxWidth());TextButton(enabled=!pending,onClick={chosen=chosen.filter{it.getString("id")!=id};actual.remove(id);loads.remove(id)}){Text("移除")}}
    error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
    when(submit){is SubmitState.Rejected->Text(submit.message,color=MaterialTheme.colorScheme.error);is SubmitState.Saved->Text(if(submit.receipt.queued)"已加入同步队列；同步完成后刷新查看" else "已保存");else->Unit}
    Button(enabled=!pending&&chosen.any{!actual[it.getString("id")].isNullOrBlank()},onClick={
      try{
        val performed=chosen.filter{!actual[it.getString("id")].isNullOrBlank()}.map{exercise->
          val id=exercise.getString("id");val unit=exercise.getString("unit")
          val sets=actual[id]!!.trim().split(Regex("[,，\\s]+")).filter{it.isNotBlank()}.map{value->val n=value.toIntOrNull();require(n!=null&&n>0&&n<=if(unit=="reps")1000 else 7200){"请填写有效的正整数次数或秒数"};JSONObject().put(unit,n).apply{loads[id]?.trim()?.takeIf{it.isNotEmpty()}?.let{load->require(Regex("(?:0|[1-9]\\d{0,2})(?:\\.\\d{1,3})?").matches(load)){"哑铃重量须为有效公斤数"};put("load_kg",load)}}}
          require(sets.isNotEmpty()&&sets.size<=30){"每个动作请填写 1–30 组"};JSONObject().put("exercise",exercise).put("sets",JSONArray(sets))
        }
        require(performed.isNotEmpty()&&performed.size<=30){"每次记录 1–30 个实际动作"}
        val input=JSONObject().put("occurred_on",LocalDate.now().toString()).put("time_zone",ZoneId.systemDefault().id).put("session_type","strength_training").put("detail",JSONObject().put("strength_session",JSONObject().put("version",1).put("focus",theme).put("exercises",JSONArray(performed))))
        if(planId.isNotBlank())input.put("plan_id",planId)
        error=null;onReset();onSave("health.record_workout",input)
      }catch(failure:IllegalArgumentException){error=failure.message}
    }){Text("记录实际完成")}
    Text("入门可从 3–5 个动作、每动作 1–2 组尝试，保留约 2–3 次余力。挑战动作是备选，先掌握容易版本。",style=MaterialTheme.typography.bodySmall)
  }
}
