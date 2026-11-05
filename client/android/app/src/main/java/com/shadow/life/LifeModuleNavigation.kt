package com.shadow.life

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavHostController
import androidx.navigation.NavGraph.Companion.findStartDestination
import kotlinx.serialization.Serializable

// Separate root destinations let Navigation save and restore each module's stack.
@Serializable data object HealthModuleRoute
@Serializable data object MealsModuleRoute
@Serializable data object MoneyModuleRoute
@Serializable data object TravelModuleRoute

internal enum class LifeModule(val label:String,val domain:LifeDomain?,val capture:CaptureKind?) {
  Life("生活",null,null),Health("健康",LifeDomain.Health,CaptureKind.Health),
  Meals("饮食",LifeDomain.Meals,CaptureKind.Meal),Money("消费",LifeDomain.Money,CaptureKind.Expense),
  Travel("出行",LifeDomain.Travel,CaptureKind.Trip),Items("物品",null,CaptureKind.OwnedItem),
  Library("资料",LifeDomain.Library,CaptureKind.Library);

  fun route():Any=when(this){Life->TodayRoute;Health->HealthModuleRoute;Meals->MealsModuleRoute;Money->MoneyModuleRoute;Travel->TravelModuleRoute;Items->ItemsRoute;Library->LibraryRoute}
  companion object { fun forDomain(domain:LifeDomain)=entries.first{it.domain==domain} }
}

internal data class LifeModuleNavigation(
  val onModule:(LifeModule,String?)->Unit,
  val onServices:()->Unit,
  val onCapture:(CaptureKind?)->Unit,
  val onSettings:()->Unit,
  val onInbox:()->Unit,
  val onProjects:()->Unit
)
internal val LocalLifeModuleNavigation=staticCompositionLocalOf<LifeModuleNavigation?>{null}

internal fun NavHostController.openLifeModule(module:LifeModule,tab:String?=null){
  navigate(module.route()){
    popUpTo(graph.findStartDestination().id){saveState=true}
    launchSingleTop=true
    restoreState=true
  }
  if(tab!=null){
    popBackStack(module.route(),inclusive=false)
    getBackStackEntry(module.route()).savedStateHandle["module-section"]="$tab|${android.os.SystemClock.elapsedRealtimeNanos()}"
  }
}

internal fun moduleIcon(module:LifeModule):ImageVector=when(module){
  LifeModule.Life->Icons.Default.Home;LifeModule.Health->Icons.Default.Favorite
  LifeModule.Meals->LifeModuleIcons.Meals;LifeModule.Money->LifeModuleIcons.Wallet
  LifeModule.Travel->Icons.Default.Place;LifeModule.Items->Icons.Default.Build;LifeModule.Library->Icons.Default.Email
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun LifeModuleTopBar(module:LifeModule,onBack:()->Unit={},subtitle:String?=null,onCreate:(()->Unit)?=null){
  val navigation=LocalLifeModuleNavigation.current
  val assistant=LocalLifeAssistant.current
  var picker by rememberSaveable{mutableStateOf(false)}
  var menu by remember{mutableStateOf(false)}
  TopAppBar(
    title={Column{
      Row(Modifier.clickable(enabled=navigation!=null,role=Role.Button){picker=true}.heightIn(min=48.dp),verticalAlignment=Alignment.CenterVertically){
        Text(module.label,style=MaterialTheme.typography.headlineMedium)
        if(navigation!=null)Icon(Icons.Default.ArrowDropDown,"切换模块")
      }
      subtitle?.let{Text(it,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}
    }},
    navigationIcon={if(navigation==null)LifeBackButton(onBack)},
    colors=TopAppBarDefaults.topAppBarColors(containerColor=MaterialTheme.colorScheme.background),
    actions={if(navigation!=null){
      IconButton(onClick=navigation.onServices){Icon(LifeModuleIcons.Services,"服务中心")}
      FilledTonalIconButton(onClick={onCreate?.invoke()?:navigation.onCapture(module.capture)}){Icon(Icons.Default.Add,"快速记录")}
      Box{IconButton(onClick={menu=true}){Icon(Icons.Default.MoreVert,"更多")};DropdownMenu(menu,{menu=false}){
        assistant?.let{DropdownMenuItem(text={Text("Life 助手")},onClick={menu=false;it()})}
        DropdownMenuItem(text={Text("提醒与消息")},onClick={menu=false;navigation.onInbox()})
        DropdownMenuItem(text={Text("账号与设置")},onClick={menu=false;navigation.onSettings()})
        DropdownMenuItem(text={Text("其他项目")},onClick={menu=false;navigation.onProjects()})
      }}
    }}
  )
  if(picker&&navigation!=null)ModalBottomSheet(onDismissRequest={picker=false}){
    LazyColumn(Modifier.fillMaxWidth(),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
      item{Text("切换模块",style=MaterialTheme.typography.titleLarge)}
      LifeModule.entries.chunked(2).forEach{modules->item{Row(horizontalArrangement=Arrangement.spacedBy(12.dp)){
        modules.forEach{value->Surface(onClick={picker=false;if(value!=module)navigation.onModule(value,null)},modifier=Modifier.weight(1f),shape=RoundedCornerShape(16.dp),color=if(value==module)MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainer){
          Row(Modifier.padding(18.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)){Icon(moduleIcon(value),null);Text(value.label);if(value==module)Icon(Icons.Default.Check,"当前模块")}
        }}
        if(modules.size==1)Spacer(Modifier.weight(1f))
      }}}
      item{TextButton(onClick={picker=false;navigation.onServices()},modifier=Modifier.fillMaxWidth()){Text("全部服务与功能搜索")}}
    }
  }
}

internal data class ModuleTab(val key:String,val label:String,val icon:ImageVector)
internal val moneyModuleTabs=listOf(ModuleTab("overview","概览",Icons.Default.Home),ModuleTab("details","明细",Icons.AutoMirrored.Filled.List),ModuleTab("stats","统计",LifeModuleIcons.Statistics),ModuleTab("budgets","预算",LifeModuleIcons.Wallet))
internal val healthModuleTabs=listOf(ModuleTab("overview","概览",Icons.Default.Home),ModuleTab("body","身体",Icons.Default.Favorite),ModuleTab("sleep","睡眠",LifeModuleIcons.Sleep),ModuleTab("activity","运动",LifeModuleIcons.Training))
internal val mealModuleTabs=listOf(ModuleTab("records","今天",LifeModuleIcons.Meals),ModuleTab("planning","餐单",Icons.Default.DateRange),ModuleTab("stock","食材",Icons.Default.Build),ModuleTab("shopping","采购",Icons.Default.ShoppingCart))
internal val travelModuleTabs=listOf(ModuleTab("overview","旅程",Icons.Default.Home),ModuleTab("itinerary","行程",Icons.Default.DateRange),ModuleTab("map","地图",Icons.Default.Place),ModuleTab("places","地点",Icons.Default.Star))

@Composable internal fun LifeModuleBottomBar(selected:String,tabs:List<ModuleTab>,onSelect:(String)->Unit){
  NavigationBar(containerColor=MaterialTheme.colorScheme.surface,tonalElevation=0.dp){
    tabs.forEach{tab->NavigationBarItem(selected=selected==tab.key,onClick={onSelect(tab.key)},icon={Icon(tab.icon,null)},label={Text(tab.label)})}
  }
}

// Store positions for every tab, including when the module is saved by Navigation.
@Composable internal fun rememberModuleListState(tab:String):LazyListState{
  val states=rememberSaveable(saver=listSaver<MutableMap<String,LazyListState>,Any>(
    save={values->values.flatMap{(key,state)->listOf(key,state.firstVisibleItemIndex,state.firstVisibleItemScrollOffset)}},
    restore={values->values.chunked(3).associate{(it[0] as String) to LazyListState(it[1] as Int,it[2] as Int)}.toMutableMap()}
  )){mutableMapOf()}
  return states.getOrPut(tab){LazyListState()}
}

// Explicit service links start at the requested section; plain module switches restore UI state.
@Composable internal fun LifeModuleEntry(entry:NavBackStackEntry,domain:LifeDomain,content:@Composable (WorkspaceRoute)->Unit){
  val request by entry.savedStateHandle.getStateFlow("module-section","").collectAsState()
  key(request){content(WorkspaceRoute(domain.name,request.substringBefore('|')))}
}

@Composable internal fun HomeCommonServices(onWorkspace:(LifeDomain,String)->Unit,onItems:()->Unit,onLibrary:()->Unit,onTraining:()->Unit,onServices:()->Unit){
  Column(verticalArrangement=Arrangement.spacedBy(10.dp)){
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text("常用",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge);TextButton(onClick=onServices){Text("全部服务")}}
    val entries=listOf(
      Triple("消费",moduleIcon(LifeModule.Money),{onWorkspace(LifeDomain.Money,"")}),
      Triple("健康",moduleIcon(LifeModule.Health),{onWorkspace(LifeDomain.Health,"")}),
      Triple("饮食",moduleIcon(LifeModule.Meals),{onWorkspace(LifeDomain.Meals,"")}),
      Triple("训练",LifeModuleIcons.Training,onTraining),
      Triple("出行",moduleIcon(LifeModule.Travel),{onWorkspace(LifeDomain.Travel,"")}),
      Triple("物品",moduleIcon(LifeModule.Items),onItems),Triple("资料",moduleIcon(LifeModule.Library),onLibrary),Triple("服务中心",LifeModuleIcons.Services,onServices)
    )
    entries.chunked(4).forEach{row->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(4.dp)){
      row.forEach{(label,icon,action)->Column(Modifier.weight(1f).clickable(role=Role.Button,onClick=action).padding(vertical=8.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(8.dp)){
        Surface(shape=RoundedCornerShape(16.dp),color=MaterialTheme.colorScheme.surfaceContainer){Box(Modifier.size(46.dp),contentAlignment=Alignment.Center){Icon(icon,null)}}
        Text(label,style=MaterialTheme.typography.labelLarge)
      }}
    }}
  }
}
