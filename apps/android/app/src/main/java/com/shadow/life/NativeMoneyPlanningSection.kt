package com.shadow.life

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.time.LocalDate

@Composable private fun PlanningWriteState(state:SubmitState){when(state){
  is SubmitState.Sending->LinearProgressIndicator(Modifier.fillMaxWidth())
  is SubmitState.Rejected->Text(state.message,color=MaterialTheme.colorScheme.error)
  is SubmitState.Saved->Text(if(state.receipt.queued)"已保存，正在同步" else "已保存",color=MaterialTheme.colorScheme.primary)
  else->Unit
}}

@Composable internal fun NativeBudgetSection(overview:WorkspaceOverview.Money,state:SubmitState,onSave:(NativeBudgetDraft)->Unit,onReset:()->Unit){
  var showEditor by rememberSaveable{mutableStateOf(false)}
  var category by rememberSaveable{mutableStateOf("")}
  var amount by rememberSaveable{mutableStateOf("")}
  var revision by rememberSaveable{mutableStateOf<Long?>(null)}
  val busy=state is SubmitState.Sending
  Column(verticalArrangement=Arrangement.spacedBy(14.dp)){
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text("${overview.period} 预算",style=MaterialTheme.typography.headlineSmall);TextButton(onClick={onReset();showEditor=!showEditor;category="";amount="";revision=null}){Text(if(showEditor)"收起" else "新建预算")}}
    PlanningWriteState(state)
    if(showEditor)LifeCard{
      Text("按本月实际支出跟踪预算",style=MaterialTheme.typography.titleMedium)
      OutlinedTextField(category,{category=it},Modifier.fillMaxWidth(),label={Text("分类（留空为总预算）")},singleLine=true)
      OutlinedTextField(amount,{amount=it},Modifier.fillMaxWidth(),label={Text("金额 CNY")},singleLine=true)
      Button(onClick={onSave(NativeBudgetDraft(overview.period,category,amount,revision))},enabled=!busy&&amount.isNotBlank(),modifier=Modifier.fillMaxWidth()){Text("保存预算")}
    }
    if(overview.budgetDetails.isEmpty())Text("本月还没有预算。",color=MaterialTheme.colorScheme.onSurfaceVariant)
    overview.budgetDetails.forEach{budget->LifeCard{
      Text(budget.category?:"全部消费",style=MaterialTheme.typography.titleMedium)
      Text("已用 ${budget.currency} ${budget.spent} / ${budget.amount}")
      Text("按本月已记录的支出计算",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
      TextButton(onClick={onReset();category=budget.category.orEmpty();amount=budget.amount;revision=budget.revision;showEditor=true},enabled=!busy){Text("调整金额")}
    }}
  }
}

@Composable internal fun NativeRecurringSection(
  overview:WorkspaceOverview.Money,state:SubmitState,onSave:(NativeRecurringDraft)->Unit,
  onOccurrence:(MoneyPlanningResultDtoOccurrencesEntry,String)->Unit,onReset:()->Unit
){
  var showEditor by rememberSaveable{mutableStateOf(false)}
  var editing by remember{mutableStateOf<MoneyPlanningResultDtoRecurringPlansEntry?>(null)}
  var title by rememberSaveable{mutableStateOf("")}
  var amount by rememberSaveable{mutableStateOf("")}
  var category by rememberSaveable{mutableStateOf("")}
  var cadence by rememberSaveable{mutableStateOf("monthly")}
  var dueOn by rememberSaveable{mutableStateOf(LocalDate.now().toString())}
  val busy=state is SubmitState.Sending
  fun open(plan:MoneyPlanningResultDtoRecurringPlansEntry?){onReset();editing=plan;showEditor=true;title=plan?.title.orEmpty();amount=plan?.amount.orEmpty();category=plan?.category.orEmpty();cadence=plan?.cadence?.wireValue?:"monthly";dueOn=plan?.nextDueOn?:LocalDate.now().toString()}
  Column(verticalArrangement=Arrangement.spacedBy(14.dp)){
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text("周期费用",style=MaterialTheme.typography.headlineSmall);TextButton(onClick={if(showEditor){showEditor=false}else open(null)}){Text(if(showEditor)"收起" else "新增计划")}}
    PlanningWriteState(state)
    if(showEditor)LifeCard{
      Text(if(editing==null)"新增周期计划" else "编辑周期计划",style=MaterialTheme.typography.titleMedium)
      OutlinedTextField(title,{title=it},Modifier.fillMaxWidth(),label={Text("名称")},singleLine=true)
      OutlinedTextField(amount,{amount=it},Modifier.fillMaxWidth(),label={Text("金额 CNY（可留空）")},singleLine=true)
      OutlinedTextField(category,{category=it},Modifier.fillMaxWidth(),label={Text("分类（可选）")},singleLine=true)
      if(editing==null)Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(6.dp)){listOf("daily" to "每天","weekly" to "每周","monthly" to "每月","yearly" to "每年").forEach{(key,label)->FilterChip(selected=cadence==key,onClick={cadence=key},label={Text(label)})}}
      else Text("周期：${when(cadence){"daily"->"每天";"weekly"->"每周";"yearly"->"每年";"interval"->"自定间隔";else->"每月"}}",color=MaterialTheme.colorScheme.onSurfaceVariant)
      OutlinedTextField(dueOn,{dueOn=it},Modifier.fillMaxWidth(),label={Text("下次日期 YYYY-MM-DD")},singleLine=true)
      Button(onClick={onSave(NativeRecurringDraft(title,amount,cadence,dueOn,category,editing))},enabled=!busy&&title.isNotBlank()&&runCatching{LocalDate.parse(dueOn)}.isSuccess,modifier=Modifier.fillMaxWidth()){Text("保存周期计划")}
    }
    if(overview.recurringDetails.isEmpty())Text("还没有周期费用计划。",color=MaterialTheme.colorScheme.onSurfaceVariant)
    overview.recurringDetails.forEach{plan->LifeCard{
      Text(plan.title,style=MaterialTheme.typography.titleMedium)
      Text("下次 ${plan.nextDueOn} · ${plan.amount?.let{"${plan.currency} $it"}?:"金额未定"}")
      Text(when(plan.state.wireValue){"paused"->"已暂停";"ended"->"已结束";else->"进行中"},color=MaterialTheme.colorScheme.onSurfaceVariant)
      if(plan.state.wireValue!="ended")Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
        TextButton(onClick={open(plan)},enabled=!busy){Text("编辑")}
        TextButton(onClick={onSave(NativeRecurringDraft(plan.title,plan.amount.orEmpty(),plan.cadence.wireValue,plan.nextDueOn,plan.category.orEmpty(),plan,if(plan.state.wireValue=="paused")"active" else "paused"))},enabled=!busy){Text(if(plan.state.wireValue=="paused")"继续" else "暂停")}
      }
    }}
    val occurrences=overview.occurrenceDetails.filter{it.state.wireValue in setOf("pending","reminded","snoozed")}
    if(occurrences.isNotEmpty())Text("待处理事项",style=MaterialTheme.typography.titleLarge)
    occurrences.forEach{item->LifeCard{
      val plan=overview.recurringDetails.firstOrNull{it.id==item.planId}
      Text(plan?.title?:"周期事项",style=MaterialTheme.typography.titleMedium)
      Text("${item.effectiveDueOn} · ${when(item.state.wireValue){"snoozed"->"已稍后提醒";"reminded"->"已提醒";else->"待处理"}}",color=MaterialTheme.colorScheme.onSurfaceVariant)
      Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
        TextButton(onClick={onOccurrence(item,"handled")},enabled=!busy){Text("已处理")}
        TextButton(onClick={onOccurrence(item,"snoozed")},enabled=!busy){Text("明天提醒")}
        TextButton(onClick={onOccurrence(item,"dismissed")},enabled=!busy){Text("忽略本次")}
      }
    }}
  }
}

@Composable internal fun NativeSpendingIntentSection(
  overview:WorkspaceOverview.Money,state:SubmitState,records:List<RecordSummary>,onSearchRecords:(String)->Unit,
  onSave:(NativeSpendingIntentDraft)->Unit,onReset:()->Unit
){
  var editing by remember{mutableStateOf<MoneyPlanningResultDtoSpendingIntentsEntry?>(null)}
  var showEditor by rememberSaveable{mutableStateOf(false)}
  var title by rememberSaveable{mutableStateOf("")};var amount by rememberSaveable{mutableStateOf("")};var intendedOn by rememberSaveable{mutableStateOf("")}
  var intentState by rememberSaveable{mutableStateOf("planned")};var linkedId by rememberSaveable{mutableStateOf<String?>(null)};var recordQuery by rememberSaveable{mutableStateOf("")}
  val busy=state is SubmitState.Sending
  fun open(item:MoneyPlanningResultDtoSpendingIntentsEntry?,stateOverride:String?=null){onReset();editing=item;showEditor=true;title=item?.title.orEmpty();amount=item?.expectedAmount.orEmpty();intendedOn=item?.intendedOn.orEmpty();intentState=stateOverride?:item?.state?.wireValue?:"planned";linkedId=item?.linkedRecordId}
  Column(verticalArrangement=Arrangement.spacedBy(14.dp)){
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text("想买清单",style=MaterialTheme.typography.headlineSmall);TextButton(onClick={if(showEditor){showEditor=false}else open(null)}){Text(if(showEditor)"收起" else "添加")}}
    PlanningWriteState(state)
    if(showEditor)LifeCard{
      Text(if(editing==null)"添加购买想法" else "编辑购买想法",style=MaterialTheme.typography.titleMedium)
      OutlinedTextField(title,{title=it},Modifier.fillMaxWidth(),label={Text("想买什么")},singleLine=true)
      OutlinedTextField(amount,{amount=it},Modifier.fillMaxWidth(),label={Text("预计金额 CNY（可选）")},singleLine=true)
      OutlinedTextField(intendedOn,{intendedOn=it},Modifier.fillMaxWidth(),label={Text("计划日期 YYYY-MM-DD（可选）")},singleLine=true)
      Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(6.dp)){
        listOf("planned" to "计划中","purchased" to "已买","cancelled" to "已取消").forEach{(key,label)->FilterChip(intentState==key,{intentState=key},{Text(label)})}
      }
      if(intentState=="purchased"){
        OutlinedTextField(recordQuery,{recordQuery=it},Modifier.fillMaxWidth(),label={Text("查找实际消费")},singleLine=true,trailingIcon={TextButton(onClick={onSearchRecords(recordQuery)}){Text("查找")}})
        val candidates=records.filter{it.detailId!=null&&it.recordState=="confirmed"&&it.kind in setOf("money_entry","purchase")}.distinctBy{it.detailId}.take(15)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(6.dp)){
          candidates.forEach{record->FilterChip(linkedId==record.detailId,{linkedId=record.detailId},{Text(record.title.take(18))})}
        }
        if(linkedId!=null&&candidates.none{it.detailId==linkedId})Text("已保留关联的消费记录",color=MaterialTheme.colorScheme.onSurfaceVariant)
      }
      Button(onClick={onSave(NativeSpendingIntentDraft(title,amount,intendedOn,editing,intentState,linkedId))},enabled=!busy&&title.isNotBlank()&&(intentState!="purchased"||linkedId!=null),modifier=Modifier.fillMaxWidth()){Text("保存")}
    }
    if(overview.intentDetails.isEmpty())Text("本月没有购买想法。",color=MaterialTheme.colorScheme.onSurfaceVariant)
    overview.intentDetails.forEach{item->LifeCard{
      Text(item.title,style=MaterialTheme.typography.titleMedium)
      Text(listOfNotNull(item.intendedOn,item.expectedAmount?.let{"${item.currency.orEmpty()} $it"}).joinToString(" · ").ifBlank{"未设置日期或金额"},color=MaterialTheme.colorScheme.onSurfaceVariant)
      Text(when(item.state.wireValue){"purchased"->"已买";"cancelled"->"已取消";else->"计划中"},style=MaterialTheme.typography.labelMedium)
      Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
        TextButton(onClick={open(item)},enabled=!busy){Text("编辑")}
        if(item.state.wireValue=="planned"){
          TextButton(onClick={open(item,"purchased")},enabled=!busy){Text("关联已买")}
          TextButton(onClick={onSave(NativeSpendingIntentDraft(item.title,item.expectedAmount.orEmpty(),item.intendedOn.orEmpty(),item,"cancelled",item.linkedRecordId))},enabled=!busy){Text("取消计划")}
        }
      }
    }}
    Text("已买状态关联实际消费记录；添加想法不会生成付款。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
  }
}
