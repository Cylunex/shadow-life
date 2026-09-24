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

@Composable internal fun NativeServiceCardsSection(
  cardsState:LoadState<ServiceCardsResultDto>,selectedState:LoadState<ServiceCardsResultDtoItemsEntry>?,submit:SubmitState,
  records:List<RecordSummary>,onSearch:(String)->Unit,onSearchPurchases:(String)->Unit,onMore:()->Unit,onOpen:(String)->Unit,onClose:()->Unit,onOlder:()->Unit,
  onSave:(NativeServiceCardDraft)->Unit,onUse:(NativeServiceCardUseDraft)->Unit,onReset:()->Unit
){
  var query by rememberSaveable{mutableStateOf("")}
  var editing by remember{mutableStateOf<ServiceCardsResultDtoItemsEntry?>(null)}
  var editorOpen by rememberSaveable{mutableStateOf(false)}
  var name by rememberSaveable{mutableStateOf("")};var merchant by rememberSaveable{mutableStateOf("")}
  var total by rememberSaveable{mutableStateOf("")};var unit by rememberSaveable{mutableStateOf("次")}
  var start by rememberSaveable{mutableStateOf(LocalDate.now().toString())};var expiry by rememberSaveable{mutableStateOf("")}
  var note by rememberSaveable{mutableStateOf("")};var purchaseId by rememberSaveable{mutableStateOf<String?>(null)}
  var purchaseQuery by rememberSaveable{mutableStateOf("")}
  var cardState by rememberSaveable{mutableStateOf("active")}
  var useEntry by remember{mutableStateOf<ServiceCardsResultDtoItemsEntryUsesEntry?>(null)}
  var useDate by rememberSaveable{mutableStateOf(LocalDate.now().toString())};var useUnits by rememberSaveable{mutableStateOf("1")};var useNote by rememberSaveable{mutableStateOf("")}
  val selected=(selectedState as? LoadState.Ready)?.value
  val busy=submit is SubmitState.Sending
  fun edit(card:ServiceCardsResultDtoItemsEntry?){onReset();editing=card;editorOpen=true;name=card?.name.orEmpty();merchant=card?.merchantName.orEmpty();total=card?.totalUnits?.toString().orEmpty();unit=card?.unitLabel?:"次";start=card?.startedOn?:LocalDate.now().toString();expiry=card?.expiresOn.orEmpty();note=card?.note.orEmpty();purchaseId=card?.purchaseRecordId;cardState=card?.state?.wireValue?:"active"}
  fun editUse(entry:ServiceCardsResultDtoItemsEntryUsesEntry?){onReset();useEntry=entry;useDate=entry?.occurredOn?:LocalDate.now().toString();useUnits=entry?.units?.toString()?:"1";useNote=entry?.note.orEmpty()}
  LaunchedEffect(submit){if(submit is SubmitState.Saved){editorOpen=false;useEntry=null}}
  Column(verticalArrangement=Arrangement.spacedBy(14.dp)){
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text("次卡与服务权益",style=MaterialTheme.typography.headlineSmall);TextButton(onClick={edit(null)},enabled=!busy){Text("新增次卡")}}
    Text("理发、洗车、课时等按实际使用扣次；购买金额仍由原消费记录管理。",color=MaterialTheme.colorScheme.onSurfaceVariant)
    when(submit){is SubmitState.Sending->LinearProgressIndicator(Modifier.fillMaxWidth());is SubmitState.Rejected->Text(submit.message,color=MaterialTheme.colorScheme.error);is SubmitState.Saved->Text(if(submit.receipt.queued)"已保存，正在同步" else "已保存",color=MaterialTheme.colorScheme.primary);else->Unit}
    OutlinedTextField(query,{query=it},Modifier.fillMaxWidth(),label={Text("搜索卡名或商家")},singleLine=true,trailingIcon={TextButton(onClick={onSearch(query)}){Text("查找")}})
    if(editorOpen)LifeCard{
      Text(if(editing==null)"新增次卡" else "编辑次卡",style=MaterialTheme.typography.titleLarge)
      OutlinedTextField(name,{name=it},Modifier.fillMaxWidth(),label={Text("卡名")},singleLine=true)
      OutlinedTextField(merchant,{merchant=it},Modifier.fillMaxWidth(),label={Text("商家（可选）")},singleLine=true)
      Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){OutlinedTextField(total,{total=it},Modifier.weight(1f),label={Text("总次数")},singleLine=true);OutlinedTextField(unit,{unit=it},Modifier.weight(1f),label={Text("单位")},singleLine=true)}
      OutlinedTextField(start,{start=it},Modifier.fillMaxWidth(),label={Text("开始日期 YYYY-MM-DD")},singleLine=true)
      OutlinedTextField(expiry,{expiry=it},Modifier.fillMaxWidth(),label={Text("到期日期（可选）")},singleLine=true)
      OutlinedTextField(purchaseQuery,{purchaseQuery=it},Modifier.fillMaxWidth(),label={Text("查找原购买 / 支出")},singleLine=true,trailingIcon={TextButton(onClick={onSearchPurchases(purchaseQuery)}){Text("查找")}})
      val purchases=records.filter{it.detailId!=null&&it.recordState=="confirmed"&&it.kind in setOf("money_entry","purchase")}.distinctBy{it.detailId}.take(15)
      Text("关联近期购买或支出（可选）",style=MaterialTheme.typography.titleSmall)
      Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(6.dp)){
        FilterChip(purchaseId==null,{purchaseId=null},{Text("不关联")})
        purchases.forEach{record->FilterChip(purchaseId==record.detailId,{purchaseId=record.detailId},{Text(record.title.take(18))})}
      }
      if(purchaseId!=null&&purchases.none{it.detailId==purchaseId})Text("已保留原购买关联",color=MaterialTheme.colorScheme.onSurfaceVariant)
      if(editing!=null)Row(horizontalArrangement=Arrangement.spacedBy(6.dp)){FilterChip(cardState=="active",{cardState="active"},{Text("启用")});FilterChip(cardState=="closed",{cardState="closed"},{Text("关闭")})}
      OutlinedTextField(note,{note=it},Modifier.fillMaxWidth(),label={Text("备注（可选）")})
      Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){Button(onClick={onSave(NativeServiceCardDraft(name,merchant,purchaseId,total,unit,start,expiry,note,editing,cardState))},enabled=!busy&&name.isNotBlank()&&total.toLongOrNull()!=null){Text("保存次卡")};TextButton(onClick={editorOpen=false}){Text("收起")}}
    }
    when(cardsState){is LoadState.Loading->LinearProgressIndicator(Modifier.fillMaxWidth());is LoadState.Failed->Text(cardsState.message,color=MaterialTheme.colorScheme.error);is LoadState.Ready->{
      if(cardsState.value.items.isEmpty())Text("还没有匹配的次卡。",color=MaterialTheme.colorScheme.onSurfaceVariant)
      cardsState.value.items.forEach{card->LifeCard{
        Text(card.name,style=MaterialTheme.typography.titleMedium)
        Text("剩余 ${card.remainingUnits} / ${card.totalUnits} ${card.unitLabel} · ${serviceCardStatus(card.balanceStatus.wireValue)}")
        card.expiresOn?.let{Text("有效期至 $it",color=MaterialTheme.colorScheme.onSurfaceVariant)}
        TextButton(onClick={onOpen(card.id)}){Text("查看与记录使用")}
      }}
      if(cardsState.value.nextAfterId!=null)TextButton(onClick=onMore){Text("加载更多次卡")}
    };else->Unit}
    if(selectedState is LoadState.Loading)LinearProgressIndicator(Modifier.fillMaxWidth())
    if(selectedState is LoadState.Failed)Text(selectedState.message,color=MaterialTheme.colorScheme.error)
    if(selected!=null)LifeCard{
      Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text(selected.name,style=MaterialTheme.typography.titleLarge);TextButton(onClick=onClose){Text("收起")}}
      Text("${selected.merchantName.orEmpty()} · ${serviceCardStatus(selected.balanceStatus.wireValue)} · 剩余 ${selected.remainingUnits} ${selected.unitLabel}")
      Text("开始 ${selected.startedOn} · 到期 ${selected.expiresOn?:"未设置"}",color=MaterialTheme.colorScheme.onSurfaceVariant)
      selected.note?.let{Text(it)}
      TextButton(onClick={edit(selected)},enabled=!busy){Text("编辑次卡")}
      if(selected.state.wireValue=="active"||useEntry!=null){
        Text(if(useEntry==null)"记录实际使用" else "更正使用记录",style=MaterialTheme.typography.titleMedium)
        OutlinedTextField(useDate,{useDate=it},Modifier.fillMaxWidth(),label={Text("使用日期 YYYY-MM-DD")},singleLine=true)
        OutlinedTextField(useUnits,{useUnits=it},Modifier.fillMaxWidth(),label={Text("使用${selected.unitLabel}数")},singleLine=true)
        OutlinedTextField(useNote,{useNote=it},Modifier.fillMaxWidth(),label={Text("备注（可选）")})
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){Button(onClick={onUse(NativeServiceCardUseDraft(selected,useDate,useUnits,useNote,useEntry))},enabled=!busy&&useUnits.toLongOrNull()!=null){Text(if(useEntry==null)"记录使用" else "保存更正")};if(useEntry!=null)TextButton(onClick={editUse(null)}){Text("取消更正")}}
      }
      Text("使用明细",style=MaterialTheme.typography.titleMedium)
      if(selected.uses.isEmpty())Text("暂无使用记录。",color=MaterialTheme.colorScheme.onSurfaceVariant)
      selected.uses.forEach{entry->Column(verticalArrangement=Arrangement.spacedBy(4.dp)){
        Text("${entry.occurredOn} · ${entry.units} ${selected.unitLabel} · ${if(entry.state.wireValue=="voided")"已撤销" else "已使用"}")
        entry.note?.let{Text(it,color=MaterialTheme.colorScheme.onSurfaceVariant)}
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
          TextButton(onClick={editUse(entry)},enabled=!busy){Text(if(entry.state.wireValue=="voided")"恢复 / 更正" else "更正")}
          if(entry.state.wireValue=="active")TextButton(onClick={onUse(NativeServiceCardUseDraft(selected,entry.occurredOn,entry.units.toString(),entry.note.orEmpty(),entry,"voided"))},enabled=!busy){Text("撤销误记")}
        }
        HorizontalDivider()
      }}
      if(selected.nextUsesBeforeId!=null)TextButton(onClick=onOlder){Text("更早使用记录")}
    }
  }
}

private fun serviceCardStatus(status:String)=when(status){"depleted"->"已用完";"expired"->"已到期";"closed"->"已关闭";else->"可使用"}
