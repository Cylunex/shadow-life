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

@Composable internal fun NativeMoneyImportSection(
  period:String,month:LoadState<MoneyImportMonthSummary>,review:LoadState<MoneyImportReviewSummary>?,submit:SubmitState,
  onMonth:(String)->Unit,onBatch:(String)->Unit,onResolve:(MoneyImportCandidateSummary,String,String,String,String,String,String)->Unit,
  refundCandidates:LoadState<RecordPage>,onSearchRefunds:(String)->Unit,pendingId:String?,onOpenRecord:(String)->Unit
){
  var selectedBatch by rememberSaveable(period){mutableStateOf<String?>(null)}
  var onlyPending by rememberSaveable(period){mutableStateOf(true)}
  Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
    StateContent(month,{onMonth(period)}){value->
      if(value.period==period){
        Text("${value.unconfirmed} 笔待处理 · ${value.duplicates} 笔疑似重复",style=MaterialTheme.typography.titleMedium)
        if(selectedBatch==null){
          if(value.batches.isEmpty())Text("本月没有导入候选")
          value.batches.forEach{batch->
            LifeCard(onClick={selectedBatch=batch.id;onBatch(batch.id)}){
              Text(batch.name,style=MaterialTheme.typography.titleMedium)
              Text("${batch.unconfirmed} 笔待处理 · 共 ${batch.total} 行")
            }
          }
        }
      }
    }
    val batch=selectedBatch
    if(batch!=null){
      TextButton(onClick={selectedBatch=null}){Text("‹ 返回批次")}
      if(submit is SubmitState.Rejected)Text(submit.message,color=MaterialTheme.colorScheme.error)
      if(submit is SubmitState.Saved&&!submit.receipt.queued)Text("账单核对已同步")
      if(review!=null)StateContent(review,{onBatch(batch)}){value->
        if(value.batchId!=batch)return@StateContent
        FilterChip(onlyPending,{onlyPending=!onlyPending},label={Text("只看待处理")})
        val visible=value.candidates.filter{!onlyPending||it.status in setOf("pending","invalid")}
        if(visible.isEmpty())Text(if(onlyPending)"这批账单没有待处理的条目" else "这批账单没有条目")
        visible.forEach{candidate->
          key(candidate.id,candidate.revision){
            MoneyImportCandidateCard(candidate,value.rules,submit is SubmitState.Sending||pendingId!=null,pendingId==candidate.id,
              refundCandidates,onSearchRefunds,onResolve,onOpenRecord)
          }
        }
      }
    }
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
  val canConfirm=!busy&&candidate.duplicateOf==null&&normalizedAmount!=null&&validDate&&category.trim().length<=80&&
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
        Text("账单候选",style=MaterialTheme.typography.titleMedium)
        Text("${candidate.counterparty.ifBlank{"未记录商家"}} · ${candidate.occurredOn}")
        Text("${candidate.amount} CNY")
        Text(candidate.raw,style=MaterialTheme.typography.bodySmall)
      }
      LifeCard{
        Text("已有流水",style=MaterialTheme.typography.titleMedium)
        StateContent(state,{retry++}){detail->
          Text(detail.title)
          Text(listOfNotNull(detail.heroSupporting,detail.heroValue).joinToString(" · "))
          detail.sections.firstOrNull{it.title=="金额"}?.facts?.filter{it.label in setOf("类型","交易方","分类","支付方式")}
            ?.forEach{fact->Text("${fact.label} · ${fact.value}")}
        }
        TextButton(onClick=onRecord){Text("打开已有流水和来源")}
      }
    }
  }
}
