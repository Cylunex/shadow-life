package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import java.time.LocalDate

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun LifeComposerHost(open:Boolean,submitState:SubmitState,assistantState:LoadState<AssistantReply>?,onDismiss:()->Unit,onSubmit:(CaptureDraft)->Unit,onAsk:(String)->Unit,onReset:()->Unit){
  if(!open)return
  var mode by rememberSaveable{mutableStateOf<CaptureKind?>(null)}
  ModalBottomSheet(onDismissRequest=onDismiss,containerColor=MaterialTheme.colorScheme.surface,dragHandle={BottomSheetDefaults.DragHandle()}){
    Column(Modifier.fillMaxWidth().imePadding().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(start=20.dp,end=20.dp,bottom=20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)){
      Text(if(mode==null)"Life" else "记录${mode?.label}",style=MaterialTheme.typography.headlineMedium)
      if(mode==null)ComposerStart(assistantState,onAsk,onChoose={mode=it}) else CaptureForm(mode!!,submitState,onSubmit,onBack={onReset();mode=null},onDone={onDismiss();onReset();mode=null})
    }
  }
}

@Composable private fun ComposerStart(assistantState:LoadState<AssistantReply>?,onAsk:(String)->Unit,onChoose:(CaptureKind)->Unit){
  var message by rememberSaveable{mutableStateOf("")}
  Text("直接告诉 Life 你要记录、查找或安排什么；也可以选择完整表单。",color=MaterialTheme.colorScheme.onSurfaceVariant)
  OutlinedTextField(message,{message=it},Modifier.fillMaxWidth(),label={Text("对 Life 说")},minLines=2,maxLines=5,enabled=assistantState !is LoadState.Loading)
  Button(onClick={val outgoing=message;message="";onAsk(outgoing)},enabled=message.isNotBlank()&&assistantState !is LoadState.Loading,modifier=Modifier.fillMaxWidth().heightIn(min=56.dp)){Text(if(assistantState is LoadState.Loading)"Life 正在处理…" else if((assistantState as? LoadState.Ready)?.value?.state=="awaiting_input")"补充并继续" else "发送")}
  when(assistantState){
    is LoadState.Ready->LifeCard{Text(assistantState.value.text.ifBlank{assistantState.value.prompt?:"任务已处理"});assistantState.value.prompt?.let{Text(it,color=MaterialTheme.colorScheme.tertiary)};assistantState.value.receipts.forEach{Text("已提交 ${it.capability}",color=MaterialTheme.colorScheme.primary)};assistantState.value.runId?.let{Text("运行 $it",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
    is LoadState.Failed->Text(assistantState.message,color=MaterialTheme.colorScheme.error)
    else->Unit
  }
  HorizontalDivider()
  CaptureKind.entries.forEach{kind->OutlinedButton(onClick={onChoose(kind)},Modifier.fillMaxWidth().heightIn(min=56.dp)){Text("记录${kind.label}")}}
  Text("手动表单始终可用，不依赖模型；Life 只有收到 Executor 的真实回执才会显示已提交。",style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable private fun CaptureForm(kind:CaptureKind,state:SubmitState,onSubmit:(CaptureDraft)->Unit,onBack:()->Unit,onDone:()->Unit){
  var primary by rememberSaveable(kind){mutableStateOf("")};var secondary by rememberSaveable(kind){mutableStateOf("")};var note by rememberSaveable(kind){mutableStateOf("")};var option by rememberSaveable(kind){mutableStateOf(defaultOption(kind))};val date=rememberSaveable{LocalDate.now().toString()}
  when(state){
    is SubmitState.Saved->{TaskResultCard(state.receipt,onDone);return}
    is SubmitState.Rejected->Text(state.message,color=MaterialTheme.colorScheme.error)
    else->Unit
  }
  if(kind==CaptureKind.Expense)SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()){listOf("expense" to "支出","income" to "收入").forEachIndexed{index,(value,label)->SegmentedButton(selected=option==value,onClick={option=value},shape=SegmentedButtonDefaults.itemShape(index,2)){Text(label)}}}
  if(kind==CaptureKind.Meal)OptionChips(listOf("breakfast" to "早餐","lunch" to "午餐","dinner" to "晚餐","snack" to "加餐","other" to "其他"),option){option=it}
  if(kind==CaptureKind.Health)OptionChips(listOf("weight" to "体重","body_fat" to "体脂","heart_rate" to "心率","temperature" to "体温","sleep_duration" to "睡眠","steps" to "步数","custom" to "其他"),option){option=it}
  OutlinedTextField(primary,{primary=it},Modifier.fillMaxWidth(),label={Text(primaryLabel(kind))},singleLine=kind!=CaptureKind.Library,keyboardOptions=KeyboardOptions(keyboardType=if(kind==CaptureKind.Expense||kind==CaptureKind.Health)KeyboardType.Decimal else KeyboardType.Text))
  if(kind in listOf(CaptureKind.Expense,CaptureKind.Health,CaptureKind.Library))OutlinedTextField(secondary,{secondary=it},Modifier.fillMaxWidth(),label={Text(secondaryLabel(kind))},minLines=if(kind==CaptureKind.Library)4 else 1,singleLine=kind!=CaptureKind.Library)
  OutlinedTextField(note,{note=it},Modifier.fillMaxWidth(),label={Text("备注（可选）")},minLines=2)
  Text("发生日期 $date",style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
  Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp),verticalAlignment=Alignment.CenterVertically){TextButton(onClick=onBack,enabled=state !is SubmitState.Sending){Text("返回")};Button(onClick={onSubmit(CaptureDraft(kind,primary,secondary,note,date,option))},enabled=valid(kind,primary,secondary)&&state !is SubmitState.Sending,modifier=Modifier.weight(1f).heightIn(min=56.dp)){Text(if(state is SubmitState.Sending)"正在保存…" else "保存记录")}}
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun OptionChips(values:List<Pair<String,String>>,selected:String,onSelect:(String)->Unit){FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){values.forEach{(value,label)->FilterChip(selected=selected==value,onClick={onSelect(value)},label={Text(label)})}}}

@Composable fun TaskResultCard(receipt:OperationReceipt,onDone:()->Unit){LifeCard{Text(if(receipt.queued)"已安全保存，等待同步" else "已保存",style=MaterialTheme.typography.titleLarge);Text(receipt.capability,color=MaterialTheme.colorScheme.onSurfaceVariant);Text("命令 ${receipt.commandId}",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);receipt.resources.forEach{Text("${kindLabel(it.type)} · ${it.id}")};receipt.warnings.forEach{Text(it,color=MaterialTheme.colorScheme.tertiary)};Button(onClick=onDone,Modifier.fillMaxWidth().heightIn(min=56.dp)){Text("完成")}}}

private fun defaultOption(kind:CaptureKind)=when(kind){CaptureKind.Expense->"expense";CaptureKind.Meal->"other";CaptureKind.Health->"weight";CaptureKind.Visit->"";CaptureKind.Library->"note"}
private fun primaryLabel(kind:CaptureKind)=when(kind){CaptureKind.Expense->"金额";CaptureKind.Meal->"吃了什么";CaptureKind.Health->"数值";CaptureKind.Visit->"地点";CaptureKind.Library->"标题"}
private fun secondaryLabel(kind:CaptureKind)=when(kind){CaptureKind.Expense->"商家（可选）";CaptureKind.Health->"单位";CaptureKind.Library->"正文或链接";else->"补充信息"}
private fun valid(kind:CaptureKind,primary:String,secondary:String)=primary.isNotBlank()&&(kind!=CaptureKind.Health||secondary.isNotBlank())&&(kind!=CaptureKind.Library||secondary.isNotBlank())
