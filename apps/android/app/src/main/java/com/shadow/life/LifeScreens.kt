package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountCircle
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun RootPage(title:String,onProjects:()->Unit,onSettings:()->Unit,content:@Composable (PaddingValues)->Unit){
  Scaffold(containerColor=MaterialTheme.colorScheme.background,topBar={TopAppBar(title={Text(title,style=MaterialTheme.typography.headlineLarge)},colors=TopAppBarDefaults.topAppBarColors(containerColor=MaterialTheme.colorScheme.background),actions={IconButton(onClick=onProjects){Icon(Icons.Default.MoreVert,"其他项目")};IconButton(onClick=onSettings){Icon(Icons.Default.AccountCircle,"账号与设置")}})},content=content)
}

@Composable fun TodayScreen(state:LoadState<TodaySnapshot>,onRetry:()->Unit,onWorkspace:(LifeDomain)->Unit,onDetail:(LifeDomain,String,String)->Unit,onProjects:()->Unit,onSettings:()->Unit){
  RootPage(LocalDate.now().format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(Locale.CHINA)),onProjects,onSettings){padding->
    LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(start=20.dp,end=20.dp,top=8.dp,bottom=112.dp),verticalArrangement=Arrangement.spacedBy(24.dp)){
      item{StateContent(state,onRetry){today->TodayContent(today,onWorkspace,onDetail)}}
    }
  }
}

@Composable private fun TodayContent(today:TodaySnapshot,onWorkspace:(LifeDomain)->Unit,onDetail:(LifeDomain,String,String)->Unit){
  LifeSection("身体状态"){
    LifeCard(onClick={onWorkspace(LifeDomain.Health)}){
      Text(if(today.healthFacts==null)"尚未授权健康数据" else "${today.healthFacts}",style=MaterialTheme.typography.displaySmall,fontWeight=FontWeight.SemiBold)
      Text(if(today.healthFacts==null)"连接设备或手动记录" else "今天的健康事实",color=MaterialTheme.colorScheme.onSurfaceVariant)
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
@Composable fun PlansScreen(state:LoadState<List<PlanSummary>>,onRetry:()->Unit,onDetail:(PlanSummary)->Unit,onProjects:()->Unit,onSettings:()->Unit){
  var selected by rememberSaveable{mutableIntStateOf(2)}
  RootPage("计划",onProjects,onSettings){padding->LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(20.dp,8.dp,20.dp,112.dp),verticalArrangement=Arrangement.spacedBy(14.dp)){
    item{SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()){listOf("今天","本周","项目").forEachIndexed{index,label->SegmentedButton(selected=index==selected,onClick={selected=index},shape=SegmentedButtonDefaults.itemShape(index,3)){Text(label)}}}}
    item{StateContent(state,onRetry){}}
    if(state is LoadState.Ready){val today=LocalDate.now();val plans=state.value.filter{plan->when(selected){0->plan.dueOn==today.toString();1->plan.dueOn?.let{runCatching{LocalDate.parse(it)}.getOrNull()}?.let{!it.isBefore(today)&&it.isBefore(today.plusDays(7))}==true;else->true}};if(plans.isEmpty())item{EmptyState(if(selected==0)"今天没有到期计划" else if(selected==1)"本周没有到期计划" else "还没有计划")} else items(plans,key={it.id}){plan->LifeCard(onClick={onDetail(plan)}){Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text(plan.title,Modifier.weight(1f),style=MaterialTheme.typography.titleLarge);StatusLabel(plan.state)};plan.goal?.let{Text(it,color=MaterialTheme.colorScheme.onSurfaceVariant)};Text("${plan.actions} 项行动${plan.dueOn?.let{" · 截止 $it"}.orEmpty()}",style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}
  }}
}

@Composable fun LibraryScreen(state:LoadState<List<LibrarySummary>>,onSearch:(String)->Unit,onDetail:(LifeDomain,String,String)->Unit,onProjects:()->Unit,onSettings:()->Unit){
  var query by rememberSaveable{mutableStateOf("")}
  RootPage("资料库",onProjects,onSettings){padding->LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(20.dp,8.dp,20.dp,112.dp)){
    item{OutlinedTextField(value=query,onValueChange={query=it;if(it.isBlank())onSearch("")},modifier=Modifier.fillMaxWidth(),singleLine=true,placeholder={Text("搜索标题、正文或标签")},leadingIcon={Icon(Icons.Default.Search,null)},trailingIcon={IconButton(onClick={onSearch(query)}){Icon(Icons.Default.Search,"搜索")}});Spacer(Modifier.height(18.dp))}
    item{StateContent(state,{onSearch(query)}){}}
    if(state is LoadState.Ready)items(state.value,key={it.id}){item->RecordRow(RecordSummary(LifeDomain.Library,item.itemType,item.id,item.title,item.state,null,item.revision)){onDetail(LifeDomain.Library,item.id,item.title)};HorizontalDivider(color=MaterialTheme.colorScheme.outline.copy(alpha=.45f))}
  }}
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun WorkspaceScreen(domain:LifeDomain,state:LoadState<RecordPage>,onSearch:(String)->Unit,onRetry:()->Unit,onLoadMore:()->Unit,onBack:()->Unit,onDetail:(LifeDomain,String,String)->Unit){
  var query by rememberSaveable{mutableStateOf("")}
  Scaffold(containerColor=MaterialTheme.colorScheme.background,topBar={TopAppBar(title={Text(domain.label())},navigationIcon={IconButton(onClick=onBack){Text("‹",style=MaterialTheme.typography.headlineLarge)}})}){padding->LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(horizontal=20.dp,vertical=12.dp)){
    item{OutlinedTextField(query,{query=it},Modifier.fillMaxWidth(),singleLine=true,label={Text("在${domain.label()}中搜索")},trailingIcon={IconButton(onClick={onSearch(query)}){Icon(Icons.Default.Search,"搜索")}});Spacer(Modifier.height(12.dp))}
    item{StateContent(state,onRetry){}}
    if(state is LoadState.Ready)items(state.value.items,key={it.id}){item->RecordRow(item){onDetail(domain,item.detailId?:item.id,item.title)};HorizontalDivider(color=MaterialTheme.colorScheme.outline.copy(alpha=.45f))}
    if(state is LoadState.Ready&&state.value.nextCursor!=null)item{TextButton(onClick=onLoadMore,Modifier.fillMaxWidth()){Text("加载更多")}}
  }}
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun DetailScreen(title:String,state:LoadState<RecordDetail>,submitState:SubmitState,onRetry:()->Unit,onBack:()->Unit,onCorrect:(EditSeed,CorrectionDraft)->Unit,onReset:()->Unit){
  var editing by rememberSaveable{mutableStateOf(false)}
  Scaffold(containerColor=MaterialTheme.colorScheme.background,topBar={TopAppBar(title={Text(title.ifBlank{"详情"})},navigationIcon={IconButton(onClick=onBack){Text("‹",style=MaterialTheme.typography.headlineLarge)}})}){padding->
    LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(2.dp)){
      item{StateContent(state,onRetry){}}
      if(state is LoadState.Ready){
        val detail=state.value
        item{Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp)){detail.state?.let{StatusLabel(it)};detail.revision?.let{Text("修订 $it",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}
        detail.editSeed?.let{seed->item{Button(onClick={onReset();editing=true},Modifier.fillMaxWidth().padding(top=16.dp).heightIn(min=52.dp)){Text("更正记录")}}}
        detail.sections.forEach{section->
          item(section.title){Column(Modifier.padding(top=20.dp)){Text(section.title,style=MaterialTheme.typography.titleLarge);section.itemCount?.let{Text("$it 项",color=MaterialTheme.colorScheme.onSurfaceVariant)};section.facts.forEach{fact->Column(Modifier.fillMaxWidth().padding(vertical=9.dp)){Text(fact.label,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);Text(fact.value,style=MaterialTheme.typography.bodyLarge)}};HorizontalDivider(color=MaterialTheme.colorScheme.outline.copy(alpha=.35f))}}
        }
      }
    }
  }
  val seed=(state as? LoadState.Ready)?.value?.editSeed
  if(editing&&seed!=null)DetailEditSheet(seed,submitState,{editing=false;onReset()},{onCorrect(seed,it)})
}

@OptIn(ExperimentalMaterial3Api::class,ExperimentalLayoutApi::class)
@Composable private fun DetailEditSheet(seed:EditSeed,state:SubmitState,onDismiss:()->Unit,onSubmit:(CorrectionDraft)->Unit){
  var primary by rememberSaveable(seed.detailId){mutableStateOf(when(seed){is EditSeed.Meal->"";is EditSeed.Money->seed.amount;is EditSeed.Health->seed.value;is EditSeed.Trip->seed.title;is EditSeed.Library->seed.title})}
  var secondary by rememberSaveable(seed.detailId){mutableStateOf(when(seed){is EditSeed.Meal->"";is EditSeed.Money->seed.category.orEmpty();is EditSeed.Health->seed.unit;is EditSeed.Trip->seed.endsOn;is EditSeed.Library->seed.text?:seed.url.orEmpty()})}
  var note by rememberSaveable(seed.detailId){mutableStateOf(when(seed){is EditSeed.Meal->seed.note.orEmpty();is EditSeed.Money->seed.note.orEmpty();is EditSeed.Health->seed.note.orEmpty();is EditSeed.Trip->seed.note.orEmpty();is EditSeed.Library->""})}
  var date by rememberSaveable(seed.detailId){mutableStateOf(when(seed){is EditSeed.Meal->seed.occurredOn;is EditSeed.Money->seed.occurredOn;is EditSeed.Health->seed.occurredOn;is EditSeed.Trip->seed.startsOn;is EditSeed.Library->LocalDate.now().toString()})}
  var option by rememberSaveable(seed.detailId){mutableStateOf(when(seed){is EditSeed.Meal->seed.mealType;is EditSeed.Money->seed.counterparty.orEmpty();is EditSeed.Health->seed.label.orEmpty();is EditSeed.Trip,is EditSeed.Library->""})}
  var reason by rememberSaveable(seed.detailId){mutableStateOf("")}
  ModalBottomSheet(onDismissRequest=onDismiss,containerColor=MaterialTheme.colorScheme.surface){Column(Modifier.fillMaxWidth().imePadding().verticalScroll(androidx.compose.foundation.rememberScrollState()).padding(start=20.dp,end=20.dp,bottom=28.dp),verticalArrangement=Arrangement.spacedBy(14.dp)){
    Text("更正${seed.domain.label()}",style=MaterialTheme.typography.headlineMedium)
    if(seed is EditSeed.Meal)FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){listOf("breakfast" to "早餐","lunch" to "午餐","dinner" to "晚餐","snack" to "加餐","other" to "其他").forEach{(value,label)->FilterChip(option==value,{option=value},{Text(label)})}}
    if(seed !is EditSeed.Meal)OutlinedTextField(primary,{primary=it},Modifier.fillMaxWidth(),label={Text(when(seed){is EditSeed.Money->"金额";is EditSeed.Health->"数值";is EditSeed.Trip,is EditSeed.Library->"标题";else->"内容"})},singleLine=true)
    if(seed !is EditSeed.Meal)OutlinedTextField(secondary,{secondary=it},Modifier.fillMaxWidth(),label={Text(when(seed){is EditSeed.Money->"分类（可选）";is EditSeed.Health->"单位";is EditSeed.Trip->"结束日期";is EditSeed.Library->"正文或链接";else->"补充"})},minLines=if(seed is EditSeed.Library)4 else 1)
    if(seed is EditSeed.Money||seed is EditSeed.Health)OutlinedTextField(option,{option=it},Modifier.fillMaxWidth(),label={Text(if(seed is EditSeed.Money)"交易方（可选）" else "标签（可选)")})
    if(seed !is EditSeed.Library)OutlinedTextField(date,{date=it},Modifier.fillMaxWidth(),label={Text(if(seed is EditSeed.Trip)"开始日期" else "发生日期")},singleLine=true)
    if(seed !is EditSeed.Library)OutlinedTextField(note,{note=it},Modifier.fillMaxWidth(),label={Text("备注（可选）")},minLines=2)
    OutlinedTextField(reason,{reason=it},Modifier.fillMaxWidth(),label={Text("更正原因")},minLines=2,isError=reason.isBlank())
    when(state){is SubmitState.Rejected->Text(state.message,color=MaterialTheme.colorScheme.error);is SubmitState.Saved->TaskResultCard(state.receipt,onDismiss);else->Button(onClick={onSubmit(CorrectionDraft(primary,secondary,note,date,option,reason))},enabled=reason.isNotBlank()&&state !is SubmitState.Sending&&primaryValid(seed,primary,secondary),modifier=Modifier.fillMaxWidth().heightIn(min=56.dp)){Text(if(state is SubmitState.Sending)"正在保存…" else "保存更正")}}
  }}
}

private fun primaryValid(seed:EditSeed,primary:String,secondary:String)=when(seed){is EditSeed.Meal->true;is EditSeed.Library->primary.isNotBlank()&&secondary.isNotBlank();is EditSeed.Health,is EditSeed.Trip->primary.isNotBlank()&&secondary.isNotBlank();is EditSeed.Money->primary.isNotBlank()}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun PlanDetailScreen(plan:PlanSummary?,onBack:()->Unit){Scaffold(containerColor=MaterialTheme.colorScheme.background,topBar={TopAppBar(title={Text(plan?.title?:"计划详情")},navigationIcon={IconButton(onClick=onBack){Text("‹",style=MaterialTheme.typography.headlineLarge)}})}){padding->Column(Modifier.fillMaxSize().padding(padding).padding(20.dp),verticalArrangement=Arrangement.spacedBy(18.dp)){if(plan==null)EmptyState("计划已更新，请返回刷新") else{Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text("当前状态",Modifier.weight(1f),color=MaterialTheme.colorScheme.onSurfaceVariant);StatusLabel(plan.state)};plan.goal?.let{LifeSection("目标"){LifeCard{Text(it)}}};LifeSection("行动"){LifeCard{Text("${plan.actions} 项行动",style=MaterialTheme.typography.titleLarge);Text(plan.dueOn?.let{"截止 $it"}?:"未设置截止日期",color=MaterialTheme.colorScheme.onSurfaceVariant)}};Text("修订 ${plan.revision}",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}}

@Composable private fun StatusLabel(state:String){Surface(shape=RoundedCornerShape(999.dp),color=MaterialTheme.colorScheme.primaryContainer){Text(stateLabel(state),Modifier.padding(horizontal=10.dp,vertical=5.dp),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onPrimaryContainer)}}
private fun stateLabel(state:String)=mapOf("active" to "进行中","paused" to "已暂停","completed" to "已完成","archived" to "已归档")[state]?:state
internal fun LifeDomain.label()=when(this){LifeDomain.Meals->"饮食";LifeDomain.Money->"消费";LifeDomain.Health->"健康";LifeDomain.Travel->"旅行";LifeDomain.Library->"资料"}
