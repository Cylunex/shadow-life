package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.background
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun RootPage(title:String,onProjects:()->Unit,onSettings:()->Unit,onSearch:(()->Unit)?=null,content:@Composable (PaddingValues)->Unit){
  Scaffold(containerColor=MaterialTheme.colorScheme.background,topBar={TopAppBar(title={Text(title,style=MaterialTheme.typography.headlineLarge)},colors=TopAppBarDefaults.topAppBarColors(containerColor=MaterialTheme.colorScheme.background),actions={IconButton(onClick=onProjects){ProjectGridIcon()};onSearch?.let{search->IconButton(onClick=search){Icon(Icons.Default.Search,"搜索生活记录")}};IconButton(onClick=onSettings){Icon(Icons.Default.AccountCircle,"账号与设置")}})},content=content)
}

@Composable private fun ProjectGridIcon(){Box(Modifier.size(20.dp).semantics{contentDescription="股票、博客与其他项目"}){listOf(Alignment.TopStart,Alignment.TopEnd,Alignment.BottomStart,Alignment.BottomEnd).forEach{alignment->Box(Modifier.size(7.dp).align(alignment).background(MaterialTheme.colorScheme.onSurface,RoundedCornerShape(2.dp)))}}}

@Composable fun TodayScreen(state:LoadState<TodaySnapshot>,deviceStatus:DeviceSyncStatus,queueState:LoadState<QueueSummary>,samsungAvailable:Boolean,onRetry:()->Unit,onWorkspace:(LifeDomain)->Unit,onDetail:(LifeDomain,String,String)->Unit,onSearch:()->Unit,onFeatures:()->Unit,onHealthSync:()->Unit,onSamsungSync:()->Unit,onScale:()->Unit,onProjects:()->Unit,onSettings:()->Unit){
  RootPage(LocalDate.now().format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(Locale.CHINA)),onProjects,onSettings,onSearch){padding->
    LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(start=20.dp,end=20.dp,top=8.dp,bottom=112.dp),verticalArrangement=Arrangement.spacedBy(24.dp)){
      item{AllFeatures(onWorkspace,onFeatures)}
      item{DeviceSyncPanel(deviceStatus,queueState,samsungAvailable,onHealthSync,onSamsungSync,onScale,onSettings)}
      item{StateContent(state,onRetry){today->TodayContent(today,onWorkspace,onDetail)}}
    }
  }
}

@Composable private fun TodayContent(today:TodaySnapshot,onWorkspace:(LifeDomain)->Unit,onDetail:(LifeDomain,String,String)->Unit){
  LifeSection("身体状态"){
    LifeCard(onClick={onWorkspace(LifeDomain.Health)}){
      when(today.health.state){
        HealthSummaryState.NotAuthorized->{Text("尚未授权健康数据",style=MaterialTheme.typography.titleLarge);Text("连接设备或手动记录",color=MaterialTheme.colorScheme.onSurfaceVariant)}
        HealthSummaryState.Empty->{Text("今天还没有健康记录",style=MaterialTheme.typography.titleLarge);Text("不会把缺失数据显示为 0",color=MaterialTheme.colorScheme.onSurfaceVariant)}
        HealthSummaryState.Failed->{Text("健康摘要暂时无法读取",style=MaterialTheme.typography.titleLarge);Text("点击进入健康空间重试",color=MaterialTheme.colorScheme.error)}
        HealthSummaryState.Ready->{
          today.health.weight?.let{Text("$it ${today.health.weightUnit.orEmpty()}",style=MaterialTheme.typography.displaySmall,fontWeight=FontWeight.SemiBold);Text("最近体重${today.health.weightOn?.let{on->" · $on"}.orEmpty()}",color=MaterialTheme.colorScheme.onSurfaceVariant)}
          Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(18.dp)){today.health.steps?.let{PlanningFact("今日步数",it.toString())};today.health.sleepMinutes?.let{PlanningFact("睡眠",formatMinutes(it))}}
          if(today.health.weight==null&&today.health.steps==null&&today.health.sleepMinutes==null)Text("已有健康记录，暂无可概览指标",color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      if(today.syncIssueCount>0)Text("${today.syncIssueCount} 个来源需要处理",color=MaterialTheme.colorScheme.error)
    }
  }
  LifeSection("支出",action={TextButton(onClick={onWorkspace(LifeDomain.Money)}){Text("全部")}}){
    LifeCard(onClick={onWorkspace(LifeDomain.Money)}){if(today.moneyTotals.isEmpty())Text("今天没有收支") else today.moneyTotals.forEach{total->Row(Modifier.fillMaxWidth()){Text(total.currency,Modifier.weight(1f),color=MaterialTheme.colorScheme.onSurfaceVariant);Text(total.netSpending,style=MaterialTheme.typography.titleLarge)}}}
  }
  LifeSection("下一步"){
    if(today.dueItems.isEmpty())EmptyState("今天没有待处理事项") else today.dueItems.take(2).forEach{due->LifeCard{Text(due.title,style=MaterialTheme.typography.titleMedium);Text(due.dueOn,color=MaterialTheme.colorScheme.onSurfaceVariant);due.amount?.let{Text("${due.currency.orEmpty()} $it")}}}
  }
  if(today.currentTrips.isNotEmpty())LifeSection("进行中的旅程"){today.currentTrips.take(1).forEach{trip->LifeCard(onClick={onDetail(LifeDomain.Travel,trip.id,trip.title)}){Text(trip.title,style=MaterialTheme.typography.titleLarge);Text("${trip.startsOn} — ${trip.endsOn}",color=MaterialTheme.colorScheme.onSurfaceVariant)}}}
  LifeSection("最近记录"){
    Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){AssistChip(onClick={onWorkspace(LifeDomain.Meals)},label={Text("${today.mealCount?:0} 餐")});AssistChip(onClick={onWorkspace(LifeDomain.Library)},label={Text("${today.libraryCaptured?:0} 份资料")})}
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun AllFeatures(onWorkspace:(LifeDomain)->Unit,onFeatures:()->Unit){
  LifeSection("全部功能"){
    FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
      LifeDomain.entries.forEach{domain->AssistChip(onClick={onWorkspace(domain)},label={Text(domain.label())})}
      AssistChip(onClick=onFeatures,label={Text("全部功能与操作")})
    }
  }
}

@Composable fun DeviceSyncPanel(status:DeviceSyncStatus,queueState:LoadState<QueueSummary>,samsungAvailable:Boolean,onHealthSync:()->Unit,onSamsungSync:()->Unit,onScale:()->Unit,onSettings:()->Unit){
  val queue=(queueState as? LoadState.Ready)?.value
  val scaleActive=status.scaleState in setOf("starting","scanning","detected","reading","needs_config","key_mismatch")
  LifeSection("健康设备",action={TextButton(onClick=onSettings){Text("设备设置")}}){
    LifeCard{
      Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
        Column(Modifier.weight(1f)){
          Text("Samsung Health",style=MaterialTheme.typography.titleLarge)
          Text(status.samsungMessage,color=deviceStatusColor(status.samsungState))
          val details=listOfNotNull(status.samsungRecords.takeIf{it>0}?.let{"最近读取 $it 条"},deviceTime(status.samsungUpdatedAt),queue?.latestSamsungState?.let{"上传${queueStateLabel(it)}"})
          if(details.isNotEmpty())Text(details.joinToString(" · "),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      Button(onClick=onSamsungSync,enabled=samsungAvailable&&status.samsungState!="syncing",modifier=Modifier.fillMaxWidth().heightIn(min=50.dp)){
        Text(when{!samsungAvailable->"当前版本未包含 Samsung SDK";status.samsungState in setOf("idle","needs_permission")->"连接 Samsung Health";status.samsungState=="syncing"->"正在同步…";else->"立即同步 Samsung Health"})
      }
      Text("授权后，每次打开 Life 都会自动检查新数据，并每小时后台同步。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
    LifeCard{
      Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
        Column(Modifier.weight(1f)){
          Text("小米体脂秤",style=MaterialTheme.typography.titleLarge)
          status.scaleLastWeight?.let{Text("$it kg",style=MaterialTheme.typography.displaySmall,fontWeight=FontWeight.SemiBold)}
          Text(status.scaleMessage,color=deviceStatusColor(status.scaleState))
          val details=listOfNotNull(status.scaleLastModel,deviceTime(status.scaleMeasuredAt),queue?.latestScaleState?.let{"上传${queueStateLabel(it)}"})
          if(details.isNotEmpty())Text(details.joinToString(" · "),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      Button(onClick=onScale,enabled=!scaleActive,modifier=Modifier.fillMaxWidth().heightIn(min=50.dp)){Text(if(scaleActive)"正在监听体脂秤…" else "开始称重（3 分钟）")}
      Text("开始后再上秤。收到广播、稳定读数和上传结果会实时显示在这里。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
    if(HealthConnectSync.enabled())OutlinedButton(onClick=onHealthSync,Modifier.fillMaxWidth().heightIn(min=50.dp)){Text("同步 Health Connect")}
  }
}

@Composable private fun deviceStatusColor(state:String)=when(state){
  "error","timeout","needs_permission"->MaterialTheme.colorScheme.error
  "needs_config","key_mismatch"->MaterialTheme.colorScheme.tertiary
  "complete","committed","queued","detected"->MaterialTheme.colorScheme.primary
  else->MaterialTheme.colorScheme.onSurfaceVariant
}
private fun deviceTime(value:Long):String?=value.takeIf{it>0}?.let{Instant.ofEpochMilli(it).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("MM-dd HH:mm"))}
private fun queueStateLabel(value:String)=when(value){"pending"->"待发送";"sending"->"中";"reconciling"->"核对中";"committed"->"完成";"failed"->"失败";"blocked"->"已阻止";else->value}

@Composable fun RecordsScreen(state:LoadState<TimelinePage>,searchState:LoadState<RecordPage>?,onRetry:()->Unit,onLoadMore:()->Unit,onSearch:(String)->Unit,onLoadMoreSearch:()->Unit,onClearSearch:()->Unit,onWorkspace:(LifeDomain)->Unit,onDetail:(LifeDomain,String,String)->Unit,onProjects:()->Unit,onSettings:()->Unit){
  var query by rememberSaveable{mutableStateOf("")}
  RootPage("记录",onProjects,onSettings){padding->
    LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(start=20.dp,end=20.dp,top=8.dp,bottom=112.dp)){
      item{OutlinedTextField(value=query,onValueChange={query=it;if(it.isBlank())onClearSearch()},modifier=Modifier.fillMaxWidth(),singleLine=true,placeholder={Text("搜索生活记录")},leadingIcon={Icon(Icons.Default.Search,null)},trailingIcon={IconButton(onClick={onSearch(query)},enabled=query.isNotBlank()){Icon(Icons.Default.Search,"搜索")}})}
      item{Spacer(Modifier.height(14.dp));DomainChips(onWorkspace);Spacer(Modifier.height(16.dp))}
      if(searchState!=null){item{StateContent(searchState,{onSearch(query)}){}};if(searchState is LoadState.Ready){items(searchState.value.items,key={"search:${it.domain}:${it.id}"}){item->RecordRow(item){onDetail(item.domain,item.detailId?:item.id,item.title)};HorizontalDivider(color=MaterialTheme.colorScheme.outline.copy(alpha=.45f))};if(searchState.value.nextCursor!=null)item{TextButton(onClick=onLoadMoreSearch,Modifier.fillMaxWidth()){Text("加载更多")}}}}
      else{item{StateContent(state,onRetry){}}
      if(state is LoadState.Ready){
        val groups=state.value.items.groupBy{it.happenedAt.take(10)}
        groups.forEach{(date,records)->item(key="date:$date"){Text(date,Modifier.padding(top=16.dp,bottom=6.dp),style=MaterialTheme.typography.titleLarge)};items(records,key={"${it.domain}:${it.id}"}){item->RecordRow(RecordSummary(item.domain,item.kind,item.id,item.title,item.happenedAt,item.amount?.let{"${item.currency.orEmpty()} $it"},null)){onDetail(item.domain,item.recordId?:item.id,item.title)};HorizontalDivider(color=MaterialTheme.colorScheme.outline.copy(alpha=.45f))}}
        if(state.value.nextCursor!=null)item{TextButton(onClick=onLoadMore,Modifier.fillMaxWidth()){Text("加载更多")}}
      }}
    }
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun DomainChips(onWorkspace:(LifeDomain)->Unit){Column(verticalArrangement=Arrangement.spacedBy(8.dp)){Text("生活空间",style=MaterialTheme.typography.titleLarge);FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){LifeDomain.entries.forEach{domain->AssistChip(onClick={onWorkspace(domain)},label={Text(domain.label())})}}}}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun PlansScreen(state:LoadState<PlanningWorkspace>,message:String?,onRetry:()->Unit,onProject:(PlanSummary)->Unit,onOwnedItem:(OwnedItemSummary)->Unit,onReview:(ReviewSummary)->Unit,onAgenda:(AgendaItem)->Unit,onAgendaAction:(AgendaItem,String)->Unit,onProjects:()->Unit,onSettings:()->Unit){
  var selected by rememberSaveable{mutableIntStateOf(0)}
  RootPage("计划",onProjects,onSettings){padding->LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(20.dp,8.dp,20.dp,112.dp),verticalArrangement=Arrangement.spacedBy(14.dp)){
    item{SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()){listOf("今天","本周","项目").forEachIndexed{index,label->SegmentedButton(selected=index==selected,onClick={selected=index},shape=SegmentedButtonDefaults.itemShape(index,3)){Text(label)}}}}
    message?.let{item{Text(it,color=MaterialTheme.colorScheme.primary,style=MaterialTheme.typography.bodyMedium)}}
    item{StateContent(state,onRetry){}}
    if(state is LoadState.Ready){val today=LocalDate.now();val value=state.value;if(value.partialFailures.isNotEmpty())item{LifeCard{Text("部分内容暂时无法读取",style=MaterialTheme.typography.titleMedium,color=MaterialTheme.colorScheme.error);value.partialFailures.forEach{Text(it,color=MaterialTheme.colorScheme.onSurfaceVariant)};TextButton(onClick=onRetry){Text("重试全部")}}};if(selected<2){val agenda=value.agenda.filter{selected==1||it.dueOn==today.toString()};if(agenda.isEmpty())item{EmptyState(if(selected==0)"今天没有待处理安排" else "本周没有待处理安排")} else{item{Text(if(selected==0)"今天" else "未来七天",style=MaterialTheme.typography.titleLarge)};items(agenda,key={it.sourceKey}){action->LifeCard(onClick={onAgenda(action)}){Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text(action.title,Modifier.weight(1f),style=MaterialTheme.typography.titleLarge);StatusLabel(action.state)};Text("${agendaKindLabel(action.sourceKind)} · ${action.dueOn}",color=MaterialTheme.colorScheme.onSurfaceVariant);if(action.primaryAction!=null&&action.state in setOf("open","pending","reminded","snoozed"))AgendaActions(action,onAgendaAction)}};if(value.truncated)item{Text("还有更多安排，请缩短日期范围查看。",color=MaterialTheme.colorScheme.onSurfaceVariant)}}}else{
      item{Text("生活项目",style=MaterialTheme.typography.titleLarge)}
      if(value.projects.isEmpty())item{EmptyState("还没有生活项目")} else items(value.projects,key={"project:${it.id}"}){plan->LifeCard(onClick={onProject(plan)}){Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text(plan.title,Modifier.weight(1f),style=MaterialTheme.typography.titleLarge);StatusLabel(plan.state)};plan.goal?.let{Text(it,color=MaterialTheme.colorScheme.onSurfaceVariant)};Text("${plan.actions} 项行动${plan.dueOn?.let{" · 截止 $it"}.orEmpty()}",style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
      item{Text("我的物品",style=MaterialTheme.typography.titleLarge,modifier=Modifier.padding(top=10.dp))}
      if(value.ownedItems.isEmpty())item{Text("还没有显式加入管理的物品。",color=MaterialTheme.colorScheme.onSurfaceVariant)} else items(value.ownedItems,key={"item:${it.id}"}){owned->LifeCard(onClick={onOwnedItem(owned)}){Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text(owned.name,Modifier.weight(1f),style=MaterialTheme.typography.titleMedium);StatusLabel(owned.state)};Text(listOfNotNull(owned.locationPath?.joinToString(" › ")?:owned.location,owned.returnBy?.let{"退货截至 $it"},owned.warrantyEndsOn?.let{"保修截至 $it"}).joinToString(" · ").ifBlank{"${owned.documents} 份资料 · ${owned.events} 条事件"},color=MaterialTheme.colorScheme.onSurfaceVariant)}}
      item{Text("生活回顾",style=MaterialTheme.typography.titleLarge,modifier=Modifier.padding(top=10.dp))}
      if(value.reviews.isEmpty())item{Text("还没有生成可追溯回顾。",color=MaterialTheme.colorScheme.onSurfaceVariant)} else items(value.reviews,key={"review:${it.id}"}){review->LifeCard(onClick={onReview(review)}){Text("${review.fromOn} — ${review.toOn}",style=MaterialTheme.typography.titleMedium);Text("${review.metrics} 组指标 · ${review.evidence.size} 项证据",color=MaterialTheme.colorScheme.onSurfaceVariant)}}
    }}
  }}
}

private fun agendaKindLabel(kind:String)=when(kind){"project_action"->"项目行动";"recurring_occurrence"->"周期事项";"health_habit"->"健康习惯";else->kind}

@Composable private fun AgendaActions(item:AgendaItem,onAction:(AgendaItem,String)->Unit){Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End){TextButton(onClick={onAction(item,"complete")}){Text("完成")};if(item.sourceKind=="recurring_occurrence"){TextButton(onClick={onAction(item,"snooze")}){Text("稍后 1 小时")};TextButton(onClick={onAction(item,"dismiss")}){Text("忽略")}}else TextButton(onClick={onAction(item,"cancel")}){Text("取消")}}}

@Composable fun LibraryScreen(state:LoadState<LibraryPage>,onSearch:(String)->Unit,onLoadMore:()->Unit,onDetail:(LifeDomain,String,String)->Unit,onProjects:()->Unit,onSettings:()->Unit){
  var query by rememberSaveable{mutableStateOf("")}
  RootPage("资料库",onProjects,onSettings){padding->LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(20.dp,8.dp,20.dp,112.dp)){
    item{OutlinedTextField(value=query,onValueChange={query=it;if(it.isBlank())onSearch("")},modifier=Modifier.fillMaxWidth(),singleLine=true,placeholder={Text("搜索标题、正文或标签")},leadingIcon={Icon(Icons.Default.Search,null)},trailingIcon={IconButton(onClick={onSearch(query)}){Icon(Icons.Default.Search,"搜索")}});Spacer(Modifier.height(18.dp))}
    item{StateContent(state,{onSearch(query)}){}}
    if(state is LoadState.Ready){items(state.value.items,key={it.id}){item->RecordRow(RecordSummary(LifeDomain.Library,item.itemType,item.id,item.title,item.state,null,item.revision)){onDetail(LifeDomain.Library,item.id,item.title)};HorizontalDivider(color=MaterialTheme.colorScheme.outline.copy(alpha=.45f))};if(state.value.nextCursor!=null)item{TextButton(onClick=onLoadMore,Modifier.fillMaxWidth()){Text("加载更多资料")}}}
  }}
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun WorkspaceScreen(domain:LifeDomain,overviewState:LoadState<WorkspaceOverview>,state:LoadState<RecordPage>,deviceStatus:DeviceSyncStatus,queueState:LoadState<QueueSummary>,samsungAvailable:Boolean,onSearch:(String)->Unit,onRetry:()->Unit,onLoadMore:()->Unit,onBack:()->Unit,onDetail:(LifeDomain,String,String)->Unit,onCapture:(CaptureKind)->Unit,onHealthSync:()->Unit,onSamsungSync:()->Unit,onScale:()->Unit,onSettings:()->Unit){
  var query by rememberSaveable{mutableStateOf("")}
  Scaffold(containerColor=MaterialTheme.colorScheme.background,topBar={TopAppBar(title={Text(domain.label())},navigationIcon={IconButton(onClick=onBack){Text("‹",style=MaterialTheme.typography.headlineLarge)}})}){padding->LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(horizontal=20.dp,vertical=12.dp)){
    item{WorkspaceActions(domain,onCapture);Spacer(Modifier.height(18.dp))}
    if(domain==LifeDomain.Health)item{DeviceSyncPanel(deviceStatus,queueState,samsungAvailable,onHealthSync,onSamsungSync,onScale,onSettings);Spacer(Modifier.height(18.dp))}
    item{WorkspaceOverviewContent(overviewState,onRetry);Spacer(Modifier.height(18.dp));OutlinedTextField(query,{query=it},Modifier.fillMaxWidth(),singleLine=true,label={Text("在${domain.label()}中搜索")},trailingIcon={IconButton(onClick={onSearch(query)}){Icon(Icons.Default.Search,"搜索")}});Spacer(Modifier.height(12.dp))}
    item{StateContent(state,onRetry){}}
    if(state is LoadState.Ready)items(state.value.items,key={it.id}){item->RecordRow(item){onDetail(domain,item.detailId?:item.id,item.title)};HorizontalDivider(color=MaterialTheme.colorScheme.outline.copy(alpha=.45f))}
    if(state is LoadState.Ready&&state.value.nextCursor!=null)item{TextButton(onClick=onLoadMore,Modifier.fillMaxWidth()){Text("加载更多")}}
  }}
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun WorkspaceActions(domain:LifeDomain,onCapture:(CaptureKind)->Unit){
  val actions=when(domain){
    LifeDomain.Meals->listOf(CaptureKind.Meal)
    LifeDomain.Money->listOf(CaptureKind.Expense,CaptureKind.Purchase,CaptureKind.Refund)
    LifeDomain.Health->listOf(CaptureKind.Health,CaptureKind.Workout,CaptureKind.Meal)
    LifeDomain.Travel->listOf(CaptureKind.Trip,CaptureKind.Visit)
    LifeDomain.Library->listOf(CaptureKind.Library)
  }
  LifeSection("就在这里开始"){FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){actions.forEach{kind->AssistChip(onClick={onCapture(kind)},label={Text(when(kind){CaptureKind.Expense->"记消费";CaptureKind.Purchase->"记购买";CaptureKind.Refund->"记退款";CaptureKind.Meal->"记一餐";CaptureKind.Health->"记健康";CaptureKind.Workout->"记训练";CaptureKind.Visit->"记到访";CaptureKind.Trip->"建旅程";CaptureKind.Library->"收资料";else->kind.label})})}}}
}

@Composable private fun WorkspaceOverviewContent(state:LoadState<WorkspaceOverview>,onRetry:()->Unit){
  when(state){
    LoadState.Loading->LinearProgressIndicator(Modifier.fillMaxWidth())
    is LoadState.Empty->Text(state.reason,color=MaterialTheme.colorScheme.onSurfaceVariant)
    is LoadState.Failed->SectionError(state.message,onRetry)
    is LoadState.Ready->when(val value=state.value){
      is WorkspaceOverview.Health->{LifeSection("健康概览"){LifeCard{HealthSummaryContent(value.summary)}};LifeSection("同步状态"){LifeCard{Text("${value.sources} 个来源 · ${value.streams} 条同步流",style=MaterialTheme.typography.titleLarge);Text(if(value.sourcesNeedingAttention==0)"来源与游标状态正常" else "${value.sourcesNeedingAttention} 个来源需要处理",color=if(value.sourcesNeedingAttention==0)MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.error)}}}
      is WorkspaceOverview.Money->LifeSection("${value.period} 规划"){LifeCard{Text("${value.budgets.size} 项预算 · ${value.openOccurrences} 个待办",style=MaterialTheme.typography.titleLarge);Text("${value.recurringPlans} 个周期计划 · ${value.spendingIntents} 个消费意向",color=MaterialTheme.colorScheme.onSurfaceVariant);value.budgets.take(3).forEach{budget->Row(Modifier.fillMaxWidth()){Text(budget.title,Modifier.weight(1f));Text("${budget.currency} ${budget.spent} / ${budget.amount}")}}}}
      is WorkspaceOverview.Travel->LifeSection("旅行空间"){LifeCard{Text("${value.trips} 段旅程 · ${value.places} 个地点",style=MaterialTheme.typography.titleLarge);Text("${value.maps} 张主题地图${if(value.activeRun)" · 正在旅途中" else ""}",color=if(value.activeRun)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)}}
      is WorkspaceOverview.Meals->LifeSection("餐单与采购"){LifeCard{Text("${value.mealPlans} 份餐单 · ${value.shoppingLists} 张购物清单",style=MaterialTheme.typography.titleLarge);Text(if(value.openShoppingItems==0)"没有待采购食材" else "${value.openShoppingItems} 项待采购",color=MaterialTheme.colorScheme.onSurfaceVariant)}}
      is WorkspaceOverview.Library->LifeSection("资料概览"){LifeCard{Text("当前载入 ${value.visibleItems} 份资料",style=MaterialTheme.typography.titleLarge);Text("原件、正文与处理状态在详情中分别呈现",color=MaterialTheme.colorScheme.onSurfaceVariant)}}
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun DetailScreen(title:String,state:LoadState<RecordDetail>,submitState:SubmitState,onRetry:()->Unit,onBack:()->Unit,onLink:(DetailLink)->Unit,onAction:(DetailAction)->Unit,onCorrect:(EditSeed,CorrectionDraft)->Unit,onReset:()->Unit,onQueueLibraryVision:(String)->Unit,onRetryLibraryVision:(String)->Unit){
  var editing by rememberSaveable(title){mutableStateOf(false)}
  var travelDate by rememberSaveable(title){mutableStateOf<String?>(null)}
  var showActions by rememberSaveable(title){mutableStateOf(false)}
  var detailTab by rememberSaveable(title){mutableStateOf("日程")}
  Scaffold(containerColor=MaterialTheme.colorScheme.background,topBar={TopAppBar(title={Text((state as? LoadState.Ready)?.value?.title?:title.ifBlank{"详情"},maxLines=1,overflow=TextOverflow.Ellipsis)},navigationIcon={IconButton(onClick=onBack){Text("‹",style=MaterialTheme.typography.headlineLarge)}})}){padding->
    LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(2.dp)){
      item{StateContent(state,onRetry){}}
      if(state is LoadState.Ready){
        val detail=state.value
        item{DetailHero(detail)}
        item{Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp)){detail.state?.let{StatusLabel(it)}}}
        val schedule=detail.travelSchedule
        if(schedule!=null){
          item{Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){listOf("日程","预订与记录").forEach{tab->FilterChip(detailTab==tab,{detailTab=tab},label={Text(tab)})}}}
          if(detailTab=="日程"){
            val dates=travelDates(schedule.trip,schedule.days)
            val date=travelSelectedDate(dates,travelDate,LocalDate.now(ZoneId.of(schedule.trip.timeZone)).toString())
            item{TravelDatePicker(dates,date,schedule.days,{travelDate=it})}
            travelDayContent(schedule.days.firstOrNull{it.date==date},date,schedule.trip.timeZone)
            item{TextButton(onClick={onLink(DetailLink("travel_workspace",schedule.trip.id,schedule.trip.title))}){Text("打开行程工作台，调整当天安排")}}
          }
        }
        if(schedule==null||detailTab!="日程")detail.sections.filter{it.facts.isNotEmpty()||it.groups.isNotEmpty()||it.links.isNotEmpty()}.sortedBy(::isDetailMetadata).forEachIndexed{sectionIndex,section->
          item("section:$sectionIndex"){DetailSectionContent(section,onLink)}
        }

        if(detail.actions.isNotEmpty())item{Column(Modifier.fillMaxWidth().padding(top=14.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){(if(showActions)detail.actions else detail.actions.take(2)).forEach{action->OutlinedButton(onClick={onAction(action)},Modifier.fillMaxWidth().heightIn(min=52.dp)){Text(action.label)}};if(detail.actions.size>2)TextButton(onClick={showActions=!showActions}){Text(if(showActions)"收起操作" else "更多操作（${detail.actions.size}）")}}}
        detail.libraryVisionSourceAssetId?.let{assetId->item{OutlinedButton(onClick={onQueueLibraryVision(assetId)},Modifier.fillMaxWidth().padding(top=8.dp),enabled=submitState !is SubmitState.Sending){Text("开始视觉理解")}}}
        detail.libraryVisionRetryJobId?.let{jobId->item{OutlinedButton(onClick={onRetryLibraryVision(jobId)},Modifier.fillMaxWidth().padding(top=8.dp),enabled=submitState !is SubmitState.Sending){Text("重试视觉理解")}}}
        if(detail.libraryVisionSourceAssetId!=null||detail.libraryVisionRetryJobId!=null)item{when(submitState){is SubmitState.Rejected->Text(submitState.message,color=MaterialTheme.colorScheme.error);is SubmitState.Saved->Text("命令已保存，刷新详情查看处理状态");else->Unit}}
        detail.editSeed?.let{seed->item{OutlinedButton(onClick={onReset();editing=true},Modifier.fillMaxWidth().padding(top=8.dp).heightIn(min=52.dp)){Text("更正记录")}}}
        detail.revision?.let{revision->item{Text("记录版本 $revision",Modifier.padding(top=16.dp),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}

      }
    }
  }
  val seed=(state as? LoadState.Ready)?.value?.editSeed
  if(editing&&seed!=null)DetailEditSheet(seed,submitState,{editing=false;onReset()},{onCorrect(seed,it)})
}

@Composable private fun DetailSectionContent(section:DetailSection,onLink:(DetailLink)->Unit){
  var expanded by rememberSaveable(section.title){mutableStateOf(false)}
  val technical=isDetailMetadata(section)
  val visibleFacts=if(expanded)section.facts else if(technical)emptyList() else section.facts.take(6)
  val visibleGroups=if(expanded)section.groups else if(technical)emptyList() else section.groups.take(3)
  Column(Modifier.fillMaxWidth().padding(top=16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text(section.title,style=MaterialTheme.typography.titleLarge,modifier=Modifier.weight(1f));section.itemCount?.let{Text("$it 项",color=MaterialTheme.colorScheme.onSurfaceVariant)}}
    if(visibleFacts.isNotEmpty())LifeCard{visibleFacts.forEach{fact->PlanningFact(fact.label,fact.value)}}
    visibleGroups.forEach{group->LifeCard{Text(group.title,style=MaterialTheme.typography.titleMedium);group.facts.forEach{PlanningFact(it.label,it.value)};group.links.forEach{link->TextButton(onClick={onLink(link)}){Text("查看${link.title}")}}}}
    (if(expanded)section.links else if(technical)emptyList() else section.links.take(6)).forEach{link->LifeCard(onClick={onLink(link)}){Text(link.title,style=MaterialTheme.typography.titleMedium);link.supporting?.let{Text(it,color=MaterialTheme.colorScheme.onSurfaceVariant)};Text("打开${planningKindLabel(link.kind)} ›",color=MaterialTheme.colorScheme.primary)}}
    if(technical||section.facts.size>6||section.groups.size>3||section.links.size>6)TextButton(onClick={expanded=!expanded}){Text(if(expanded)"收起" else "展开全部（${section.itemCount?:maxOf(section.facts.size,section.groups.size,section.links.size)}）")}
  }
}

@Composable private fun DetailHero(detail:RecordDetail){val tone=detailTone(detail.presentation);Surface(Modifier.fillMaxWidth().padding(bottom=12.dp),shape=RoundedCornerShape(28.dp),color=tone.copy(alpha=.13f)){Row(Modifier.padding(22.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(16.dp)){Surface(Modifier.size(58.dp),shape=RoundedCornerShape(20.dp),color=tone.copy(alpha=.2f)){Box(contentAlignment=Alignment.Center){Text(detailGlyph(detail.presentation),style=MaterialTheme.typography.headlineMedium,color=tone)}};Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){Text(detailCategory(detail.presentation),style=MaterialTheme.typography.labelLarge,color=tone);if(detail.heroValue!=null)Text(detail.title,style=MaterialTheme.typography.titleMedium);Text(detail.heroValue?:detail.title,style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.SemiBold);detail.heroSupporting?.takeIf(String::isNotBlank)?.let{Text(it,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}}}
private fun detailCategory(value:DetailPresentation)=when(value){DetailPresentation.HealthMetric->"身体测量";DetailPresentation.Workout->"运动记录";DetailPresentation.Sleep->"睡眠记录";DetailPresentation.Activity->"活动记录";DetailPresentation.Meal->"饮食记录";DetailPresentation.Money->"消费记录";DetailPresentation.Travel->"旅程";DetailPresentation.Library->"资料";DetailPresentation.Habit->"生活习惯";DetailPresentation.Generic->"记录详情"}
@Composable private fun detailTone(value:DetailPresentation):Color=when(value){DetailPresentation.HealthMetric->Color(0xFFFF9F43);DetailPresentation.Workout,DetailPresentation.Activity->Color(0xFF7CEB52);DetailPresentation.Sleep->Color(0xFFA982FF);DetailPresentation.Meal->Color(0xFFFF806F);DetailPresentation.Money->Color(0xFF64D2FF);DetailPresentation.Travel->Color(0xFF58D6B1);DetailPresentation.Library->Color(0xFF8DA6FF);DetailPresentation.Habit->Color(0xFFFFC857);DetailPresentation.Generic->MaterialTheme.colorScheme.primary}
private fun detailGlyph(value:DetailPresentation)=when(value){DetailPresentation.HealthMetric->"◇";DetailPresentation.Workout->"↗";DetailPresentation.Sleep->"☾";DetailPresentation.Activity->"◎";DetailPresentation.Meal->"◐";DetailPresentation.Money->"¥";DetailPresentation.Travel->"⌁";DetailPresentation.Library->"▤";DetailPresentation.Habit->"✓";DetailPresentation.Generic->"·"}

@OptIn(ExperimentalMaterial3Api::class,ExperimentalLayoutApi::class)
@Composable private fun DetailEditSheet(seed:EditSeed,state:SubmitState,onDismiss:()->Unit,onSubmit:(CorrectionDraft)->Unit){
  var primary by rememberSaveable(seed.detailId){mutableStateOf(when(seed){is EditSeed.Meal->"";is EditSeed.Money->seed.amount;is EditSeed.Health->seed.value;is EditSeed.Trip->seed.title;is EditSeed.Library->seed.title})}
  var secondary by rememberSaveable(seed.detailId){mutableStateOf(when(seed){is EditSeed.Meal->"";is EditSeed.Money->seed.category.orEmpty();is EditSeed.Health->seed.unit;is EditSeed.Trip->seed.endsOn;is EditSeed.Library->seed.text?:seed.url.orEmpty()})}
  var note by rememberSaveable(seed.detailId){mutableStateOf(when(seed){is EditSeed.Meal->seed.note.orEmpty();is EditSeed.Money->seed.note.orEmpty();is EditSeed.Health->seed.note.orEmpty();is EditSeed.Trip->seed.note.orEmpty();is EditSeed.Library->""})}
  var date by rememberSaveable(seed.detailId){mutableStateOf(when(seed){is EditSeed.Meal->seed.occurredOn;is EditSeed.Money->seed.occurredOn;is EditSeed.Health->seed.occurredOn;is EditSeed.Trip->seed.startsOn;is EditSeed.Library->seed.documentDate.orEmpty()})}
  var option by rememberSaveable(seed.detailId){mutableStateOf(when(seed){is EditSeed.Meal->seed.mealType;is EditSeed.Money->seed.counterparty.orEmpty();is EditSeed.Health->seed.label.orEmpty();is EditSeed.Trip->"";is EditSeed.Library->seed.category.orEmpty()})}
  var reason by rememberSaveable(seed.detailId){mutableStateOf("")}
  ModalBottomSheet(onDismissRequest=onDismiss,containerColor=MaterialTheme.colorScheme.surface){Column(Modifier.fillMaxWidth().imePadding().verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(start=20.dp,end=20.dp,bottom=28.dp),verticalArrangement=Arrangement.spacedBy(14.dp)){
    Text("更正${seed.domain.label()}",style=MaterialTheme.typography.headlineMedium)
    if(seed is EditSeed.Meal)FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){listOf("breakfast" to "早餐","lunch" to "午餐","dinner" to "晚餐","snack" to "加餐","other" to "其他").forEach{(value,label)->FilterChip(option==value,{option=value},{Text(label)})}}
    if(seed !is EditSeed.Meal)OutlinedTextField(primary,{primary=it},Modifier.fillMaxWidth(),label={Text(when(seed){is EditSeed.Money->"金额";is EditSeed.Health->"数值";is EditSeed.Trip,is EditSeed.Library->"标题";else->"内容"})},singleLine=true)
    if(seed !is EditSeed.Meal)OutlinedTextField(secondary,{secondary=it},Modifier.fillMaxWidth(),label={Text(when(seed){is EditSeed.Money->"分类（可选）";is EditSeed.Health->"单位";is EditSeed.Trip->"结束日期";is EditSeed.Library->"正文或链接";else->"补充"})},minLines=if(seed is EditSeed.Library)4 else 1)
    if(seed is EditSeed.Money||seed is EditSeed.Health)OutlinedTextField(option,{option=it},Modifier.fillMaxWidth(),label={Text(if(seed is EditSeed.Money)"交易方（可选）" else "标签（可选)")})
    if(seed is EditSeed.Library){OutlinedTextField(date,{date=it},Modifier.fillMaxWidth(),label={Text("资料日期（可选，YYYY-MM-DD）")},singleLine=true);OutlinedTextField(option,{option=it},Modifier.fillMaxWidth(),label={Text("分类（可选）")},singleLine=true)}else OutlinedTextField(date,{date=it},Modifier.fillMaxWidth(),label={Text(if(seed is EditSeed.Trip)"开始日期" else "发生日期")},singleLine=true)
    if(seed !is EditSeed.Library)OutlinedTextField(note,{note=it},Modifier.fillMaxWidth(),label={Text("备注（可选）")},minLines=2)
    OutlinedTextField(reason,{reason=it},Modifier.fillMaxWidth(),label={Text("更正说明（可选）")},minLines=2,supportingText={Text("留空时会记录为“用户在详情中更正”")})
    when(state){is SubmitState.Rejected->Text(state.message,color=MaterialTheme.colorScheme.error);is SubmitState.Saved->TaskResultCard(state.receipt,onDismiss);else->Button(onClick={onSubmit(CorrectionDraft(primary,secondary,note,date,option,reason))},enabled=state !is SubmitState.Sending&&primaryValid(seed,primary,secondary),modifier=Modifier.fillMaxWidth().heightIn(min=56.dp)){Text(if(state is SubmitState.Sending)"正在保存…" else "保存更正")}}
  }}
}

private fun primaryValid(seed:EditSeed,primary:String,secondary:String)=when(seed){is EditSeed.Meal->true;is EditSeed.Library->primary.isNotBlank()&&secondary.isNotBlank();is EditSeed.Health,is EditSeed.Trip->primary.isNotBlank()&&secondary.isNotBlank();is EditSeed.Money->primary.isNotBlank()}

private sealed interface FeatureAction{
  data class Capture(val kind:CaptureKind):FeatureAction
  data class Workspace(val domain:LifeDomain):FeatureAction
  data object Plans:FeatureAction
  data object HealthConnect:FeatureAction
  data object Samsung:FeatureAction
  data object Scale:FeatureAction
}
private data class FeatureEntry(val group:String,val title:String,val subtitle:String,val keywords:String,val action:FeatureAction)

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun FeaturesScreen(onCapture:(CaptureKind)->Unit,onWorkspace:(LifeDomain)->Unit,onPlans:()->Unit,onHealthSync:()->Unit,onSamsungSync:()->Unit,onScale:()->Unit,onBack:()->Unit){
  var query by rememberSaveable{mutableStateOf("")}
  val entries=remember{buildList{
    addAll(listOf(
    FeatureEntry("健康","记录健康数据","体重、体脂、心率、体温、睡眠或步数","体重 体脂 心率 睡眠 步数",FeatureAction.Capture(CaptureKind.Health)),
    FeatureEntry("健康","记录训练","保存一次手工训练","运动 健身 跑步",FeatureAction.Capture(CaptureKind.Workout)),
    FeatureEntry("健康","Samsung Health 同步","读取已授权的三星健康数据","三星 手表 自动同步",FeatureAction.Samsung),
    FeatureEntry("健康","小米体脂秤称重","开启三分钟蓝牙接收窗口","小米 体重秤 s400 scale2 蓝牙",FeatureAction.Scale),
    FeatureEntry("饮食","记录一餐","用食物行、份量和单位快速录入","早餐 午餐 晚餐 食物",FeatureAction.Capture(CaptureKind.Meal)),
    FeatureEntry("饮食","饮食记录","查看餐次并搜索","食谱 餐次",FeatureAction.Workspace(LifeDomain.Meals)),
    FeatureEntry("消费","记录收支","记录支出或收入","消费 收入 账单",FeatureAction.Capture(CaptureKind.Expense)),
    FeatureEntry("消费","记录购买","同时保存商品明细和可选付款","购物 商品 订单",FeatureAction.Capture(CaptureKind.Purchase)),
    FeatureEntry("消费","记录退款","选择原交易后记录部分或全部退款","退货 退款",FeatureAction.Capture(CaptureKind.Refund)),
    FeatureEntry("消费","消费记录与规划","查看交易、预算和周期事项","预算 周期 账单",FeatureAction.Workspace(LifeDomain.Money)),
    FeatureEntry("旅行","创建旅程","记录旅程日期与时区","出行 行程",FeatureAction.Capture(CaptureKind.Trip)),
    FeatureEntry("旅行","记录到访","保存实际到访，不把候选地点当事实","地点 打卡",FeatureAction.Capture(CaptureKind.Visit)),
    FeatureEntry("旅行","旅行空间","查看旅程、地点和地图","预订 地图 在途",FeatureAction.Workspace(LifeDomain.Travel)),
    FeatureEntry("物品与计划","添加物品","显式加入需要管理的个人物品","保修 说明书 退货",FeatureAction.Capture(CaptureKind.OwnedItem)),
    FeatureEntry("物品与计划","创建生活项目","组织目标、时间和行动","目标 项目 行动",FeatureAction.Capture(CaptureKind.Project)),
    FeatureEntry("物品与计划","计划、物品与回顾","查看本周行动、物品和生活回顾","计划 物品 回顾",FeatureAction.Plans),
    FeatureEntry("资料","收存资料","保存文字、链接或从系统分享文件","文档 PDF 链接",FeatureAction.Capture(CaptureKind.Library)),
    FeatureEntry("资料","资料库","搜索原件、正文与处理状态","阅读 凭证 批注",FeatureAction.Workspace(LifeDomain.Library))
    ))
    if(HealthConnectSync.enabled())add(FeatureEntry("健康","Health Connect 同步","读取系统健康聚合来源","谷歌 health connect",FeatureAction.HealthConnect))
  }}
  val shown=entries.filter{query.isBlank()||listOf(it.group,it.title,it.subtitle,it.keywords).any{value->value.contains(query.trim(),ignoreCase=true)}}
  Scaffold(containerColor=MaterialTheme.colorScheme.background,topBar={TopAppBar(title={Text("全部功能")},navigationIcon={IconButton(onClick=onBack){Text("‹",style=MaterialTheme.typography.headlineLarge)}})}){padding->
    LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
      item{OutlinedTextField(query,{query=it},Modifier.fillMaxWidth(),singleLine=true,label={Text("搜索功能")},leadingIcon={Icon(Icons.Default.Search,null)});Text("常用动作也会出现在对应工作区和对象详情中。",Modifier.padding(top=8.dp),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
      if(shown.isEmpty())item{EmptyState("没有匹配的功能")}
      shown.groupBy{it.group}.forEach{(group,groupEntries)->item("group:$group"){Text(group,Modifier.padding(top=12.dp),style=MaterialTheme.typography.titleLarge)};items(groupEntries,key={"feature:${it.title}"}){entry->LifeCard(onClick={when(val action=entry.action){is FeatureAction.Capture->onCapture(action.kind);is FeatureAction.Workspace->onWorkspace(action.domain);FeatureAction.Plans->onPlans();FeatureAction.HealthConnect->onHealthSync();FeatureAction.Samsung->onSamsungSync();FeatureAction.Scale->onScale()}}){Text(entry.title,style=MaterialTheme.typography.titleMedium);Text(entry.subtitle,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun PlanDetailScreen(state:LoadState<PlanSummary>,onRetry:()->Unit,onRelated:(String,String)->Unit,onBack:()->Unit,onSaveAction:(String,String,String,String)->Unit,actionState:SubmitState){
  val plan=(state as? LoadState.Ready)?.value
  var actionTitle by rememberSaveable{mutableStateOf("")};var actionDate by rememberSaveable{mutableStateOf("")};var actionTime by rememberSaveable{mutableStateOf("")}
  PlanningDetailScaffold(plan?.title?:"项目详情",onBack){
    item{StateContent(state,onRetry){}}
    if(plan!=null){
      item{DetailStatus(plan.state,plan.revision)}
      plan.goal?.let{goal->item{LifeSection("目标"){LifeCard{Text(goal)}}}}
      item{LifeSection("时间"){LifeCard{PlanningFact("开始",plan.startsOn?:"未设置");PlanningFact("截止",plan.dueOn?:"未设置");plan.updatedAt?.let{PlanningFact("最近更新",it)}}}}
      item{Text("下一步与行动",style=MaterialTheme.typography.titleLarge)}
      item{LifeCard{Text("添加行动",style=MaterialTheme.typography.titleMedium);OutlinedTextField(actionTitle,{actionTitle=it},Modifier.fillMaxWidth(),label={Text("行动")});OutlinedTextField(actionDate,{actionDate=it},Modifier.fillMaxWidth(),label={Text("日期 YYYY-MM-DD（可选）")});OutlinedTextField(actionTime,{actionTime=it},Modifier.fillMaxWidth(),label={Text("当天时间 HH:mm（可选）")});Button(onClick={onSaveAction(plan.id,actionTitle,actionDate,actionTime);actionTitle="";actionDate="";actionTime=""},enabled=actionTitle.isNotBlank()&&(actionTime.isBlank()||runCatching{java.time.LocalDate.parse(actionDate);java.time.LocalTime.parse(actionTime);true}.getOrDefault(false))){Text("保存行动")};if(actionState is SubmitState.Rejected)Text(actionState.message,color=MaterialTheme.colorScheme.error);if(actionState is SubmitState.Saved)TextButton(onClick=onRetry){Text(if(actionState.receipt.queued)"已加入同步队列 · 刷新行动" else "已保存 · 刷新行动")}}}
      if(plan.actionItems.isEmpty())item{EmptyState("还没有项目行动")} else items(plan.actionItems,key={"action:${it.id}"}){action->LifeCard{Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text(action.title,Modifier.weight(1f),style=MaterialTheme.typography.titleMedium);StatusLabel(action.state)};Text(action.dueOn?.let{"计划 $it"}?:"未设置日期",color=MaterialTheme.colorScheme.onSurfaceVariant);action.scheduledAt?.let{Text("单日安排：${localDateTime(it,action.scheduledTimeZone?:java.time.ZoneId.systemDefault().id)}",color=MaterialTheme.colorScheme.primary)};action.sourceState?.let{Text("来源状态：$it",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}
      item{Text("里程碑",style=MaterialTheme.typography.titleLarge,modifier=Modifier.padding(top=8.dp))}
      if(plan.milestones.isEmpty())item{EmptyState("还没有里程碑")} else items(plan.milestones,key={"milestone:${it.id}"}){milestone->LifeCard{Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text(milestone.title,Modifier.weight(1f),style=MaterialTheme.typography.titleMedium);StatusLabel(milestone.state)};Text(milestone.dueOn?.let{"目标 $it"}?:"未设置日期",color=MaterialTheme.colorScheme.onSurfaceVariant)}}
      item{Text("相关内容",style=MaterialTheme.typography.titleLarge,modifier=Modifier.padding(top=8.dp))}
      if(plan.links.isEmpty())item{EmptyState("还没有关联内容")} else items(plan.links,key={"link:${it.kind}:${it.id}"}){link->RelatedPlanningLink(link,onRelated)}
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun OwnedItemDetailScreen(state:LoadState<OwnedItemSummary>,onRetry:()->Unit,onRelated:(String,String)->Unit,onBack:()->Unit){
  val owned=(state as? LoadState.Ready)?.value
  PlanningDetailScaffold(owned?.name?:"物品详情",onBack){
    item{StateContent(state,onRetry){}}
    if(owned!=null){
      item{DetailStatus(owned.state,owned.revision)}
      item{LifeSection("物品信息"){LifeCard{PlanningFact("位置",owned.locationPath?.joinToString(" › ")?:owned.location?:"未设置");PlanningFact("开始持有",owned.startedOn?:"未设置");PlanningFact("退货截至",owned.returnBy?:"不适用");PlanningFact("保修截至",owned.warrantyEndsOn?:"未设置");owned.updatedAt?.let{PlanningFact("最近更新",it)}}}}
      owned.purchase?.let{purchase->item{LifeSection("购买来源"){LifeCard(onClick={onRelated("money_entry",purchase.recordId)}){Text(purchase.rawName,style=MaterialTheme.typography.titleMedium);Text(listOfNotNull(purchase.quantity,purchase.unit).joinToString(" ").ifBlank{"数量未记录"},color=MaterialTheme.colorScheme.onSurfaceVariant);purchase.lineAmount?.let{Text("金额 $it")};Text("查看关联交易",color=MaterialTheme.colorScheme.primary)}}}}
      item{Text("资料",style=MaterialTheme.typography.titleLarge)}
      if(owned.documentItems.isEmpty())item{EmptyState("还没有票据、说明书或保修资料")} else items(owned.documentItems,key={"document:${it.id}:${it.revision}"}){document->RelatedPlanningLink(document,onRelated)}
      item{Text("售后与使用事件",style=MaterialTheme.typography.titleLarge,modifier=Modifier.padding(top=8.dp))}
      if(owned.eventItems.isEmpty())item{EmptyState("还没有维护、维修或处置事件")} else items(owned.eventItems,key={"event:${it.id}"}){event->LifeCard{Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text(ownedEventLabel(event.kind),Modifier.weight(1f),style=MaterialTheme.typography.titleMedium);Text(event.occurredOn,color=MaterialTheme.colorScheme.onSurfaceVariant)};if(event.note.isNotBlank())Text(event.note);event.cost?.let{Text("费用 $it",color=MaterialTheme.colorScheme.onSurfaceVariant)};event.costEntryId?.let{id->TextButton(onClick={onRelated("money_entry",id)}){Text("查看费用明细")}};event.documentId?.let{id->TextButton(onClick={onRelated("library_item",id)}){Text(event.documentTitle?:"查看关联凭证")}}}}
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ReviewDetailScreen(state:LoadState<ReviewSummary>,onRetry:()->Unit,onEvidence:(ReviewEvidence)->Unit,onBack:()->Unit){
  val review=(state as? LoadState.Ready)?.value
  var showEvidence by rememberSaveable(review?.id){mutableStateOf(false)}
  var showMetadata by rememberSaveable(review?.id){mutableStateOf(false)}
  PlanningDetailScaffold("生活回顾",onBack){
    item{StateContent(state,onRetry){}}
    if(review!=null){
      item{LifeSection("回顾范围"){LifeCard{PlanningFact("期间","${review.fromOn} — ${review.toOn}");PlanningFact("时区",review.timeZone);PlanningFact("领域",review.domains.joinToString("、",transform=::planningDomainLabel).ifBlank{"未记录"})}}}
      item{Text("实际指标",style=MaterialTheme.typography.titleLarge)}
      if(review.metricGroups.isEmpty())item{EmptyState("没有可用指标")} else review.metricGroups.forEach{group->item(key="metric:${group.title}"){ReviewMetricCard(group)}}
      item{Text("数据覆盖",style=MaterialTheme.typography.titleLarge)}
      if(review.coverageGroups.isEmpty())item{EmptyState("没有覆盖信息")} else review.coverageGroups.forEach{group->item(key="coverage:${group.title}"){ReviewMetricCard(group)}}
      item{Text("覆盖说明",style=MaterialTheme.typography.titleLarge)}
      if(review.limitationItems.isEmpty())item{LifeCard{Text("本期没有额外覆盖限制",color=MaterialTheme.colorScheme.onSurfaceVariant)}} else items(review.limitationItems,key={it}){limitation->LifeCard{Text(limitation)}}
      item{TextButton(onClick={showMetadata=!showMetadata}){Text(if(showMetadata)"收起生成信息" else "查看生成信息")};if(showMetadata)LifeCard{PlanningFact("算法版本",review.algorithmVersion);PlanningFact("生成时间",review.generatedAt);PlanningFact("回顾修订",review.revision.toString());PlanningFact("证据数量","${review.evidence.size} 项")}}
      item{Text("证据索引",style=MaterialTheme.typography.titleLarge,modifier=Modifier.padding(top=8.dp))}
      if(review.evidence.isEmpty())item{EmptyState("没有可显示的证据引用")} else items(if(showEvidence)review.evidence else review.evidence.take(5),key={"evidence:${it.kind}:${it.id}:${it.revision}"}){evidence->LifeCard(onClick=if(reviewEvidenceActionable(evidence.kind)){{onEvidence(evidence)}} else null){Text(planningKindLabel(evidence.kind),style=MaterialTheme.typography.titleMedium);Text(if(reviewEvidenceActionable(evidence.kind))"查看原记录" else "证据修订 ${evidence.revision}",color=if(reviewEvidenceActionable(evidence.kind))MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)}}
      if(review.evidence.size>5)item{TextButton(onClick={showEvidence=!showEvidence}){Text(if(showEvidence)"收起关联记录" else "查看全部 ${review.evidence.size} 条关联记录")}}
    }
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun PlanningDetailScaffold(title:String,onBack:()->Unit,content:androidx.compose.foundation.lazy.LazyListScope.()->Unit){Scaffold(containerColor=MaterialTheme.colorScheme.background,topBar={TopAppBar(title={Text(title,maxLines=1,overflow=TextOverflow.Ellipsis)},navigationIcon={IconButton(onClick=onBack){Text("‹",style=MaterialTheme.typography.headlineLarge)}})}){padding->LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(14.dp),content=content)}}

@Composable private fun DetailStatus(state:String,revision:Int){Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text("当前状态",Modifier.weight(1f),color=MaterialTheme.colorScheme.onSurfaceVariant);StatusLabel(state)};Text("修订 $revision",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}
@Composable private fun PlanningFact(label:String,value:String){Column(Modifier.fillMaxWidth().padding(vertical=5.dp)){Text(label,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);Text(detailValue(label,value),style=MaterialTheme.typography.bodyLarge)}}
@Composable private fun RelatedPlanningLink(link:PlanningLink,onRelated:(String,String)->Unit){
  val actionable=link.kind in setOf("trip","owned_item","library_item","money_entry","meal","purchase")
  LifeCard(onClick=if(actionable){{onRelated(link.kind,link.id)}} else null){
    Text(link.title?:planningKindLabel(link.kind),style=MaterialTheme.typography.titleMedium)
    Text(if(actionable)"${planningRoleLabel(link.role)} · 查看详情" else "${planningRoleLabel(link.role)} · 关联摘要",color=if(actionable)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
  }
}
private fun planningRoleLabel(role:String)=mapOf("receipt" to "购买凭证","manual" to "使用说明","warranty" to "保修资料","repair" to "维修记录")[role]?:role
private fun planningKindLabel(kind:String)=when(kind){"trip"->"旅程";"health_plan"->"健康计划";"recurring_plan"->"周期计划";"owned_item"->"物品";"library_item"->"资料";"money_entry"->"交易";"meal"->"餐次";"purchase"->"消费";"health_record"->"健康记录";"recipe"->"食谱";"health_measurement"->"健康测量";"health_workout_session"->"训练记录";else->kind}
private fun planningDomainLabel(domain:String)=when(domain){"money"->"消费";"meals"->"饮食";"health"->"健康";"items"->"物品";"library"->"资料";else->domain}
@Composable private fun ReviewMetricCard(group:ReviewMetricGroup){LifeCard{Text(group.title,style=MaterialTheme.typography.titleMedium);group.values.forEach{PlanningFact(it.label,it.value)}}}
@Composable private fun HealthSummaryContent(summary:TodayHealthSummary){when(summary.state){HealthSummaryState.NotAuthorized->Text("未授权健康数据",color=MaterialTheme.colorScheme.onSurfaceVariant);HealthSummaryState.Empty->Text("尚无有效健康记录；缺失值不会显示为 0",color=MaterialTheme.colorScheme.onSurfaceVariant);HealthSummaryState.Failed->Text("健康摘要读取失败，请稍后重试",color=MaterialTheme.colorScheme.error);HealthSummaryState.Ready->{summary.weight?.let{PlanningFact("最近体重","$it ${summary.weightUnit.orEmpty()}${summary.weightOn?.let{on->" · $on"}.orEmpty()}")};summary.steps?.let{PlanningFact("今日步数",it.toString())};summary.sleepMinutes?.let{PlanningFact("睡眠",formatMinutes(it))};summary.updatedAt?.let{PlanningFact("最近更新",it)}}}}
private fun formatMinutes(value:Long)="${value/60} 小时 ${value%60} 分"
private fun reviewEvidenceActionable(kind:String)=kind in setOf("money_entry","meal","health_measurement","health_workout_session","library_item","owned_item")
private fun ownedEventLabel(kind:String)=when(kind){"maintenance"->"维护";"repair"->"维修";"return"->"退货";"dispose"->"处置";"gift"->"赠出";"lost"->"遗失";"restore"->"恢复持有";"note"->"记录";else->kind}

@Composable private fun StatusLabel(state:String){Surface(shape=RoundedCornerShape(999.dp),color=MaterialTheme.colorScheme.primaryContainer){Text(stateLabel(state),Modifier.padding(horizontal=10.dp,vertical=5.dp),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onPrimaryContainer)}}
private fun stateLabel(state:String)=mapOf("active" to "进行中","paused" to "已暂停","completed" to "已完成","archived" to "已归档")[state]?:state
internal fun LifeDomain.label()=when(this){LifeDomain.Meals->"饮食";LifeDomain.Money->"消费";LifeDomain.Health->"健康";LifeDomain.Travel->"旅行";LifeDomain.Library->"资料"}
