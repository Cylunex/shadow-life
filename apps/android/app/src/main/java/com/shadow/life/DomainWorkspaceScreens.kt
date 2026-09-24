package com.shadow.life

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.LocalDate
import kotlin.math.abs

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun MoneyWorkspaceScreen(
  overviewState:LoadState<WorkspaceOverview>,recordsState:LoadState<RecordPage>,onSearch:(String)->Unit,onRetry:()->Unit,onLoadMore:()->Unit,
  onBack:()->Unit,onDetail:(LifeDomain,String,String)->Unit,onCapture:(CaptureKind)->Unit,initialTab:String="overview",
  planningState:SubmitState,onSaveBudget:(NativeBudgetDraft)->Unit,onSaveRecurring:(NativeRecurringDraft)->Unit,onSaveIntent:(NativeSpendingIntentDraft)->Unit,
  onSaveCycle:(NativeUseCycleDraft)->Unit,onConsumableUse:(NativeConsumableUseDraft)->Unit,
  onOccurrence:(MoneyPlanningResultDtoOccurrencesEntry,String)->Unit,onResetPlanning:()->Unit,
  cardsState:LoadState<ServiceCardsResultDto>,selectedCard:LoadState<ServiceCardsResultDtoItemsEntry>?,cardSubmit:SubmitState,
  onLoadCards:(String)->Unit,onMoreCards:()->Unit,onOpenCard:(String)->Unit,onCloseCard:()->Unit,onOlderUses:()->Unit,
  onSaveCard:(NativeServiceCardDraft)->Unit,onCardUse:(NativeServiceCardUseDraft)->Unit,onResetCard:()->Unit,
  importMonth:LoadState<MoneyImportMonthSummary>,importReview:LoadState<MoneyImportReviewSummary>?,importSubmit:SubmitState,onLoadImportMonth:(String)->Unit,onOpenImportBatch:(String)->Unit,onResolveImport:(MoneyImportCandidateSummary,String,String,String,String,String,String)->Unit
){
  var tab by rememberSaveable(initialTab){mutableStateOf(initialTab.takeIf{it in setOf("overview","details","budgets","recurring","intents","supplies","cards","reconcile")}?:"overview")};var query by rememberSaveable{mutableStateOf("")}
  val workspaceScroll=rememberLazyListState()
  LaunchedEffect(tab){workspaceScroll.scrollToItem(0)}
  LaunchedEffect(tab){if(tab=="cards")onLoadCards("")}
  LaunchedEffect(tab){if(tab=="reconcile")onLoadImportMonth(LocalDate.now().toString().take(7))}
  val overview=(overviewState as? LoadState.Ready)?.value as? WorkspaceOverview.Money
  val records=(recordsState as? LoadState.Ready)?.value?.items.orEmpty()
  var selectedCurrency by rememberSaveable{mutableStateOf<String?>(null)}
  val periodRecords=records.filter{it.subtype in setOf("expense","income","refund")&&it.supporting?.startsWith(overview?.period?:LocalDate.now().toString().take(7))==true}
  val currencies=periodRecords.mapNotNull(::recordCurrency).distinct().sorted()
  val currency=selectedCurrency?.takeIf{it in currencies}?:currencies.firstOrNull()
  val currencyRecords=periodRecords.filter{recordCurrency(it)==currency}
  Scaffold(containerColor=MaterialTheme.colorScheme.background,topBar={TopAppBar(
    title={Column{Text("消费");Text(overview?.period?.let{"$it · 收支与预算"}?:"正在读取账目",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}},
    navigationIcon={IconButton(onClick=onBack){Text("‹",style=MaterialTheme.typography.headlineLarge)}},actions={FilledTonalIconButton(onClick={onCapture(CaptureKind.Expense)}){Icon(Icons.Default.Add,"记一笔")}}
  )}){padding->LazyColumn(Modifier.fillMaxSize().padding(padding),state=workspaceScroll,contentPadding=PaddingValues(20.dp,10.dp,20.dp,28.dp),verticalArrangement=Arrangement.spacedBy(18.dp)){
    item{WorkspaceTabs(tab,{tab=it},listOf("overview" to "概览","details" to "明细","reconcile" to "核对","budgets" to "预算","recurring" to "订阅","intents" to "想买","supplies" to "消耗品","cards" to "次卡"))}
    item{StateContent(overviewState,onRetry){} }
    if(tab=="cards")item{NativeServiceCardsSection(cardsState,selectedCard,cardSubmit,records,onLoadCards,onSearch,onMoreCards,onOpenCard,onCloseCard,onOlderUses,onSaveCard,onCardUse,onResetCard)}
    if(tab=="reconcile")item{NativeMoneyImportSection(importMonth,importReview,importSubmit,onLoadImportMonth,onOpenImportBatch,onResolveImport)}
    if(overview!=null&&tab!="cards"&&tab!="reconcile")when(tab){
      "budgets"->item{NativeBudgetSection(overview,planningState,onSaveBudget,onResetPlanning)}
      "recurring"->item{NativeRecurringSection(overview,planningState,onSaveRecurring,onOccurrence,onResetPlanning)}
      "intents"->item{NativeSpendingIntentSection(overview,planningState,records,onSearch,onSaveIntent,onResetPlanning)}
      "supplies"->item{NativeUseCycleSection(overview,planningState,onSaveCycle,onConsumableUse,onResetPlanning)}
      "details"->{item{MoneySearch(query,{query=it},{onSearch(query)},onCapture)};if(recordsState is LoadState.Ready)item{MoneyRecordList(records,onDetail)};if(recordsState is LoadState.Ready&&recordsState.value.nextCursor!=null)item{LoadMoreButton("加载更多明细",onLoadMore)}}
      else->{
        if(currencies.size>1)item{Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){currencies.forEach{code->FilterChip(currency==code,{selectedCurrency=code},{Text(code)})}}}
        if(recordsState is LoadState.Ready){item{MoneyHero(currencyRecords,overview,currency,recordsState.value.nextCursor!=null,onCapture)};item{MoneyComposition(currencyRecords,currency)}};item{BudgetPreview(overview){tab="budgets"}};item{UseCyclePreview(overview){tab="supplies"}};item{RecurringPreview(overview){tab="recurring"}};if(recordsState is LoadState.Ready)item{RecentMoney(records,onDetail){tab="details"}}}
    }
    item{StateContent(recordsState,onRetry){} }
  }}
}

@Composable private fun MoneyHero(records:List<RecordSummary>,overview:WorkspaceOverview.Money,currency:String?,hasMore:Boolean,onCapture:(CaptureKind)->Unit){
  val totals=moneyCardTotals(records,currency.orEmpty())
  LifeCard{
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.Top){
      Column(Modifier.weight(1f)){
        Text("${overview.period} · 已加载收支",color=MaterialTheme.colorScheme.secondary,style=MaterialTheme.typography.labelLarge)
        Text(if(records.isEmpty())"暂无收支明细" else "${currency.orEmpty()} ${totals.net.stripTrailingZeros().toPlainString()}",style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.SemiBold)
        Text("净支出 · 支出减退款",color=MaterialTheme.colorScheme.onSurfaceVariant)
      }
      FilledTonalIconButton(onClick={onCapture(CaptureKind.Expense)}){Icon(Icons.Default.Add,"记消费")}
    }
    if(records.isNotEmpty()){
      MoneyBars(records,currency.orEmpty(),Modifier.fillMaxWidth().height(120.dp))
      Text("净支出趋势 · 最近 14 个有收支的日期",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
      Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp)){
        VisualStat("支出",totals.expense.stripTrailingZeros().toPlainString(),currency.orEmpty(),MaterialTheme.colorScheme.tertiary,Modifier.weight(1f))
        VisualStat("收入",totals.income.stripTrailingZeros().toPlainString(),currency.orEmpty(),MaterialTheme.colorScheme.primary,Modifier.weight(1f))
        VisualStat("退款",totals.refund.stripTrailingZeros().toPlainString(),currency.orEmpty(),MaterialTheme.colorScheme.secondary,Modifier.weight(1f))
      }
    }
    Text("${records.size} 条已加载明细"+if(hasMore)" · 尚有更多记录，请在明细中继续加载" else " · 按原币种统计",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@Composable private fun MoneyBars(records:List<RecordSummary>,currency:String,modifier:Modifier){
  val days=records.filter{recordCurrency(it)==currency&&it.subtype in setOf("expense","refund")}
    .groupBy{it.supporting.orEmpty().take(10)}.toSortedMap().entries.toList().takeLast(14)
  if(days.isEmpty())return
  val values=days.map{moneyCardTotals(it.value,currency).net.toDouble()}
  val grid=MaterialTheme.colorScheme.outline;val expense=MaterialTheme.colorScheme.tertiary;val refund=MaterialTheme.colorScheme.primary
  Column(modifier,verticalArrangement=Arrangement.spacedBy(6.dp)){
    Canvas(Modifier.fillMaxWidth().weight(1f)){
      val above=values.maxOrNull()?.coerceAtLeast(0.0)?:0.0
      val below=values.minOrNull()?.coerceAtMost(0.0)?.let{abs(it)}?:0.0
      val range=(above+below).takeIf{it>0}?:1.0
      val baseline=if(above+below==0.0)size.height else (size.height*above/range).toFloat()
      drawLine(grid,Offset(0f,baseline),Offset(size.width,baseline),1.dp.toPx())
      val width=size.width/(values.size*1.7f)
      values.forEachIndexed{index,value->
        val height=(size.height*abs(value)/range).toFloat()
        val x=(index+.5f)*size.width/values.size
        drawRoundRect(if(value>=0)expense else refund,Offset(x-width/2,if(value>=0)baseline-height else baseline),androidx.compose.ui.geometry.Size(width,height),CornerRadius(4.dp.toPx()))
      }
    }
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
      Text(days.first().key.takeLast(5),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
      if(days.size>1)Text(days.last().key.takeLast(5),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

@Composable private fun MoneyComposition(records:List<RecordSummary>,currency:String?){
  val groups=records.filter{it.subtype=="expense"&&recordCurrency(it)==currency}
    .groupBy{it.title.ifBlank{"未命名交易"}}
    .mapValues{(_,rows)->moneyCardTotals(rows,currency.orEmpty()).expense}.entries.sortedByDescending{it.value}.take(5)
  val max=groups.maxOfOrNull{it.value.toDouble()}?.takeIf{it>0}?:1.0
  LifeSection("主要消费去向"){
    if(groups.isEmpty())EmptyState("当前明细没有支出") else groups.forEach{entry->
      Column(verticalArrangement=Arrangement.spacedBy(5.dp)){
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp)){
          Text(entry.key,Modifier.weight(1f),maxLines=2,overflow=TextOverflow.Ellipsis)
          Text("${currency.orEmpty()} ${entry.value.stripTrailingZeros().toPlainString()}")
        }
        LinearProgressIndicator({(entry.value.toDouble()/max).toFloat().coerceIn(0f,1f)},Modifier.fillMaxWidth().height(7.dp),color=MaterialTheme.colorScheme.secondary,trackColor=MaterialTheme.colorScheme.surfaceVariant)
      }
    }
    Text("按已加载的交易名称归纳 · ${currency.orEmpty()} · 前 5 项",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@Composable private fun BudgetPreview(value:WorkspaceOverview.Money,onOpen:()->Unit){LifeSection("预算",action={TextButton(onClick=onOpen){Text("完整预算")}}){if(value.budgets.isEmpty())EmptyState("本月还没有预算") else value.budgets.take(2).forEach{BudgetCard(it)}}}
@Composable private fun BudgetCard(value:BudgetProgress){val amount=value.amount.toDoubleOrNull()?:0.0;val spent=value.spent.toDoubleOrNull()?:0.0;val ratio=if(amount>0)(spent/amount).toFloat().coerceIn(0f,1f) else 0f;LifeCard{Row(Modifier.fillMaxWidth()){Column(Modifier.weight(1f)){Text(value.title,style=MaterialTheme.typography.titleMedium);Text("${value.currency} ${value.spent} / ${value.amount}",color=MaterialTheme.colorScheme.onSurfaceVariant)};Text(if(spent>amount)"超支" else "剩余 ${moneyNumber((amount-spent).coerceAtLeast(0.0))}",color=if(spent>amount)MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)};LinearProgressIndicator({ratio},Modifier.fillMaxWidth().height(9.dp),color=if(spent>amount)MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.secondary,trackColor=MaterialTheme.colorScheme.surfaceVariant)}}

@Composable private fun RecurringPreview(value:WorkspaceOverview.Money,onOpen:()->Unit){LifeSection("订阅与周期费用",action={TextButton(onClick=onOpen){Text("全部")}}){LifeCard(onClick=onOpen){Text("${value.recurringPlans} 个周期计划",style=MaterialTheme.typography.titleLarge);Text("${value.openOccurrences} 项待处理 · ${value.spendingIntents} 个消费意向",color=MaterialTheme.colorScheme.onSurfaceVariant);value.recurring.firstOrNull()?.let{Text("最近：${it.title} · ${it.nextDueOn}",color=MaterialTheme.colorScheme.secondary)}}}}
@Composable private fun UseCyclePreview(value:WorkspaceOverview.Money,onOpen:()->Unit){LifeSection("消耗品余量",action={TextButton(onClick=onOpen){Text("全部")}}){if(value.useCycles.isEmpty())EmptyState("没有正在追踪的消耗品") else LifeCard(onClick=onOpen){Text("${value.useCycles.size} 个使用周期",style=MaterialTheme.typography.titleLarge);value.useCycles.first().let{Text(useCycleLine(it),color=if(it.balanceStatus in setOf("replenish_now","depleted","needs_specification"))MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)}}}}
private fun useCycleLine(item:MoneyUseCycleSummary)=if(item.usageState=="pending")"待启用 / 未记开封" else when(item.balanceStatus){"needs_specification"->"待补规格，不预测提醒日期";"replenish_now"->"已到补货阈值 · 剩余 ${item.remaining.orEmpty()} ${item.unit.orEmpty()}";"depleted"->"已耗尽";else->listOfNotNull(item.remaining?.let{"按记录剩余 $it ${item.unit.orEmpty()}"},item.estimatedRemaining?.let{"日用量估算剩余 $it ${item.unit.orEmpty()}"},item.projectedDepletionOn?.let{"预计 $it 耗尽"}).joinToString(" · ").ifBlank{statusUi(item.balanceStatus)}}

@Composable private fun MoneySearch(query:String,onQuery:(String)->Unit,onSubmit:()->Unit,onCapture:(CaptureKind)->Unit){LifeSection("收支明细"){Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){OutlinedTextField(query,onQuery,Modifier.weight(1f),singleLine=true,placeholder={Text("商家、分类或备注")},leadingIcon={Icon(Icons.Default.Search,null)});FilledTonalIconButton(onClick=onSubmit,enabled=query.isNotBlank()){Icon(Icons.Default.Search,"搜索")}};Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(7.dp)){listOf(CaptureKind.Expense,CaptureKind.Purchase,CaptureKind.Refund).forEach{kind->AssistChip({onCapture(kind)},{Text(kind.label)})}}}}
@Composable private fun MoneyRecordList(records:List<RecordSummary>,onDetail:(LifeDomain,String,String)->Unit){Column(verticalArrangement=Arrangement.spacedBy(8.dp)){if(records.isEmpty())EmptyState("没有匹配的正式明细") else records.forEach{record->MoneyRecordCard(record){onDetail(LifeDomain.Money,record.detailId?:record.id,record.title)}}}}
@Composable private fun RecentMoney(records:List<RecordSummary>,onDetail:(LifeDomain,String,String)->Unit,onAll:()->Unit){LifeSection("最近明细",action={TextButton(onClick=onAll){Text("全部")}}){records.take(5).forEach{record->MoneyRecordCard(record){onDetail(LifeDomain.Money,record.detailId?:record.id,record.title)}};if(records.isEmpty())EmptyState("还没有收支明细")}}
@Composable private fun MoneyRecordCard(record:RecordSummary,onClick:()->Unit){Surface(Modifier.fillMaxWidth().clickable(role=Role.Button,onClick=onClick),shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.surface,border=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outline.copy(alpha=.55f))){Row(Modifier.padding(15.dp),verticalAlignment=Alignment.CenterVertically){Surface(Modifier.size(42.dp),shape=RoundedCornerShape(14.dp),color=(if(record.subtype=="income")MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondary).copy(alpha=.13f)){Box(contentAlignment=Alignment.Center){Text(if(record.subtype=="income")"入" else if(record.subtype=="refund")"退" else "支")}};Spacer(Modifier.width(12.dp));Column(Modifier.weight(1f)){Text(record.title,style=MaterialTheme.typography.titleMedium,maxLines=1,overflow=TextOverflow.Ellipsis);Text(listOfNotNull(record.supporting,statusUi(record.subtype.orEmpty())).joinToString(" · "),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};Text(record.trailing.orEmpty(),style=MaterialTheme.typography.titleMedium,color=if(record.subtype=="income"||record.subtype=="refund")MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)}}}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun TravelWorkspaceScreen(overviewState:LoadState<WorkspaceOverview>,recordsState:LoadState<RecordPage>,onRetry:()->Unit,onLoadMore:()->Unit,onBack:()->Unit,onDetail:(LifeDomain,String,String)->Unit,onCapture:(CaptureKind)->Unit,initialTab:String="overview",onSelectTrip:(String)->Unit,onVisit:(CaptureSeed)->Unit,submitState:SubmitState,onSaveDay:(TravelDayDraft)->Unit,onReset:()->Unit,onSaveChecklist:(String,Int?,List<TravelChecklistItemSummary>)->Unit,offlineItinerary:LoadState<NativeOfflineItinerary>?,onPrepareOffline:(String)->Unit){
  var tab by rememberSaveable(initialTab){mutableStateOf(initialTab.takeIf{it in setOf("overview","map","itinerary","places","records") }?:"overview")}
  val value=(overviewState as? LoadState.Ready)?.value as? WorkspaceOverview.Travel
  val trip=value?.tripItems?.firstOrNull{it.id==value.selectedTripId}?:value?.tripItems?.firstOrNull()
  var selectedDate by rememberSaveable{mutableStateOf<String?>(null)}
  var selectedDateTripId by rememberSaveable{mutableStateOf<String?>(null)}
  var editingDay by rememberSaveable(trip?.id){mutableStateOf(false)}
  var checklistTitle by rememberSaveable(trip?.id){mutableStateOf("")}
  var exportError by remember{mutableStateOf<String?>(null)}
  val context=LocalContext.current
  val exportLauncher=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("text/html")){uri->
    val prepared=(offlineItinerary as? LoadState.Ready)?.value
    if(uri!=null&&prepared!=null&&prepared.tripId==trip?.id)runCatching{context.contentResolver.openOutputStream(uri)?.use{it.write(prepared.html.toByteArray(Charsets.UTF_8))}?:error("无法写入所选文件")}.onFailure{exportError=it.message?:"保存行程单失败"}
  }
  val days=value?.days.orEmpty().filter{it.tripId==trip?.id}
  val dates=trip?.let{travelDates(it,days)}.orEmpty()
  val date=travelSelectedDate(dates,selectedDate.takeIf{selectedDateTripId==trip?.id},LocalDate.now(java.time.ZoneId.of(trip?.timeZone?:"UTC")).toString())
  val day=days.firstOrNull{it.date==date}
  Scaffold(containerColor=MaterialTheme.colorScheme.background,topBar={TopAppBar(title={Text("旅行")},navigationIcon={IconButton(onClick=onBack){Text("‹",style=MaterialTheme.typography.headlineLarge)}},actions={FilledTonalIconButton(onClick={onCapture(CaptureKind.Trip)}){Icon(Icons.Default.Add,"新建旅行")}})}){padding->
    LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(20.dp,10.dp,20.dp,28.dp),verticalArrangement=Arrangement.spacedBy(14.dp)){
      item{WorkspaceTabs(tab,{tab=it},listOf("overview" to "概览","itinerary" to "行程","map" to "地图","places" to "地点","records" to "记录"))}
      item{StateContent(overviewState,onRetry){} }
      if(value!=null){
        if(value.tripItems.isNotEmpty())item{Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){value.tripItems.forEach{candidate->FilterChip(candidate.id==trip?.id,{if(candidate.id!=trip?.id)onSelectTrip(candidate.id)},label={Text(candidate.title)})}}}
        when(tab){
          "map"->item{TravelMapWorkspace(value,trip,days,date)}
          "itinerary"->{
            if(trip==null)item{EmptyState("先新建旅程，再安排每天的地点")}
            else{
              item{Text(trip.title,style=MaterialTheme.typography.headlineSmall);Text("${trip.startsOn} — ${trip.endsOn} · ${trip.timeZone}",color=MaterialTheme.colorScheme.onSurfaceVariant)}
              item{Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){OutlinedButton(onClick={onPrepareOffline(trip.id)}){Text("生成离线行程单")};val prepared=(offlineItinerary as? LoadState.Ready)?.value?.takeIf{it.tripId==trip.id};if(prepared!=null)Button(onClick={exportLauncher.launch(prepared.filename)}){Text("保存到文件")}};Text("保存后的 HTML 可从文件应用离线打开；包含全部日期、可见预订、交通、清单与实际到访。",style=MaterialTheme.typography.bodySmall);if(offlineItinerary is LoadState.Failed)Text(offlineItinerary.message,color=MaterialTheme.colorScheme.error);exportError?.let{Text(it,color=MaterialTheme.colorScheme.error)}}
              item{LifeCard{Text("旅程清单",style=MaterialTheme.typography.titleLarge);Text("准备事项不等于实际到访",color=MaterialTheme.colorScheme.onSurfaceVariant);value.checklist?.items?.forEach{entry->Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Checkbox(checked=entry.state=="packed",onCheckedChange={checked->onSaveChecklist(trip.id,value.checklist?.revision,value.checklist?.items.orEmpty().map{if(it.id==entry.id)it.copy(state=if(checked)"packed" else "needed") else it})});Text(entry.title,Modifier.weight(1f));TextButton(onClick={onSaveChecklist(trip.id,value.checklist?.revision,value.checklist?.items.orEmpty().filterNot{it.id==entry.id})}){Text("移除")}}};Row(verticalAlignment=Alignment.CenterVertically){OutlinedTextField(checklistTitle,{checklistTitle=it},Modifier.weight(1f),label={Text("准备事项")},singleLine=true);TextButton(enabled=checklistTitle.isNotBlank(),onClick={onSaveChecklist(trip.id,value.checklist?.revision,value.checklist?.items.orEmpty()+TravelChecklistItemSummary("",checklistTitle.trim(),"needed",null));checklistTitle=""}){Text("添加")}};if(submitState is SubmitState.Rejected)Text(submitState.message,color=MaterialTheme.colorScheme.error)}}
              item{TravelDatePicker(dates,date,days,{selectedDate=it;selectedDateTripId=trip.id})}
              item{Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){Button(onClick={selectedDate=date;selectedDateTripId=trip.id;onReset();editingDay=true}){Text(if(day==null)"安排当天" else "调整当天")};OutlinedButton(onClick={onDetail(LifeDomain.Travel,trip.id,trip.title)}){Text("预订与详情")}}}
              val dayMap=travelDayMap(day,value.placeItems)
              if(dayMap.markers.isNotEmpty())item{Column(verticalArrangement=Arrangement.spacedBy(5.dp)){TravelNativeMap(TravelMapProvider.Google,dayMap.markers,emptyList(),Modifier.fillMaxWidth().height(280.dp),dayMap.routes);Text("编号为日程顺序；橙色虚线仅示意连续地点，不是道路导航，也不代表已到访。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
              travelDayContent(day,date,trip.timeZone,value.placeItems){stop->onVisit(CaptureSeed(CaptureKind.Visit,primary=stop.title,date=LocalDate.now(java.time.ZoneId.of(trip.timeZone)).toString(),option=trip.timeZone,contextKind="trip",contextId=trip.id,contextLabel=trip.title))}
              val segments=value.segments.filter{it.tripId==trip.id&&(it.startsAt==null||runCatching{java.time.Instant.parse(it.startsAt).atZone(java.time.ZoneId.of(trip.timeZone)).toLocalDate().toString()==date}.getOrDefault(false))}
              if(segments.isNotEmpty())item{Text("当天交通与待定交通",style=MaterialTheme.typography.titleLarge)}
              items(segments,key={"segment:${it.id}"}){segment->LifeCard{Text("${segment.origin} → ${segment.destination}",style=MaterialTheme.typography.titleMedium);Text("${travelLabel(segment.mode)} · ${travelTime(segment.startsAt,trip.timeZone)}")}}
            }
          }
          "places"->item{TravelPlaces(value,onCapture)}
          "records"->{item{StateContent(recordsState,onRetry){}};if(recordsState is LoadState.Ready){items(recordsState.value.items,key={"record:${it.kind}:${it.id}"}){record->LifeCard(onClick=if(record.detailId!=null||record.kind=="trip"){{onDetail(LifeDomain.Travel,record.detailId?:record.id,record.title)}} else null){Text(record.title,style=MaterialTheme.typography.titleMedium);Text(record.supporting.orEmpty())}};if(recordsState.value.nextCursor!=null)item{LoadMoreButton("加载更早旅行记录",onLoadMore)}}}
          else->{item{TravelHero(value,onDetail,onCapture)};item{Button(onClick={tab="itinerary"},Modifier.fillMaxWidth()){Text("查看与安排每日行程")}};item{TravelMapPreview(value){tab="map"}};item{UpcomingTrips(value,onDetail)};item{TravelMemorySummary(value){tab="places"}}}
        }
      }
    }
  }
  if(editingDay&&trip!=null&&date!=null)TravelDayEditor(trip,date,day,value?.placeItems.orEmpty(),submitState,{editingDay=false;onReset()},onSaveDay)
}

@Composable private fun TravelHero(value:WorkspaceOverview.Travel,onDetail:(LifeDomain,String,String)->Unit,onCapture:(CaptureKind)->Unit){val trip=value.tripItems.firstOrNull{it.id==value.selectedTripId}?:value.tripItems.firstOrNull{it.active}?:value.tripItems.firstOrNull{it.endsOn>=LocalDate.now().toString()}?:value.tripItems.firstOrNull();LifeCard(onClick=trip?.let{{onDetail(LifeDomain.Travel,it.id,it.title)}}){Text(if(trip?.active==true)"正在旅行" else "下一段旅程",color=MaterialTheme.colorScheme.primary,style=MaterialTheme.typography.labelLarge);Text(trip?.title?:"还没有旅程",style=MaterialTheme.typography.headlineLarge,fontWeight=FontWeight.SemiBold);Text(trip?.let{"${it.startsOn} — ${it.endsOn}"}?:"先建立旅程，再把地点、支出和资料放进来",color=MaterialTheme.colorScheme.onSurfaceVariant);Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){Button(onClick={if(trip!=null)onDetail(LifeDomain.Travel,trip.id,trip.title) else onCapture(CaptureKind.Trip)}){Text(if(trip!=null)"查看旅程" else "建立旅程")};OutlinedButton(onClick={onCapture(CaptureKind.Visit)}){Text("记到访")}}}}
@Composable private fun TravelMapPreview(value:WorkspaceOverview.Travel,onOpen:()->Unit){val markers=travelMapMarkers(value,value.placeItems,true);LifeSection("旅行地图",action={TextButton(onClick=onOpen){Text("打开地图")}}){LifeCard(onClick=onOpen){TravelMapCanvas(markers,value.tracks,Modifier.fillMaxWidth().height(190.dp));Text("${markers.size} 个有坐标足迹 · ${value.tracks.size} 条轨迹",color=MaterialTheme.colorScheme.onSurfaceVariant)}}}
@Composable private fun TravelMapWorkspace(value:WorkspaceOverview.Travel,trip:TravelTripSummary?,days:List<TravelDaySummary>,selectedDate:String?){
  val context=LocalContext.current
  var scope by rememberSaveable(trip?.id){mutableStateOf("day")}
  var selectedMap by rememberSaveable{mutableStateOf<String?>(null)}
  var providerName by rememberSaveable{mutableStateOf(TravelMapPreference.provider(context).name)}
  var satellite by rememberSaveable{mutableStateOf(false)}
  var showMarkers by rememberSaveable{mutableStateOf(true)}
  var showRoutes by rememberSaveable{mutableStateOf(true)}
  var amapConsent by remember{mutableStateOf(TravelMapPreference.hasAmapConsent(context))}
  var showAmapConsent by remember{mutableStateOf(false)}
  val provider=TravelMapProvider.entries.firstOrNull{it.name==providerName}?:TravelMapProvider.Google
  val dayMap=travelDayMap(days.firstOrNull{it.date==selectedDate},value.placeItems)
  val allMarkers=days.sortedBy{it.date}.flatMapIndexed{index,day->travelDayMap(day,value.placeItems,"${index+1}").markers}.groupBy{Triple(it.title,it.latitude,it.longitude)}.values.map{samePlace->samePlace.first().copy(label=samePlace.mapNotNull{it.label}.joinToString("/").take(6),supporting="日程 ${samePlace.mapNotNull{it.label}.joinToString("、")}")}
  val selected=value.mapItems.firstOrNull{it.id==selectedMap}
  val placeIds=selected?.items?.map{it.placeId}?.toSet()
  val themePlaces=if(placeIds==null)value.placeItems else value.placeItems.filter{it.id in placeIds}
  val markers=when(scope){"day"->dayMap.markers;"all"->allMarkers;else->travelMapMarkers(value,themePlaces,selectedMap==null)}
  val shownTracks=if(scope=="theme"&&selectedMap==null)value.tracks else emptyList()
  val routes=if(scope=="day")dayMap.routes else emptyList()
  val displayMarkers=if(showMarkers)markers else emptyList()
  val displayRoutes=if(showRoutes)routes else emptyList()
  fun selectProvider(next:TravelMapProvider){if(next==TravelMapProvider.Amap&&!amapConsent&&providerConfigured(next))showAmapConsent=true else{providerName=next.name;TravelMapPreference.setProvider(context,next)}}
  LaunchedEffect(provider,amapConsent){if(provider==TravelMapProvider.Amap&&!amapConsent&&providerConfigured(provider))showAmapConsent=true}
  if(showAmapConsent)AlertDialog(onDismissRequest={showAmapConsent=false},title={Text("启用高德地图")},text={Text("高德地图 SDK 会联网加载地图服务。首次使用前需要同意高德地图隐私政策；不同意仍可切换 Google 地图或查看本地坐标预览。")},confirmButton={Button(onClick={TravelMapPreference.setAmapConsent(context,true);amapConsent=true;providerName=TravelMapProvider.Amap.name;TravelMapPreference.setProvider(context,TravelMapProvider.Amap);showAmapConsent=false}){Text("同意并启用")}},dismissButton={TextButton(onClick={showAmapConsent=false;providerName=TravelMapProvider.Google.name;TravelMapPreference.setProvider(context,TravelMapProvider.Google)}){Text("暂不使用")}})
  Column(verticalArrangement=Arrangement.spacedBy(14.dp)){
    Text("旅行地图",style=MaterialTheme.typography.headlineSmall)
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
      if(trip!=null){FilterChip(scope=="day",{scope="day"},label={Text("当天 ${selectedDate.orEmpty()}")});FilterChip(scope=="all",{scope="all"},label={Text("全程地点")})}
      FilterChip(scope=="theme",{scope="theme"},label={Text("足迹与主题地图")})
    }
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){TravelMapProvider.entries.forEach{item->FilterChip(provider==item,{selectProvider(item)},label={Text(item.label+if(providerConfigured(item))"" else " · 待配置")})}}
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){FilterChip(satellite,{satellite=!satellite},label={Text(if(satellite)"卫星图" else "标准图")});FilterChip(showMarkers,{showMarkers=!showMarkers},label={Text("地点标记")});if(scope=="day")FilterChip(showRoutes,{showRoutes=!showRoutes},label={Text("示意路线")})}
    if(provider==TravelMapProvider.Amap&&!amapConsent&&providerConfigured(provider))Box(Modifier.fillMaxWidth().height(360.dp)){TravelMapCanvas(displayMarkers,shownTracks,Modifier.fillMaxSize(),displayRoutes);Surface(Modifier.align(Alignment.BottomCenter).padding(12.dp),shape=RoundedCornerShape(14.dp),color=MaterialTheme.colorScheme.surface.copy(alpha=.94f)){TextButton(onClick={showAmapConsent=true}){Text("同意隐私说明后加载高德地图")}}}
    else TravelNativeMap(provider,displayMarkers,shownTracks,Modifier.fillMaxWidth().height(480.dp),displayRoutes,satellite)
    Text(if(scope=="day")"编号为日程顺序；橙色虚线只示意连续地点，未知地理停留点和备选点会断开，未定位的餐饮休息会跳过。不是道路导航，也不代表已到访。" else if(scope=="all")"汇总当前旅程日程地点，不代表实际到访。" else "主题地图和导入轨迹与行程计划分别保存。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    if(scope!="theme"){
      val visibleDays=if(scope=="day")days.filter{it.date==selectedDate} else days.sortedBy{it.date}
      var expanded by rememberSaveable(scope,selectedDate){mutableStateOf(false)}
      val stops=visibleDays.flatMap{day->day.stops.mapIndexed{index,stop->Triple(day.date,index+1,stop)}}
      LifeCard{
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Column(Modifier.weight(1f)){Text(if(scope=="day")"当天地点" else "全程地点",style=MaterialTheme.typography.titleMedium);Text("${markers.size} 个可定位停留点 · ${stops.size} 项日程",color=MaterialTheme.colorScheme.onSurfaceVariant)};TextButton(onClick={expanded=!expanded}){Text(if(expanded)"收起" else "展开")}}
        if(expanded){stops.forEach{(date,number,stop)->val place=value.placeItems.firstOrNull{it.id==stop.placeId};val located=place?.latitude!=null&&place.longitude!=null;Row(Modifier.fillMaxWidth().padding(vertical=6.dp),horizontalArrangement=Arrangement.spacedBy(8.dp)){Text("$number.",color=MaterialTheme.colorScheme.primary);Column{Text("$date · ${stop.title}");Text(if(located)"${place.name} · ${if(Regex("备选|可选|候选|弹性|视情况|如果有时间|自由活动").containsMatchIn("${stop.title} ${stop.note.orEmpty()}"))"弹性备选" else "计划地点"}" else "未关联可定位地点",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}
          if(scope=="day")routes.flatMap{route->route.zipWithNext()}.forEachIndexed{index,(origin,destination)->TextButton(onClick={runCatching{context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(googleDirectionsUrl(origin,destination))))}}){Text("在 Google 地图查看第 ${index+1} 段道路路线 ↗")}}
        }
      }
    }
    if(scope=="theme"){
      Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){FilterChip(selectedMap==null,{selectedMap=null},label={Text("全部足迹 ${markers.size}")});value.mapItems.forEach{map->FilterChip(selectedMap==map.id,{selectedMap=map.id},label={Text("${map.title} ${map.items.size}")})}}
      value.mapItems.forEach{map->LifeCard(onClick={selectedMap=map.id}){Row(Modifier.fillMaxWidth()){Column(Modifier.weight(1f)){Text(map.title,style=MaterialTheme.typography.titleMedium);Text(map.description?:"没有简介",color=MaterialTheme.colorScheme.onSurfaceVariant)};DomainStatusLabel(map.state)};Text("${map.items.size} 个地点",color=MaterialTheme.colorScheme.secondary)}}
    }
    if(markers.isEmpty()&&shownTracks.isEmpty())Text("当前范围没有带经纬度的地点；可在日程中关联已保存地点。",color=MaterialTheme.colorScheme.onSurfaceVariant)
  }
}
private fun travelMapMarkers(value:WorkspaceOverview.Travel,places:List<TravelPlaceSummary>,includeVisits:Boolean):List<TravelMapMarker>{val placeMarkers=places.mapNotNull{place->val latitude=place.latitude;val longitude=place.longitude;if(latitude!=null&&longitude!=null)TravelMapMarker("place:${place.id}",place.name,latitude,longitude,place.favorite,place.address) else null};val visits=if(includeVisits)value.visitItems.mapNotNull{visit->val latitude=visit.latitude;val longitude=visit.longitude;if(latitude!=null&&longitude!=null)TravelMapMarker("visit:${visit.id}",visit.placeName,latitude,longitude,false,"到访 ${visit.occurredOn}") else null} else emptyList();return(placeMarkers+visits).distinctBy{"${"%.5f".format(java.util.Locale.ROOT,it.latitude)},${"%.5f".format(java.util.Locale.ROOT,it.longitude)}:${it.title}"}}
@Composable internal fun TravelMapCanvas(markers:List<TravelMapMarker>,tracks:List<TravelTrackSummary>,modifier:Modifier,routes:List<List<TravelMapPoint>> = emptyList()){
  val markerCoordinates=markers.map{it.latitude to it.longitude}
  val coords:List<Pair<Double,Double>> = markerCoordinates+tracks.flatMap{track->track.points.map{point->point.latitude to point.longitude}}+routes.flatten().map{it.latitude to it.longitude}
  val grid=MaterialTheme.colorScheme.outline;val primary=MaterialTheme.colorScheme.primary;val warm=MaterialTheme.colorScheme.tertiary;val surface=MaterialTheme.colorScheme.surface
  Canvas(modifier.background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha=.42f),RoundedCornerShape(24.dp)).padding(14.dp)){
    repeat(5){i->drawLine(grid.copy(alpha=.2f),Offset(size.width*i/4,size.height*.08f),Offset(size.width*i/4,size.height*.92f),1.dp.toPx());drawLine(grid.copy(alpha=.2f),Offset(size.width*.04f,size.height*i/4),Offset(size.width*.96f,size.height*i/4),1.dp.toPx())}
    if(coords.isEmpty())return@Canvas
    val minLat=coords.minOf{it.first};val maxLat=coords.maxOf{it.first};val minLon=coords.minOf{it.second};val maxLon=coords.maxOf{it.second}
    fun position(lat:Double,lon:Double):Offset{val lonSpan=maxLon-minLon;val latSpan=maxLat-minLat;val x=if(abs(lonSpan)>.000001)(lon-minLon)/lonSpan else .5;val y=if(abs(latSpan)>.000001)(lat-minLat)/latSpan else .5;return Offset(size.width*.08f+(size.width*.84f*x).toFloat(),size.height*.92f-(size.height*.84f*y).toFloat())}
    tracks.forEach{track->if(track.points.size>1){val path=Path();track.points.forEachIndexed{i,p->val point=position(p.latitude,p.longitude);if(i==0)path.moveTo(point.x,point.y) else path.lineTo(point.x,point.y)};drawPath(path,primary,style=Stroke(3.dp.toPx()))}}
    routes.forEach{route->if(route.size>1){val path=Path();route.forEachIndexed{i,p->val point=position(p.latitude,p.longitude);if(i==0)path.moveTo(point.x,point.y) else path.lineTo(point.x,point.y)};drawPath(path,warm,style=Stroke(3.dp.toPx()))}}
    markers.forEach{marker->val point=position(marker.latitude,marker.longitude);drawCircle(surface,8.dp.toPx(),point);drawCircle(if(marker.favorite)warm else primary,5.dp.toPx(),point)}
  }
}
@Composable private fun UpcomingTrips(value:WorkspaceOverview.Travel,onDetail:(LifeDomain,String,String)->Unit){LifeSection("旅程"){if(value.tripItems.isEmpty())EmptyState("还没有旅程") else value.tripItems.take(4).forEach{trip->LifeCard(onClick={onDetail(LifeDomain.Travel,trip.id,trip.title)}){Row(Modifier.fillMaxWidth()){Column(Modifier.weight(1f)){Text(trip.title,style=MaterialTheme.typography.titleLarge);Text("${trip.startsOn} — ${trip.endsOn}",color=MaterialTheme.colorScheme.onSurfaceVariant)};DomainStatusLabel(tripPhase(trip))}}}}}
@Composable private fun TravelPlaces(value:WorkspaceOverview.Travel,onCapture:(CaptureKind)->Unit){Column(verticalArrangement=Arrangement.spacedBy(12.dp)){Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Column(Modifier.weight(1f)){Text("收藏地点",style=MaterialTheme.typography.headlineSmall);Text("${value.places} 个地点 · ${value.placeItems.count{it.favorite}} 个收藏",color=MaterialTheme.colorScheme.onSurfaceVariant)};FilledTonalButton(onClick={onCapture(CaptureKind.Visit)}){Text("记到访")}};if(value.placeItems.isEmpty())EmptyState("还没有地点") else value.placeItems.forEach{place->LifeCard{Row(Modifier.fillMaxWidth()){Column(Modifier.weight(1f)){Text(place.name,style=MaterialTheme.typography.titleMedium);Text(place.address?:"地址未记录",color=MaterialTheme.colorScheme.onSurfaceVariant)};if(place.favorite)Text("★",color=MaterialTheme.colorScheme.tertiary,style=MaterialTheme.typography.titleLarge)};if(place.tags.isNotEmpty())Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(6.dp)){place.tags.forEach{tag->SuggestionChip({},label={Text(tag)})}}}}}}
@Composable private fun TravelMemorySummary(value:WorkspaceOverview.Travel,onOpen:()->Unit){LifeSection("足迹与回忆"){LifeCard(onClick=onOpen){Text("${value.places} 个地点 · ${value.tracks.size} 条轨迹",style=MaterialTheme.typography.titleLarge);Text("到访记录、地点收藏和轨迹都保留为各自的真实事实。",color=MaterialTheme.colorScheme.onSurfaceVariant)}}}

@Composable private fun WorkspaceTabs(selected:String,onSelect:(String)->Unit,items:List<Pair<String,String>>){Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){items.forEach{(key,label)->FilterChip(selected==key,{onSelect(key)},{Text(label)})}}}
@Composable private fun VisualStat(label:String,value:String,suffix:String,tone:Color,modifier:Modifier){Surface(modifier,shape=RoundedCornerShape(18.dp),color=tone.copy(alpha=.11f)){Column(Modifier.padding(12.dp)){Text(label,style=MaterialTheme.typography.labelMedium,color=tone);Text(value,style=MaterialTheme.typography.titleMedium);Text(suffix,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}
@Composable private fun LoadMoreButton(label:String,onClick:()->Unit){TextButton(onClick=onClick,Modifier.fillMaxWidth()){Text(label)}}
@Composable private fun DomainStatusLabel(value:String){Surface(shape=RoundedCornerShape(99.dp),color=MaterialTheme.colorScheme.primaryContainer){Text(statusUi(value),Modifier.padding(horizontal=10.dp,vertical=5.dp),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onPrimaryContainer)}}
private fun moneyNumber(value:Double)=BigDecimal.valueOf(value).setScale(if(abs(value)>=100)0 else 2,RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
private fun cadenceLabel(value:String)=mapOf("daily" to "每日","weekly" to "每周","monthly" to "每月","yearly" to "每年","interval" to "固定间隔")[value]?:value
private fun statusUi(value:String)=mapOf("expense" to "支出","income" to "收入","refund" to "退款","pending" to "待处理","reminded" to "已提醒","snoozed" to "已延后","active" to "进行中","planned" to "计划中","completed" to "已完成")[value]?:value
