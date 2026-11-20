package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.CancellationException
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.time.LocalDate

data class MoneyBulkLine(val id:String,val title:String,val error:String?)
data class MoneyBulkImport(val batchId:String,val total:Int,val running:Boolean,val items:List<MoneyBulkLine>)

@Composable internal fun NativeMoneyImportSection(
  period:String,month:LoadState<MoneyImportMonthSummary>,review:LoadState<MoneyImportReviewSummary>?,submit:SubmitState,
  onMonth:(String)->Unit,onBatch:(String)->Unit,onResolve:(MoneyImportCandidateSummary,String,String,String,String,String,String)->Unit,
  refundCandidates:LoadState<RecordPage>,onSearchRefunds:(String)->Unit,pendingId:String?,onOpenRecord:(String)->Unit,
  fileState:SubmitState=SubmitState.Editing,onStageFile:((android.net.Uri)->Unit)?=null,
  bulk:MoneyBulkImport?=null,onBulk:((String,List<MoneyImportCandidateSummary>)->Unit)?=null
){
  var selectedBatch by rememberSaveable(period){mutableStateOf<String?>(null)}
  var onlyPending by rememberSaveable(period){mutableStateOf(true)}
  var reason by rememberSaveable(period){mutableStateOf("all")}
  var focused by rememberSaveable(period){mutableStateOf<String?>(null)}
  var showBatches by rememberSaveable(period){mutableStateOf(false)}
  var selectedSource by rememberSaveable(period){mutableStateOf("")}
  val filePicker=androidx.activity.compose.rememberLauncherForActivityResult(
    androidx.activity.result.contract.ActivityResultContracts.OpenDocument()
  ){uri->if(uri!=null)onStageFile?.invoke(uri)}
  val busy=submit is SubmitState.Sending||pendingId!=null||bulk?.running==true
  LaunchedEffect(selectedBatch){selectedBatch?.let(onBatch)}
  fun closeBatch(){selectedBatch=null;focused=null}
  androidx.activity.compose.BackHandler(enabled=selectedBatch!=null){closeBatch()}
  val reasons=listOf("all" to "全部","duplicate" to "疑似重复","refund" to "退款待关联","category" to "分类待补","missing" to "字段缺失")
  Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
    if(selectedBatch==null&&onStageFile!=null){
      val receipt=(fileState as? SubmitState.Saved)?.receipt
      Row(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=Alignment.CenterVertically){
        OutlinedButton(enabled=!busy&&fileState !is SubmitState.Sending&&receipt?.queued!=true,
          onClick={filePicker.launch(arrayOf("*/*"))}){Text("选择账单文件")}
        Text("CSV、JSON、Markdown",style=MaterialTheme.typography.bodySmall)
      }
      when(fileState){
        is SubmitState.Sending->Text("正在读取文件",style=MaterialTheme.typography.bodySmall)
        is SubmitState.Saved->if(fileState.receipt.queued)Text("已保存到本机，待同步生成候选") else {
          Text("账单候选已生成")
          fileState.receipt.resources.firstOrNull{it.type=="money_import_batch"}?.id?.let{id->
            TextButton(onClick={focused=null;selectedBatch=id}){Text("打开此次导入")}
          }
        }
        is SubmitState.Rejected->Text(fileState.message,color=MaterialTheme.colorScheme.error)
        else->Unit
      }
    }
    StateContent(month,{onMonth(period)}){value->
      if(value.period==period){
        if(selectedBatch==null)LifeCard{
          Text("$period 账单",style=MaterialTheme.typography.labelLarge)
          val headline=when{
            value.unconfirmed>0->"${value.unconfirmed} 笔待处理"
            value.batches.isEmpty()->"本月暂无账单"
            else->"本月账单已核对"
          }
          Text(headline,style=MaterialTheme.typography.headlineMedium)
          if(value.duplicates>0||value.refundsUnlinked>0)Text(listOfNotNull(
            "${value.duplicates} 笔疑似重复".takeIf{value.duplicates>0},
            "${value.refundsUnlinked} 笔退款待关联".takeIf{value.refundsUnlinked>0}).joinToString(" · "))
        }
        if(selectedBatch==null){
          LifeTabs(reason,{reason=it},reasons.map{(key,label)->
            val count=when(key){"duplicate"->value.duplicates;"refund"->value.refundsUnlinked;"category"->value.uncategorized;"missing"->null;else->value.unconfirmed}
            key to listOfNotNull(label,count?.toString()).joinToString(" ")
          })
          val sources=value.batches.map{it.platform to it.sourceAccount}.distinct().filter{it.first.isNotBlank()}
          if(sources.isNotEmpty())LifeChoiceField("来源账号",selectedSource,listOf("" to "所有来源")+sources.map{(platform,account)->
            "$platform|$account" to listOf(platform,account).filter{it.isNotBlank()}.joinToString(" · ")
          }){selectedSource=it}
          fun sourceMatches(platform:String,account:String)=selectedSource.isBlank()||selectedSource=="$platform|$account"
          val pending=value.pending.filter{row->
            sourceMatches(row.platform,row.sourceAccount)&&when(reason){
              "duplicate"->row.duplicate;"refund"->row.refund;"category"->row.categoryMissing;"missing"->row.needsData;else->true
            }
          }
          pending.forEach{row->
            LifeCard(onClick={focused=row.id;selectedBatch=row.batchId}){
              Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
                Text(row.counterparty.ifBlank{"商家待补"},Modifier.weight(1f),style=MaterialTheme.typography.titleMedium)
                Text(row.amount.takeIf{it.isNotBlank()}?.let{"CNY $it"}?:"金额待补",style=MaterialTheme.typography.titleMedium)
              }
              Text(listOf(row.on.ifBlank{"日期待补"},row.source).filter{it.isNotBlank()}.joinToString(" · "),style=MaterialTheme.typography.bodySmall)
              Text(listOfNotNull("疑似重复".takeIf{row.duplicate},"退款待关联".takeIf{row.refund},
                "分类待补".takeIf{row.categoryMissing},"字段缺失".takeIf{row.needsData}).joinToString(" · ").ifBlank{"待核对"},
                style=MaterialTheme.typography.bodySmall)
            }
          }
          if(pending.isEmpty()&&value.pending.isNotEmpty())Text("当前筛选下没有已加载的待处理项")
          if(value.unconfirmed>value.pending.size)Text("此处展示最近 80 笔候选，可从批次查看其余记录")
          if(value.truncated)Text("当前最多显示 100 个批次")
          TextButton(onClick={showBatches=!showBatches}){Text(if(showBatches)"收起导入批次" else "查看导入批次")}
          if(showBatches){
          if(value.batches.isEmpty())Text("本月没有导入候选")
          val visibleBatches=value.batches.filter{batch->
            sourceMatches(batch.platform,batch.sourceAccount)&&when(reason){"duplicate"->batch.duplicates>0;"refund"->batch.refundsUnlinked>0;"category"->batch.uncategorized>0;else->true}
          }
          if(visibleBatches.isEmpty()&&value.batches.isNotEmpty())Text("当前没有此类待核对账单")
          visibleBatches.forEach{batch->
            LifeCard(onClick={focused=null;selectedBatch=batch.id}){
              Text(batch.name,style=MaterialTheme.typography.titleMedium)
              Text("${batch.unconfirmed} 笔待处理 · 共 ${batch.total} 行")
            }
          }
          }
        }
      }
    }
    val batch=selectedBatch
    if(batch!=null){
      TextButton(onClick=::closeBatch){Text("返回本月账单")}
      val batchName=(month as? LoadState.Ready)?.value?.batches?.firstOrNull{it.id==batch}?.name
      if(!batchName.isNullOrBlank())Text(batchName,style=MaterialTheme.typography.titleLarge)
      if(submit is SubmitState.Rejected)Text(submit.message,color=MaterialTheme.colorScheme.error)
      if(submit is SubmitState.Saved&&!submit.receipt.queued)Text("账单核对已同步")
      if(review==null)TextButton(onClick={onBatch(batch)}){Text("读取批次")}
      if(review!=null)StateContent(review,{onBatch(batch)}){value->
        if(value.batchId!=batch)return@StateContent
        FilterChip(onlyPending,{onlyPending=!onlyPending},label={Text("只看待处理")})
        val visible=value.candidates.filter{candidate->
          val pending=candidate.status in setOf("pending","invalid")
          if(candidate.id==focused||!onlyPending)true
          else pending&&when(reason){
            "duplicate"->candidate.duplicateOf!=null||candidate.duplicateOfCandidate!=null
            "refund"->candidate.entryType=="refund"
            "category"->candidate.category.isBlank()
            "missing"->candidate.status=="invalid"
            else->true
          }
        }
        if(visible.isEmpty())Text(if(onlyPending)"这批账单没有待处理的条目" else "这批账单没有条目")
        if(focused!=null)TextButton(onClick={focused=null}){Text("查看本批其他记录")}
        var limit by rememberSaveable(batch,reason,onlyPending){mutableIntStateOf(40)}
        val shown=if(focused==null)visible.take(limit) else visible.filter{it.id==focused}
        if(focused==null&&onBulk!=null)MoneyImportBulkPreview(batch,shown.filter{it.canConfirmWithoutEdit()},bulk?.takeIf{it.batchId==batch},busy,onBulk)
        shown.forEach{candidate->
          key(candidate.id,candidate.revision){
            MoneyImportCandidateCard(candidate,value.rules,busy,pendingId==candidate.id,
              refundCandidates,onSearchRefunds,onResolve,onOpenRecord)
          }
        }
        if(focused==null&&shown.size<visible.size)TextButton(onClick={limit+=40}){Text("继续显示本批候选 · ${shown.size}/${visible.size}")}
      }
    }
  }
}

@Composable private fun MoneyImportBulkPreview(
  batchId:String,eligible:List<MoneyImportCandidateSummary>,report:MoneyBulkImport?,busy:Boolean,
  onConfirm:(String,List<MoneyImportCandidateSummary>)->Unit
){
  var open by rememberSaveable(batchId){mutableStateOf(false)}
  var selected by rememberSaveable(batchId){mutableStateOf(arrayListOf<String>())}
  fun key(candidate:MoneyImportCandidateSummary)="${candidate.id}:${candidate.revision}"
  val committed=report?.items.orEmpty().filter{it.error==null}.mapTo(hashSetOf()){it.id}
  val shown=eligible.filterNot{it.id in committed}
  val picked=shown.filter{key(it) in selected}
  if(shown.isNotEmpty())TextButton(enabled=!busy,onClick={open=!open;selected=arrayListOf()}){
    Text(if(open)"收起批量核对" else "选择多笔入账")
  }
  if(open&&shown.isNotEmpty())LifeCard{
    Text("选择要入账的候选",style=MaterialTheme.typography.titleMedium)
    shown.forEach{row->
      val id=key(row)
      Row(verticalAlignment=Alignment.CenterVertically){
        Checkbox(checked=id in selected,enabled=!busy,onCheckedChange={checked->
          selected=ArrayList(if(checked)selected+id else selected-id)
        })
        Column(Modifier.weight(1f)){
          Text(row.counterparty.ifBlank{"未记录商家"})
          Text("${row.occurredOn} · ${if(row.entryType=="income")"收入" else "支出"} ${row.amount} CNY",style=MaterialTheme.typography.bodySmall)
        }
      }
    }
    Button(enabled=!busy&&picked.isNotEmpty(),onClick={onConfirm(batchId,picked)}){
      Text("确认入账 ${picked.size} 笔")
    }
  }
  if(report!=null)LifeCard{
    Text(if(report.running)"已核对 ${report.items.size}/${report.total}" else "${report.items.count{it.error==null}} 笔已入账 · ${report.items.count{it.error!=null}} 笔需处理",
      style=MaterialTheme.typography.titleMedium)
    report.items.forEach{item->Text("${item.title} · ${item.error?:"已入账"}",style=MaterialTheme.typography.bodySmall)}
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun MoneyImportCandidateCard(
  candidate:MoneyImportCandidateSummary,rules:Map<String,String>,busy:Boolean,pending:Boolean,
  refunds:LoadState<RecordPage>,onSearchRefunds:(String)->Unit,
  onResolve:(MoneyImportCandidateSummary,String,String,String,String,String,String)->Unit,onOpenRecord:(String)->Unit
){
  var editing by rememberSaveable{mutableStateOf(false)}
  var entryType by rememberSaveable{mutableStateOf(candidate.entryType)}
  var amount by rememberSaveable{mutableStateOf(candidate.amount)}
  var date by rememberSaveable{mutableStateOf(candidate.occurredOn)}
  var category by rememberSaveable{mutableStateOf(candidate.category)}
  var original by rememberSaveable{mutableStateOf("")}
  var rawOpen by rememberSaveable{mutableStateOf(false)}
  var compare by rememberSaveable{mutableStateOf(false)}
  val status=when(candidate.status){
    "pending"->"待处理";"invalid"->"需要补充";"committed","confirmed"->"已入账";"ignored"->"已忽略";else->"已处理"
  }
  val types=listOf("expense" to "支出","income" to "收入","refund" to "退款")
  val validDate=runCatching{LocalDate.parse(date)}.isSuccess
  val normalizedAmount=remember(amount){runCatching{normalizeCnyAmount(amount)}.getOrNull()}
  val originalValues=buildList{
    if((normalizedAmount?:amount.trim())!=candidate.amount) add("金额 ${candidate.amount.ifBlank{"未填"}}")
    if(date!=candidate.occurredOn) add("日期 ${candidate.occurredOn.ifBlank{"未填"}}")
    if(entryType!=candidate.entryType) add(types.toMap()[candidate.entryType]?:candidate.entryType)
    if(category.trim()!=candidate.category) add("分类 ${candidate.category.ifBlank{"未填"}}")
  }
  val canConfirm=!busy&&candidate.duplicateOf==null&&candidate.duplicateOfCandidate==null&&normalizedAmount!=null&&validDate&&category.trim().length<=80&&
    (candidate.status=="pending"||editing||originalValues.isNotEmpty()||original.isNotBlank())&&
    (entryType!="refund"||original.isNotBlank())
  LifeCard{
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.Top,horizontalArrangement=Arrangement.spacedBy(8.dp)){
      Column(Modifier.weight(1f)){
        Text(candidate.counterparty.ifBlank{"未记录商家"},style=MaterialTheme.typography.titleMedium)
        Text(listOf(date.takeIf{validDate} ?: "日期待补",types.toMap()[entryType]?:status,status).joinToString(" · "),
          style=MaterialTheme.typography.bodySmall)
      }
      Text(normalizedAmount?.let{"$it CNY"}?:"金额待补",style=MaterialTheme.typography.titleMedium)
    }
    if(pending)Text("已存本机，待同步",color=MaterialTheme.colorScheme.primary)
    if(candidate.duplicateOfCandidate!=null&&candidate.duplicateOf==null)Text("与导入候选重复 · 等待原行处理")
    if(category.isNotBlank())Text("分类 · ${category.trim()}",style=MaterialTheme.typography.bodySmall)
    if(originalValues.isNotEmpty())Text("原始建议 · ${originalValues.joinToString(" · ")}",style=MaterialTheme.typography.bodySmall)
    candidate.linkedRecordId?.let{id->TextButton(onClick={onOpenRecord(id)}){Text("查看已入账记录")}}
    candidate.duplicateOf?.let{id->
      TextButton(onClick={compare=true}){Text("疑似重复 · 核对原始行与流水")}
      if(compare)MoneyImportComparison(candidate,id,{compare=false}){compare=false;onOpenRecord(id)}
    }
    if(candidate.status in setOf("pending","invalid")){
      if(editing){
        FlowRow(horizontalArrangement=Arrangement.spacedBy(6.dp)){
          types.forEach{(type,label)->FilterChip(entryType==type,{entryType=type},label={Text(label)})}
        }
        OutlinedTextField(amount,{amount=it},Modifier.fillMaxWidth(),label={Text("精确金额（CNY）")},singleLine=true,
          keyboardOptions=androidx.compose.foundation.text.KeyboardOptions(keyboardType=androidx.compose.ui.text.input.KeyboardType.Decimal))
        LifeDateField(date,{date=it},"发生日")
        OutlinedTextField(category,{category=it.take(80)},Modifier.fillMaxWidth(),label={Text("分类（可选）")},singleLine=true)
        if(entryType=="refund"){
          LaunchedEffect(Unit){onSearchRefunds("")}
          RefundEntryPicker(refunds,original,{original=it},onSearchRefunds)
        }
      }
      FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){
        Button(enabled=canConfirm,onClick={onResolve(candidate,"confirm",entryType,checkNotNull(normalizedAmount),date,category,original)}){Text("确认入账")}
        TextButton(enabled=!busy,onClick={editing=!editing}){Text(if(editing)"收起修改" else "修改")}
        TextButton(enabled=!busy,onClick={onResolve(candidate,"ignore",entryType,amount,date,category,original)}){Text("忽略")}
      }
      if(!editing&&entryType=="refund"){
        val selected=(refunds as? LoadState.Ready)?.value?.items?.firstOrNull{it.id==original}
        Text(when{
          original.isBlank()->"需先选择退款对应的原交易"
          selected!=null->"退款对应 · ${selected.title}"
          else->"已选择退款对应的原交易"
        },style=MaterialTheme.typography.bodySmall)
      }
    }
    TextButton(onClick={rawOpen=!rawOpen}){Text(if(rawOpen)"收起原始行" else "查看原始行")}
    if(rawOpen){
      candidate.appliedRules.forEach{id->rules[id]?.let{Text(it,style=MaterialTheme.typography.bodySmall)}}
      Text(candidate.raw,style=MaterialTheme.typography.bodySmall)
    }
  }
}


@Composable private fun MoneyImportComparison(candidate:MoneyImportCandidateSummary,id:String,onBack:()->Unit,onRecord:()->Unit){
  val context=LocalContext.current
  val app=context.applicationContext as ShadowApp
  val repo=remember(app){NativeLifeRepository(context,app)}
  var retry by remember{mutableIntStateOf(0)}
  var state by remember(id,retry){mutableStateOf<LoadState<RecordDetail>>(LoadState.Loading)}
  LaunchedEffect(id,retry){
    try{state=LoadState.Ready(repo.detail(LifeDomain.Money,id))}
    catch(error:CancellationException){throw error}
    catch(error:Exception){state=LoadState.Failed(error.message?:"无法读取已有流水")}
  }
  LifeFullScreen("核对疑似重复账单",onBack){
    Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)){
      LifeCard{
        Text("逐项比较",style=MaterialTheme.typography.titleMedium)
        StateContent(state,{retry++}){detail->
          val facts=detail.sections.firstOrNull{it.title=="金额"}?.facts.orEmpty().associate{it.label to it.value}
          val fields=listOf(
            Triple("商家",candidate.counterparty,facts["交易方"]?:detail.title),
            Triple("金额","CNY "+candidate.amount,detail.heroValue.orEmpty()),
            Triple("日期",candidate.occurredOn,detail.heroSupporting.orEmpty()),
            Triple("分类",candidate.category,facts["分类"].orEmpty())
          )
          fields.forEach{(label,imported,current)->
            HorizontalDivider()
            Text(label,style=MaterialTheme.typography.labelLarge)
            Text("账单 · "+imported.ifBlank{"未提供"})
            Text("流水 · "+current.ifBlank{"未提供"},color=if(imported!=current)MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.onSurface)
          }
        }
        Text("原始账单行",style=MaterialTheme.typography.labelLarge)
        Text(candidate.raw,style=MaterialTheme.typography.bodySmall)
        TextButton(onClick=onRecord){Text("打开已有流水和来源")}
      }
    }
  }
}
