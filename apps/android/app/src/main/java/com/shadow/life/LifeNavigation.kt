package com.shadow.life

import android.content.ActivityNotFoundException
import android.content.Intent
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.ArrowForward
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.navigation.NavDestination.Companion.hasRoute
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute

private data class DockItem(val label:String,val route:Any,val icon:ImageVector)

@Composable fun LifeApp(session:ProductSession?,viewModel:NativeLifeViewModel,appearance:Appearance,statusMessage:String?,pendingShare:SharePayload?,notificationAuthorization:String?,openInboxNonce:Long,onAcceptShare:(SharePayload)->Unit,onDiscardShare:()->Unit,onDismissStatus:()->Unit,onAppearance:(Appearance)->Unit,onLogin:()->Unit,onLogout:()->Unit,onHealthSync:()->Unit,onNotificationPermission:()->Unit){
  val nav=rememberNavController();var composerOpen by rememberSaveable{mutableStateOf(false)}
  LaunchedEffect(session?.accountId){if(session==null)viewModel.deactivateAccount() else viewModel.activateAccount(session.accountId)}
  LaunchedEffect(session?.accountId,notificationAuthorization){if(session!=null&&notificationAuthorization!=null)viewModel.registerNotificationDevice(notificationAuthorization)}
  LaunchedEffect(session?.accountId,openInboxNonce){if(session!=null&&openInboxNonce>0){viewModel.refreshInbox();nav.navigate(InboxRoute){launchSingleTop=true}}}
  if(session==null){SignInScreen(statusMessage,onLogin);return}
  val entry by nav.currentBackStackEntryAsState();val destination=entry?.destination
  val root=destination?.hasRoute<TodayRoute>()==true||destination?.hasRoute<RecordsRoute>()==true||destination?.hasRoute<PlansRoute>()==true||destination?.hasRoute<LibraryRoute>()==true
  Scaffold(containerColor=MaterialTheme.colorScheme.background,bottomBar={if(root)LifeDock(
    selected=when{destination?.hasRoute<RecordsRoute>()==true->"记录";destination?.hasRoute<PlansRoute>()==true->"计划";destination?.hasRoute<LibraryRoute>()==true->"资料库";else->"今日"},
    onRoute={route->nav.navigate(route){popUpTo(nav.graph.findStartDestination().id){saveState=true};launchSingleTop=true;restoreState=true}},onLife={composerOpen=true})
  }){outer->Box(Modifier.fillMaxSize().padding(bottom=if(root)outer.calculateBottomPadding() else 0.dp)){
    NavHost(navController=nav,startDestination=TodayRoute){
      composable<TodayRoute>{TodayScreen(viewModel.today,viewModel::refreshToday,{domain->viewModel.loadWorkspace(domain);nav.navigate(WorkspaceRoute(domain.name))},{domain,id,title->viewModel.loadDetail(domain,id);nav.navigate(DetailRoute(domain.name,id,title))},{nav.navigate(RecordsRoute)},{nav.navigate(ConnectionsRoute)},{nav.navigate(SettingsRoute)})}
      composable<RecordsRoute>{RecordsScreen(viewModel.timeline,viewModel.searchResults,viewModel::refreshTimeline,viewModel::loadMoreTimeline,viewModel::search,viewModel::loadMoreSearch,viewModel::clearSearch,{domain->viewModel.loadWorkspace(domain);nav.navigate(WorkspaceRoute(domain.name))},{domain,id,title->viewModel.loadDetail(domain,id);nav.navigate(DetailRoute(domain.name,id,title))},{nav.navigate(ConnectionsRoute)},{nav.navigate(SettingsRoute)})}
      composable<PlansRoute>{PlansScreen(viewModel.plans,viewModel::refreshPlans,{plan->nav.navigate(PlanDetailRoute(plan.id))},{agenda->when(agenda.targetKind){"project"->nav.navigate(PlanDetailRoute(agenda.targetId));"money_occurrence"->{viewModel.loadWorkspace(LifeDomain.Money);nav.navigate(WorkspaceRoute(LifeDomain.Money.name))};"health_habit"->{viewModel.loadWorkspace(LifeDomain.Health);nav.navigate(WorkspaceRoute(LifeDomain.Health.name))}}},{nav.navigate(ConnectionsRoute)},{nav.navigate(SettingsRoute)})}
      composable<LibraryRoute>{LibraryScreen(viewModel.library,viewModel::refreshLibrary,{domain,id,title->viewModel.loadDetail(domain,id);nav.navigate(DetailRoute(domain.name,id,title))},{nav.navigate(ConnectionsRoute)},{nav.navigate(SettingsRoute)})}
      composable<WorkspaceRoute>{backStack->val route=backStack.toRoute<WorkspaceRoute>();val domain=LifeDomain.valueOf(route.domain);LaunchedEffect(domain){if(viewModel.workspaceDomain!=domain)viewModel.loadWorkspace(domain)};WorkspaceScreen(domain,viewModel.workspaceOverview,viewModel.workspace,{viewModel.loadWorkspace(domain,it)},{viewModel.loadWorkspace(domain)},viewModel::loadMoreWorkspace,{nav.popBackStack()},{d,id,title->viewModel.loadDetail(d,id);nav.navigate(DetailRoute(d.name,id,title))})}
      composable<DetailRoute>{backStack->val route=backStack.toRoute<DetailRoute>();val domain=LifeDomain.valueOf(route.domain);LaunchedEffect(route.id){viewModel.loadDetail(domain,route.id)};DetailScreen(route.title,viewModel.detail,viewModel.submit,{viewModel.loadDetail(domain,route.id)},{nav.popBackStack()},viewModel::correct,viewModel::editAgain)}
      composable<PlanDetailRoute>{backStack->val route=backStack.toRoute<PlanDetailRoute>();val plan=(viewModel.plans as? LoadState.Ready)?.value?.projects?.firstOrNull{it.id==route.id};PlanDetailScreen(plan,{nav.popBackStack()})}
      composable<SettingsRoute>{SettingsScreen(session,appearance,viewModel.queueStatus,onAppearance,onHealthSync,viewModel::retryQueue,viewModel::clearTerminalQueue,onLogout,{nav.popBackStack()},{nav.navigate(ConnectionsRoute)},{viewModel.refreshInbox();nav.navigate(InboxRoute)})}
      composable<ConnectionsRoute>{ProjectDirectoryScreen(viewModel.projectLinks,viewModel::refreshProjectLinks){nav.popBackStack()}}
      composable<InboxRoute>{InboxScreen(viewModel.inbox,viewModel::refreshInbox,viewModel::updateNotification,viewModel::setNotificationPreferences,onNotificationPermission){nav.popBackStack()}}
    }
  }}
  statusMessage?.let{message->AlertDialog(onDismissRequest=onDismissStatus,confirmButton={TextButton(onClick=onDismissStatus){Text("知道了")}},text={Text(message)})}
  if(pendingShare!=null)ShareIngressDialog(pendingShare,viewModel.shareImport,{onAcceptShare(pendingShare)},onDiscardShare)
  LifeComposerHost(composerOpen,viewModel.submit,viewModel.assistant,{composerOpen=false;viewModel.editAgain();viewModel.clearAssistant()},{viewModel.submit(it)},viewModel::askLife,viewModel::editAgain)
}

@Composable private fun ShareIngressDialog(payload:SharePayload,state:LoadState<Int>?,onAccept:()->Unit,onDiscard:()->Unit){AlertDialog(onDismissRequest={},title={Text("收存到资料库")},text={Column(verticalArrangement=Arrangement.spacedBy(8.dp)){Text("这份分享将归属当前登录账号。") ;payload.text?.let{Text(it.take(180),maxLines=4,color=MaterialTheme.colorScheme.onSurfaceVariant)};if(payload.uris.isNotEmpty())Text("${payload.uris.size} 个附件会复制到加密队列");if(state is LoadState.Failed)Text(state.message,color=MaterialTheme.colorScheme.error)}},dismissButton={TextButton(onClick=onDiscard,enabled=state !is LoadState.Loading){Text("放弃")}},confirmButton={Button(onClick=onAccept,enabled=state !is LoadState.Loading){Text(if(state is LoadState.Loading)"正在收存…" else "确认收存")}})}

@Composable private fun LifeDock(selected:String,onRoute:(Any)->Unit,onLife:()->Unit){
  val items=listOf(DockItem("今日",TodayRoute,Icons.Default.Home),DockItem("记录",RecordsRoute,Icons.AutoMirrored.Filled.List),DockItem("计划",PlansRoute,Icons.Default.DateRange),DockItem("资料库",LibraryRoute,Icons.Default.Menu))
  Surface(tonalElevation=8.dp,shape=RoundedCornerShape(topStart=24.dp,topEnd=24.dp),color=MaterialTheme.colorScheme.surface){NavigationBar(containerColor=MaterialTheme.colorScheme.surface,modifier=Modifier.navigationBarsPadding().heightIn(min=76.dp)){
    items.take(2).forEach{item->NavigationBarItem(selected=selected==item.label,onClick={onRoute(item.route)},icon={Icon(item.icon,item.label)},label={Text(item.label)})}
    NavigationBarItem(selected=false,onClick=onLife,icon={Surface(shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.primary,modifier=Modifier.size(50.dp)){Box(contentAlignment=Alignment.Center){Icon(Icons.Default.Add,"打开 Life，记录或提问",tint=MaterialTheme.colorScheme.onPrimary)}}},label={Text("Life")})
    items.drop(2).forEach{item->NavigationBarItem(selected=selected==item.label,onClick={onRoute(item.route)},icon={Icon(item.icon,item.label)},label={Text(item.label)})}
  }}
}

@Composable private fun SignInScreen(message:String?,onLogin:()->Unit){Box(Modifier.fillMaxSize().padding(28.dp),contentAlignment=Alignment.Center){Column(horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(18.dp)){Surface(Modifier.size(72.dp),shape=RoundedCornerShape(24.dp),color=MaterialTheme.colorScheme.primaryContainer){Box(contentAlignment=Alignment.Center){Icon(Icons.Default.Add,null,Modifier.size(34.dp),tint=MaterialTheme.colorScheme.primary)}};Text("Shadow Life",style=MaterialTheme.typography.headlineLarge);Text("你的生活事实、计划与资料，在一个原生空间里。",color=MaterialTheme.colorScheme.onSurfaceVariant);message?.let{Text(it,color=MaterialTheme.colorScheme.error)};Button(onClick=onLogin,Modifier.fillMaxWidth().heightIn(min=56.dp)){Text("使用 Shadow 账号继续")}}}}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsScreen(
  session:ProductSession,
  appearance:Appearance,
  queueState:LoadState<QueueSummary>,
  onAppearance:(Appearance)->Unit,
  onHealthSync:()->Unit,
  onRetryQueue:()->Unit,
  onClearQueue:()->Unit,
  onLogout:()->Unit,
  onBack:()->Unit,
  onProjects:()->Unit,
  onInbox:()->Unit
){
  var confirmClear by remember{mutableStateOf(false)}
  Scaffold(
    topBar={TopAppBar(title={Text("设置")},navigationIcon={IconButton(onClick=onBack){Text("‹",style=MaterialTheme.typography.headlineLarge)}})}
  ){padding->
    Column(
      Modifier.fillMaxSize().padding(padding).padding(20.dp).verticalScroll(androidx.compose.foundation.rememberScrollState()),
      verticalArrangement=Arrangement.spacedBy(20.dp)
    ){
      LifeSection("账号"){
        LifeCard{
          Text(session.displayName?:session.subjectId,style=MaterialTheme.typography.titleMedium)
          Text("Shadow Identity",color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      LifeSection("外观"){
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()){
          Appearance.entries.forEachIndexed{index,value->
            SegmentedButton(
              selected=appearance==value,
              onClick={onAppearance(value)},
              shape=SegmentedButtonDefaults.itemShape(index,Appearance.entries.size)
            ){
              Text(when(value){Appearance.Dark->"深色";Appearance.Light->"日间";Appearance.System->"系统"})
            }
          }
        }
      }
      LifeSection("同步与离线队列"){
        when(queueState){
          LoadState.Loading->CircularProgressIndicator()
          is LoadState.Failed->SectionError(queueState.message,onRetryQueue)
          is LoadState.Empty->Text(queueState.reason)
          is LoadState.Ready->{
            val value=queueState.value
            LifeCard{
              Text("${value.waiting} 项待发送 · ${value.reconciling} 项核对中",style=MaterialTheme.typography.titleMedium)
              Text(
                "${value.attachments} 个加密附件 · ${value.failed} 项需处理",
                color=if(value.failed>0)MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant
              )
              Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                TextButton(onClick=onRetryQueue,enabled=value.failed+value.reconciling>0){Text("重试")}
                TextButton(onClick={confirmClear=true},enabled=value.terminal>0){Text("清理终态")}
              }
            }
          }
        }
      }
      LifeSection("连接"){
        OutlinedButton(onClick=onInbox,Modifier.fillMaxWidth().heightIn(min=52.dp)){Text("提醒与收件箱")}
        OutlinedButton(onClick=onHealthSync,Modifier.fillMaxWidth().heightIn(min=52.dp)){Text("同步 Health Connect")}
        OutlinedButton(onClick=onProjects,Modifier.fillMaxWidth().heightIn(min=52.dp)){Text("其他项目与连接")}
      }
      Text("退出后待上传内容仍按当前账号加密保留。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
      TextButton(onClick=onLogout,Modifier.fillMaxWidth()){Text("退出 Life",color=MaterialTheme.colorScheme.error)}
    }
  }
  if(confirmClear){
    AlertDialog(
      onDismissRequest={confirmClear=false},
      title={Text("清理已结束项目？")},
      text={Text("将删除已提交、失败或被阻止的本地队列记录和对应终态附件；待发送与核对中的内容不会删除。")},
      dismissButton={TextButton(onClick={confirmClear=false}){Text("取消")}},
      confirmButton={TextButton(onClick={confirmClear=false;onClearQueue()}){Text("确认清理",color=MaterialTheme.colorScheme.error)}}
    )
  }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun InboxScreen(state:LoadState<InboxSnapshot>,onRetry:()->Unit,onUpdate:(String,String)->Unit,onPreferences:(Boolean)->Unit,onPermission:()->Unit,onBack:()->Unit){
  Scaffold(topBar={TopAppBar(title={Text("提醒与收件箱")},navigationIcon={IconButton(onClick=onBack){Text("‹",style=MaterialTheme.typography.headlineLarge)}})}){padding->
    LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
      item{when(state){is LoadState.Ready->{val preferences=state.value.preferences;LifeCard{Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Column(Modifier.weight(1f)){Text("生活提醒",style=MaterialTheme.typography.titleLarge);Text(if(preferences.enabled)"已启用 · ${preferences.timeZone}" else "已关闭；事项仍保留在收件箱",color=MaterialTheme.colorScheme.onSurfaceVariant)};Switch(preferences.enabled,{enabled->onPreferences(enabled);if(enabled)onPermission()})};preferences.quietStart?.let{Text("静默时段 $it — ${preferences.quietEnd}",style=MaterialTheme.typography.bodySmall)};if(preferences.enabled)TextButton(onClick=onPermission){Text("检查系统通知权限")}}};else->Unit}}
      item{StateContent(state,onRetry){}}
      if(state is LoadState.Ready){
        items(state.value.items,key={it.id}){item->LifeCard{Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Column(Modifier.weight(1f)){Text(item.title,style=MaterialTheme.typography.titleMedium,fontWeight=if(item.readState=="unread")androidx.compose.ui.text.font.FontWeight.SemiBold else androidx.compose.ui.text.font.FontWeight.Normal);Text(item.body,color=MaterialTheme.colorScheme.onSurfaceVariant);Text(notificationStateLabel(item),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};if(item.readState=="unread")TextButton(onClick={onUpdate(item.id,"mark_read")}){Text("已读")}};Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){TextButton(onClick={onUpdate(item.id,"snooze")},enabled=item.state!="snoozed"){Text("稍后 1 小时")};TextButton(onClick={onUpdate(item.id,"dismiss")}){Text("关闭")}}}
        }
      }
    }
  }
}

private fun notificationStateLabel(item:NotificationItem)=when(item.deliveryState){"ready"->"现在可处理";"scheduled"->"计划于 ${item.scheduledAt}";"quiet"->"静默时段后提醒";"disabled"->"仅保留在收件箱";"snoozed"->"已稍后提醒";else->item.deliveryState}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun ProjectDirectoryScreen(state:LoadState<List<ProjectLinkItem>>,onRetry:()->Unit,onBack:()->Unit){val context=LocalContext.current;var launchError by remember{mutableStateOf<String?>(null)};LaunchedEffect(Unit){onRetry()};Scaffold(topBar={TopAppBar(title={Text("其他项目")},navigationIcon={IconButton(onClick=onBack){Text("‹",style=MaterialTheme.typography.headlineLarge)}})}){padding->Column(Modifier.fillMaxSize().padding(padding).padding(20.dp),verticalArrangement=Arrangement.spacedBy(14.dp)){Text("目录只负责到达独立项目；各项目自行登录和授权。Life 不会把会话令牌放进链接。",color=MaterialTheme.colorScheme.onSurfaceVariant);launchError?.let{Text(it,color=MaterialTheme.colorScheme.error)};when(state){LoadState.Loading->CircularProgressIndicator();is LoadState.Empty->Text(state.reason,color=MaterialTheme.colorScheme.onSurfaceVariant);is LoadState.Failed->LifeCard{Text(state.message,color=MaterialTheme.colorScheme.error);TextButton(onClick=onRetry){Text("重试")}};is LoadState.Ready->state.value.forEach{item->ProjectLink(item){launchError=if(launchProject(context,item))null else "没有可用的应用或浏览器，请检查配置后重试。"}}}}}}

@Composable private fun ProjectLink(item:ProjectLinkItem,onOpen:()->Unit){val configured=item.state=="configured"&&projectUrl(item)!=null;LifeCard(onClick=if(configured)onOpen else null){Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(14.dp)){Icon(when(item.icon){"chart-line"->Icons.Default.Search;"notebook-pen"->Icons.AutoMirrored.Filled.List;else->Icons.Default.Menu},null);Column(Modifier.weight(1f)){Text(item.title,style=MaterialTheme.typography.titleLarge);Text(item.subtitle,color=MaterialTheme.colorScheme.onSurfaceVariant);Text(when(item.state){"configured"->authHint(item.authHint);"disabled"->"维护中";else->"入口待配置"},color=if(configured)MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)};if(configured)Icon(Icons.AutoMirrored.Filled.ArrowForward,"外部打开")}}}

private fun authHint(value:String)=when(value){"shadow_identity"->"使用 Shadow Identity 登录";"public"->"公开项目";else->"由项目独立登录"}
private fun projectUrl(item:ProjectLinkItem):String?=(if(item.launchMode=="app_link")item.appLinkUrl?:item.webFallbackUrl else item.appLinkUrl)?.takeIf{runCatching{Uri.parse(it).scheme=="https"}.getOrDefault(false)}
private fun launchProject(context:android.content.Context,item:ProjectLinkItem):Boolean{val appLink=item.appLinkUrl?.takeIf{Uri.parse(it).scheme=="https"};if(item.launchMode=="app_link"&&appLink!=null&&item.androidPackage!=null){try{context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(appLink)).setPackage(item.androidPackage));return true}catch(_:ActivityNotFoundException){}};val fallback=item.webFallbackUrl?:appLink?:return false;return runCatching{CustomTabsIntent.Builder().build().launchUrl(context,Uri.parse(fallback));true}.getOrElse{runCatching{context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(fallback)));true}.getOrDefault(false)}}
