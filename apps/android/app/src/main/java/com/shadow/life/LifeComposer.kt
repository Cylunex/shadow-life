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
@Composable fun LifeComposerHost(open:Boolean,submitState:SubmitState,assistantState:LoadState<AssistantReply>?,historyState:LoadState<AssistantConversation>?,onLoadOlder:()->Unit,onDismiss:()->Unit,onSubmit:(CaptureDraft)->Unit,onAsk:(String)->Unit,onReset:()->Unit){
  if(!open)return
  var mode by rememberSaveable{mutableStateOf<CaptureKind?>(null)}
  ModalBottomSheet(onDismissRequest=onDismiss,containerColor=MaterialTheme.colorScheme.surface,dragHandle={BottomSheetDefaults.DragHandle()}){
    Column(Modifier.fillMaxWidth().imePadding().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(start=20.dp,end=20.dp,bottom=20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)){
      Text(if(mode==null)"Life" else "记录${mode?.label}",style=MaterialTheme.typography.headlineMedium)
      if(mode==null)ComposerStart(assistantState,historyState,onLoadOlder,onAsk,onChoose={mode=it}) else CaptureForm(mode!!,submitState,onSubmit,onBack={onReset();mode=null},onDone={onDismiss();onReset();mode=null})
    }
  }
}

@Composable private fun ComposerStart(assistantState:LoadState<AssistantReply>?,historyState:LoadState<AssistantConversation>?,onLoadOlder:()->Unit,onAsk:(String)->Unit,onChoose:(CaptureKind)->Unit){
  var message by rememberSaveable{mutableStateOf("")}
  Text("直接告诉 Life 你要记录、查找或安排什么；也可以选择完整表单。",color=MaterialTheme.colorScheme.onSurfaceVariant)
  when(historyState){
    is LoadState.Ready->{if(historyState.value.nextCursor!=null)TextButton(onClick=onLoadOlder){Text("加载更早消息")};historyState.value.items.forEach{item->Surface(Modifier.fillMaxWidth(),shape=MaterialTheme.shapes.large,color=if(item.role=="user")MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant){Column(Modifier.padding(14.dp)){Text(if(item.role=="user")"你" else "Life",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);Text(item.content)}}}}
    is LoadState.Failed->Text(historyState.message,color=MaterialTheme.colorScheme.error)
    LoadState.Loading->LinearProgressIndicator(Modifier.fillMaxWidth())
    else->Unit
  }
  OutlinedTextField(message,{message=it},Modifier.fillMaxWidth(),label={Text("对 Life 说")},minLines=2,maxLines=5,enabled=assistantState !is LoadState.Loading)
  Button(onClick={val outgoing=message;message="";onAsk(outgoing)},enabled=message.isNotBlank()&&assistantState !is LoadState.Loading,modifier=Modifier.fillMaxWidth().heightIn(min=56.dp)){Text(if(assistantState is LoadState.Loading)"Life 正在处理…" else if((assistantState as? LoadState.Ready)?.value?.state=="awaiting_input")"补充并继续" else "发送")}
  when(assistantState){
    is LoadState.Ready->if(assistantState.value.receipts.isNotEmpty()||assistantState.value.prompt!=null)LifeCard{assistantState.value.prompt?.let{Text(it,color=MaterialTheme.colorScheme.tertiary)};assistantState.value.receipts.forEach{Text("已提交 ${it.capability}",color=MaterialTheme.colorScheme.primary)};assistantState.value.runId?.let{Text("运行 $it",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
    is LoadState.Failed->Text(assistantState.message,color=MaterialTheme.colorScheme.error)
    else->Unit
  }
  HorizontalDivider()
  CaptureKind.entries.forEach{kind->OutlinedButton(onClick={onChoose(kind)},Modifier.fillMaxWidth().heightIn(min=56.dp)){Text("记录${kind.label}")}}
  Text("手动表单始终可用，不依赖模型；Life 只有收到 Executor 的真实回执才会显示已提交。",style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable private fun CaptureForm(kind:CaptureKind,state:SubmitState,onSubmit:(CaptureDraft)->Unit,onBack:()->Unit,onDone:()->Unit){
  var primary by rememberSaveable(kind){mutableStateOf("")};var secondary by rememberSaveable(kind){mutableStateOf("")};var note by rememberSaveable(kind){mutableStateOf("")};var option by rememberSaveable(kind){mutableStateOf(defaultOption(kind))};var date by rememberSaveable(kind){mutableStateOf(LocalDate.now().toString())};var category by rememberSaveable(kind){mutableStateOf("")};var paymentMethod by rememberSaveable(kind){mutableStateOf("")}
  when(state){
    is SubmitState.Saved->{TaskResultCard(state.receipt,onDone);return}
    is SubmitState.Rejected->Text(state.message,color=MaterialTheme.colorScheme.error)
    else->Unit
  }
  if(kind==CaptureKind.Expense)SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()){listOf("expense" to "支出","income" to "收入").forEachIndexed{index,(value,label)->SegmentedButton(selected=option==value,onClick={option=value},shape=SegmentedButtonDefaults.itemShape(index,2)){Text(label)}}}
  if(kind==CaptureKind.Purchase)OptionChips(listOf("offline_purchase" to "线下","online_purchase" to "网购","delivery" to "外卖","service" to "服务","transport" to "交通","other" to "其他"),option){option=it}
  if(kind==CaptureKind.Meal)OptionChips(listOf("breakfast" to "早餐","lunch" to "午餐","dinner" to "晚餐","snack" to "加餐","other" to "其他"),option){option=it}
  if(kind==CaptureKind.Health)OptionChips(listOf("weight" to "体重","body_fat" to "体脂","heart_rate" to "心率","temperature" to "体温","sleep_duration" to "睡眠","steps" to "步数","custom" to "其他"),option){option=it}
  if(kind==CaptureKind.OwnedItem)OptionChips(listOf("owned" to "持有","gifted" to "已赠出","returned" to "已退货","disposed" to "已处置","lost" to "遗失"),option){option=it}
  if(kind==CaptureKind.Project)OptionChips(listOf("active" to "进行中","paused" to "暂停","completed" to "完成","cancelled" to "取消"),option){option=it}
  OutlinedTextField(primary,{primary=it},Modifier.fillMaxWidth(),label={Text(primaryLabel(kind))},singleLine=kind!=CaptureKind.Library,keyboardOptions=KeyboardOptions(keyboardType=if(kind in listOf(CaptureKind.Expense,CaptureKind.Refund,CaptureKind.Health))KeyboardType.Decimal else KeyboardType.Text))
  if(kind !in listOf(CaptureKind.Meal,CaptureKind.Visit))OutlinedTextField(secondary,{secondary=it},Modifier.fillMaxWidth(),label={Text(secondaryLabel(kind))},minLines=if(kind==CaptureKind.Library||kind==CaptureKind.Project)4 else 1,singleLine=kind!=CaptureKind.Library&&kind!=CaptureKind.Project,keyboardOptions=KeyboardOptions(keyboardType=if(kind in listOf(CaptureKind.Purchase,CaptureKind.Workout))KeyboardType.Decimal else KeyboardType.Text))
  if(kind==CaptureKind.Expense||kind==CaptureKind.Purchase){OutlinedTextField(category,{category=it},Modifier.fillMaxWidth(),label={Text(if(kind==CaptureKind.Expense)"分类（可选）" else "渠道（可选）")},singleLine=true);Text("支付方式（可选）",style=MaterialTheme.typography.labelLarge);OptionChips(listOf("" to "未知","wechat" to "微信","alipay" to "支付宝","bank_card" to "银行卡","cash" to "现金","other" to "其他"),paymentMethod){paymentMethod=it}}
  OutlinedTextField(note,{note=it},Modifier.fillMaxWidth(),label={Text("备注（可选）")},minLines=2)
  OutlinedTextField(date,{date=it},Modifier.fillMaxWidth(),label={Text("发生日期")},supportingText={Text("YYYY-MM-DD")},singleLine=true,isError=!validDate(date))
  Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp),verticalAlignment=Alignment.CenterVertically){TextButton(onClick=onBack,enabled=state !is SubmitState.Sending){Text("返回")};Button(onClick={onSubmit(CaptureDraft(kind,primary,secondary,note,date,option,category,paymentMethod))},enabled=valid(kind,primary,secondary,date)&&state !is SubmitState.Sending,modifier=Modifier.weight(1f).heightIn(min=56.dp)){Text(if(state is SubmitState.Sending)"正在保存…" else "保存记录")}}
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun OptionChips(values:List<Pair<String,String>>,selected:String,onSelect:(String)->Unit){FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){values.forEach{(value,label)->FilterChip(selected=selected==value,onClick={onSelect(value)},label={Text(label)})}}}

@Composable fun TaskResultCard(receipt:OperationReceipt,onDone:()->Unit){LifeCard{Text(if(receipt.queued)"已安全保存，等待同步" else "已保存",style=MaterialTheme.typography.titleLarge);Text(receipt.capability,color=MaterialTheme.colorScheme.onSurfaceVariant);Text("命令 ${receipt.commandId}",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);receipt.resources.forEach{Text("${kindLabel(it.type)} · ${it.id}")};receipt.warnings.forEach{Text(it,color=MaterialTheme.colorScheme.tertiary)};Button(onClick=onDone,Modifier.fillMaxWidth().heightIn(min=56.dp)){Text("完成")}}}

private fun defaultOption(kind:CaptureKind)=when(kind){CaptureKind.Expense->"expense";CaptureKind.Purchase->"offline_purchase";CaptureKind.Meal->"other";CaptureKind.Health->"weight";CaptureKind.OwnedItem->"owned";CaptureKind.Project->"active";CaptureKind.Refund,CaptureKind.Workout,CaptureKind.Visit,CaptureKind.Trip->"";CaptureKind.Library->"note"}
private fun primaryLabel(kind:CaptureKind)=when(kind){CaptureKind.Expense,CaptureKind.Refund->"金额";CaptureKind.Purchase->"商家或商品";CaptureKind.Meal->"吃了什么";CaptureKind.Health->"数值";CaptureKind.Workout->"训练类型";CaptureKind.Visit->"地点";CaptureKind.Trip,CaptureKind.Project->"标题";CaptureKind.OwnedItem->"物品名称";CaptureKind.Library->"标题（可选）"}
private fun secondaryLabel(kind:CaptureKind)=when(kind){CaptureKind.Expense->"商家（可选）";CaptureKind.Purchase->"付款金额（可选）";CaptureKind.Refund->"原交易 ID";CaptureKind.Health->"单位";CaptureKind.Workout->"时长分钟（可选）";CaptureKind.Trip->"结束日期";CaptureKind.OwnedItem->"存放位置（可选）";CaptureKind.Project->"目标";CaptureKind.Library->"正文或链接";else->"补充信息"}
private fun valid(kind:CaptureKind,primary:String,secondary:String,date:String)=validDate(date)&&when(kind){CaptureKind.Library->secondary.isNotBlank();CaptureKind.Health,CaptureKind.Refund,CaptureKind.Trip,CaptureKind.Project->primary.isNotBlank()&&secondary.isNotBlank();else->primary.isNotBlank()}
private fun validDate(value:String)=runCatching{LocalDate.parse(value);true}.getOrDefault(false)
