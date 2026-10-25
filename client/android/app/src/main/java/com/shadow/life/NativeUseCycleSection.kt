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

@Composable internal fun NativeUseCycleSection(
  overview:WorkspaceOverview.Money,state:SubmitState,onSave:(NativeUseCycleDraft)->Unit,
  onUse:(NativeConsumableUseDraft)->Unit,onReset:()->Unit
){
  var showEditor by rememberSaveable{mutableStateOf(false)}
  var editing by remember{mutableStateOf<MoneyPlanningResultDtoUseCyclesEntry?>(null)}
  var name by rememberSaveable{mutableStateOf("")};var usageState by rememberSaveable{mutableStateOf("pending")}
  var startedOn by rememberSaveable{mutableStateOf(LocalDate.now().toString())}
  var initial by rememberSaveable{mutableStateOf("")};var unit by rememberSaveable{mutableStateOf("count")}
  var unitLabel by rememberSaveable{mutableStateOf("")};var daily by rememberSaveable{mutableStateOf("")};var note by rememberSaveable{mutableStateOf("")}
  var using by remember{mutableStateOf<MoneyPlanningResultDtoUseCyclesEntry?>(null)}
  var useEntry by remember{mutableStateOf<MoneyPlanningResultDtoUseCyclesEntryUsesEntry?>(null)}
  var useDate by rememberSaveable{mutableStateOf(LocalDate.now().toString())};var useQuantity by rememberSaveable{mutableStateOf("1")};var useNote by rememberSaveable{mutableStateOf("")}
  val busy=state is SubmitState.Sending
  fun open(cycle:MoneyPlanningResultDtoUseCyclesEntry?){onReset();editing=cycle;showEditor=true;name=cycle?.itemName.orEmpty();usageState=cycle?.usageState?.wireValue?:if(cycle==null)"pending" else "in_use";startedOn=cycle?.startedOn?:LocalDate.now().toString();initial=cycle?.initialQuantity.orEmpty();unit=cycle?.quantityUnit?.wireValue?:"count";unitLabel=cycle?.quantityLabel.orEmpty();daily=cycle?.expectedDailyUsage.orEmpty();note=cycle?.note.orEmpty()}
  fun openUse(cycle:MoneyPlanningResultDtoUseCyclesEntry,entry:MoneyPlanningResultDtoUseCyclesEntryUsesEntry?=null){onReset();using=cycle;useEntry=entry;useDate=entry?.occurredOn?:LocalDate.now().toString();useQuantity=entry?.quantity?:"1";useNote=entry?.note.orEmpty()}
  LaunchedEffect(state){if(state is SubmitState.Saved){showEditor=false;using=null;useEntry=null}}
  Column(verticalArrangement=Arrangement.spacedBy(14.dp)){
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text("消耗品余量",style=MaterialTheme.typography.headlineSmall);TextButton(onClick={open(null)},enabled=!busy){Text("新建")}}
    Text("区分待启用、实际使用和日用量估算；记录消耗不会再生成一笔支出。",color=MaterialTheme.colorScheme.onSurfaceVariant)
    when(state){is SubmitState.Sending->LinearProgressIndicator(Modifier.fillMaxWidth());is SubmitState.Rejected->Text(state.message,color=MaterialTheme.colorScheme.error);is SubmitState.Saved->Text(if(state.receipt.queued)"已保存，正在同步" else "已保存",color=MaterialTheme.colorScheme.primary);else->Unit}
    if(showEditor)LifeCard{
      Text(if(editing==null)"新建消耗品" else "编辑消耗品",style=MaterialTheme.typography.titleLarge)
      OutlinedTextField(name,{name=it},Modifier.fillMaxWidth(),label={Text("名称")},singleLine=true)
      Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(6.dp)){
        FilterChip(usageState=="pending",{usageState="pending"},{Text("待启用")},enabled=editing?.matchMode?.wireValue in setOf(null,"none"))
        FilterChip(usageState=="in_use",{usageState="in_use"},{Text("使用中")})
      }
      OutlinedTextField(startedOn,{startedOn=it},Modifier.fillMaxWidth(),label={Text(if(usageState=="pending")"购买 / 登记日期 YYYY-MM-DD" else "实际启用日期 YYYY-MM-DD")},singleLine=true)
      OutlinedTextField(initial,{initial=it},Modifier.fillMaxWidth(),label={Text("本批次初始数量（未知可留空）")},singleLine=true)
      Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(6.dp)){
        listOf("count" to "按件","g" to "克","ml" to "毫升").forEach{(key,label)->FilterChip(unit==key,{unit=key},{Text(label)},enabled=editing?.let{it.uses.orEmpty().isEmpty()&&it.usesTruncated!=true}?:true)}
      }
      if(unit=="count")OutlinedTextField(unitLabel,{unitLabel=it},Modifier.fillMaxWidth(),label={Text("单位名称（袋、卷、个等，可选）")},singleLine=true)
      OutlinedTextField(daily,{daily=it},Modifier.fillMaxWidth(),label={Text("预计每日使用量（可选，仅用于估算）")},singleLine=true)
      OutlinedTextField(note,{note=it},Modifier.fillMaxWidth(),label={Text("备注（可选）")})
      if(editing?.matchMode?.wireValue !in setOf(null,"none"))Text("这批次按已有饮食匹配规则扣减，规则保持不变。",color=MaterialTheme.colorScheme.onSurfaceVariant)
      Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){Button(onClick={onSave(NativeUseCycleDraft(name,usageState,startedOn,initial,unit,unitLabel,daily,note,editing,editing?.state?.wireValue?:"active",editing?.endedOn))},enabled=!busy&&name.isNotBlank()){Text("保存")};TextButton(onClick={showEditor=false}){Text("收起")}}
    }
    if(overview.useCycleDetails.isEmpty())Text("本月还没有消耗品周期。",color=MaterialTheme.colorScheme.onSurfaceVariant)
    overview.useCycleDetails.forEach{cycle->LifeCard{
      val unitText=cycle.quantityLabel?:when(cycle.quantityUnit?.wireValue){"g"->"克";"ml"->"毫升";else->"个"}
      Text(cycle.itemName,style=MaterialTheme.typography.titleMedium)
      Text(when{cycle.state.wireValue!="active"->when(cycle.state.wireValue){"completed"->"已用完";"discarded"->"已丢弃";else->"已补货"};cycle.usageState?.wireValue=="pending"->"待启用 / 未记开封";else->"使用中"},color=MaterialTheme.colorScheme.onSurfaceVariant)
      if(cycle.usageState?.wireValue!="pending"){
        Text(cycle.remainingQuantity?.let{"按记录剩余 $it $unitText"}?:"余量未知，请补充初始数量")
        cycle.estimatedRemainingQuantity?.let{Text("按日用量估算剩余 $it $unitText",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
        cycle.projectedDepletionOn?.let{Text("预计 $it 耗尽",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
      }
      cycle.note?.let{Text(it,color=MaterialTheme.colorScheme.onSurfaceVariant)}
      Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
        TextButton(onClick={open(cycle)},enabled=!busy){Text(if(cycle.usageState?.wireValue=="pending")"填写启用与规格" else "编辑")}
        if(cycle.state.wireValue=="active"&&cycle.usageState?.wireValue!="pending"&&cycle.matchMode.wireValue=="none"&&cycle.quantityUnit!=null)TextButton(onClick={openUse(cycle)},enabled=!busy){Text("记一次使用")}
        if(cycle.state.wireValue=="active")TextButton(onClick={onSave(NativeUseCycleDraft(cycle.itemName,cycle.usageState?.wireValue?:"in_use",cycle.startedOn,cycle.initialQuantity.orEmpty(),cycle.quantityUnit?.wireValue?:"count",cycle.quantityLabel.orEmpty(),cycle.expectedDailyUsage.orEmpty(),cycle.note.orEmpty(),cycle,"completed",LocalDate.now().toString()))},enabled=!busy){Text("已用完")}
      }
      cycle.uses.orEmpty().forEach{entry->Column(verticalArrangement=Arrangement.spacedBy(4.dp)){
        Text("${entry.occurredOn} · ${entry.quantity} $unitText · ${if(entry.state.wireValue=="voided")"已撤销" else "已使用"}")
        entry.note?.let{Text(it,color=MaterialTheme.colorScheme.onSurfaceVariant)}
        if(cycle.matchMode.wireValue=="none")Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
          TextButton(onClick={openUse(cycle,entry)},enabled=!busy){Text(if(entry.state.wireValue=="voided")"恢复 / 更正" else "更正")}
          if(entry.state.wireValue=="active")TextButton(onClick={onUse(NativeConsumableUseDraft(cycle,entry.occurredOn,entry.quantity,entry.note.orEmpty(),entry,"voided"))},enabled=!busy){Text("撤销误记")}
        }
        HorizontalDivider()
      }}
      if(cycle.usesTruncated==true)Text("还有更早使用记录，余量按全部有效记录计算。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }}
    if(using!=null){val cycle=using!!;LifeCard{
      Text(if(useEntry==null)"记录实际使用：${cycle.itemName}" else "更正使用记录：${cycle.itemName}",style=MaterialTheme.typography.titleMedium)
      OutlinedTextField(useDate,{useDate=it},Modifier.fillMaxWidth(),label={Text("使用日期 YYYY-MM-DD")},singleLine=true)
      OutlinedTextField(useQuantity,{useQuantity=it},Modifier.fillMaxWidth(),label={Text("使用数量")},singleLine=true)
      OutlinedTextField(useNote,{useNote=it},Modifier.fillMaxWidth(),label={Text("备注（可选）")})
      Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){Button(onClick={onUse(NativeConsumableUseDraft(cycle,useDate,useQuantity,useNote,useEntry))},enabled=!busy&&useQuantity.isNotBlank()){Text(if(useEntry==null)"记录使用" else "保存更正")};TextButton(onClick={using=null;useEntry=null}){Text("收起")}}
    }}
  }
}
