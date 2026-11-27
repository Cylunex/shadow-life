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
import androidx.compose.foundation.lazy.LazyListScope
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
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.LocalDate
import kotlin.math.abs

@OptIn(ExperimentalMaterial3Api::class,ExperimentalLayoutApi::class)
@Composable fun MoneyWorkspaceScreen(
  overviewState:LoadState<WorkspaceOverview>,recordsState:LoadState<RecordPage>,onSearch:(String)->Unit,onRetry:()->Unit,onLoadMore:()->Unit,
  onBack:()->Unit,onDetail:(LifeDomain,String,String)->Unit,onCapture:(CaptureKind)->Unit,initialTab:String="overview",
  planningState:SubmitState,onSaveBudget:(NativeBudgetDraft)->Unit,onSaveRecurring:(NativeRecurringDraft)->Unit,onSaveIntent:(NativeSpendingIntentDraft)->Unit,
  onSaveCycle:(NativeUseCycleDraft)->Unit,onConsumableUse:(NativeConsumableUseDraft)->Unit,
  onOccurrence:(MoneyPlanningResultDtoOccurrencesEntry,String)->Unit,onResetPlanning:()->Unit,
  cardsState:LoadState<ServiceCardsResultDto>,selectedCard:LoadState<ServiceCardsResultDtoItemsEntry>?,cardSubmit:SubmitState,
  onLoadCards:(String)->Unit,onMoreCards:()->Unit,onOpenCard:(String)->Unit,onCloseCard:()->Unit,onOlderUses:()->Unit,
  onSaveCard:(NativeServiceCardDraft)->Unit,onCardUse:(NativeServiceCardUseDraft)->Unit,onResetCard:()->Unit,
  importMonth:LoadState<MoneyImportMonthSummary>,importReview:LoadState<MoneyImportReviewSummary>?,importSubmit:SubmitState,onLoadImportMonth:(String)->Unit,onOpenImportBatch:(String)->Unit,onResolveImport:(MoneyImportCandidateSummary,String,String,String,String,String,String)->Unit,
  planningPeriod:String,onPlanningPeriod:(String)->Unit,focusId:String="",onCapturedOrders:()->Unit={},onOrderStats:()->Unit,onPriceBook:()->Unit,onReturns:()->Unit,
  refundCandidates:LoadState<RecordPage>,onSearchRefunds:(String)->Unit,importPendingId:String?,accountId:String,
  importFileState:SubmitState=SubmitState.Editing,onStageImportFile:((Uri)->Unit)?=null,
  bulkImportState:MoneyBulkImport?=null,onBulkImport:((String,List<MoneyImportCandidateSummary>)->Unit)?=null,
  onForeign:()->Unit={},readRevision:Int=0
){
  var tab by rememberSaveable(initialTab){mutableStateOf(initialTab.takeIf{it in setOf("overview","details","stats","budgets","recurring","intents","supplies","cards","reconcile")}?:"overview")};var query by rememberSaveable{mutableStateOf("")}
  var returnTab by rememberSaveable{mutableStateOf<String?>(null)}
  fun drillInto(target:String){returnTab=tab;tab=target}
  fun returnFromDetails(){returnTab?.let{tab=it};returnTab=null}
  androidx.activity.compose.BackHandler(enabled=returnTab!=null&&tab in setOf("details","reconcile")){returnFromDetails()}
  val workspaceScroll=rememberModuleListState(tab)
  LaunchedEffect(tab){if(tab=="cards")onLoadCards("")}
  var submittedQuery by rememberSaveable{mutableStateOf("")}
  LaunchedEffect(tab){if(tab=="cards"||tab=="intents")onSearch("")}
  LaunchedEffect(planningPeriod){onLoadImportMonth(planningPeriod)}
  val overview=((overviewState as? LoadState.Ready)?.value as? WorkspaceOverview.Money)?.takeIf{it.period==planningPeriod}
  val records=(recordsState as? LoadState.Ready)?.value?.items.orEmpty()
  var selectedCurrency by rememberSaveable{mutableStateOf<String?>(null)}
  var entryType by rememberSaveable{mutableStateOf<String?>(null)}
  var selectedDay by rememberSaveable(planningPeriod){mutableStateOf<String?>(null)}
  var category by rememberSaveable(planningPeriod){mutableStateOf<String?>(null)}
  val context=LocalContext.current
  val repository by remember(accountId){lazy{NativeLifeRepository(context,context.applicationContext as ShadowApp)}}
  val readsTransactions=tab=="overview"||tab=="details"
  val summary=rememberLifeRead(accountId,planningPeriod,enabled=readsTransactions||tab=="stats",refreshKey=readRevision){
    repository.monthlyMoney(planningPeriod)
  }
  val totals=(summary.state as? LoadState.Ready)?.value?.totals.orEmpty()
  val currencies=totals.map{it.currency}.sorted()
  val currency=selectedCurrency?.takeIf{it in currencies}?:"CNY".takeIf{it in currencies}?:currencies.firstOrNull()
  val usesFilters=tab!="overview"
  val monthlyQuery=submittedQuery.takeIf{usesFilters}.orEmpty()
  val monthlyType=entryType.takeIf{usesFilters}
  val monthlyDay=selectedDay.takeIf{usesFilters}
  val monthlyCategory=category.takeIf{usesFilters}
  val monthly=rememberRecordPages(accountId,listOf(planningPeriod,currency,monthlyType,monthlyDay,monthlyCategory,monthlyQuery),
    enabled=readsTransactions&&summary.state !is LoadState.Loading,refreshKey=readRevision){cursor->
    repository.records(LifeDomain.Money,monthlyQuery,cursor,planningPeriod,currency,monthlyType,on=monthlyDay,category=monthlyCategory)
  }
  val periodRecords=(monthly.state as? LoadState.Ready)?.value?.items.orEmpty()
  val importContent=rememberMoneyImportContent(planningPeriod,importMonth,importReview,importSubmit,onLoadImportMonth,onOpenImportBatch,
    onResolveImport,refundCandidates,onSearchRefunds,importPendingId,{id->onDetail(LifeDomain.Money,id,"账单关联记录")},
    workspaceScroll,tab=="reconcile",importFileState,onStageImportFile,bulkImportState,onBulkImport)

  Scaffold(containerColor=MaterialTheme.colorScheme.background,
    topBar={LifeModuleTopBar(LifeModule.Money,onBack,overview?.period)},
    floatingActionButton={if(tab=="overview")ModuleCaptureAction("记消费"){onCapture(CaptureKind.Expense)}},
    bottomBar={LifeModuleBottomBar(when(tab){"reconcile"->"details";"recurring","intents","supplies","cards"->"budgets";else->tab},moneyModuleTabs){returnTab=null;tab=it}}
  ){padding->LazyColumn(Modifier.fillMaxSize().padding(padding),state=workspaceScroll,contentPadding=PaddingValues(20.dp,10.dp,20.dp,if(tab in setOf("overview","details"))88.dp else 28.dp),verticalArrangement=Arrangement.spacedBy(18.dp)){
    if(tab in setOf("budgets","recurring","intents","supplies","cards"))item{
      WorkspaceTabs(tab,{tab=it},listOf("budgets" to "预算","recurring" to "订阅","cards" to "次卡","intents" to "想买","supplies" to "消耗品"))
    }
    if(tab in setOf("overview","details","stats","budgets","recurring","intents","supplies","reconcile"))item{
      val month=java.time.YearMonth.parse(planningPeriod)
      Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically){
        TextButton(onClick={onPlanningPeriod(month.minusMonths(1).toString())},enabled=planningState !is SubmitState.Sending&&(month.year>1||month.monthValue>1)){Text("上月")}
        Text(planningPeriod,style=MaterialTheme.typography.titleMedium)
        TextButton(onClick={onPlanningPeriod(month.plusMonths(1).toString())},enabled=planningState !is SubmitState.Sending&&(month.year<9999||month.monthValue<12)){Text("下月")}
      }
      if(planningPeriod!=java.time.YearMonth.now().toString())TextButton(onClick={onPlanningPeriod(java.time.YearMonth.now().toString())},enabled=planningState !is SubmitState.Sending){Text("回到本月")}
    }
    if(tab in setOf("budgets","recurring","intents","supplies"))item{StateContent(overviewState,onRetry){}}
    if(tab=="cards"||tab=="intents")item{StateContent(recordsState,onRetry){}}
    if(tab in setOf("details","reconcile"))item{
      returnTab?.let{previous->TextButton(onClick=::returnFromDetails){Text(if(previous=="stats")"返回统计" else "返回概览")}}
      WorkspaceTabs(tab,{tab=it},listOf("details" to "正式明细","reconcile" to "账单待处理"))
      Row{TextButton(onClick=onCapturedOrders){Text("采集订单")};TextButton(onClick=onForeign){Text("外币与分摊")}}
    }
    if(tab=="cards")item{NativeServiceCardsSection(cardsState,selectedCard,cardSubmit,records,onLoadCards,onSearch,onMoreCards,onOpenCard,onCloseCard,onOlderUses,onSaveCard,onCardUse,onResetCard)}
    if(tab=="reconcile")importContent()
    if(focusId.isNotBlank()&&overview!=null)item{Text("提醒关联事项",style=MaterialTheme.typography.titleMedium);if((tab=="recurring"&&overview.occurrenceDetails.none{it.id==focusId})||(tab=="supplies"&&overview.useCycleDetails.none{it.id==focusId}))Text("该事项当前未加载或已不可用，请返回查看其他事项。")}
    if(tab=="details"){
      item{
        if(currencies.size>1)WorkspaceTabs(currency.orEmpty(),{selectedCurrency=it},currencies.map{it to it})
        WorkspaceTabs(entryType.orEmpty(),{entryType=it.ifBlank{null}},listOf("" to "全部","expense" to "支出","refund" to "退款","income" to "收入"))
        if(selectedDay!=null||category!=null)TextButton(onClick={selectedDay=null;category=null}){
          Text("清除 "+listOfNotNull(selectedDay,category?.ifBlank{"未分类"}).joinToString(" · "))
        }
        MoneySearch(query,{query=it},{submittedQuery=query.trim()},onCapture)
        StateContent(monthly.state,monthly.retry){}
      }
      val page=(monthly.state as? LoadState.Ready)?.value
      page?.items.orEmpty().groupBy{it.happenedOn}.toSortedMap(compareByDescending<String?>{it.orEmpty()}).forEach{(date,rows)->
        item("money-day:$date"){
          Text(date?:"日期未知",style=MaterialTheme.typography.titleMedium)
          val subtotal=(summary.state as? LoadState.Ready)?.value?.days?.firstOrNull{it.on==date&&it.currency==currency}
          if(subtotal!=null&&entryType==null&&category==null&&submittedQuery.isBlank())
            Text("当日净支出 $currency ${displayDecimal(subtotal.net)}",style=MaterialTheme.typography.bodySmall)
        }
        items(rows,key={"money:${it.kind}:${it.id}"}){record->
          MoneyRecordCard(record){onDetail(LifeDomain.Money,record.detailId?:record.id,record.title)}
        }
      }
      if(page?.items?.isEmpty()==true)item{EmptyState("没有匹配的月度明细")}
      if(page?.nextCursor!=null)item{LoadMoreButton("加载更多明细",monthly.more)}
    }
    when(tab){
      "stats"->{
        item{TextButton(onClick=onOrderStats){Text("购买与食用统计 ↗")}}
        if(currencies.size>1)item{WorkspaceTabs(currency.orEmpty(),{selectedCurrency=it},currencies.map{it to it})}
        item("money-stats-state"){StateContent(summary.state,summary.retry){}}
        (summary.state as? LoadState.Ready)?.value?.let{data->
          moneyMonthBreakdown(data,planningPeriod,currency,{date->
            selectedDay=date;category=null;entryType=null;query="";submittedQuery="";drillInto("details")
          },{name->
            category=name.orEmpty();selectedDay=null;entryType="expense";query="";submittedQuery="";drillInto("details")
          })
        }
      }
      "budgets"->if(overview!=null)item{key(overview.period){NativeBudgetSection(overview,planningState,onSaveBudget,onResetPlanning)}}
      "recurring"->if(overview!=null)item{key(overview.period){NativeRecurringSection(if(focusId.isBlank())overview else overview.copy(occurrenceDetails=overview.occurrenceDetails.filter{it.id==focusId},recurringDetails=overview.recurringDetails.filter{plan->overview.occurrenceDetails.any{it.id==focusId&&it.planId==plan.id}}),planningState,onSaveRecurring,onOccurrence,onResetPlanning){id->onDetail(LifeDomain.Money,id,"周期账单付款")}}}
      "intents"->if(overview!=null)item{NativeSpendingIntentSection(overview,planningState,records,onSearch,onSaveIntent,onResetPlanning)}
      "supplies"->if(overview!=null)item{NativeUseCycleSection(if(focusId.isBlank())overview else overview.copy(useCycleDetails=overview.useCycleDetails.filter{it.id==focusId}),planningState,onSaveCycle,onConsumableUse,onResetPlanning)}
      "overview"->{
        if(currencies.size>1)item{Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){currencies.forEach{code->FilterChip(currency==code,{selectedCurrency=code},{Text(code)})}}}
        item{
          StateContent(summary.state,summary.retry){values->
            MoneyHero(planningPeriod,values.totals.firstOrNull{it.currency==currency}){type->
              entryType=type;selectedDay=null;category=null;query="";submittedQuery="";drillInto("details")
            }
          }
        }
        val month=(importMonth as? LoadState.Ready)?.value?.takeIf{it.period==planningPeriod}
        if(month==null||month.unconfirmed>0)item{
          LifeCard(onClick={drillInto("reconcile")}){
            Text("账单待处理",style=MaterialTheme.typography.titleMedium)
            Text(month?.let{"${it.unconfirmed} 笔待处理"}?:if(importMonth is LoadState.Failed)"暂不可读 · 点击重试" else "正在读取")
          }
        }
        val today=LocalDate.now()
        val upcoming=overview?.occurrences?.filter{it.state in setOf("pending","reminded","snoozed")&&it.dueOn in today.toString()..today.plusDays(7).toString()}?.minByOrNull{it.dueOn}
        if(upcoming!=null)item{LifeCard(onClick={tab="recurring"}){Text(upcoming.title);Text("${upcoming.dueOn} 到期")}}
        val replenish=overview?.useCycles?.firstOrNull{it.balanceStatus in setOf("replenish_now","depleted")}
        if(replenish!=null)item{LifeCard(onClick={tab="supplies"}){Text("${replenish.title} · 待补货")}}
        if(monthly.state is LoadState.Ready)item{RecentMoney(periodRecords,onDetail){entryType=null;selectedDay=null;category=null;submittedQuery="";query="";drillInto("details")}}
        item{Row{
          TextButton(onClick=onPriceBook){Text("常购价格")}
          TextButton(onClick=onReturns){Text("售后与退款")}
        }}
        if(overview!=null&&overview.budgets.isNotEmpty())item{BudgetPreview(overview){tab="budgets"}}
        if(overviewState is LoadState.Failed)item{StateContent(overviewState,onRetry){}}
      }
      else->Unit
    }
  }}
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun MoneyHero(period:String,total:MonthlyMoneyTotal?,onOpen:(String)->Unit){
  LifeCard{
    Text("$period 净支出",style=MaterialTheme.typography.labelLarge)
    Text(total?.let{"${it.currency} ${displayDecimal(it.net)}"}?:"暂无已入账收支",style=MaterialTheme.typography.headlineMedium)
    if(total!=null){
      Text("${total.entries} 条正式流水 · 退款按到账月份",style=MaterialTheme.typography.bodySmall)
      FlowRow(horizontalArrangement=Arrangement.spacedBy(4.dp)){
        listOf(Triple("expense","支出",total.expense),Triple("refund","退款",total.refund),Triple("income","收入",total.income)).forEach{(type,title,value)->
          TextButton(onClick={onOpen(type)}){Text("$title ${displayDecimal(value)}")}
        }
      }
    }
  }
}

@Composable internal fun SpendingCalendar(month:java.time.YearMonth,currency:String,days:List<MonthlyMoneyDay>,onDay:(String)->Unit){
  val byDate=remember(days){days.associateBy{it.on}}
  val offset=month.atDay(1).dayOfWeek.value-1
  LifeCard{
    Text("流水月历",style=MaterialTheme.typography.titleMedium)
    Text("$month · ${days.size} 天有流水 · $currency",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    Row(Modifier.fillMaxWidth()){
      "一二三四五六日".forEach{day->Box(Modifier.weight(1f),contentAlignment=Alignment.Center){Text(day.toString(),style=MaterialTheme.typography.labelSmall)}}
    }
    repeat((offset+month.lengthOfMonth()+6)/7){week->
      Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(2.dp)){
        repeat(7){weekday->
          val day=week*7+weekday-offset+1
          if(day !in 1..month.lengthOfMonth())Spacer(Modifier.weight(1f)) else{
            val date=month.atDay(day).toString()
            val row=byDate[date]
            val label=if(row==null)"$date 无流水" else "$date，${row.entries} 笔，净支出 $currency ${displayDecimal(row.net)}"
            Surface(Modifier.weight(1f).semantics{contentDescription=label}
              .then(if(row!=null)Modifier.clickable(role=Role.Button){onDay(date)} else Modifier),
              shape=MaterialTheme.shapes.small,
              color=if(row!=null)MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface){
              Box(Modifier.heightIn(min=44.dp),contentAlignment=Alignment.Center){
                Text(day.toString(),style=MaterialTheme.typography.labelLarge,
                  color=if(row!=null)MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant)
              }
            }
          }
        }
      }
    }
  }
}

private fun LazyListScope.moneyMonthBreakdown(data:MonthlyMoneyRead,period:String,currency:String?,onDay:(String)->Unit,onCategory:(String?)->Unit){
  val days=data.days.filter{it.currency==currency}.sortedByDescending{it.on}
  if(days.isEmpty()){
    item("money-stats-empty"){EmptyState("本月没有可统计的正式收支")}
    return
  }
  val categories=data.categories.filter{it.currency==currency}.sortedByDescending{it.expense.toBigDecimalOrNull()}
  item("money-stats-calendar"){
    SpendingCalendar(java.time.YearMonth.parse(period),currency.orEmpty(),days,onDay)
  }
  item("money-stats-category-heading"){Text("主要消费去向",style=MaterialTheme.typography.titleLarge)}
  val largest=categories.firstOrNull()?.expense?.toDoubleOrNull()?.takeIf{it>0}
  items(categories,key={category->"money-stats-category:"+category.category?.let{"name:$it"}.orEmpty()}){category->
    LifeCard(onClick={onCategory(category.category)}){
      Text(category.category?:"未分类",style=MaterialTheme.typography.titleMedium)
      Text("$currency ${displayDecimal(category.expense)}")
      if(largest!=null)LinearProgressIndicator({((category.expense.toDoubleOrNull()?:0.0)/largest).toFloat().coerceIn(0f,1f)},Modifier.fillMaxWidth())
    }
  }
  item("money-stats-day-heading"){Text("每日净支出",style=MaterialTheme.typography.titleLarge)}
  items(days,key={"money-stats-day:${it.on}"}){day->
    LifeCard(onClick={onDay(day.on)}){
      Row(Modifier.fillMaxWidth()){
        Text(day.on,Modifier.weight(1f))
        Text("$currency ${displayDecimal(day.net)}")
      }
      Text("${day.entries} 笔正式流水",style=MaterialTheme.typography.bodySmall)
    }
  }
}

@Composable private fun BudgetPreview(value:WorkspaceOverview.Money,onOpen:()->Unit){LifeSection("预算",action={TextButton(onClick=onOpen){Text("完整预算")}}){if(value.budgets.isEmpty())EmptyState("本月还没有预算") else value.budgets.take(2).forEach{BudgetCard(it)}}}
@Composable private fun BudgetCard(value:BudgetProgress){val amount=value.amount.toDoubleOrNull()?:0.0;val spent=value.spent.toDoubleOrNull()?:0.0;val ratio=if(amount>0)(spent/amount).toFloat().coerceIn(0f,1f) else 0f;LifeCard{Row(Modifier.fillMaxWidth()){Column(Modifier.weight(1f)){Text(value.title,style=MaterialTheme.typography.titleMedium);Text("${value.currency} ${value.spent} / ${value.amount}",color=MaterialTheme.colorScheme.onSurfaceVariant)};Text(if(spent>amount)"超支" else "剩余 ${moneyNumber((amount-spent).coerceAtLeast(0.0))}",color=if(spent>amount)MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)};LinearProgressIndicator({ratio},Modifier.fillMaxWidth().height(9.dp),color=if(spent>amount)MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.secondary,trackColor=MaterialTheme.colorScheme.surfaceVariant)}}

@Composable private fun RecurringPreview(value:WorkspaceOverview.Money,onOpen:()->Unit){LifeSection("订阅与周期费用",action={TextButton(onClick=onOpen){Text("全部")}}){LifeCard(onClick=onOpen){Text("${value.recurringPlans} 个周期计划",style=MaterialTheme.typography.titleLarge);Text("${value.openOccurrences} 项待处理 · ${value.spendingIntents} 个消费意向",color=MaterialTheme.colorScheme.onSurfaceVariant);value.recurring.firstOrNull()?.let{Text("最近：${it.title} · ${it.nextDueOn}",color=MaterialTheme.colorScheme.secondary)}}}}
@Composable private fun UseCyclePreview(value:WorkspaceOverview.Money,onOpen:()->Unit){LifeSection("消耗品余量",action={TextButton(onClick=onOpen){Text("全部")}}){if(value.useCycles.isEmpty())EmptyState("没有正在追踪的消耗品") else LifeCard(onClick=onOpen){Text("${value.useCycles.size} 个使用周期",style=MaterialTheme.typography.titleLarge);value.useCycles.first().let{Text(useCycleLine(it),color=if(it.balanceStatus in setOf("replenish_now","depleted","needs_specification"))MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)}}}}
private fun useCycleLine(item:MoneyUseCycleSummary)=if(item.usageState=="pending")"待启用 / 未记开封" else when(item.balanceStatus){"needs_specification"->"待补规格，不预测提醒日期";"replenish_now"->"已到补货阈值 · 剩余 ${item.remaining.orEmpty()} ${item.unit.orEmpty()}";"depleted"->"已耗尽";else->listOfNotNull(item.remaining?.let{"按记录剩余 $it ${item.unit.orEmpty()}"},item.estimatedRemaining?.let{"日用量估算剩余 $it ${item.unit.orEmpty()}"},item.projectedDepletionOn?.let{"预计 $it 耗尽"}).joinToString(" · ").ifBlank{statusUi(item.balanceStatus)}}

@Composable private fun MoneySearch(query:String,onQuery:(String)->Unit,onSubmit:()->Unit,onCapture:(CaptureKind)->Unit){LifeSection("消费明细"){Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){OutlinedTextField(query,onQuery,Modifier.weight(1f),singleLine=true,placeholder={Text("商家、分类或备注")},leadingIcon={Icon(Icons.Default.Search,null)});FilledTonalIconButton(onClick=onSubmit,enabled=true){Icon(Icons.Default.Search,"搜索")}};Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(7.dp)){listOf(CaptureKind.Expense,CaptureKind.Purchase,CaptureKind.Refund).forEach{kind->AssistChip({onCapture(kind)},{Text(when(kind){CaptureKind.Expense->"记收支";CaptureKind.Purchase->"记购买";else->"登记退款"})})}}}}
@Composable private fun MoneyRecordList(records:List<RecordSummary>,onDetail:(LifeDomain,String,String)->Unit){Column(verticalArrangement=Arrangement.spacedBy(8.dp)){if(records.isEmpty())EmptyState("没有匹配的正式明细") else records.forEach{record->MoneyRecordCard(record){onDetail(LifeDomain.Money,record.detailId?:record.id,record.title)}}}}
@Composable private fun RecentMoney(records:List<RecordSummary>,onDetail:(LifeDomain,String,String)->Unit,onAll:()->Unit){LifeSection("最近明细",action={TextButton(onClick=onAll){Text("全部")}}){records.take(3).forEach{record->MoneyRecordCard(record){onDetail(LifeDomain.Money,record.detailId?:record.id,record.title)}};if(records.isEmpty())EmptyState("还没有收支明细")}}
@Composable private fun MoneyRecordCard(record:RecordSummary,onClick:()->Unit){Surface(Modifier.fillMaxWidth().clickable(role=Role.Button,onClick=onClick),shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.surface,border=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outline.copy(alpha=.55f))){Row(Modifier.padding(15.dp),verticalAlignment=Alignment.CenterVertically){Surface(Modifier.size(42.dp),shape=RoundedCornerShape(14.dp),color=(if(record.subtype=="income")MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondary).copy(alpha=.13f)){Box(contentAlignment=Alignment.Center){Text(if(record.kind=="purchase")"购" else if(record.subtype=="income")"入" else if(record.subtype=="refund")"退" else "支")}};Spacer(Modifier.width(12.dp));Column(Modifier.weight(1f)){Text(record.title,style=MaterialTheme.typography.titleMedium,maxLines=1,overflow=TextOverflow.Ellipsis);Text(listOfNotNull(record.supporting,if(record.recordState=="voided")"已作废" else if(record.kind=="purchase")"未记录付款" else statusUi(record.subtype.orEmpty())).joinToString(" · "),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};Text(recordAmountLabel(record).orEmpty(),style=MaterialTheme.typography.titleMedium,color=if(record.subtype=="income"||record.subtype=="refund")MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurface)}}}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun TravelWorkspaceScreen(overviewState:LoadState<WorkspaceOverview>,recordsState:LoadState<RecordPage>,onRetry:()->Unit,onLoadMore:()->Unit,onBack:()->Unit,onDetail:(LifeDomain,String,String)->Unit,onCapture:(CaptureKind)->Unit,initialTab:String="overview",onSelectTrip:(String)->Unit,onVisit:(CaptureSeed)->Unit,submitState:SubmitState,onSaveDay:(TravelDayDraft)->Unit,onReset:()->Unit,onSaveChecklist:(String,Int?,List<TravelChecklistItemSummary>)->Unit,offlineItinerary:LoadState<NativeOfflineItinerary>?,onPrepareOffline:(String)->Unit,accountId:String,onTripDetails:(String,String,String?)->Unit){
  var tab by rememberSaveable(initialTab){mutableStateOf(initialTab.takeIf{it in setOf("overview","map","itinerary","places","records") }?:"overview")}
  val value=(overviewState as? LoadState.Ready)?.value as? WorkspaceOverview.Travel
  val trip=value?.tripItems?.firstOrNull{it.id==value.selectedTripId}?:value?.tripItems?.firstOrNull()
  var selectedDate by rememberSaveable{mutableStateOf<String?>(null)}
  var selectedDateTripId by rememberSaveable{mutableStateOf<String?>(null)}
  var editingDay by rememberSaveable(trip?.id){mutableStateOf(false)}
  var mapGestureActive by remember{mutableStateOf(false)}
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
  var focusedStop by rememberSaveable(day?.id){mutableStateOf<String?>(null)}
  var showMap by rememberSaveable{mutableStateOf(true)}
  val workspaceScroll=rememberModuleListState(tab)
  Scaffold(containerColor=MaterialTheme.colorScheme.background,topBar={
    Column {
      LifeModuleTopBar(LifeModule.Travel,onBack)
      if(tab=="itinerary"&&value!=null&&date!=null){
        val map=travelDayMap(day,value.placeItems)
        if(map.markers.isNotEmpty()){
          Row(Modifier.fillMaxWidth().padding(horizontal=12.dp),horizontalArrangement=Arrangement.SpaceBetween){
            TextButton(onClick={showMap=!showMap}){Text(if(showMap)"收起行程地图" else "展开行程地图")}
            if(focusedStop!=null)TextButton(onClick={focusedStop=null}){Text("查看全部站点")}
          }
          if(showMap){
            val point=map.markers.firstOrNull{it.id=="${day?.id}:$focusedStop"}
            TravelNativeMap(TravelMapProvider.Google,point?.let(::listOf)?:map.markers,emptyList(),
              Modifier.fillMaxWidth().height(190.dp).padding(horizontal=12.dp),
              routes=if(point==null)map.routes else emptyList(),onGestureActive={mapGestureActive=it})
          }
        }
      }
    }
  },bottomBar={LifeModuleBottomBar(tab,travelModuleTabs){tab=it}}){padding->
    LazyColumn(Modifier.fillMaxSize().padding(padding),state=workspaceScroll,userScrollEnabled=!mapGestureActive,contentPadding=PaddingValues(20.dp,10.dp,20.dp,28.dp),verticalArrangement=Arrangement.spacedBy(14.dp)){
      if(tab=="overview"||tab=="records")item{TextButton(onClick={tab=if(tab=="records")"overview" else "records"}){Text(if(tab=="records")"返回旅程" else "全部出行记录")}}
      item{StateContent(overviewState,onRetry){} }
      if(value!=null){
        if(value.tripItems.isNotEmpty())item{Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){value.tripItems.forEach{candidate->FilterChip(candidate.id==trip?.id,{if(candidate.id!=trip?.id)onSelectTrip(candidate.id)},label={Text(candidate.title)})}}}
        when(tab){
          "map"->item{TravelMapWorkspace(value,trip,days,dates,date,{selectedDate=it;selectedDateTripId=trip?.id},{mapGestureActive=it})}
          "itinerary"->{
            if(trip==null)item{EmptyState("先新建旅程，再安排每天的地点")}
            else{
              item{Text(trip.title,style=MaterialTheme.typography.headlineSmall);Text("${trip.startsOn} — ${trip.endsOn} · ${trip.timeZone}",color=MaterialTheme.colorScheme.onSurfaceVariant)}
              item{TravelDatePicker(dates,date,days,{selectedDate=it;selectedDateTripId=trip.id})}
              item{
                var checklistOpen by rememberSaveable(trip.id){mutableStateOf(false)}
                val entries=value.checklist?.items.orEmpty()
                LifeCard{
                  TextButton(onClick={checklistOpen=!checklistOpen}){Text("旅程清单 · ${entries.count{it.state=="packed"}}／${entries.size} 已备齐")}
                  if(checklistOpen)Column{Text("准备事项不等于实际到访",color=MaterialTheme.colorScheme.onSurfaceVariant);value.checklist?.items?.forEach{entry->Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Checkbox(checked=entry.state=="packed",onCheckedChange={checked->onSaveChecklist(trip.id,value.checklist?.revision,value.checklist?.items.orEmpty().map{if(it.id==entry.id)it.copy(state=if(checked)"packed" else "needed") else it})});Text(entry.title,Modifier.weight(1f));TextButton(onClick={onSaveChecklist(trip.id,value.checklist?.revision,value.checklist?.items.orEmpty().filterNot{it.id==entry.id})}){Text("移除")}}};Row(verticalAlignment=Alignment.CenterVertically){OutlinedTextField(checklistTitle,{checklistTitle=it},Modifier.weight(1f),label={Text("准备事项")},singleLine=true);TextButton(enabled=checklistTitle.isNotBlank(),onClick={onSaveChecklist(trip.id,value.checklist?.revision,value.checklist?.items.orEmpty()+TravelChecklistItemSummary("",checklistTitle.trim(),"needed",null));checklistTitle=""}){Text("添加")}};if(submitState is SubmitState.Rejected)Text(submitState.message,color=MaterialTheme.colorScheme.error)}}}
              item{Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){Button(onClick={selectedDate=date;selectedDateTripId=trip.id;onReset();editingDay=true}){Text(if(day==null)"安排当天" else "调整当天")};OutlinedButton(onClick={onTripDetails(trip.id,trip.title,date)}){Text("预订与详情")}}}
              item{PersonalRecordsCard(accountId,"旅行小记与票据")}
              if(date!=null)item{key(accountId,trip.id,date){DestinationCard(accountId,trip,date,value.placeItems)}}
              if(day!=null)item{key(accountId,day.id,day.revision){TravelConnectionCard(accountId,trip,day)}}
              travelDayContent(day,date,trip.timeZone,value.placeItems,onVisit={stop->
                onVisit(CaptureSeed(CaptureKind.Visit,primary=stop.title,date=LocalDate.now(java.time.ZoneId.of(trip.timeZone)).toString(),option=trip.timeZone,contextKind="trip",contextId=trip.id,contextLabel=trip.title))
              },onMapStop={stop->focusedStop=stop.id;showMap=true})
              item{Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){OutlinedButton(onClick={onPrepareOffline(trip.id)}){Text("生成离线行程单")};val prepared=(offlineItinerary as? LoadState.Ready)?.value?.takeIf{it.tripId==trip.id};if(prepared!=null)Button(onClick={exportLauncher.launch(prepared.filename)}){Text("保存到文件")}};Text("保存后的 HTML 可从文件应用离线打开；包含全部日期、可见预订、交通、清单与实际到访。",style=MaterialTheme.typography.bodySmall);if(offlineItinerary is LoadState.Failed)Text(offlineItinerary.message,color=MaterialTheme.colorScheme.error);exportError?.let{Text(it,color=MaterialTheme.colorScheme.error)}}
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

internal fun featuredTrip(trips:List<TravelTripSummary>,selectedId:String?,today:String):TravelTripSummary? =
  trips.firstOrNull{it.id==selectedId}
    ?:trips.filter{today in it.startsOn..it.endsOn}.maxByOrNull{it.active}
    ?:trips.filter{it.startsOn>today}.minByOrNull{it.startsOn}
    ?:trips.maxByOrNull{it.endsOn}

internal fun tripHeadline(trip:TravelTripSummary?,today:String):String=when{
  trip==null->"旅程"
  today in trip.startsOn..trip.endsOn->"正在旅行"
  trip.startsOn>today->"下一段旅程"
  else->"已结束的旅程"
}

@Composable private fun TravelHero(value:WorkspaceOverview.Travel,onDetail:(LifeDomain,String,String)->Unit,onCapture:(CaptureKind)->Unit){
  val today=LocalDate.now().toString()
  val trip=featuredTrip(value.tripItems,value.selectedTripId,today)
  LifeCard(onClick=trip?.let{{onDetail(LifeDomain.Travel,it.id,it.title)}}){
    if(trip!=null)Text(tripHeadline(trip,today),color=MaterialTheme.colorScheme.primary,style=MaterialTheme.typography.labelLarge)
    Text(trip?.title?:"还没有旅程",style=MaterialTheme.typography.headlineLarge,fontWeight=FontWeight.SemiBold)
    Text(trip?.let{"${it.startsOn} — ${it.endsOn}"}?:"先建立旅程，再把地点、支出和资料放进来",color=MaterialTheme.colorScheme.onSurfaceVariant)
    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
      Button(onClick={if(trip!=null)onDetail(LifeDomain.Travel,trip.id,trip.title) else onCapture(CaptureKind.Trip)}){Text(if(trip!=null)"查看旅程" else "建立旅程")}
      OutlinedButton(onClick={onCapture(CaptureKind.Visit)}){Text("记到访")}
    }
  }
}
@Composable private fun TravelMapPreview(value:WorkspaceOverview.Travel,onOpen:()->Unit){val markers=travelMapMarkers(value,value.placeItems,true);LifeSection("旅行地图",action={TextButton(onClick=onOpen){Text("打开地图")}}){LifeCard(onClick=onOpen){TravelMapCanvas(markers,value.tracks,Modifier.fillMaxWidth().height(190.dp));Text("${markers.size} 个有坐标足迹 · ${value.tracks.size} 条轨迹",color=MaterialTheme.colorScheme.onSurfaceVariant)}}}
internal fun travelMapMarkers(value:WorkspaceOverview.Travel,places:List<TravelPlaceSummary>,includeVisits:Boolean):List<TravelMapMarker>{val placeMarkers=places.mapNotNull{place->val latitude=place.latitude;val longitude=place.longitude;if(latitude!=null&&longitude!=null)TravelMapMarker("place:${place.id}",place.name,latitude,longitude,place.favorite,place.address) else null};val visits=if(includeVisits)value.visitItems.mapNotNull{visit->val latitude=visit.latitude;val longitude=visit.longitude;if(latitude!=null&&longitude!=null)TravelMapMarker("visit:${visit.id}",visit.placeName,latitude,longitude,false,"到访 ${visit.occurredOn}") else null} else emptyList();return(placeMarkers+visits).distinctBy{"${"%.5f".format(java.util.Locale.ROOT,it.latitude)},${"%.5f".format(java.util.Locale.ROOT,it.longitude)}:${it.title}"}}
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
@OptIn(ExperimentalLayoutApi::class)
@Composable private fun TravelPlaces(value:WorkspaceOverview.Travel,onCapture:(CaptureKind)->Unit){
  var tag by rememberSaveable{mutableStateOf<String?>(null)}
  var selectedId by rememberSaveable{mutableStateOf<String?>(null)}
  val selected=value.placeItems.firstOrNull{it.id==selectedId}
  Column(verticalArrangement=Arrangement.spacedBy(12.dp)){
    Text("地点与到访",style=MaterialTheme.typography.headlineSmall)
    FlowRow(horizontalArrangement=Arrangement.spacedBy(6.dp)){
      val tags=remember(value.placeItems){value.placeItems.flatMap{it.tags}.distinct().sorted()}
      var expanded by rememberSaveable{mutableStateOf(false)}
      val visibleTags=if(expanded)tags else (tags.take(5)+listOfNotNull(tag)).distinct()
      visibleTags.forEach{label->
        FilterChip(tag==label,{tag=if(tag==label)null else label},{Text(label)})
      }
      if(tags.size>5)TextButton(onClick={expanded=!expanded}){Text(if(expanded)"收起标签" else "全部标签（${tags.size}）")}
    }
    val visible=value.placeItems.filter{tag==null||tag in it.tags}.sortedByDescending{it.favorite}
    if(visible.isEmpty())EmptyState("没有可显示的地点","记到访"){onCapture(CaptureKind.Visit)}
    visible.forEach{place->LifeCard(onClick={selectedId=place.id}){
      Text(place.name,style=MaterialTheme.typography.titleMedium)
      Text(listOfNotNull(place.address,"收藏".takeIf{place.favorite}).joinToString(" · "))
    }}
  }
  if(selected!=null)LifeFullScreen(selected.name,{selectedId=null}){
    var map by rememberSaveable(selected.id){mutableStateOf(false)}
    Text(selected.address?:"地址未记录")
    if(selected.tags.isNotEmpty())Text(selected.tags.joinToString(" · "),style=MaterialTheme.typography.bodySmall)
    val visits=value.visitItems.filter{visit->
      visit.placeName==selected.name&&(selected.latitude==null||visit.latitude==selected.latitude)&&
        (selected.longitude==null||visit.longitude==selected.longitude)
    }.sortedByDescending{it.occurredAt?:it.occurredOn}
    if(visits.isNotEmpty())LifeSection("实际到访"){
      visits.forEach{visit->Text(visit.occurredOn,style=MaterialTheme.typography.bodyMedium)}
    }
    val lat=selected.latitude
    val lon=selected.longitude
    if(lat!=null&&lon!=null){
      TextButton(onClick={map=!map}){Text(if(map)"收起地图" else "在地图查看")}
      if(map)TravelNativeMap(TravelMapProvider.Google,listOf(TravelMapMarker(selected.id,selected.name,lat,lon)),emptyList(),Modifier.fillMaxWidth().height(260.dp))
    }
  }
}
@Composable private fun TravelMemorySummary(value:WorkspaceOverview.Travel,onOpen:()->Unit){LifeSection("足迹与回忆"){LifeCard(onClick=onOpen){Text("${value.places} 个地点 · ${value.tracks.size} 条轨迹",style=MaterialTheme.typography.titleLarge);Text("到访记录、地点收藏和轨迹都保留为各自的真实事实。",color=MaterialTheme.colorScheme.onSurfaceVariant)}}}

@Composable private fun WorkspaceTabs(selected:String,onSelect:(String)->Unit,items:List<Pair<String,String>>){
  if(items.size<=5){LifeTabs(selected,onSelect,items);return}
  var expanded by remember{mutableStateOf(false)}
  val core=items.filter{it.first in setOf("overview","details","reconcile")}
  val tools=items.filterNot{it in core}
  Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
    LifeTabs(selected,onSelect,core)
    Box{OutlinedButton(onClick={expanded=true}){Text(tools.firstOrNull{it.first==selected}?.second?.let{"管理 · $it"}?:"更多消费管理")};DropdownMenu(expanded,{expanded=false}){tools.forEach{(key,label)->DropdownMenuItem(text={Text(label)},onClick={expanded=false;onSelect(key)})}}}
  }
}
@Composable private fun VisualStat(label:String,value:String,suffix:String,tone:Color,modifier:Modifier){Surface(modifier,shape=RoundedCornerShape(18.dp),color=tone.copy(alpha=.11f)){Column(Modifier.padding(12.dp)){Text(label,style=MaterialTheme.typography.labelMedium,color=tone);Text(value,style=MaterialTheme.typography.titleMedium);Text(suffix,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}
@Composable private fun LoadMoreButton(label:String,onClick:()->Unit){TextButton(onClick=onClick,Modifier.fillMaxWidth()){Text(label)}}
@Composable private fun DomainStatusLabel(value:String){Surface(shape=RoundedCornerShape(99.dp),color=MaterialTheme.colorScheme.primaryContainer){Text(statusUi(value),Modifier.padding(horizontal=10.dp,vertical=5.dp),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onPrimaryContainer)}}
private fun moneyNumber(value:Double)=BigDecimal.valueOf(value).setScale(if(abs(value)>=100)0 else 2,RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
private fun cadenceLabel(value:String)=mapOf("daily" to "每日","weekly" to "每周","monthly" to "每月","yearly" to "每年","interval" to "固定间隔")[value]?:value
private fun statusUi(value:String)=mapOf("expense" to "支出","income" to "收入","refund" to "退款","pending" to "待处理","reminded" to "已提醒","snoozed" to "已延后","active" to "进行中","planned" to "计划中","completed" to "已完成")[value]?:value
