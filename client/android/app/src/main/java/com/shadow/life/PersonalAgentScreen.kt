package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.json.JSONObject
import org.json.JSONArray
import java.time.LocalDate
import java.util.UUID

private fun JsonObject.field(name:String)=(get(name) as? JsonPrimitive)?.content.orEmpty()
private val personalLabels=mapOf("global" to "全部场景","daily" to "日常","planning" to "生活规划","spending" to "消费","health" to "健康","travel" to "旅行","library" to "资料","preference" to "偏好","constraint" to "限制","goal" to "目标","other" to "一般","dietary" to "饮食","time_budget" to "时间上限","budget" to "预算","open" to "未开始","running" to "进行中","waiting" to "等待材料","completed" to "已完成","cancelled" to "已取消")

@Composable fun PersonalAgentScreen(accountId:String,state:LoadState<FoundationListDto>,submit:SubmitState,onLoad:(String,String,Int)->Unit,onSave:(String,JSONObject)->Unit,onBack:()->Unit){
  var tab by rememberSaveable(accountId){mutableStateOf("intentions")}
  var on by rememberSaveable(accountId){mutableStateOf(LocalDate.now().toString())}
  var editing by remember(accountId){mutableStateOf<JsonObject?>(null)}
  var editor by rememberSaveable(accountId){mutableStateOf(false)}
  var text by rememberSaveable(accountId){mutableStateOf("")}
  var scope by rememberSaveable(accountId){mutableStateOf("global")}
  var kind by rememberSaveable(accountId){mutableStateOf("preference")}
  var category by rememberSaveable(accountId){mutableStateOf("other")}
  var minutes by rememberSaveable(accountId){mutableStateOf("30")}
  var amount by rememberSaveable(accountId){mutableStateOf("")}
  var currency by rememberSaveable(accountId){mutableStateOf("CNY")}
  var from by rememberSaveable(accountId){mutableStateOf("")}
  var until by rememberSaveable(accountId){mutableStateOf("")}
  var step by rememberSaveable(accountId){mutableStateOf("")}
  var next by rememberSaveable(accountId){mutableStateOf("")}
  var missing by rememberSaveable(accountId){mutableStateOf("")}
  var taskState by rememberSaveable(accountId){mutableStateOf("open")}
  var localError by remember(accountId){mutableStateOf<String?>(null)}
  LaunchedEffect(accountId,tab,on){editor=false;editing=null;onLoad(tab,on,0)}
  fun edit(item:JsonObject?){editing=item;editor=true;text=item?.field(if(tab=="tasks")"title" else "statement").orEmpty();scope=item?.field("scope")?.ifBlank{"global"}?:"global";kind=item?.field("kind")?.ifBlank{"preference"}?:"preference";category=item?.field("category")?.ifBlank{"other"}?:"other";minutes=item?.field("minutes")?.ifBlank{"30"}?:"30";amount=item?.field("amount").orEmpty();currency=item?.field("currency")?.ifBlank{"CNY"}?:"CNY";from=item?.field("valid_from").orEmpty();until=item?.field("valid_to_exclusive").orEmpty();step=item?.field("current_step").orEmpty();next=item?.field("next_step").orEmpty();taskState=item?.field("state")?.ifBlank{"open"}?:"open";missing=item?.get("missing")?.let{runCatching{JSONArray(it.toString()).let{array->(0 until array.length()).joinToString("\n"){index->array.getString(index)}}}.getOrDefault("")}.orEmpty();localError=null}
  fun input(item:JsonObject?,archive:Boolean=false):JSONObject{
    val result=JSONObject()
    val fields=if(tab=="intentions")listOf("key","scope","kind","category","statement","assertion","minutes","amount","currency","valid_from","valid_to_exclusive","project_ref") else if(tab=="tasks")listOf("task_key","scope","title","state","current_step","next_step","missing","object_refs","operation_ids") else listOf("key","scope","kind","statement","object_refs","operation_ids","environment","workflow_revision","outcome","limitations","valid_to_exclusive")
    val old=item?.let{JSONObject(it.toString())}
    fields.forEach{field->if(old?.has(field)==true)result.put(field,old.get(field))}
    if(item!=null){result.put("id",item.field("id")).put("expected_revision",item.field("revision").toInt()).put("reason",if(archive)"用户归档" else "用户在 Android 更正")}
    if(archive)return result.put("state","archived")
    result.put("scope",scope)
    if(tab=="intentions"){
      result.put("key",item?.field("key")?:"personal.${UUID.randomUUID()}").put("kind",kind).put("category",category).put("statement",text.trim()).put("assertion","explicit").put("state","active")
      if(category=="time_budget")result.put("minutes",minutes.toInt()) else result.remove("minutes")
      if(category=="budget"){result.put("amount",amount).put("currency",currency.uppercase())}else{result.remove("amount");result.remove("currency")}
      if(from.isNotBlank())result.put("valid_from",LocalDate.parse(from).toString()) else result.remove("valid_from")
      if(until.isNotBlank())result.put("valid_to_exclusive",LocalDate.parse(until).toString()) else result.remove("valid_to_exclusive")
    }else{
      result.put("task_key",item?.field("task_key")?:"personal.${UUID.randomUUID()}").put("title",text.trim()).put("state",taskState).put("current_step",step).put("next_step",next)
      result.put("missing",JSONArray(missing.lines().map(String::trim).filter(String::isNotBlank)))
      old?.optJSONObject("lease")?.optString("token")?.takeIf{it.isNotBlank()&&it!="null"}?.let{result.put("lease_token",it)}
    }
    return result
  }
  val busy=submit is SubmitState.Sending
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
    Row{TextButton(onClick=onBack){Text("返回")};Text("目标与偏好",style=MaterialTheme.typography.headlineSmall)}
    Text("维护明确的目标和偏好，查看持续任务与有依据的观察。")
    Row(horizontalArrangement=Arrangement.spacedBy(6.dp)){listOf("intentions" to "目标偏好","tasks" to "任务","learning" to "经验").forEach{(key,label)->FilterChip(tab==key,{tab=key},{Text(label)})}}
    LifeDateField(on,{on=it},"查看日期")
    Row{if(tab!="learning")Button(onClick={edit(null)},enabled=!busy){Text("新增")};TextButton(onClick={onLoad(tab,on,0)}){Text("刷新")}}
    if(localError!=null)Text(localError!!,color=MaterialTheme.colorScheme.error)
    when(submit){is SubmitState.Rejected->Text(submit.message,color=MaterialTheme.colorScheme.error);is SubmitState.Saved->Text(if(submit.receipt.queued)"已加入同步队列；同步完成后刷新查看" else "已保存");else->Unit}
    if(editor){
      OutlinedTextField(text,{text=it},label={Text(if(tab=="tasks")"任务" else "目标或偏好")},modifier=Modifier.fillMaxWidth())
      PersonalChoice("适用场景",scope,listOf("global","daily","planning","spending","health","travel","library")){scope=it}
      if(tab=="intentions"){
        PersonalChoice("类型",kind,listOf("preference","constraint","goal")){kind=it}
        PersonalChoice("类别",category,listOf("other","dietary","time_budget","budget","travel","goal")){category=it}
        if(category=="time_budget")OutlinedTextField(minutes,{minutes=it},label={Text("分钟上限")},modifier=Modifier.fillMaxWidth())
        if(category=="budget"){OutlinedTextField(amount,{amount=it},label={Text("金额")},modifier=Modifier.fillMaxWidth());OutlinedTextField(currency,{currency=it},label={Text("币种")},modifier=Modifier.fillMaxWidth())}
        OutlinedTextField(from,{from=it},label={Text("开始生效日期（可留空）")},modifier=Modifier.fillMaxWidth())
        OutlinedTextField(until,{until=it},label={Text("结束日期（当天起不再适用，可留空）")},modifier=Modifier.fillMaxWidth())
      }else{
        PersonalChoice("状态",taskState,listOf("open","running","waiting","completed","cancelled")){taskState=it;if(it=="completed"){next="";missing=""}}
        OutlinedTextField(step,{step=it},label={Text("当前步骤")},modifier=Modifier.fillMaxWidth())
        OutlinedTextField(next,{next=it},label={Text("下一步")},modifier=Modifier.fillMaxWidth())
        OutlinedTextField(missing,{missing=it},label={Text("尚缺材料，每行一项")},modifier=Modifier.fillMaxWidth())
      }
      Row{Button(enabled=!busy&&text.isNotBlank(),onClick={try{onSave(if(tab=="tasks")"agent.save_task" else "agent.set_intention",input(editing));editor=false}catch(error:Exception){localError=error.message}}){Text("保存")};TextButton(onClick={editor=false}){Text("取消")}}
    }
    if(state is LoadState.Ready)ReadStatus(state){onLoad(tab,on,0)}
    when(state){
      LoadState.Loading->CircularProgressIndicator()
      is LoadState.Failed->Text(state.message,color=MaterialTheme.colorScheme.error)
      is LoadState.Empty->Text(state.reason)
      is LoadState.Ready->{
        if(state.value.items.isEmpty())Text("这个类别还没有记录。")
        state.value.items.forEach{item->Card(Modifier.fillMaxWidth()){Column(Modifier.padding(14.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
          Text(item.field("statement").ifBlank{item.field("title")},style=MaterialTheme.typography.titleMedium)
          Text("${personalLabels[item.field("scope")]?:item.field("scope")} · ${personalLabels[item.field("state")]?:item.field("state")}")
          if(item.field("current_step").isNotBlank())Text("当前：${item.field("current_step")}")
          if(item.field("next_step").isNotBlank())Text("下一步：${item.field("next_step")}")
          if(item.field("limitations").isNotBlank())Text(item.field("limitations"))
          if(item.field("valid_from").isNotBlank()||item.field("valid_to_exclusive").isNotBlank())Text("${item.field("valid_from").ifBlank{"长期"}} — ${item.field("valid_to_exclusive").ifBlank{"无结束日期"}}")
          if(item.field("evidence_current")=="false")Text("依据已变更，请重新读取相关记录。")
          val lease=item["lease"] as? JsonObject
          if(lease?.field("active")=="true")Text("助手正在处理，可接手时间：${lease.field("expires_at")}")
          Text("更新于 ${item.field("updated_at")} · 修订 ${item.field("revision")}",style=MaterialTheme.typography.bodySmall)
          Row{if(tab!="learning")TextButton(enabled=!busy&&(lease?.field("active")!="true"||lease.field("token").let{it.isNotBlank()&&it!="null"}),onClick={edit(item)}){Text("更正")};if(tab!="tasks"&&item.field("state")!="archived")TextButton(enabled=!busy,onClick={onSave(if(tab=="intentions")"agent.set_intention" else "agent.save_learning",input(item,true))}){Text("归档")}}
        }}}
        state.value.nextOffset?.let{offset->TextButton(onClick={onLoad(tab,on,offset.toInt())}){Text("继续加载")}}
      }
    }
  }
}
@Composable private fun PersonalChoice(label:String,value:String,values:List<String>,onChange:(String)->Unit){var expanded by remember{mutableStateOf(false)};Column{TextButton(onClick={expanded=true}){Text("$label：${personalLabels[value]?:value}")};DropdownMenu(expanded,{expanded=false}){values.forEach{option->DropdownMenuItem(text={Text(personalLabels[option]?:option)},onClick={onChange(option);expanded=false})}}}}
