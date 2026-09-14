package com.shadow.life

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@OptIn(ExperimentalLayoutApi::class)
@Composable fun TodayVisualScreen(
  state:LoadState<TodaySnapshot>,deviceStatus:DeviceSyncStatus,queueState:LoadState<QueueSummary>,samsungAvailable:Boolean,onRetry:()->Unit,
  onWorkspace:(LifeDomain)->Unit,onItems:()->Unit,onDetail:(LifeDomain,String,String)->Unit,onSearch:()->Unit,onInbox:()->Unit,onFeatures:()->Unit,onCapture:(CaptureKind)->Unit,
  onHealthSync:()->Unit,onSamsungSync:()->Unit,onScale:()->Unit,onProjects:()->Unit,onSettings:()->Unit
){
  RootPage("今天",onProjects,onSettings,onSearch){padding->LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(20.dp,8.dp,20.dp,112.dp),verticalArrangement=Arrangement.spacedBy(20.dp)){
    item{Text(LocalDate.now().format(DateTimeFormatter.ofPattern("M 月 d 日 EEEE",Locale.CHINA)),style=MaterialTheme.typography.titleMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}
    item{StateContent(state,onRetry){} }
    item{TodayScaleReceiver(deviceStatus,queueState,onScale,onSettings)}
    if(state is LoadState.Ready){val today=state.value
      item{TodayFocusCard(today,onWorkspace,onDetail)}
      item{TodayWorkspaceGrid(today,onWorkspace,onItems)}
      item{QuickCaptureGrid(onCapture,onFeatures)}
      item{TodayAgenda(today,onInbox)}
      item{TodayRecent(today,onWorkspace)}
    }
    item{CompactTodaySync(deviceStatus,queueState,samsungAvailable,onHealthSync,onSamsungSync,onSettings)}
  }}
}

@Composable private fun TodayFocusCard(value:TodaySnapshot,onWorkspace:(LifeDomain)->Unit,onDetail:(LifeDomain,String,String)->Unit){
  val trip=value.currentTrips.firstOrNull()
  val open:()->Unit=if(trip!=null){{onDetail(LifeDomain.Travel,trip.id,trip.title)}} else {{onWorkspace(LifeDomain.Health)}}
  val headline=trip?.title?:when(value.health.state){HealthSummaryState.Ready->value.health.weight?.let{"最近体重 $it ${value.health.weightUnit.orEmpty()}"}?:"健康数据已更新";HealthSummaryState.Failed->"健康摘要需要重试";else->"从一条真实记录开始"}
  val subtitle=trip?.let{"${it.startsOn} — ${it.endsOn}"}?:listOfNotNull(value.health.steps?.let{"$it 步"},value.health.sleepMinutes?.let{"睡眠 ${rootMinutes(it)}"}).joinToString(" · ").ifBlank{"今天可以保持空白，不会填充虚构状态"}
  LifeCard(onClick=open){Text(if(trip!=null)"今日旅程" else "今日状态",style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.primary);Text(headline,style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.SemiBold);Text(subtitle,color=MaterialTheme.colorScheme.onSurfaceVariant);if(trip!=null)Button(onClick=open){Text("继续旅程")}}
}

@Composable private fun TodayWorkspaceGrid(value:TodaySnapshot,onWorkspace:(LifeDomain)->Unit,onItems:()->Unit){LifeSection("生活空间"){Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp)){TodaySpace("健康",value.health.weight?.let{"$it ${value.health.weightUnit.orEmpty()}"}?:value.health.steps?.let{"$it 步"}?:"查看趋势","↗",{onWorkspace(LifeDomain.Health)},Modifier.weight(1f));TodaySpace("消费",value.moneyTotals.firstOrNull()?.let{"${it.currency} ${it.netSpending}"}?:"今日无收支","¥",{onWorkspace(LifeDomain.Money)},Modifier.weight(1f))};Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp)){TodaySpace("旅行",value.currentTrips.firstOrNull()?.title?:"地图与足迹","⌖",{onWorkspace(LifeDomain.Travel)},Modifier.weight(1f));TodaySpace("物品","使用、维护与补给","◇",onItems,Modifier.weight(1f))}}}
@Composable private fun TodaySpace(title:String,subtitle:String,mark:String,onClick:()->Unit,modifier:Modifier){Surface(modifier.heightIn(min=108.dp).clickable(role=Role.Button,onClick=onClick),shape=RoundedCornerShape(21.dp),color=MaterialTheme.colorScheme.surface,border=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outline.copy(alpha=.65f))){Column(Modifier.padding(15.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){Text(mark,style=MaterialTheme.typography.titleLarge,color=MaterialTheme.colorScheme.primary);Text(title,style=MaterialTheme.typography.titleMedium);Text(subtitle,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=2,overflow=TextOverflow.Ellipsis)}}}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun QuickCaptureGrid(onCapture:(CaptureKind)->Unit,onFeatures:()->Unit){LifeSection("快速记录",action={TextButton(onClick=onFeatures){Text("全部")}}){FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){listOf(CaptureKind.Expense to "记一笔",CaptureKind.Health to "记体重",CaptureKind.Meal to "记饮食",CaptureKind.Workout to "记运动",CaptureKind.Visit to "记到访",CaptureKind.Library to "记随记").forEach{(kind,label)->FilledTonalButton(onClick={onCapture(kind)}){Text(label)}}}}}
@Composable private fun TodayAgenda(value:TodaySnapshot,onInbox:()->Unit){
  LifeSection("接下来",action={TextButton(onClick=onInbox){Text("全部提醒")}}){
    if(value.dueItems.isEmpty())EmptyState("今天没有待处理事项") else value.dueItems.take(3).forEach{due->
      LifeCard{Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Box(Modifier.size(12.dp).background(MaterialTheme.colorScheme.primary,RoundedCornerShape(99.dp)));Spacer(Modifier.width(12.dp));Column(Modifier.weight(1f)){Text(due.title,style=MaterialTheme.typography.titleMedium);Text(due.dueOn,color=MaterialTheme.colorScheme.onSurfaceVariant)};due.amount?.let{Text("${due.currency.orEmpty()} $it")}}}
    }
  }
}
@Composable private fun TodayRecent(value:TodaySnapshot,onWorkspace:(LifeDomain)->Unit){LifeSection("今日记录"){Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp)){RootStat("饮食",value.mealCount?.toString()?:"—","餐",{onWorkspace(LifeDomain.Meals)},Modifier.weight(1f));RootStat("资料",value.libraryCaptured?.toString()?:"—","份",{onWorkspace(LifeDomain.Library)},Modifier.weight(1f))}}}
@Composable private fun RootStat(title:String,value:String,suffix:String,onClick:()->Unit,modifier:Modifier){Surface(modifier.clickable(role=Role.Button,onClick=onClick),shape=RoundedCornerShape(19.dp),color=MaterialTheme.colorScheme.surfaceVariant.copy(alpha=.55f)){Column(Modifier.padding(15.dp)){Text(title,color=MaterialTheme.colorScheme.onSurfaceVariant);Text("$value $suffix",style=MaterialTheme.typography.titleLarge)}}}
@Composable private fun TodayScaleReceiver(status:DeviceSyncStatus,queue:LoadState<QueueSummary>,onStart:()->Unit,onSettings:()->Unit){
  val queueSummary=(queue as? LoadState.Ready)?.value
  val uploadState=queueSummary?.latestScaleState
  val currentUploadState=uploadState.takeIf{status.scaleState=="queued"}
  val active=status.scaleState in setOf("starting","scanning","detected","reading")
  val tone=todayScaleTone(status.scaleState,currentUploadState)
  val stateLabel=todayScaleStateLabel(status.scaleState,currentUploadState)
  val message=todayScaleMessage(status,currentUploadState)
  LifeSection("小米体脂秤"){
    Surface(Modifier.fillMaxWidth(),shape=RoundedCornerShape(24.dp),color=MaterialTheme.colorScheme.surface,border=androidx.compose.foundation.BorderStroke(1.dp,tone.copy(alpha=.48f))){
      Column(Modifier.padding(18.dp),verticalArrangement=Arrangement.spacedBy(14.dp)){
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
          Surface(Modifier.size(48.dp),shape=RoundedCornerShape(16.dp),color=tone.copy(alpha=.14f)){Box(contentAlignment=Alignment.Center){Text("体",style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.Bold,color=tone)}}
          Spacer(Modifier.width(12.dp))
          Column(Modifier.weight(1f)){Text("直接接收体脂秤数据",style=MaterialTheme.typography.titleLarge);Text("点击后再上秤，持续接收 3 分钟",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
          Surface(shape=RoundedCornerShape(99.dp),color=tone.copy(alpha=.14f)){Text(stateLabel,Modifier.padding(horizontal=10.dp,vertical=6.dp),style=MaterialTheme.typography.labelMedium,color=tone)}
        }
        if(status.scaleLastWeight!=null){
          Row(verticalAlignment=Alignment.Bottom){Text(status.scaleLastWeight,style=MaterialTheme.typography.displayMedium,fontWeight=FontWeight.SemiBold);Spacer(Modifier.width(6.dp));Text("kg",Modifier.padding(bottom=7.dp),style=MaterialTheme.typography.titleMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}
          Text(listOfNotNull(status.scaleLastModel,todayDeviceTime(status.scaleMeasuredAt)).joinToString(" · ").ifBlank{"最近一次稳定读数"},style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Text(message,color=tone,style=MaterialTheme.typography.bodyMedium)
        if(active)LinearProgressIndicator(Modifier.fillMaxWidth(),color=tone,trackColor=tone.copy(alpha=.14f))
        Button(onClick=onStart,enabled=!active,modifier=Modifier.fillMaxWidth().heightIn(min=52.dp)){
          Text(if(active)todayScaleActionLabel(status.scaleState) else if(status.scaleLastWeight==null)"开启数据接收" else "再测一次")
        }
        if(status.scaleState=="needs_config")TextButton(onClick=onSettings,modifier=Modifier.align(Alignment.End)){Text("打开体脂秤设置")}
        uploadState?.let{state->Text("${if(status.scaleState in setOf("queued","committed"))"本次" else "最近一次"}上传：${todayScaleQueueLabel(state)}",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
      }
    }
  }
}

@Composable private fun CompactTodaySync(status:DeviceSyncStatus,queue:LoadState<QueueSummary>,samsungAvailable:Boolean,onHealth:()->Unit,onSamsung:()->Unit,onSettings:()->Unit){val q=(queue as? LoadState.Ready)?.value;LifeSection("其他数据源",action={TextButton(onClick=onSettings){Text("管理")}}){LifeCard{Text(listOfNotNull(if(samsungAvailable)"Samsung ${status.samsungMessage}" else null,q?.takeIf{it.waiting>0||it.reconciling>0||it.failed>0}?.let{"${it.waiting} 待发送 · ${it.reconciling} 核对中 · ${it.failed} 失败"}).joinToString(" · ").ifBlank{"数据同步正常"},color=MaterialTheme.colorScheme.onSurfaceVariant);Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(7.dp)){if(samsungAvailable)AssistChip(onSamsung,{Text("同步三星")});AssistChip(onHealth,{Text("Health Connect")})}}}}

@Composable private fun todayScaleTone(state:String,uploadState:String?)=when{
  uploadState=="failed"||state in setOf("error","timeout","needs_permission","needs_config")->MaterialTheme.colorScheme.error
  uploadState=="committed"||state in setOf("queued","committed","complete")->MaterialTheme.colorScheme.primary
  state in setOf("starting","scanning","detected","reading")->MaterialTheme.colorScheme.secondary
  else->MaterialTheme.colorScheme.onSurfaceVariant
}
private fun todayScaleStateLabel(state:String,uploadState:String?)=when{
  state=="queued"&&uploadState=="committed"->"已同步"
  state=="queued"&&uploadState=="failed"->"上传失败"
  state=="queued"&&uploadState=="reconciling"->"核对中"
  state=="queued"&&uploadState=="pending"->"发送中"
  else->mapOf("idle" to "未开启","starting" to "正在启动","scanning" to "等待上秤","detected" to "已发现设备","reading" to "正在保存","queued" to "已接收","committed" to "已同步","complete" to "已同步","timeout" to "未收到","needs_permission" to "需授权","needs_config" to "需配置","error" to "接收失败")[state]?:state
}
private fun todayScaleMessage(status:DeviceSyncStatus,uploadState:String?)=when{
  status.scaleState=="queued"&&uploadState=="committed"->"稳定读数已接收，并已同步到 Life"
  status.scaleState=="queued"&&uploadState=="failed"->"稳定读数已接收，但上传失败，请在数据状态中重试"
  status.scaleState=="queued"&&uploadState=="reconciling"->"稳定读数已接收，正在核对服务器结果"
  status.scaleState=="queued"&&uploadState=="pending"->"稳定读数已接收，正在安全发送"
  else->status.scaleMessage
}
private fun todayScaleActionLabel(state:String)=when(state){"starting"->"正在启动…";"detected"->"已发现设备，等待稳定读数…";"reading"->"正在保存读数…";else->"正在等待上秤…"}
private fun todayScaleQueueLabel(state:String)=when(state){"pending"->"待发送";"sending"->"发送中";"reconciling"->"核对中";"committed"->"已完成";"failed"->"失败";"blocked"->"已阻止";else->state}
private fun todayDeviceTime(value:Long):String?=value.takeIf{it>0}?.let{Instant.ofEpochMilli(it).atZone(ZoneId.systemDefault()).format(DateTimeFormatter.ofPattern("M 月 d 日 HH:mm"))}

@Composable fun RecordsVisualScreen(state:LoadState<TimelinePage>,searchState:LoadState<RecordPage>?,onRetry:()->Unit,onLoadMore:()->Unit,onSearch:(String)->Unit,onLoadMoreSearch:()->Unit,onClearSearch:()->Unit,onDetail:(LifeDomain,String,String)->Unit,onQuickCapture:()->Unit,onProjects:()->Unit,onSettings:()->Unit){
  var query by rememberSaveable{mutableStateOf("")};var domain by rememberSaveable{mutableStateOf<String?>(null)};var period by rememberSaveable{mutableStateOf("all")}
  RootPage("记录",onProjects,onSettings){padding->LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(20.dp,8.dp,20.dp,112.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
    item{Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){OutlinedTextField(query,{query=it;if(it.isBlank())onClearSearch()},Modifier.weight(1f),singleLine=true,placeholder={Text("搜索记录、地点或资料")},leadingIcon={Icon(Icons.Default.Search,null)});FilledTonalIconButton(onClick={onSearch(query)},enabled=query.isNotBlank()){Icon(Icons.Default.Search,"搜索")};FilledIconButton(onClick=onQuickCapture){Icon(Icons.Default.Add,"打开快速记录")}}}
    item{RecordFilters(domain,{domain=it},period,{period=it})}
    if(searchState!=null){item{StateContent(searchState,{onSearch(query)}){} };if(searchState is LoadState.Ready){items(searchState.value.items,key={"search:${it.domain}:${it.id}"}){record->VisualRecordCard(record.domain,record.title,record.supporting,record.trailing){onDetail(record.domain,record.detailId?:record.id,record.title)}};if(searchState.value.nextCursor!=null)item{TextButton(onClick=onLoadMoreSearch,Modifier.fillMaxWidth()){Text("加载更多搜索结果")}}}}
    else{item{StateContent(state,onRetry){} };if(state is LoadState.Ready){val now=LocalDate.now();val filtered=state.value.items.filter{item->(domain==null||item.domain.name==domain)&&runCatching{val date=LocalDate.parse(item.happenedAt.take(10));period=="all"||(period=="today"&&date==now)||(period=="week"&&!date.isBefore(now.minusDays(6)))||(period=="month"&&date.month==now.month&&date.year==now.year)}.getOrDefault(period=="all")};val groups=filtered.groupBy{it.happenedAt.take(10)};if(filtered.isEmpty())item{EmptyState("当前筛选没有记录","清除筛选"){domain=null;period="all"}};groups.forEach{(date,rows)->item{Text(if(date==now.toString())"今天" else date,style=MaterialTheme.typography.titleLarge,modifier=Modifier.padding(top=8.dp))};items(rows,key={"${it.domain}:${it.id}"}){item->VisualRecordCard(item.domain,item.title,item.happenedAt.substringAfter('T').take(5),item.amount?.let{"${item.currency.orEmpty()} $it"}){onDetail(item.domain,item.recordId?:item.id,item.title)}}};if(state.value.nextCursor!=null)item{TextButton(onClick=onLoadMore,Modifier.fillMaxWidth()){Text("加载更早记录")}}}}
  }}
}

@Composable private fun RecordFilters(domain:String?,onDomain:(String?)->Unit,period:String,onPeriod:(String)->Unit){Column(verticalArrangement=Arrangement.spacedBy(8.dp)){Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(7.dp)){listOf(null to "全部",LifeDomain.Money.name to "消费",LifeDomain.Health.name to "健康",LifeDomain.Meals.name to "饮食",LifeDomain.Travel.name to "旅行",LifeDomain.Library.name to "资料").forEach{(key,label)->FilterChip(domain==key,{onDomain(key)},{Text(label)})}};Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(7.dp)){listOf("all" to "不限时间","today" to "今天","week" to "近 7 天","month" to "本月").forEach{(key,label)->FilterChip(period==key,{onPeriod(key)},{Text(label)})}}}}
@Composable private fun VisualRecordCard(domain:LifeDomain,title:String,supporting:String?,trailing:String?,onClick:()->Unit){val tone=rootDomainColor(domain);Surface(Modifier.fillMaxWidth().clickable(role=Role.Button,onClick=onClick),shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.surface,border=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outline.copy(alpha=.55f))){Row(Modifier.padding(15.dp),verticalAlignment=Alignment.CenterVertically){Surface(Modifier.size(43.dp),shape=RoundedCornerShape(14.dp),color=tone.copy(alpha=.13f)){Box(contentAlignment=Alignment.Center){Text(domainMark(domain),color=tone,fontWeight=FontWeight.Bold)}};Spacer(Modifier.width(12.dp));Column(Modifier.weight(1f)){Text(title,style=MaterialTheme.typography.titleMedium,maxLines=2,overflow=TextOverflow.Ellipsis);supporting?.let{Text(it,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}};trailing?.let{Text(it,style=MaterialTheme.typography.titleMedium)}}}}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun PlansVisualScreen(state:LoadState<PlanningWorkspace>,message:String?,onRetry:()->Unit,onProject:(PlanSummary)->Unit,onOwnedItem:(OwnedItemSummary)->Unit,onReview:(ReviewSummary)->Unit,onAgenda:(AgendaItem)->Unit,onAgendaAction:(AgendaItem,String)->Unit,onCapture:(CaptureKind)->Unit,onItems:()->Unit,onProjects:()->Unit,onSettings:()->Unit){
  var tab by rememberSaveable{mutableStateOf("today")}
  RootPage("计划",onProjects,onSettings){padding->
    LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(20.dp,8.dp,20.dp,112.dp),verticalArrangement=Arrangement.spacedBy(14.dp)){
      item{Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){Button(onClick={onCapture(CaptureKind.Project)},Modifier.weight(1f)){Icon(Icons.Default.Add,null);Spacer(Modifier.width(7.dp));Text("新建计划")};OutlinedButton(onClick=onItems){Text("物品与维护")}}}
      message?.let{item{Text(it,color=MaterialTheme.colorScheme.primary)}}
      item{StateContent(state,onRetry){} }
      if(state is LoadState.Ready)item{PlansReadyContent(state.value,tab,{tab=it},onProject,onOwnedItem,onReview,onAgenda,onAgendaAction)}
    }
  }
}
@Composable private fun PlansReadyContent(value:PlanningWorkspace,tab:String,onTab:(String)->Unit,onProject:(PlanSummary)->Unit,onOwnedItem:(OwnedItemSummary)->Unit,onReview:(ReviewSummary)->Unit,onAgenda:(AgendaItem)->Unit,onAgendaAction:(AgendaItem,String)->Unit){Column(verticalArrangement=Arrangement.spacedBy(14.dp)){PlanningOverview(value);PlanningTabs(tab,onTab);when(tab){"today","week"->{AgendaCalendar(value.agenda);val shown=value.agenda.filter{tab=="week"||it.dueOn==LocalDate.now().toString()};if(shown.isEmpty())EmptyState(if(tab=="today")"今天没有安排" else "未来七天没有安排") else shown.forEach{AgendaVisualCard(it,onAgenda,onAgendaAction)}};"projects"->if(value.projects.isEmpty())EmptyState("还没有生活计划") else value.projects.forEach{plan->PlanVisualCard(plan){onProject(plan)}};"items"->if(value.ownedItems.isEmpty())EmptyState("还没有物品") else value.ownedItems.forEach{owned->OwnedVisualCard(owned){onOwnedItem(owned)}};else->if(value.reviews.isEmpty())EmptyState("还没有周月回顾") else value.reviews.forEach{review->LifeCard(onClick={onReview(review)}){Text("${review.fromOn} — ${review.toOn}",style=MaterialTheme.typography.titleLarge);Text("${review.metrics} 组指标 · ${review.evidence.size} 项可追溯证据",color=MaterialTheme.colorScheme.onSurfaceVariant)}}}}}
@Composable private fun PlanningOverview(value:PlanningWorkspace){Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(9.dp)){RootPlanStat("今天",value.agenda.count{it.dueOn==LocalDate.now().toString()}.toString(),Modifier.weight(1f));RootPlanStat("项目",value.projects.count{it.state=="active"}.toString(),Modifier.weight(1f));RootPlanStat("物品",value.ownedItems.size.toString(),Modifier.weight(1f));RootPlanStat("回顾",value.reviews.size.toString(),Modifier.weight(1f))}}
@Composable private fun RootPlanStat(label:String,value:String,modifier:Modifier){Surface(modifier,shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.surfaceVariant.copy(alpha=.52f)){Column(Modifier.padding(12.dp),horizontalAlignment=Alignment.CenterHorizontally){Text(value,style=MaterialTheme.typography.titleLarge);Text(label,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}
@Composable private fun PlanningTabs(tab:String,onSelect:(String)->Unit){Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(7.dp)){listOf("today" to "今天","week" to "本周","projects" to "项目","items" to "物品","reviews" to "回顾").forEach{(key,label)->FilterChip(tab==key,{onSelect(key)},{Text(label)})}}}
@Composable private fun AgendaCalendar(items:List<AgendaItem>){Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){repeat(7){offset->val date=LocalDate.now().plusDays(offset.toLong());val count=items.count{it.dueOn==date.toString()};Surface(shape=RoundedCornerShape(16.dp),color=if(offset==0)MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface){Column(Modifier.width(42.dp).padding(vertical=9.dp),horizontalAlignment=Alignment.CenterHorizontally){Text(date.dayOfWeek.getDisplayName(java.time.format.TextStyle.SHORT,Locale.CHINA),style=MaterialTheme.typography.labelSmall);Text(date.dayOfMonth.toString(),style=MaterialTheme.typography.titleMedium);if(count>0)Box(Modifier.size(5.dp).background(MaterialTheme.colorScheme.primary,RoundedCornerShape(99.dp)))}}}}}
@Composable private fun AgendaVisualCard(item:AgendaItem,onOpen:(AgendaItem)->Unit,onAction:(AgendaItem,String)->Unit){LifeCard(onClick={onOpen(item)}){Row(Modifier.fillMaxWidth()){Column(Modifier.weight(1f)){Text(item.title,style=MaterialTheme.typography.titleLarge);Text("${planKind(item.sourceKind)} · ${item.dueOn}",color=MaterialTheme.colorScheme.onSurfaceVariant)};RootStatus(item.state)};if(item.primaryAction!=null&&item.state in setOf("open","pending","reminded","snoozed"))Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.End){TextButton(onClick={onAction(item,"complete")}){Text("完成")};if(item.sourceKind=="recurring_occurrence")TextButton(onClick={onAction(item,"snooze")}){Text("稍后")}}}}
@Composable private fun PlanVisualCard(value:PlanSummary,onClick:()->Unit){LifeCard(onClick=onClick){Row(Modifier.fillMaxWidth()){Column(Modifier.weight(1f)){Text(value.title,style=MaterialTheme.typography.titleLarge);Text(value.goal?:"未填写目标说明",color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=2)};RootStatus(value.state)};val done=value.actionItems.count{it.state in setOf("completed","handled")};LinearProgressIndicator({if(value.actions>0)done.toFloat()/value.actions else 0f},Modifier.fillMaxWidth().height(7.dp),trackColor=MaterialTheme.colorScheme.surfaceVariant);Text("$done / ${value.actions} 项行动${value.dueOn?.let{" · 截止 $it"}.orEmpty()}",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
@Composable private fun OwnedVisualCard(value:OwnedItemSummary,onClick:()->Unit){LifeCard(onClick=onClick){Row(Modifier.fillMaxWidth()){Column(Modifier.weight(1f)){Text(value.name,style=MaterialTheme.typography.titleMedium);Text(listOfNotNull(value.location,value.warrantyEndsOn?.let{"保修至 $it"},value.returnBy?.let{"退货至 $it"}).joinToString(" · ").ifBlank{"${value.documents} 份资料 · ${value.events} 条事件"},color=MaterialTheme.colorScheme.onSurfaceVariant)};RootStatus(value.state)}}}

@Composable fun LibraryVisualScreen(state:LoadState<LibraryPage>,onSearch:(String)->Unit,onLoadMore:()->Unit,onDetail:(LifeDomain,String,String)->Unit,onCapture:(CaptureKind)->Unit,onProjects:()->Unit,onSettings:()->Unit){var query by rememberSaveable{mutableStateOf("")};var type by rememberSaveable{mutableStateOf<String?>(null)};RootPage("资料",onProjects,onSettings){padding->LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(20.dp,8.dp,20.dp,112.dp),verticalArrangement=Arrangement.spacedBy(16.dp)){item{Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){OutlinedTextField(query,{query=it;if(it.isBlank())onSearch("")},Modifier.weight(1f),singleLine=true,placeholder={Text("搜索标题、正文或标签")},leadingIcon={Icon(Icons.Default.Search,null)});FilledTonalIconButton(onClick={onSearch(query)}){Icon(Icons.Default.Search,"搜索")};FilledIconButton(onClick={onCapture(CaptureKind.Library)}){Icon(Icons.Default.Add,"收资料")}}};item{LibraryCategories(type,{type=it})};item{StateContent(state,{onSearch(query)}){} };if(state is LoadState.Ready){val shown=state.value.items.filter{type==null||libraryGroup(it.itemType)==type};item{Text("最近内容",style=MaterialTheme.typography.titleLarge)};if(shown.isEmpty())item{EmptyState("当前分类没有资料","清除分类"){type=null}} else items(shown,key={it.id}){item->LibraryVisualCard(item){onDetail(LifeDomain.Library,item.id,item.title)}};if(state.value.nextCursor!=null)item{TextButton(onClick=onLoadMore,Modifier.fillMaxWidth()){Text("加载更多资料")}}}}}}
@Composable private fun LibraryCategories(selected:String?,onSelect:(String?)->Unit){LifeSection("分类"){Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){listOf(null to "全部","image" to "图片","document" to "文件","link" to "链接","note" to "笔记","ticket" to "票券").forEach{(key,label)->FilterChip(selected==key,{onSelect(key)},{Text(label)})}}}}
@Composable private fun LibraryVisualCard(value:LibrarySummary,onClick:()->Unit){LifeCard(onClick=onClick){Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Surface(Modifier.size(54.dp),shape=RoundedCornerShape(17.dp),color=MaterialTheme.colorScheme.secondary.copy(alpha=.12f)){Box(contentAlignment=Alignment.Center){Text(libraryMark(value.itemType),style=MaterialTheme.typography.titleLarge,color=MaterialTheme.colorScheme.secondary)}};Spacer(Modifier.width(13.dp));Column(Modifier.weight(1f)){Text(value.title,style=MaterialTheme.typography.titleMedium,maxLines=2,overflow=TextOverflow.Ellipsis);Text("${libraryTypeLabel(value.itemType)} · ${value.state?.let(::rootStateLabel)?:"已收存"}",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}}

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun ItemsWorkspaceScreen(state:LoadState<PlanningWorkspace>,onRetry:()->Unit,onBack:()->Unit,onDetail:(OwnedItemSummary)->Unit,onCapture:(CaptureKind)->Unit){var filter by rememberSaveable{mutableStateOf("all")};Scaffold(containerColor=MaterialTheme.colorScheme.background,topBar={TopAppBar(title={Column{Text("物品");Text("拥有、使用、维护与补给",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}},navigationIcon={IconButton(onClick=onBack){Text("‹",style=MaterialTheme.typography.headlineLarge)}},actions={FilledTonalIconButton(onClick={onCapture(CaptureKind.OwnedItem)}){Icon(Icons.Default.Add,"添加物品")}})}){padding->LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(14.dp)){item{StateContent(state,onRetry){} };if(state is LoadState.Ready){val all=state.value.ownedItems;item{Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(9.dp)){RootPlanStat("物品",all.size.toString(),Modifier.weight(1f));RootPlanStat("有保修",all.count{it.warrantyEndsOn!=null}.toString(),Modifier.weight(1f));RootPlanStat("有事件",all.count{it.events>0}.toString(),Modifier.weight(1f))}};item{Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(7.dp)){listOf("all" to "全部","owned" to "持有中","attention" to "待处理").forEach{(key,label)->FilterChip(filter==key,{filter=key},{Text(label)})}}};val shown=all.filter{filter=="all"||(filter=="owned"&&it.state=="owned")||(filter=="attention"&&(it.returnBy!=null||it.warrantyEndsOn!=null||it.events>0))};if(shown.isEmpty())item{EmptyState("当前分类没有物品","添加物品"){onCapture(CaptureKind.OwnedItem)}} else items(shown,key={it.id}){item->OwnedVisualCard(item){onDetail(item)}}}}}}

@Composable private fun RootStatus(value:String){Surface(shape=RoundedCornerShape(99.dp),color=MaterialTheme.colorScheme.primaryContainer){Text(rootStateLabel(value),Modifier.padding(horizontal=9.dp,vertical=5.dp),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onPrimaryContainer)}}
private fun rootStateLabel(value:String)=mapOf("active" to "进行中","planned" to "计划中","open" to "待完成","pending" to "待处理","reminded" to "已提醒","snoozed" to "已延后","completed" to "已完成","handled" to "已处理","owned" to "持有中","consumed" to "已用完","retired" to "已停用","archived" to "已归档","ready" to "可用")[value]?:value
private fun planKind(value:String)=mapOf("project_action" to "项目任务","recurring_occurrence" to "周期事项","health_habit" to "健康习惯")[value]?:value
private fun domainMark(value:LifeDomain)=when(value){LifeDomain.Health->"健";LifeDomain.Meals->"食";LifeDomain.Money->"¥";LifeDomain.Travel->"行";LifeDomain.Library->"资"}
@Composable private fun rootDomainColor(value:LifeDomain)=when(value){LifeDomain.Health->MaterialTheme.colorScheme.primary;LifeDomain.Meals->MaterialTheme.colorScheme.tertiary;LifeDomain.Money->MaterialTheme.colorScheme.secondary;LifeDomain.Travel->LifeColors.WarmDark;LifeDomain.Library->LifeColors.InformationDark}
private fun libraryGroup(value:String)=when{value.contains("image")||value.contains("photo")||value.contains("screenshot")->"image";value.contains("link")||value.contains("url")||value=="web"->"link";value.contains("ticket")||value.contains("booking")||value.contains("receipt")->"ticket";value.contains("note")||value.contains("text")->"note";else->"document"}
private fun libraryTypeLabel(value:String)=mapOf("image" to "图片","photo" to "照片","screenshot" to "截图","link" to "链接","note" to "笔记","ticket" to "票券","receipt" to "凭证","document" to "文件","file" to "文件")[libraryGroup(value)]?:value
private fun libraryMark(value:String)=when(libraryGroup(value)){"image"->"▧";"link"->"↗";"note"->"✎";"ticket"->"券";else->"文"}
private fun rootMinutes(value:Long)="${value/60} 小时 ${value%60} 分"
