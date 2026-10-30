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

internal fun trainingTheme(menu:JSONObject,date:LocalDate=LocalDate.now()):String=menu.getJSONArray("days").trainingObjects().firstOrNull{it.getInt("weekday")==date.dayOfWeek.value}?.getString("focus")?:menu.getJSONArray("priorities").getString(0)

// Older free-form plan detail may use the same key. Do not render an incomplete object.
internal fun trainingMenuOrDefault(candidate:JSONObject?,fallback:JSONObject):JSONObject=runCatching{
  val menu=requireNotNull(candidate)
  require(menu.getInt("version")==1)
  val priorities=menu.getJSONArray("priorities");require(priorities.length()==5&&(0 until priorities.length()).map{priorities.getString(it)}.toSet()==trainingFocusLabels.keys)
  val days=menu.getJSONArray("days").trainingObjects();require(days.isNotEmpty()&&days.size<=7);days.forEach{require(it.getInt("weekday") in 1..7&&it.getString("focus") in trainingFocusLabels);it.getJSONArray("secondary")}
  val exercises=menu.getJSONArray("exercises").trainingObjects();require(exercises.isNotEmpty()&&exercises.size<=100)
  exercises.forEach{exercise->listOf("id","name","guidance","caution").forEach{require(exercise.getString(it).isNotBlank())};require(exercise.getString("focus") in trainingFocusLabels);require(exercise.getString("difficulty") in trainingDifficultyLabels);require(exercise.getString("equipment") in setOf("bodyweight","dumbbell"));require(exercise.getString("unit") in setOf("reps","seconds"));require(exercise.getString("source_url").startsWith("https://"))}
  menu.copyJson()
}.getOrElse{fallback.copyJson()}

@Composable internal fun TodayTrainingCard(state:LoadState<List<NativeTrainingPlan>>,onOpen:()->Unit){
  val plans=(state as? LoadState.Ready)?.value.orEmpty()
  val today=LocalDate.now().dayOfWeek.value
  val plan=plans.firstOrNull{it.schedule.optJSONArray("days")?.let{days->(0 until days.length()).any{days.optInt(it)==today}}==true}
  Card(onClick=onOpen,modifier=Modifier.fillMaxWidth(),colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.primaryContainer)){
    Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
      Text("训练计划",style=MaterialTheme.typography.titleLarge)
      Text(plan?.title?:if(plans.isNotEmpty())"今天自由练 / 恢复" else "今天练什么？",style=MaterialTheme.typography.headlineSmall)
      Text(when(state){is LoadState.Loading->"读取你的计划中，离线动作库随时可用";is LoadState.Failed->"计划暂未读取，仍可进入训练";else->if(plans.isEmpty())"徒手与哑铃 · 自选动作 · 逐组记录" else "${plans.size} 份计划 · 按状态选动作"})
      Text("进入训练 →",style=MaterialTheme.typography.labelLarge)
    }
  }
}

@Composable internal fun TrainingMenuWorkspace(accountId:String,state:LoadState<List<NativeTrainingPlan>>,submit:SubmitState,onLoad:()->Unit,onSave:(String,JSONObject,String?)->Unit,onReset:()->Unit){
  val context=LocalContext.current
  val builtIn=remember{context.assets.open("home-workout.json").bufferedReader().use{JSONObject(it.readText())}}
  val store=remember(accountId){TrainingDraftStore(context,accountId)}
  fun emptyDraft(planId:String="",focus:String=trainingTheme(builtIn))=TrainingDraft(LocalDate.now().toString(),ZoneId.systemDefault().id,focus,planId)
  var draft by remember(accountId){mutableStateOf(store.read()?:emptyDraft())}
  var activeExercise by androidx.compose.runtime.saveable.rememberSaveable(accountId){mutableIntStateOf(0)}
  var tab by remember(accountId){mutableStateOf("today")}
  var menu by remember(accountId){mutableStateOf(builtIn.copyJson())}
  var focus by remember(accountId){mutableStateOf(draft.focus)}
  var equipment by remember(accountId){mutableStateOf("all")}
  var difficulty by remember(accountId){mutableStateOf("all")}
  var query by remember(accountId){mutableStateOf("")}
  var name by remember(accountId){mutableStateOf("居家力量 · 自选动作")}
  var error by remember(accountId){mutableStateOf<String?>(null)}
  var expanded by remember(accountId){mutableStateOf<String?>(null)}
  var selecting by remember(accountId){mutableStateOf(false)}
  var initialized by remember(accountId){mutableStateOf(false)}
  var restLength by remember(accountId){mutableIntStateOf(60)}
  var now by remember{mutableLongStateOf(System.currentTimeMillis())}
  val plans=(state as? LoadState.Ready)?.value.orEmpty()
  val selected=plans.firstOrNull{it.id==draft.planId}
  val sending=submit is SubmitState.Sending
  val pending=sending||draft.commandId.isNotBlank()
  val uriHandler=androidx.compose.ui.platform.LocalUriHandler.current
  fun update(next:TrainingDraft){draft=next;store.save(next)}
  fun choosePlan(plan:NativeTrainingPlan?){
    if(draft.exercises.isNotEmpty()){error="当前组合已保留，请先完成或清空，再切换计划";tab="today";return}
    menu=trainingMenuOrDefault(plan?.detail?.optJSONObject("workout_menu"),builtIn)
    val theme=trainingTheme(menu);update(emptyDraft(plan?.id.orEmpty(),theme));focus=theme;name=plan?.title?:"居家力量 · 自选动作";error=null
  }
  fun updateExercise(id:String,change:(TrainingExerciseDraft)->TrainingExerciseDraft){update(draft.copy(exercises=draft.exercises.map{if(it.id==id)change(it) else it}))}
  LaunchedEffect(accountId){onLoad()}
  LaunchedEffect(state){if(state is LoadState.Ready&&!initialized){
    val plan=plans.firstOrNull{it.id==draft.planId}?:if(draft.exercises.isEmpty())plans.firstOrNull{it.schedule.optJSONArray("days")?.let{days->(0 until days.length()).any{days.optInt(it)==LocalDate.now().dayOfWeek.value}}==true}?:plans.firstOrNull() else null
    if(draft.exercises.isEmpty())choosePlan(plan) else {menu=trainingMenuOrDefault(plan?.detail?.optJSONObject("workout_menu"),builtIn);name=plan?.title?:"当前训练"}
    initialized=true
  }}
  LaunchedEffect(draft.restUntil){while(draft.restUntil>System.currentTimeMillis()){now=System.currentTimeMillis();kotlinx.coroutines.delay(250)};now=System.currentTimeMillis()}
  LaunchedEffect(submit){if(submit is SubmitState.Saved&&draft.commandId.isNotBlank()&&submit.receipt.commandId==draft.commandId){update(emptyDraft(draft.planId,draft.focus))}}
  Column(verticalArrangement=Arrangement.spacedBy(14.dp)){
    Card(colors=CardDefaults.cardColors(containerColor=MaterialTheme.colorScheme.primaryContainer)){
      Column(Modifier.fillMaxWidth().padding(18.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
        Text(if(draft.started)"训练进行中" else "今天练什么",style=MaterialTheme.typography.labelLarge)
        Text(trainingFocusLabels[draft.focus]?:"自选训练",style=MaterialTheme.typography.headlineLarge)
        Text(selected?.title?:if(draft.planId.isNotBlank())"已保留原计划的训练草稿" else "自由训练 · 徒手 / 哑铃")
        Text("${draft.exercises.size} 个动作 · 已完成 ${draft.completedSets} 组")
      }
    }
    Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
      linkedMapOf("today" to "今日训练","library" to "动作库","plans" to "我的计划").forEach{(key,label)->FilterChip(selected=tab==key,onClick={tab=key},label={Text(label)})}
    }
    error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
    if(state is LoadState.Ready&&state.refreshError!=null)ReadStatus(state,onLoad)
    when(submit){is SubmitState.Rejected->Text(submit.message,color=MaterialTheme.colorScheme.error);is SubmitState.Saved->Text(if(submit.receipt.queued)"已保存到同步队列；联网后同步" else "已保存");else->Unit}
    if(draft.restUntil>0){
      val remaining=trainingRestSeconds(draft.restUntil,now)
      OutlinedCard{Column(Modifier.fillMaxWidth().padding(14.dp)){
        Text(if(remaining>0)"组间休息 · ${remaining}s" else "休息结束，可以继续",style=MaterialTheme.typography.titleMedium)
        Row{listOf(30,60,90).forEach{seconds->TextButton(enabled=!pending,onClick={restLength=seconds;update(draft.copy(restUntil=System.currentTimeMillis()+seconds*1000L))}){Text("${seconds}s")}};TextButton(enabled=!pending,onClick={update(draft.copy(restUntil=0))}){Text("跳过")}}
      }}
    }
    when(tab){
      "today"->{
        if(draft.exercises.isEmpty()){
          Text("先选几个今天想练的动作",style=MaterialTheme.typography.titleLarge)
          Text("动作库是备选菜单，不是待完成清单。选好后再开始，按组记录。")
          Button(onClick={tab="library"}){Text("添加动作")}
          OutlinedButton(onClick={tab="plans"}){Text("选择训练计划")}
        }else{
          Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text(if(draft.started)"逐组记录" else "今日组合",style=MaterialTheme.typography.titleLarge);TextButton(enabled=!pending,onClick={tab="library"}){Text("＋ 添加动作")}}
          Text("${draft.date} · ${draft.timeZone}",style=MaterialTheme.typography.bodySmall)
          if(!draft.started)Button(enabled=!pending,onClick={update(draft.copy(started=true))}){Text("开始训练 · ${draft.exercises.size} 个动作")}
          if(draft.started)LifeTabs(activeExercise.coerceIn(0,draft.exercises.lastIndex).toString(),{activeExercise=it.toInt()},draft.exercises.mapIndexed{index,row->index.toString() to "${index+1}. ${JSONObject(row.snapshot).getString("name")}"})
          draft.exercises.forEachIndexed{index,row->
            if(draft.started&&index!=activeExercise.coerceIn(0,draft.exercises.lastIndex))return@forEachIndexed
            val exercise=JSONObject(row.snapshot);val seconds=exercise.getString("unit")=="seconds";val dumbbell=exercise.getString("equipment")=="dumbbell"
            OutlinedCard(Modifier.fillMaxWidth()){Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
              Text("${index+1}  ${exercise.getString("name")}",style=MaterialTheme.typography.titleMedium)
              TextButton(onClick={expanded=if(expanded==row.id)null else row.id}){Text(if(expanded==row.id)"收起动作说明" else "动作说明 / 教学")}
              if(expanded==row.id){Text(exercise.getString("guidance"));Text(exercise.getString("caution"),style=MaterialTheme.typography.bodySmall);TextButton(onClick={uriHandler.openUri(exercise.getString("source_url"))}){Text("打开教学参考")}}
              if(draft.started){
                row.sets.forEachIndexed{setIndex,set->
                  Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(6.dp),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){
                    Text("${setIndex+1}",modifier=Modifier.width(20.dp))
                    OutlinedTextField(set.value,{value->updateExercise(row.id){it.copy(sets=it.sets.mapIndexed{i,s->if(i==setIndex)s.copy(value=value,completed=false) else s})}},enabled=!pending&&!set.completed,label={Text(if(seconds)"秒数" else "次数")},keyboardOptions=androidx.compose.foundation.text.KeyboardOptions(keyboardType=androidx.compose.ui.text.input.KeyboardType.Number),modifier=Modifier.weight(1f))
                    if(dumbbell)OutlinedTextField(set.load,{value->updateExercise(row.id){it.copy(sets=it.sets.mapIndexed{i,s->if(i==setIndex)s.copy(load=value,completed=false) else s})}},enabled=!pending&&!set.completed,label={Text("kg / 只")},keyboardOptions=androidx.compose.foundation.text.KeyboardOptions(keyboardType=androidx.compose.ui.text.input.KeyboardType.Decimal),modifier=Modifier.weight(1f))
                    TextButton(enabled=!pending,onClick={
                      if(!set.completed&&!validTrainingSet(set,exercise.getString("unit"),dumbbell)){error="请填写有效${if(seconds)"秒数" else "次数"}；重量可留空"}
                      else {error=null;val next=row.copy(sets=row.sets.mapIndexed{i,s->if(i==setIndex)s.copy(completed=!s.completed) else s});update(draft.copy(exercises=draft.exercises.map{if(it.id==row.id)next else it},restUntil=if(set.completed)draft.restUntil else System.currentTimeMillis()+restLength*1000L))}
                    }){Text(if(set.completed)"✓ 撤销" else "完成")}
                  }
                }
                TextButton(enabled=!pending&&row.sets.size<30,onClick={updateExercise(row.id){it.copy(sets=it.sets+TrainingSetDraft(load=it.sets.lastOrNull()?.load.orEmpty()))}}){Text("＋ 加一组")}
              }
              if(!draft.started)Row{
                TextButton(enabled=!pending&&index>0,onClick={val list=draft.exercises.toMutableList();list.add(index-1,list.removeAt(index));update(draft.copy(exercises=list))}){Text("上移")}
                TextButton(enabled=!pending&&index<draft.exercises.lastIndex,onClick={val list=draft.exercises.toMutableList();list.add(index+1,list.removeAt(index));update(draft.copy(exercises=list))}){Text("下移")}
                TextButton(enabled=!pending&&row.sets.none{it.completed},onClick={update(draft.copy(exercises=draft.exercises.filter{it.id!=row.id}))}){Text("移除")}
              }
            }}
          }
          if(draft.started){
            if(activeExercise<draft.exercises.lastIndex)OutlinedButton(onClick={activeExercise++}){Text("下一个动作")}
            Text("只有点过“完成”的组会保存。重量按每只哑铃填写；单侧动作按每侧次数记录。",style=MaterialTheme.typography.bodySmall)
            Button(enabled=!sending&&draft.completedSets>0,onClick={
              try{
                val performed=draft.exercises.mapNotNull{row->val exercise=JSONObject(row.snapshot);val sets=row.sets.filter{it.completed}.map{set->require(validTrainingSet(set,exercise.getString("unit"),exercise.getString("equipment")=="dumbbell"));JSONObject().put(exercise.getString("unit"),set.value.toInt()).apply{if(exercise.getString("equipment")=="dumbbell"&&set.load.isNotBlank())put("load_kg",set.load.trim())}};if(sets.isEmpty())null else JSONObject().put("exercise",exercise).put("sets",JSONArray(sets))}
                val input=JSONObject().put("occurred_on",draft.date).put("time_zone",draft.timeZone).put("session_type","strength_training").put("detail",JSONObject().put("strength_session",JSONObject().put("version",1).put("focus",draft.focus).put("exercises",JSONArray(performed))))
                if(draft.planId.isNotBlank())input.put("plan_id",draft.planId)
                val commandId=draft.commandId.ifBlank{"cmd_android_training_${java.util.UUID.randomUUID().toString().replace("-","")}"}
                val submission=draft.submission.ifBlank{input.toString()}
                val frozen=draft.copy(commandId=commandId,submission=submission)
                require(store.save(frozen)){"暂时无法保存训练草稿，请稍后重试"};draft=frozen;error=null;onReset();onSave("health.record_workout",JSONObject(submission),commandId)
              }catch(failure:IllegalArgumentException){error=failure.message?:"请检查实际组数"}
            }){Text("结束并保存 · ${draft.completedSets} 组")}
          }
          TextButton(enabled=!pending&&draft.completedSets==0,onClick={update(emptyDraft(draft.planId,draft.focus));onReset()}){Text("清空未完成的组合")}
        }
      }
      "library"->{
        Text("动作库",style=MaterialTheme.typography.titleLarge)
        OutlinedTextField(query,{query=it},label={Text("搜索动作，如 卧推、飞鸟")},modifier=Modifier.fillMaxWidth())
        Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){trainingFocusLabels.forEach{(key,label)->FilterChip(selected=focus==key,onClick={focus=key},label={Text(label)})}}
        Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){linkedMapOf("all" to "全部器械","bodyweight" to "徒手","dumbbell" to "哑铃").forEach{(key,label)->FilterChip(selected=equipment==key,onClick={equipment=key},label={Text(label)})}}
        Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){(linkedMapOf("all" to "全部难度")+trainingDifficultyLabels).forEach{(key,label)->FilterChip(selected=difficulty==key,onClick={difficulty=key},label={Text(label)})}}
        val visible=menu.getJSONArray("exercises").trainingObjects().filter{(if(query.isBlank())it.getString("focus")==focus else it.getString("name").contains(query.trim(),ignoreCase=true))&&(equipment=="all"||it.getString("equipment")==equipment)&&(difficulty=="all"||it.getString("difficulty")==difficulty)}
        visible.forEach{exercise->val id=exercise.getString("id");val chosen=draft.exercises.any{it.id==id}
          OutlinedCard(Modifier.fillMaxWidth()){Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
            Text(exercise.getString("name"),style=MaterialTheme.typography.titleMedium)
            Text("${trainingFocusLabels[exercise.getString("focus")]} · ${if(exercise.getString("equipment")=="dumbbell")"哑铃" else "徒手"} · ${trainingDifficultyLabels[exercise.getString("difficulty")]}",style=MaterialTheme.typography.bodySmall)
            Row{TextButton(onClick={expanded=if(expanded==id)null else id}){Text("动作说明")};OutlinedButton(enabled=!pending&&!chosen&&draft.exercises.size<30,onClick={update(draft.copy(exercises=draft.exercises+TrainingExerciseDraft(id,exercise.toString())));error=null}){Text(if(chosen)"✓ 已加入" else "＋ 加入训练")}}
            if(expanded==id){Text(exercise.getString("guidance"));Text(exercise.getString("caution"));TextButton(onClick={uriHandler.openUri(exercise.getString("source_url"))}){Text("打开教学参考")}}
          }}
        }
        if(visible.isEmpty())Text("暂无匹配动作，试试其他筛选。")
        Button(onClick={tab="today"}){Text("查看今日训练 · ${draft.exercises.size} 个动作")}
      }
      "plans"->{
        Text("我的计划",style=MaterialTheme.typography.titleLarge)
        when(state){is LoadState.Loading->LinearProgressIndicator(Modifier.fillMaxWidth());is LoadState.Failed->{Text(state.message);TextButton(onClick=onLoad){Text("重试读取")}};else->if(plans.isEmpty())Text("还没有已保存的计划，可以先自由训练。")}
        plans.forEach{plan->OutlinedCard(Modifier.fillMaxWidth()){Column(Modifier.padding(14.dp)){
          Text(plan.title,style=MaterialTheme.typography.titleMedium)
          val days=plan.schedule.optJSONArray("days");Text(days?.let{(0 until it.length()).mapNotNull{i->it.optInt(i).takeIf{day->day in 1..7}?.let{day->"周${"一二三四五六日"[day-1]}"}}.joinToString(" · ")}?:"自选安排")
          TextButton(enabled=!pending,onClick={choosePlan(plan);if(draft.exercises.isEmpty())tab="library"}){Text(if(selected?.id==plan.id)"当前计划 · 选动作" else "使用这个计划")}
        }}}
        TextButton(enabled=!pending,onClick={choosePlan(null)}){Text("自由训练 / 新建菜单")}
        TextButton(enabled=!pending,onClick={selecting=!selecting}){Text(if(selecting)"收起菜单设置" else "编辑当前菜单与每周主题")}
        if(selecting){
          OutlinedTextField(name,{name=it},label={Text("菜单名称")},modifier=Modifier.fillMaxWidth())
          menu.getJSONArray("days").trainingObjects().forEachIndexed{index,day->
            Text("周${"一二三四五六日"[day.getInt("weekday")-1]}")
            Row(Modifier.horizontalScroll(rememberScrollState())){trainingFocusLabels.forEach{(key,label)->FilterChip(selected=day.getString("focus")==key,onClick={menu=menu.copyJson().apply{getJSONArray("days").getJSONObject(index).apply{put("focus",key);val old=getJSONArray("secondary");put("secondary",JSONArray((0 until old.length()).map{old.getString(it)}.filter{it!=key}))}}},label={Text(label)})}}
          }
          Button(enabled=!pending&&state is LoadState.Ready&&name.isNotBlank()&&(draft.planId.isBlank()||selected!=null)&&!(submit is SubmitState.Saved&&submit.receipt.capability=="health.set_plan"),onClick={
            val detail=selected?.detail?.copyJson()?:JSONObject();detail.put("workout_menu",menu)
            val schedule=selected?.schedule?.copyJson()?:JSONObject();if(selected==null)schedule.put("days",JSONArray(menu.getJSONArray("days").trainingObjects().map{it.getInt("weekday")}))
            val input=JSONObject().put("kind","workout").put("name",name.trim()).put("state","active").put("schedule",schedule).put("detail",detail)
            selected?.let{input.put("plan_id",it.id).put("expected_revision",it.revision)};onReset();onSave("health.set_plan",input,null)
          }){Text(if(selected==null)"保存为新计划" else "保存菜单设置")}
        }
        Text("训练主题",style=MaterialTheme.typography.titleMedium)
        Row(Modifier.horizontalScroll(rememberScrollState())){trainingFocusLabels.forEach{(key,label)->FilterChip(selected=draft.focus==key,enabled=!draft.started&&!pending,onClick={update(draft.copy(focus=key));focus=key},label={Text(label)})}}
      }
    }
    Text("不必做完动作库。动作引起或加重疼痛时停止，后腰不适优先有支撑的版本。教学链接需联网。",style=MaterialTheme.typography.bodySmall)
  }
}
