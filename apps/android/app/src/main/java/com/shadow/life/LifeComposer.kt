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
@Composable fun LifeComposerHost(open:Boolean,initialSeed:CaptureSeed?,submitState:SubmitState,assistantState:LoadState<AssistantReply>?,historyState:LoadState<AssistantConversation>?,refundCandidates:LoadState<RecordPage>,onLoadOlder:()->Unit,onLoadRefundCandidates:(String)->Unit,onDismiss:()->Unit,onSubmit:(CaptureDraft)->Unit,onAsk:(String)->Unit,onReset:()->Unit){
  if(!open)return
  var mode by rememberSaveable(initialSeed?.contextId,initialSeed?.kind){mutableStateOf(initialSeed?.kind)}
  ModalBottomSheet(onDismissRequest=onDismiss,containerColor=MaterialTheme.colorScheme.surface,dragHandle={BottomSheetDefaults.DragHandle()}){
    Column(Modifier.fillMaxWidth().imePadding().navigationBarsPadding().verticalScroll(rememberScrollState()).padding(start=20.dp,end=20.dp,bottom=20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)){
      Text(if(mode==null)"Life" else "记录${mode?.label}",style=MaterialTheme.typography.headlineMedium)
      if(mode==null)ComposerStart(assistantState,historyState,onLoadOlder,onAsk,onChoose={mode=it;if(it==CaptureKind.Refund)onLoadRefundCandidates("")}) else CaptureForm(mode!!,initialSeed?.takeIf{it.kind==mode},submitState,refundCandidates,onLoadRefundCandidates,onSubmit,onBack={onReset();mode=null},onDone={onDismiss();onReset();mode=null})
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
    is LoadState.Ready->if(assistantState.value.receipts.isNotEmpty()||assistantState.value.prompt!=null)LifeCard{assistantState.value.prompt?.let{Text(it,color=MaterialTheme.colorScheme.tertiary)};assistantState.value.receipts.forEach{Text(receiptLabel(it.capability),color=MaterialTheme.colorScheme.primary)}}
    is LoadState.Failed->Text(assistantState.message,color=MaterialTheme.colorScheme.error)
    else->Unit
  }
  HorizontalDivider()
  CaptureKind.entries.forEach{kind->OutlinedButton(onClick={onChoose(kind)},Modifier.fillMaxWidth().heightIn(min=56.dp)){Text("记录${kind.label}")}}
  Text("手动表单始终可用，不依赖模型；Life 只有收到 Executor 的真实回执才会显示已提交。",style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable private fun CaptureForm(kind:CaptureKind,seed:CaptureSeed?,state:SubmitState,refundCandidates:LoadState<RecordPage>,onLoadRefundCandidates:(String)->Unit,onSubmit:(CaptureDraft)->Unit,onBack:()->Unit,onDone:()->Unit){
  var primary by rememberSaveable(kind,seed?.contextId){mutableStateOf(seed?.primary.orEmpty())};var secondary by rememberSaveable(kind,seed?.contextId){mutableStateOf(seed?.secondary.orEmpty())};var note by rememberSaveable(kind,seed?.contextId){mutableStateOf(seed?.note.orEmpty())};var option by rememberSaveable(kind,seed?.contextId){mutableStateOf(seed?.option?.ifBlank{defaultOption(kind)}?:defaultOption(kind))};var date by rememberSaveable(kind,seed?.contextId){mutableStateOf(seed?.date?:LocalDate.now().toString())};var category by rememberSaveable(kind,seed?.contextId){mutableStateOf(seed?.category.orEmpty())};var paymentMethod by rememberSaveable(kind,seed?.contextId){mutableStateOf(seed?.paymentMethod.orEmpty())};var advancedMeal by rememberSaveable(kind,seed?.contextId){mutableStateOf(false)};val mealRows=remember(kind,seed?.contextId){mutableStateListOf(MealDraftItem(name=if(kind==CaptureKind.Meal)seed?.primary.orEmpty() else ""))}
  when(state){
    is SubmitState.Saved->{TaskResultCard(state.receipt,onDone);return}
    is SubmitState.Rejected->Text(state.message,color=MaterialTheme.colorScheme.error)
    else->Unit
  }
  seed?.contextLabel?.let{LifeCard{Text("已带入上下文",style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.primary);Text(it);Text("保存时会引用当前对象，不会重复创建原交易或购买。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
  if(kind==CaptureKind.Expense)SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()){listOf("expense" to "支出","income" to "收入").forEachIndexed{index,(value,label)->SegmentedButton(selected=option==value,onClick={option=value},shape=SegmentedButtonDefaults.itemShape(index,2)){Text(label)}}}
  if(kind==CaptureKind.Purchase)OptionChips(listOf("offline_purchase" to "线下","online_purchase" to "网购","delivery" to "外卖","service" to "服务","transport" to "交通","other" to "其他"),option){option=it}
  if(kind==CaptureKind.Meal)OptionChips(listOf("breakfast" to "早餐","lunch" to "午餐","dinner" to "晚餐","snack" to "加餐","other" to "其他"),option){option=it}
  if(kind==CaptureKind.Health)OptionChips(listOf("weight" to "体重","body_fat" to "体脂","heart_rate" to "心率","temperature" to "体温","sleep_duration" to "睡眠","steps" to "步数","custom" to "其他"),option){option=it}
  if(kind==CaptureKind.OwnedItem)OptionChips(listOf("owned" to "持有","gifted" to "已赠出","returned" to "已退货","disposed" to "已处置","lost" to "遗失"),option){option=it}
  if(kind==CaptureKind.Project)OptionChips(listOf("active" to "进行中","paused" to "暂停","completed" to "完成","cancelled" to "取消"),option){option=it}
  if(kind==CaptureKind.Meal){
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text("食物与份量",Modifier.weight(1f),style=MaterialTheme.typography.titleMedium);TextButton(onClick={advancedMeal=!advancedMeal}){Text(if(advancedMeal)"使用逐行编辑" else "高级粘贴")}}
    if(advancedMeal)OutlinedTextField(primary,{primary=it},Modifier.fillMaxWidth(),label={Text("每行一种食物")},minLines=4,supportingText={Text("名称，或 名称 | 份量 | 单位")})
    else{
      mealRows.forEachIndexed{index,row->LifeCard{
        OutlinedTextField(row.name,{value->mealRows[index]=row.copy(name=value)},Modifier.fillMaxWidth(),label={Text("食物 ${index+1}")},singleLine=true)
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
          OutlinedTextField(row.quantity,{value->mealRows[index]=row.copy(quantity=value)},Modifier.weight(1f),label={Text("份量")},singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal))
          OutlinedTextField(row.unit,{value->mealRows[index]=row.copy(unit=value)},Modifier.weight(1f),label={Text("单位")},singleLine=true)
        }
        Text("营养（可选；按这份食物填写）",style=MaterialTheme.typography.labelMedium)
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
          OutlinedTextField(row.energyKcal,{value->mealRows[index]=row.copy(energyKcal=value)},Modifier.weight(1f),label={Text("热量 kcal")},singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal))
          OutlinedTextField(row.proteinG,{value->mealRows[index]=row.copy(proteinG=value)},Modifier.weight(1f),label={Text("蛋白 g")},singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal))
        }
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
          OutlinedTextField(row.fatG,{value->mealRows[index]=row.copy(fatG=value)},Modifier.weight(1f),label={Text("脂肪 g")},singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal))
          OutlinedTextField(row.carbG,{value->mealRows[index]=row.copy(carbG=value)},Modifier.weight(1f),label={Text("碳水 g")},singleLine=true,keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal))
        }
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(6.dp)){listOf("g","ml","份","个").forEach{unit->AssistChip(onClick={mealRows[index]=row.copy(unit=unit)},label={Text(unit)})};if(mealRows.size>1)TextButton(onClick={mealRows.removeAt(index)}){Text("移除")}}
      }}
      OutlinedButton(onClick={mealRows.add(MealDraftItem())},Modifier.fillMaxWidth()){Text("添加一种食物")}
    }
  }else OutlinedTextField(primary,{primary=it},Modifier.fillMaxWidth(),label={Text(primaryLabel(kind))},minLines=1,singleLine=kind!=CaptureKind.Library,keyboardOptions=KeyboardOptions(keyboardType=if(kind in listOf(CaptureKind.Expense,CaptureKind.Refund,CaptureKind.Health))KeyboardType.Decimal else KeyboardType.Text))
  if(kind==CaptureKind.Refund)RefundEntryPicker(refundCandidates,secondary,{secondary=it},onLoadRefundCandidates)
  else if(kind !in listOf(CaptureKind.Meal,CaptureKind.Visit))OutlinedTextField(secondary,{secondary=it},Modifier.fillMaxWidth(),label={Text(secondaryLabel(kind))},minLines=if(kind==CaptureKind.Library||kind==CaptureKind.Project)4 else 1,singleLine=kind!=CaptureKind.Library&&kind!=CaptureKind.Project,keyboardOptions=KeyboardOptions(keyboardType=if(kind in listOf(CaptureKind.Purchase,CaptureKind.Workout))KeyboardType.Decimal else KeyboardType.Text))
  if(kind==CaptureKind.Expense||kind==CaptureKind.Purchase){OutlinedTextField(category,{category=it},Modifier.fillMaxWidth(),label={Text(if(kind==CaptureKind.Expense)"分类（可选）" else "渠道（可选）")},singleLine=true);Text("支付方式（可选）",style=MaterialTheme.typography.labelLarge);OptionChips(listOf("" to "未知","wechat" to "微信","alipay" to "支付宝","bank_card" to "银行卡","cash" to "现金","other" to "其他"),paymentMethod){paymentMethod=it}}
  OutlinedTextField(note,{note=it},Modifier.fillMaxWidth(),label={Text("备注（可选）")},minLines=2)
  OutlinedTextField(date,{date=it},Modifier.fillMaxWidth(),label={Text("发生日期")},supportingText={Text("YYYY-MM-DD")},singleLine=true,isError=!validDate(date))
  val mealValid=kind!=CaptureKind.Meal||if(advancedMeal)primary.isNotBlank() else mealRows.isNotEmpty()&&mealRows.all{it.name.isNotBlank()&&(it.quantity.isBlank()==it.unit.isBlank())}
  val effectivePrimary=if(kind==CaptureKind.Meal&&!advancedMeal)mealRows.firstOrNull()?.name.orEmpty() else primary
  Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp),verticalAlignment=Alignment.CenterVertically){TextButton(onClick=onBack,enabled=state !is SubmitState.Sending){Text("返回")};Button(onClick={onSubmit(CaptureDraft(kind,primary,secondary,note,date,option,category,paymentMethod,if(kind==CaptureKind.Meal&&!advancedMeal)mealRows.toList() else emptyList(),seed?.contextKind,seed?.contextId))},enabled=mealValid&&valid(kind,effectivePrimary,secondary,date)&&state !is SubmitState.Sending,modifier=Modifier.weight(1f).heightIn(min=56.dp)){Text(if(state is SubmitState.Sending)"正在保存…" else "保存记录")}}
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun RefundEntryPicker(state:LoadState<RecordPage>,selectedId:String,onSelect:(String)->Unit,onSearch:(String)->Unit){
  var expanded by remember{mutableStateOf(false)};var query by rememberSaveable{mutableStateOf("")}
  val candidates=(state as? LoadState.Ready)?.value?.items.orEmpty();val selected=candidates.firstOrNull{it.id==selectedId}
  OutlinedTextField(query,{query=it},Modifier.fillMaxWidth(),label={Text("搜索原交易")},singleLine=true,trailingIcon={TextButton(onClick={onSearch(query)}){Text("搜索")}})
  ExposedDropdownMenuBox(expanded=expanded,onExpandedChange={if(state is LoadState.Ready)expanded=it}){
    OutlinedTextField(selected?.let{listOfNotNull(it.title,it.trailing,it.supporting).joinToString(" · ")}.orEmpty(),{},Modifier.menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable).fillMaxWidth(),readOnly=true,label={Text("原交易")},placeholder={Text(when(state){LoadState.Loading->"正在读取交易…";is LoadState.Empty->state.reason;is LoadState.Failed->"读取失败，点击搜索重试";is LoadState.Ready->"选择一笔交易"})},trailingIcon={ExposedDropdownMenuDefaults.TrailingIcon(expanded)})
    ExposedDropdownMenu(expanded=expanded,onDismissRequest={expanded=false}){candidates.forEach{entry->DropdownMenuItem(text={Column{Text(entry.title);Text(listOfNotNull(entry.trailing,entry.supporting).joinToString(" · "),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}},onClick={onSelect(entry.id);expanded=false})}}
  }
  Text("退款会继承普通交易的 CNY 合同；外币交易暂不在这里静默折算。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun OptionChips(values:List<Pair<String,String>>,selected:String,onSelect:(String)->Unit){FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){values.forEach{(value,label)->FilterChip(selected=selected==value,onClick={onSelect(value)},label={Text(label)})}}}

@Composable fun TaskResultCard(receipt:OperationReceipt,onDone:()->Unit){var details by rememberSaveable{mutableStateOf(false)};LifeCard{Text(if(receipt.queued)"已安全保存，等待同步" else receiptLabel(receipt.capability),style=MaterialTheme.typography.titleLarge);receipt.resources.forEach{Text(kindLabel(it.type),color=MaterialTheme.colorScheme.onSurfaceVariant)};receipt.warnings.forEach{Text(it,color=MaterialTheme.colorScheme.tertiary)};TextButton(onClick={details=!details}){Text(if(details)"收起数据说明" else "数据说明")};if(details){Text(receipt.capability,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);Text("命令 ${receipt.commandId}",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant);receipt.executionId?.let{Text("执行 $it",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}};Button(onClick=onDone,Modifier.fillMaxWidth().heightIn(min=56.dp)){Text("完成")}}}

private fun receiptLabel(capability:String)=when(capability){"money.record_entry"->"收支已记录";"money.record_refund"->"退款已记录";"life.record_purchase"->"购买已记录";"life.record_meal"->"餐次已记录";"health.record_measurement"->"健康数据已记录";"health.record_workout"->"训练已记录";"travel.record_visit"->"到访已记录";"travel.create_trip"->"旅程已创建";"life.save_owned_item"->"物品已保存";"life.save_project"->"项目已保存";"library.capture"->"资料已收存";else->"操作已保存"}

private fun defaultOption(kind:CaptureKind)=when(kind){CaptureKind.Expense->"expense";CaptureKind.Purchase->"offline_purchase";CaptureKind.Meal->"other";CaptureKind.Health->"weight";CaptureKind.OwnedItem->"owned";CaptureKind.Project->"active";CaptureKind.Refund,CaptureKind.Workout,CaptureKind.Visit,CaptureKind.Trip->"";CaptureKind.Library->"note"}
private fun primaryLabel(kind:CaptureKind)=when(kind){CaptureKind.Expense,CaptureKind.Refund->"金额";CaptureKind.Purchase->"商家或商品";CaptureKind.Meal->"吃了什么";CaptureKind.Health->"数值";CaptureKind.Workout->"训练类型";CaptureKind.Visit->"地点";CaptureKind.Trip,CaptureKind.Project->"标题";CaptureKind.OwnedItem->"物品名称";CaptureKind.Library->"标题（可选）"}
private fun secondaryLabel(kind:CaptureKind)=when(kind){CaptureKind.Expense->"商家（可选）";CaptureKind.Purchase->"付款金额（可选）";CaptureKind.Refund->"原交易";CaptureKind.Health->"单位";CaptureKind.Workout->"时长分钟（可选）";CaptureKind.Trip->"结束日期";CaptureKind.OwnedItem->"存放位置（可选）";CaptureKind.Project->"目标";CaptureKind.Library->"正文或链接";else->"补充信息"}
private fun valid(kind:CaptureKind,primary:String,secondary:String,date:String)=validDate(date)&&when(kind){CaptureKind.Library->secondary.isNotBlank();CaptureKind.Health,CaptureKind.Refund,CaptureKind.Trip,CaptureKind.Project->primary.isNotBlank()&&secondary.isNotBlank();else->primary.isNotBlank()}
private fun validDate(value:String)=runCatching{LocalDate.parse(value);true}.getOrDefault(false)
