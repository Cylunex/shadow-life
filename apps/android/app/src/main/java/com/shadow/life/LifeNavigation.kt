package com.shadow.life

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
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

@Composable fun LifeApp(session:ProductSession?,viewModel:NativeLifeViewModel,appearance:Appearance,statusMessage:String?,onDismissStatus:()->Unit,onAppearance:(Appearance)->Unit,onLogin:()->Unit,onLogout:()->Unit,onHealthSync:()->Unit){
  val nav=rememberNavController();var composerOpen by rememberSaveable{mutableStateOf(false)}
  LaunchedEffect(session?.accountId){if(session==null)viewModel.deactivateAccount() else viewModel.activateAccount(session.accountId)}
  if(session==null){SignInScreen(statusMessage,onLogin);return}
  val entry by nav.currentBackStackEntryAsState();val destination=entry?.destination
  val root=destination?.hasRoute<TodayRoute>()==true||destination?.hasRoute<RecordsRoute>()==true||destination?.hasRoute<PlansRoute>()==true||destination?.hasRoute<LibraryRoute>()==true
  Scaffold(containerColor=MaterialTheme.colorScheme.background,bottomBar={if(root)LifeDock(
    selected=when{destination?.hasRoute<RecordsRoute>()==true->"记录";destination?.hasRoute<PlansRoute>()==true->"计划";destination?.hasRoute<LibraryRoute>()==true->"资料库";else->"今日"},
    onRoute={route->nav.navigate(route){popUpTo(nav.graph.findStartDestination().id){saveState=true};launchSingleTop=true;restoreState=true}},onLife={composerOpen=true})
  }){outer->Box(Modifier.fillMaxSize().padding(bottom=if(root)outer.calculateBottomPadding() else 0.dp)){
    NavHost(navController=nav,startDestination=TodayRoute){
      composable<TodayRoute>{TodayScreen(viewModel.today,viewModel::refreshToday,{domain->viewModel.loadWorkspace(domain);nav.navigate(WorkspaceRoute(domain.name))},{domain,id,title->viewModel.loadDetail(domain,id);nav.navigate(DetailRoute(domain.name,id,title))},{nav.navigate(ConnectionsRoute)},{nav.navigate(SettingsRoute)})}
      composable<RecordsRoute>{RecordsScreen(viewModel.timeline,viewModel.searchResults,viewModel::refreshTimeline,viewModel::loadMoreTimeline,viewModel::search,viewModel::loadMoreSearch,viewModel::clearSearch,{domain->viewModel.loadWorkspace(domain);nav.navigate(WorkspaceRoute(domain.name))},{domain,id,title->viewModel.loadDetail(domain,id);nav.navigate(DetailRoute(domain.name,id,title))},{nav.navigate(ConnectionsRoute)},{nav.navigate(SettingsRoute)})}
      composable<PlansRoute>{PlansScreen(viewModel.plans,viewModel::refreshPlans,{plan->nav.navigate(PlanDetailRoute(plan.id))},{nav.navigate(ConnectionsRoute)},{nav.navigate(SettingsRoute)})}
      composable<LibraryRoute>{LibraryScreen(viewModel.library,viewModel::refreshLibrary,{domain,id,title->viewModel.loadDetail(domain,id);nav.navigate(DetailRoute(domain.name,id,title))},{nav.navigate(ConnectionsRoute)},{nav.navigate(SettingsRoute)})}
      composable<WorkspaceRoute>{backStack->val route=backStack.toRoute<WorkspaceRoute>();val domain=LifeDomain.valueOf(route.domain);LaunchedEffect(domain){if(viewModel.workspaceDomain!=domain)viewModel.loadWorkspace(domain)};WorkspaceScreen(domain,viewModel.workspace,{viewModel.loadWorkspace(domain,it)},{viewModel.loadWorkspace(domain)},viewModel::loadMoreWorkspace,{nav.popBackStack()},{d,id,title->viewModel.loadDetail(d,id);nav.navigate(DetailRoute(d.name,id,title))})}
      composable<DetailRoute>{backStack->val route=backStack.toRoute<DetailRoute>();val domain=LifeDomain.valueOf(route.domain);LaunchedEffect(route.id){viewModel.loadDetail(domain,route.id)};DetailScreen(route.title,viewModel.detail,viewModel.submit,{viewModel.loadDetail(domain,route.id)},{nav.popBackStack()},viewModel::correct,viewModel::editAgain)}
      composable<PlanDetailRoute>{backStack->val route=backStack.toRoute<PlanDetailRoute>();val plan=(viewModel.plans as? LoadState.Ready)?.value?.firstOrNull{it.id==route.id};PlanDetailScreen(plan,{nav.popBackStack()})}
      composable<SettingsRoute>{SettingsScreen(session,appearance,onAppearance,onHealthSync,onLogout,{nav.popBackStack()},{nav.navigate(ConnectionsRoute)})}
      composable<ConnectionsRoute>{ProjectDirectoryScreen{nav.popBackStack()}}
    }
  }}
  statusMessage?.let{message->AlertDialog(onDismissRequest=onDismissStatus,confirmButton={TextButton(onClick=onDismissStatus){Text("知道了")}},text={Text(message)})}
  LifeComposerHost(composerOpen,viewModel.submit,viewModel.assistant,{composerOpen=false;viewModel.editAgain();viewModel.clearAssistant()},{viewModel.submit(it)},viewModel::askLife,viewModel::editAgain)
}

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
@Composable private fun SettingsScreen(session:ProductSession,appearance:Appearance,onAppearance:(Appearance)->Unit,onHealthSync:()->Unit,onLogout:()->Unit,onBack:()->Unit,onProjects:()->Unit){Scaffold(topBar={TopAppBar(title={Text("设置")},navigationIcon={IconButton(onClick=onBack){Text("‹",style=MaterialTheme.typography.headlineLarge)}})}){padding->Column(Modifier.fillMaxSize().padding(padding).padding(20.dp),verticalArrangement=Arrangement.spacedBy(20.dp)){LifeSection("账号"){LifeCard{Text(session.subjectId,style=MaterialTheme.typography.titleMedium);Text("Shadow Identity",color=MaterialTheme.colorScheme.onSurfaceVariant)}};LifeSection("外观"){SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()){Appearance.entries.forEachIndexed{index,value->SegmentedButton(selected=appearance==value,onClick={onAppearance(value)},shape=SegmentedButtonDefaults.itemShape(index,Appearance.entries.size)){Text(when(value){Appearance.Dark->"深色";Appearance.Light->"日间";Appearance.System->"系统"})}}}};LifeSection("连接"){OutlinedButton(onClick=onHealthSync,Modifier.fillMaxWidth().heightIn(min=52.dp)){Text("同步 Health Connect")};OutlinedButton(onClick=onProjects,Modifier.fillMaxWidth().heightIn(min=52.dp)){Text("其他项目与连接")}};Spacer(Modifier.weight(1f));TextButton(onClick=onLogout,Modifier.fillMaxWidth()){Text("退出 Life",color=MaterialTheme.colorScheme.error)}}}}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun ProjectDirectoryScreen(onBack:()->Unit){val context=LocalContext.current;Scaffold(topBar={TopAppBar(title={Text("其他项目")},navigationIcon={IconButton(onClick=onBack){Text("‹",style=MaterialTheme.typography.headlineLarge)}})}){padding->Column(Modifier.fillMaxSize().padding(padding).padding(20.dp),verticalArrangement=Arrangement.spacedBy(14.dp)){Text("各项目保持独立身份与业务边界。Life 不会把登录令牌放进链接。",color=MaterialTheme.colorScheme.onSurfaceVariant);ProjectLink("Shadow Foliant","股票研究",BuildConfig.SHADOW_FOLIANT_URL){context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(it)))};ProjectLink("Shadow Garden","博客创作",BuildConfig.SHADOW_GARDEN_URL){context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(it)))}}}}

@Composable private fun ProjectLink(title:String,description:String,url:String,onOpen:(String)->Unit){LifeCard(onClick=url.takeIf(String::isNotBlank)?.let{{onOpen(url)}}){Text(title,style=MaterialTheme.typography.titleLarge);Text(description,color=MaterialTheme.colorScheme.onSurfaceVariant);Text(if(url.isBlank())"尚未配置" else "打开项目",color=if(url.isBlank())MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary)}}
