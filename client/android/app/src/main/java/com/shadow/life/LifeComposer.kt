package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.horizontalScroll
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
@Composable fun LifeComposerHost(open:Boolean,initialSeed:CaptureSeed?,submitState:SubmitState,assistantState:LoadState<AssistantReply>?,historyState:LoadState<AssistantConversation>?,threadState:LoadState<List<AssistantThreadSummary>>,selectedThreadId:String?,refundCandidates:LoadState<RecordPage>,onLoadOlder:()->Unit,onSelectThread:(String)->Unit,onNewThread:()->Unit,onLoadRefundCandidates:(String)->Unit,onDismiss:()->Unit,onSubmit:(CaptureDraft)->Unit,onAsk:(String)->Unit,onReset:()->Unit,onOpenCapture:()->Unit={},startWithAssistant:Boolean=false,onSavedMessage:(String)->Unit={}){
  if(!open)return
  var mode by rememberSaveable(initialSeed?.contextId,initialSeed?.kind){mutableStateOf(initialSeed?.kind)}
  var dirty by remember{mutableStateOf(false)}
  var exit by remember{mutableStateOf<String?>(null)}
  fun leave(target:String){if(submitState is SubmitState.Sending)return;if(dirty)exit=target else if(target=="types"){onReset();mode=null}else onDismiss()}

  val saved=submitState as? SubmitState.Saved
  LaunchedEffect(saved?.receipt?.commandId){if(saved!=null&&mode!=null&&saved.receipt.warnings.isEmpty()){onSavedMessage(if(saved.receipt.queued)"已保存到本机，待同步" else "记录已保存");dirty=false;onDismiss();onReset()}}
  androidx.compose.ui.window.Dialog(onDismissRequest={leave("close")},properties=androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth=false)){
    Scaffold(containerColor=MaterialTheme.colorScheme.background,topBar={TopAppBar(title={Text(mode?.let{"记录${it.label}"}?:if(startWithAssistant)"Life 助手" else "快速记录")},navigationIcon={LifeBackButton{leave(if(mode!=null&&initialSeed==null)"types" else "close")}})}){padding->
      Column(Modifier.fillMaxSize().padding(padding).imePadding().verticalScroll(rememberScrollState()).padding(20.dp),verticalArrangement=Arrangement.spacedBy(16.dp)){
        if(mode==null){
          if(startWithAssistant)ComposerStart(assistantState,historyState,threadState,selectedThreadId,onLoadOlder,onSelectThread,onNewThread,onAsk,onChoose={mode=it;if(it==CaptureKind.Refund)onLoadRefundCandidates("")})
          else{
            Text("选择你想记下的事",style=MaterialTheme.typography.headlineMedium)
            CaptureKind.entries.forEach{kind->LifeCard(onClick={mode=kind;if(kind==CaptureKind.Refund)onLoadRefundCandidates("")}){Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text(kind.label,Modifier.weight(1f),style=MaterialTheme.typography.titleMedium);Text("＋",color=MaterialTheme.colorScheme.primary)}}}
            OutlinedButton(onClick=onOpenCapture,modifier=Modifier.fillMaxWidth()){Text("录音、截图与自动记录")}
          }
        }else CaptureForm(mode!!,initialSeed?.takeIf{it.kind==mode},submitState,refundCandidates,onLoadRefundCandidates,onSubmit,onDirty={dirty=it},onBack={leave("types")},onDone={onDismiss();onReset();mode=null})
      }
    }
  if(exit!=null)AlertDialog(onDismissRequest={exit=null},title={Text("放弃未保存的内容？")},text={Text("已填写的内容尚未保存。")},confirmButton={TextButton(onClick={val target=exit;exit=null;dirty=false;if(target=="types"){onReset();mode=null}else onDismiss()}){Text("放弃")}},dismissButton={TextButton(onClick={exit=null}){Text("继续编辑")}})
  }
}

@Composable private fun ComposerStart(assistantState:LoadState<AssistantReply>?,historyState:LoadState<AssistantConversation>?,threadState:LoadState<List<AssistantThreadSummary>>,selectedThreadId:String?,onLoadOlder:()->Unit,onSelectThread:(String)->Unit,onNewThread:()->Unit,onAsk:(String)->Unit,onChoose:(CaptureKind)->Unit){
  var message by rememberSaveable{mutableStateOf("")}
  Text("直接告诉 Life 你要记录、查找或安排什么；也可以选择完整表单。",color=MaterialTheme.colorScheme.onSurfaceVariant)
  var showHistory by rememberSaveable{mutableStateOf(false)}
  Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){TextButton(onClick={showHistory=!showHistory}){Text(if(showHistory)"收起历史对话" else "历史对话")};
    FilterChip(selected=selectedThreadId==null,onClick=onNewThread,enabled=assistantState !is LoadState.Loading,label={Text("新对话")})
  }
  if(showHistory&&threadState is LoadState.Ready)threadState.value.forEach{thread->TextButton(onClick={onSelectThread(thread.id);showHistory=false},enabled=assistantState !is LoadState.Loading,modifier=Modifier.fillMaxWidth()){Text(thread.title.ifBlank{"未命名对话"})}}
  if(threadState is LoadState.Failed)Text(threadState.message,color=MaterialTheme.colorScheme.error)
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
  var manual by rememberSaveable{mutableStateOf(false)}
  TextButton(onClick={manual=!manual}){Text(if(manual)"收起手动记录" else "使用手动记录")}
  if(manual)CaptureKind.entries.forEach{kind->OutlinedButton(onClick={onChoose(kind)},Modifier.fillMaxWidth().heightIn(min=48.dp)){Text("记录${kind.label}")}}
  Text("记录保存状态会随同步结果更新。",style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
}

@Composable private fun CaptureForm(kind:CaptureKind,seed:CaptureSeed?,state:SubmitState,refundCandidates:LoadState<RecordPage>,onLoadRefundCandidates:(String)->Unit,onSubmit:(CaptureDraft)->Unit,onDirty:(Boolean)->Unit,onBack:()->Unit,onDone:()->Unit){
  var primary by rememberSaveable(kind,seed?.contextId){mutableStateOf(seed?.primary.orEmpty())};var secondary by rememberSaveable(kind,seed?.contextId){mutableStateOf(seed?.secondary?.takeIf{it.isNotBlank()}?:if(kind==CaptureKind.Trip)LocalDate.now().toString() else "")};var note by rememberSaveable(kind,seed?.contextId){mutableStateOf(seed?.note.orEmpty())};var option by rememberSaveable(kind,seed?.contextId){mutableStateOf(seed?.option?.ifBlank{defaultOption(kind)}?:defaultOption(kind))};var date by rememberSaveable(kind,seed?.contextId){mutableStateOf(seed?.date?:LocalDate.now().toString())};var category by rememberSaveable(kind,seed?.contextId){mutableStateOf(seed?.category.orEmpty())};var paymentMethod by rememberSaveable(kind,seed?.contextId){mutableStateOf(seed?.paymentMethod.orEmpty())};var advancedMeal by rememberSaveable(kind,seed?.contextId){mutableStateOf(false)};val mealRows=rememberSaveable(kind,seed?.contextId,saver=androidx.compose.runtime.saveable.listSaver<androidx.compose.runtime.snapshots.SnapshotStateList<MealDraftItem>,String>(save={rows->rows.map{org.json.JSONArray(listOf(it.name,it.quantity,it.unit,it.energyKcal,it.proteinG,it.fatG,it.carbG)).toString()}},restore={rows->rows.map{org.json.JSONArray(it).let{a->MealDraftItem(a.getString(0),a.getString(1),a.getString(2),a.getString(3),a.getString(4),a.getString(5),a.getString(6))}}.toMutableStateList()})){mutableStateListOf(MealDraftItem(name=if(kind==CaptureKind.Meal)seed?.primary.orEmpty() else ""))}
  val changed=primary!=seed?.primary.orEmpty()||secondary!=(seed?.secondary?.takeIf{it.isNotBlank()}?:if(kind==CaptureKind.Trip)LocalDate.now().toString() else "")||note!=seed?.note.orEmpty()||mealRows.toList()!=listOf(MealDraftItem(name=if(kind==CaptureKind.Meal)seed?.primary.orEmpty() else ""))||category!=seed?.category.orEmpty()||paymentMethod!=seed?.paymentMethod.orEmpty()||date!=(seed?.date?:LocalDate.now().toString())||option!=(seed?.option?.ifBlank{defaultOption(kind)}?:defaultOption(kind))
  SideEffect{onDirty(changed)}
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
  else if(kind==CaptureKind.Trip)LifeDateField(secondary.ifBlank{date},{secondary=it},"结束日期")
  else if(kind !in listOf(CaptureKind.Meal,CaptureKind.Visit))OutlinedTextField(secondary,{secondary=it},Modifier.fillMaxWidth(),label={Text(secondaryLabel(kind))},minLines=if(kind==CaptureKind.Library||kind==CaptureKind.Project)4 else 1,singleLine=kind!=CaptureKind.Library&&kind!=CaptureKind.Project,keyboardOptions=KeyboardOptions(keyboardType=if(kind in listOf(CaptureKind.Purchase,CaptureKind.Workout))KeyboardType.Decimal else KeyboardType.Text))
  if(kind==CaptureKind.Expense||kind==CaptureKind.Purchase){OutlinedTextField(category,{category=it},Modifier.fillMaxWidth(),label={Text(if(kind==CaptureKind.Expense)"分类（可选）" else "渠道（可选）")},singleLine=true);Text("支付方式（可选）",style=MaterialTheme.typography.labelLarge);OptionChips(listOf("" to "未知","wechat" to "微信","alipay" to "支付宝","bank_card" to "银行卡","cash" to "现金","other" to "其他"),paymentMethod){paymentMethod=it}}
  OutlinedTextField(note,{note=it},Modifier.fillMaxWidth(),label={Text("备注（可选）")},minLines=2)
  LifeDateField(date,{date=it},enabled=state !is SubmitState.Sending)
  val mealValid=kind!=CaptureKind.Meal||if(advancedMeal)primary.isNotBlank() else mealRows.isNotEmpty()&&mealRows.all{it.name.isNotBlank()&&(it.quantity.isBlank()==it.unit.isBlank())}
  val effectivePrimary=if(kind==CaptureKind.Meal&&!advancedMeal)mealRows.firstOrNull()?.name.orEmpty() else primary
  Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp),verticalAlignment=Alignment.CenterVertically){TextButton(onClick=onBack,enabled=state !is SubmitState.Sending){Text("返回")};Button(onClick={onSubmit(CaptureDraft(kind,primary,secondary,note,date,option,category,paymentMethod,if(kind==CaptureKind.Meal&&!advancedMeal)mealRows.toList() else emptyList(),seed?.contextKind,seed?.contextId))},enabled=mealValid&&valid(kind,effectivePrimary,secondary,date)&&state !is SubmitState.Sending,modifier=Modifier.weight(1f).heightIn(min=56.dp)){Text(if(state is SubmitState.Sending)"正在保存…" else "保存记录")}}
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun RefundEntryPicker(state:LoadState<RecordPage>,selectedId:String,onSelect:(String)->Unit,onSearch:(String)->Unit){
  var expanded by remember{mutableStateOf(false)};var query by rememberSaveable{mutableStateOf("")}
  val candidates=(state as? LoadState.Ready)?.value?.items.orEmpty();val selected=candidates.firstOrNull{it.id==selectedId}
  OutlinedTextField(query,{query=it},Modifier.fillMaxWidth(),label={Text("搜索原交易")},singleLine=true,trailingIcon={TextButton(onClick={onSearch(query)}){Text("搜索")}})
  OutlinedButton(onClick={expanded=true},modifier=Modifier.fillMaxWidth()){Text(selected?.let{listOfNotNull(it.title,it.trailing).joinToString(" · ")}?:"选择原交易")}
  if(expanded)LifeFullScreen("选择原交易",{expanded=false}){
    Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
      Text("选择退款对应的消费记录",style=MaterialTheme.typography.titleMedium)
      OutlinedTextField(query,{query=it},modifier=Modifier.fillMaxWidth(),singleLine=true,label={Text("商家或交易内容")},trailingIcon={TextButton(onClick={onSearch(query)}){Text("搜索")}})
      androidx.compose.foundation.lazy.LazyColumn{item{StateContent(state,{onSearch(query)}){}};items(candidates.size){index->val entry=candidates[index];LifeCard(onClick={onSelect(entry.id);expanded=false}){Text(entry.title,style=MaterialTheme.typography.titleMedium);Text(listOfNotNull(entry.trailing,entry.supporting).joinToString(" · "))}}}
    }
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
