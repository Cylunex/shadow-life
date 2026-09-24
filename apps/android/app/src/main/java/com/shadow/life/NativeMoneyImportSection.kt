package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.time.LocalDate

@Composable internal fun NativeMoneyImportSection(
  month:LoadState<MoneyImportMonthSummary>,review:LoadState<MoneyImportReviewSummary>?,submit:SubmitState,
  onMonth:(String)->Unit,onBatch:(String)->Unit,onResolve:(MoneyImportCandidateSummary,String,String,String,String,String,String)->Unit
){
  var period by rememberSaveable{mutableStateOf(LocalDate.now().toString().take(7))}
  Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
    Text("月度账单核对",style=MaterialTheme.typography.headlineSmall)
    Text("原始行与精确金额保留；规则只生成可查看的候选，确认后才写入账目。",color=MaterialTheme.colorScheme.onSurfaceVariant)
    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){OutlinedTextField(period,{period=it},Modifier.weight(1f),label={Text("月份 YYYY-MM")},singleLine=true);Button(enabled=Regex("\\d{4}-(0[1-9]|1[0-2])").matches(period),onClick={onMonth(period)}){Text("查询")}}
    when(month){is LoadState.Loading->CircularProgressIndicator();is LoadState.Failed->Text(month.message,color=MaterialTheme.colorScheme.error);is LoadState.Ready->{val value=month.value;LifeCard{Text("${value.period} · 未确认 ${value.unconfirmed}",style=MaterialTheme.typography.titleLarge);Text("疑似重复 ${value.duplicates} · 未分类 ${value.uncategorized} · 退款待关联 ${value.refundsUnlinked}")};if(value.batches.isEmpty())Text("本月没有导入候选") else value.batches.forEach{batch->LifeCard(onClick={onBatch(batch.id)}){Text(batch.name,style=MaterialTheme.typography.titleMedium);Text("${batch.total} 行 · 未确认 ${batch.unconfirmed} · 重复 ${batch.duplicates} · 未分类 ${batch.uncategorized} · 退款 ${batch.refundsUnlinked}")}}};else->Text("暂无核对批次")}
    when(review){is LoadState.Loading->CircularProgressIndicator();is LoadState.Failed->Text(review.message,color=MaterialTheme.colorScheme.error);is LoadState.Ready->{Text("批次候选",style=MaterialTheme.typography.titleLarge);review.value.candidates.forEach{candidate->MoneyImportCandidateCard(candidate,review.value.rules,submit,onResolve)}};else->Unit}
    if(submit is SubmitState.Rejected)Text(submit.message,color=MaterialTheme.colorScheme.error)
    if(submit is SubmitState.Saved)Text("复核决定已进入加密离线队列；提交完成后自动刷新。",color=MaterialTheme.colorScheme.primary)
  }
}

@Composable private fun MoneyImportCandidateCard(candidate:MoneyImportCandidateSummary,rules:Map<String,String>,submit:SubmitState,onResolve:(MoneyImportCandidateSummary,String,String,String,String,String,String)->Unit){
  var entryType by rememberSaveable(candidate.id,candidate.revision){mutableStateOf(candidate.entryType)}
  var amount by rememberSaveable(candidate.id,candidate.revision){mutableStateOf(candidate.amount)}
  var date by rememberSaveable(candidate.id,candidate.revision){mutableStateOf(candidate.occurredOn)}
  var category by rememberSaveable(candidate.id,candidate.revision){mutableStateOf(candidate.category)}
  var original by rememberSaveable(candidate.id,candidate.revision){mutableStateOf("")}
  var rawOpen by rememberSaveable(candidate.id){mutableStateOf(false)}
  LifeCard{
    Text("第 ${candidate.position+1} 行 · ${candidate.status}",style=MaterialTheme.typography.titleMedium)
    if(candidate.duplicateOf!=null)Text("疑似重复：${candidate.duplicateOf}，请核对后忽略",color=MaterialTheme.colorScheme.error)
    if(candidate.appliedRules.isNotEmpty())Text("规则预览：${candidate.appliedRules.joinToString("；"){rules[it]?:it}}")
    if(candidate.status in setOf("pending","invalid")){
      Row(horizontalArrangement=Arrangement.spacedBy(6.dp)){listOf("expense" to "支出","income" to "收入","refund" to "退款").forEach{(type,label)->FilterChip(entryType==type,{entryType=type},label={Text(label)})}}
      OutlinedTextField(amount,{amount=it},Modifier.fillMaxWidth(),label={Text("精确金额（CNY）")},singleLine=true)
      OutlinedTextField(date,{date=it},Modifier.fillMaxWidth(),label={Text("发生日 YYYY-MM-DD")},singleLine=true)
      OutlinedTextField(category,{category=it},Modifier.fillMaxWidth(),label={Text("分类，可留空")},singleLine=true)
      if(entryType=="refund")OutlinedTextField(original,{original=it},Modifier.fillMaxWidth(),label={Text("原交易 ID（必填）")},singleLine=true)
      Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){Button(enabled=submit !is SubmitState.Sending&&candidate.duplicateOf==null&&amount.isNotBlank()&&date.isNotBlank()&&(entryType!="refund"||original.isNotBlank()),onClick={onResolve(candidate,"confirm",entryType,amount,date,category,original)}){Text("确认写入")};OutlinedButton(enabled=submit !is SubmitState.Sending,onClick={onResolve(candidate,"ignore",entryType,amount,date,category,original)}){Text("忽略")}}
    }
    TextButton(onClick={rawOpen=!rawOpen}){Text(if(rawOpen)"收起原始行" else "查看原始行")}
    if(rawOpen)Text(candidate.raw,style=MaterialTheme.typography.bodySmall)
  }
}
