package com.shadow.life

import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.LocalDate
import kotlin.math.abs

private val healthTabs=listOf("overview" to "概览","body" to "身体成分","activity" to "活动与睡眠")
private val mealOrder=listOf("breakfast","lunch","dinner","snack","other")

@OptIn(ExperimentalMaterial3Api::class,ExperimentalLayoutApi::class)
@Composable fun HealthWorkspaceScreen(
  overviewState:LoadState<WorkspaceOverview>,recordsState:LoadState<RecordPage>,deviceStatus:DeviceSyncStatus,queueState:LoadState<QueueSummary>,samsungAvailable:Boolean,
  onRetry:()->Unit,onLoadMore:()->Unit,onBack:()->Unit,onDetail:(LifeDomain,String,String)->Unit,onCapture:(CaptureKind)->Unit,
  onHealthSync:()->Unit,onSamsungSync:()->Unit,onScale:()->Unit,onSettings:()->Unit,onMeals:()->Unit
){
  var tab by rememberSaveable{mutableStateOf("overview")}
  val overview=(overviewState as? LoadState.Ready)?.value as? WorkspaceOverview.Health
  Scaffold(containerColor=MaterialTheme.colorScheme.background,topBar={TopAppBar(
    title={Column{Text("健康");Text(healthSourceLine(overview),style=MaterialTheme.typography.labelMedium,color=healthSourceColor(overview))}},
    navigationIcon={IconButton(onClick=onBack){Text("‹",style=MaterialTheme.typography.headlineLarge)}},
    actions={IconButton(onClick=onSettings){Icon(Icons.Default.Settings,"健康数据与设备设置")}}
  )}){padding->
    LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(horizontal=20.dp,vertical=10.dp),verticalArrangement=Arrangement.spacedBy(18.dp)){
      item{Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){healthTabs.forEach{(key,label)->FilterChip(selected=tab==key,onClick={tab=key},label={Text(label)})};FilterChip(selected=false,onClick=onMeals,label={Text("饮食")})}}
      item{StateContent(overviewState,onRetry){} }
      if(overview!=null){
        when(tab){
          "body"->item{BodyMetricsWorkspace(overview.metrics,onDetail,onCapture)}
          "activity"->item{ActivitySleepWorkspace(overview.daily,onCapture)}
          else->{
            item{HealthHero(overview,onDetail,onCapture)}
            item{TodayHealthGrid(overview.daily)}
            item{HealthModuleGrid({tab=it},onMeals,onCapture,onSettings)}
            item{BodyCompositionStrip(overview.metrics,onSelect={tab="body"})}
          }
        }
        item{CompactDeviceStatus(deviceStatus,queueState,samsungAvailable,onHealthSync,onSamsungSync,onScale,onSettings)}
      }
      item{Text("最近健康记录",style=MaterialTheme.typography.titleLarge)}
      item{StateContent(recordsState,onRetry){} }
      if(recordsState is LoadState.Ready){
        items(recordsState.value.items.take(12).size){index->val record=recordsState.value.items[index];RecordRow(record){onDetail(LifeDomain.Health,record.detailId?:record.id,record.title)};if(index<recordsState.value.items.take(12).lastIndex)HorizontalDivider(color=MaterialTheme.colorScheme.outline.copy(alpha=.45f))}
        if(recordsState.value.nextCursor!=null)item{TextButton(onClick=onLoadMore,Modifier.fillMaxWidth()){Text("加载更多健康记录")}}
      }
      item{Spacer(Modifier.height(12.dp))}
    }
  }
}

@Composable private fun HealthHero(overview:WorkspaceOverview.Health,onDetail:(LifeDomain,String,String)->Unit,onCapture:(CaptureKind)->Unit){
  val weight=overview.metrics.firstOrNull{it.key=="weight"};val latest=weight?.points?.lastOrNull();val first=weight?.points?.firstOrNull()
  LifeCard(onClick=latest?.let{{onDetail(LifeDomain.Health,it.id,"体重记录")}}){
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
      Column(Modifier.weight(1f)){Text("体重趋势",style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.primary);Text(latest?.let{"${it.valueText} ${it.unit}"}?:"尚未记录",style=MaterialTheme.typography.headlineLarge,fontWeight=FontWeight.SemiBold);Text(latest?.occurredOn?.let{"最近测量 · $it"}?:"连接体脂秤或手动记录",color=MaterialTheme.colorScheme.onSurfaceVariant)}
      FilledTonalIconButton(onClick={onCapture(CaptureKind.Health)}){Icon(Icons.Default.Add,"记录体重")}
    }
    if(weight!=null&&weight.points.isNotEmpty()){
      TrendChart(weight.points,Modifier.fillMaxWidth().height(168.dp),MaterialTheme.colorScheme.primary)
      Row(Modifier.fillMaxWidth()){Text(weight.points.first().occurredOn.takeLast(5),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);Spacer(Modifier.weight(1f));Text(weight.points.last().occurredOn.takeLast(5),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}
      Text(if(first!=null&&latest!=null&&first.id!=latest.id)"90 天变化 ${signed(latest.value-first.value)} ${latest.unit} · ${weight.coveragePoints} 个测量点" else "当前只有 ${weight.coveragePoints} 个测量点，继续记录后形成趋势",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }else ChartEmpty("近 90 天还没有体重趋势")
  }
}

@Composable private fun TodayHealthGrid(daily:HealthDailyOverview?){
  Column(verticalArrangement=Arrangement.spacedBy(10.dp)){
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp)){
      MetricTile("步数",daily?.steps?.toString()?:"未记录","今日活动","步",MaterialTheme.colorScheme.primary,Modifier.weight(1f))
      MetricTile("睡眠",daily?.sleepMinutes?.let(::minutesLabel)?:"未同步","昨晚","",LifeColors.ReflectionDark,Modifier.weight(1f))
    }
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp)){
      MetricTile("活跃",daily?.activeMinutes?.let{"$it 分钟"}?:"未记录","今日","",MaterialTheme.colorScheme.secondary,Modifier.weight(1f))
      MetricTile("训练",daily?.workouts?.takeIf{it>0}?.let{"$it 次"}?:"未记录","今日","",MaterialTheme.colorScheme.tertiary,Modifier.weight(1f))
    }
  }
}

@Composable private fun MetricTile(label:String,value:String,note:String,suffix:String,tone:Color,modifier:Modifier=Modifier){
  Surface(modifier,shape=RoundedCornerShape(20.dp),color=MaterialTheme.colorScheme.surface,border=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outline.copy(alpha=.72f))){Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(7.dp)){Row(verticalAlignment=Alignment.CenterVertically){Box(Modifier.size(8.dp).clip(RoundedCornerShape(99.dp)).background(tone));Spacer(Modifier.width(7.dp));Text(label,style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.onSurfaceVariant)};Text(value,style=MaterialTheme.typography.titleLarge,maxLines=1,overflow=TextOverflow.Ellipsis);if(suffix.isNotBlank()&&value!="未记录")Text(suffix,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant) else Text(note,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun HealthModuleGrid(onTab:(String)->Unit,onMeals:()->Unit,onCapture:(CaptureKind)->Unit,onSettings:()->Unit){
  LifeSection("健康功能"){
    Text("常用入口固定在这里，不再藏在记录列表里。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    FlowRow(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp),verticalArrangement=Arrangement.spacedBy(10.dp),maxItemsInEachRow=2){
      ModuleTile("↗","身体指标","体重、体脂与围度",{onTab("body")},Modifier.weight(1f))
      ModuleTile("◔","睡眠","时长、分期与规律",{onTab("activity")},Modifier.weight(1f))
      ModuleTile("◇","饮食饮水","餐次、餐照与营养",onMeals,Modifier.weight(1f))
      ModuleTile("◎","活动运动","步数、训练与热量",{onTab("activity")},Modifier.weight(1f))
      ModuleTile("＋","开始训练","保存实际完成",{onCapture(CaptureKind.Workout)},Modifier.weight(1f))
      ModuleTile("⌁","感受与资料","补记主观感受",{onCapture(CaptureKind.Health)},Modifier.weight(1f))
      ModuleTile("↻","数据来源","同步与冲突状态",onSettings,Modifier.weight(1f))
    }
  }
}

@Composable private fun ModuleTile(mark:String,title:String,subtitle:String,onClick:()->Unit,modifier:Modifier=Modifier){Surface(modifier.heightIn(min=106.dp).clickable(role=Role.Button,onClick=onClick),shape=RoundedCornerShape(20.dp),color=MaterialTheme.colorScheme.surface,border=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outline.copy(alpha=.72f))){Column(Modifier.padding(15.dp),verticalArrangement=Arrangement.spacedBy(5.dp)){Text(mark,color=MaterialTheme.colorScheme.primary,style=MaterialTheme.typography.titleLarge);Text(title,style=MaterialTheme.typography.titleMedium);Text(subtitle,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=2)}}}

@Composable private fun BodyCompositionStrip(metrics:List<HealthMetricTrend>,onSelect:()->Unit){LifeSection("身体成分变化",action={TextButton(onClick=onSelect){Text("完整分析")}}){Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(10.dp)){metrics.filterNot{it.key=="weight"}.forEach{metric->val latest=metric.points.lastOrNull();Surface(Modifier.width(142.dp).clickable(role=Role.Button,onClick=onSelect),shape=RoundedCornerShape(20.dp),color=MaterialTheme.colorScheme.surface,border=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outline.copy(alpha=.72f))){Column(Modifier.padding(15.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){Text(metric.label,color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.labelLarge);Text(latest?.let{"${it.valueText} ${it.unit}"}?:"未记录",style=MaterialTheme.typography.titleMedium,maxLines=1);MiniTrend(metric.points,Modifier.fillMaxWidth().height(42.dp))}}}}}}

@Composable private fun BodyMetricsWorkspace(metrics:List<HealthMetricTrend>,onDetail:(LifeDomain,String,String)->Unit,onCapture:(CaptureKind)->Unit){
  var metricKey by rememberSaveable{mutableStateOf("weight")};var days by rememberSaveable{mutableIntStateOf(30)}
  val metric=metrics.firstOrNull{it.key==metricKey}?:metrics.firstOrNull();val cutoff=LocalDate.now().minusDays(days.toLong()-1)
  val shown=metric?.points.orEmpty().filter{runCatching{LocalDate.parse(it.occurredOn)>=cutoff}.getOrDefault(true)};val latest=shown.lastOrNull()?:metric?.points?.lastOrNull();val first=shown.firstOrNull()
  Column(verticalArrangement=Arrangement.spacedBy(16.dp)){
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){metrics.forEach{item->FilterChip(metricKey==item.key,{metricKey=item.key},{Text(item.label)})}}
    LifeCard(onClick=latest?.let{{onDetail(LifeDomain.Health,it.id,"${metric?.label}记录")}}){
      Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.Top){Column(Modifier.weight(1f)){Text("${metric?.label?:"身体指标"}变化",style=MaterialTheme.typography.titleLarge);Text(latest?.let{"${it.valueText} ${it.unit}"}?:"未记录",style=MaterialTheme.typography.headlineLarge);Text(latest?.occurredOn?:"等待同步或手动补记",color=MaterialTheme.colorScheme.onSurfaceVariant)};FilledTonalIconButton(onClick={onCapture(CaptureKind.Health)}){Icon(Icons.Default.Add,"添加记录")}}
      Row(horizontalArrangement=Arrangement.spacedBy(7.dp)){listOf(7,30,90).forEach{value->FilterChip(days==value,{days=value},{Text("$value 天")})}}
      if(shown.isEmpty())ChartEmpty("所选期间没有${metric?.label.orEmpty()}数据") else {TrendChart(shown,Modifier.fillMaxWidth().height(210.dp),MaterialTheme.colorScheme.primary);Row(Modifier.fillMaxWidth()){Text(shown.first().occurredOn.takeLast(5),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);Spacer(Modifier.weight(1f));Text(shown.last().occurredOn.takeLast(5),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
    }
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp)){
      MetricTile("当前",latest?.valueText?:"—",latest?.unit.orEmpty(),latest?.unit.orEmpty(),MaterialTheme.colorScheme.primary,Modifier.weight(1f))
      MetricTile("期间变化",if(first!=null&&latest!=null&&first.id!=latest.id)signed(latest.value-first.value) else "—","基于 ${shown.size} 个点","",MaterialTheme.colorScheme.secondary,Modifier.weight(1f))
    }
    Text("测量历史",style=MaterialTheme.typography.titleLarge)
    if(shown.isEmpty())EmptyState("没有可显示的真实测量点") else shown.asReversed().take(12).forEach{point->Surface(Modifier.fillMaxWidth().clickable(role=Role.Button){onDetail(LifeDomain.Health,point.id,"${metric?.label}记录")},shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.surface,border=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outline.copy(alpha=.6f))){Row(Modifier.padding(15.dp),verticalAlignment=Alignment.CenterVertically){Column(Modifier.weight(1f)){Text(point.occurredOn,style=MaterialTheme.typography.titleMedium);Text(sourceLabel(point.sourceKind),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};Text("${point.valueText} ${point.unit}",style=MaterialTheme.typography.titleMedium)}}}
    Text("变化仅描述所选期间的测量结果，不自动推断饮食、训练与体重之间的因果关系。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@Composable private fun ActivitySleepWorkspace(daily:HealthDailyOverview?,onCapture:(CaptureKind)->Unit){Column(verticalArrangement=Arrangement.spacedBy(16.dp)){
  LifeCard{Text("今日活动",style=MaterialTheme.typography.titleLarge);Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){ActivityRing(daily?.steps,Modifier.size(116.dp));Column(Modifier.weight(1f)){HealthFact("步数",daily?.steps?.toString()?:"未记录");HealthFact("活跃时间",daily?.activeMinutes?.let{"$it 分钟"}?:"未记录");HealthFact("活动热量",daily?.caloriesKcal?.let{"$it kcal"}?:"未记录")}};Button(onClick={onCapture(CaptureKind.Workout)},Modifier.fillMaxWidth()){Text("记录一次训练")}}
  LifeCard{Text("昨晚睡眠",style=MaterialTheme.typography.titleLarge);Text(daily?.sleepMinutes?.let(::minutesLabel)?:"尚未同步",style=MaterialTheme.typography.headlineLarge);Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(16.dp)){HealthFact("深睡",daily?.deepMinutes?.let(::minutesLabel)?:"未提供",Modifier.weight(1f));HealthFact("REM",daily?.remMinutes?.let(::minutesLabel)?:"未提供",Modifier.weight(1f))};Text("设备没有提供分期时不会把缺失显示为 0。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
}}

@Composable private fun CompactDeviceStatus(status:DeviceSyncStatus,queueState:LoadState<QueueSummary>,samsungAvailable:Boolean,onHealthSync:()->Unit,onSamsungSync:()->Unit,onScale:()->Unit,onSettings:()->Unit){
  val queue=(queueState as? LoadState.Ready)?.value
  LifeSection("设备与同步",action={TextButton(onClick=onSettings){Text("管理")}}){LifeCard{
    SyncRow("Samsung Health",if(!samsungAvailable)"当前包未包含 SDK" else status.samsungMessage,status.samsungState){onSamsungSync()}
    HorizontalDivider(color=MaterialTheme.colorScheme.outline.copy(alpha=.55f))
    SyncRow("小米体脂秤",status.scaleLastWeight?.let{"最近 $it kg · ${status.scaleMessage}"}?:status.scaleMessage,status.scaleState,onScale)
    HorizontalDivider(color=MaterialTheme.colorScheme.outline.copy(alpha=.55f))
    SyncRow("Health Connect","读取系统已授权数据","idle",onHealthSync)
    queue?.let{Text("离线队列：${it.waiting} 待发送 · ${it.reconciling} 核对中 · ${it.failed} 需处理",style=MaterialTheme.typography.bodySmall,color=if(it.failed>0)MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)}
  }}
}

@Composable private fun SyncRow(title:String,subtitle:String,state:String,onClick:()->Unit){Row(Modifier.fillMaxWidth().clickable(role=Role.Button,onClick=onClick).padding(vertical=5.dp),verticalAlignment=Alignment.CenterVertically){Box(Modifier.size(10.dp).clip(RoundedCornerShape(99.dp)).background(if(state in setOf("complete","committed","queued","detected"))MaterialTheme.colorScheme.primary else if(state in setOf("error","timeout","needs_permission","needs_config"))MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline));Spacer(Modifier.width(10.dp));Column(Modifier.weight(1f)){Text(title,style=MaterialTheme.typography.titleMedium);Text(subtitle,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=2,overflow=TextOverflow.Ellipsis)};Icon(Icons.Default.Refresh,"立即操作",tint=MaterialTheme.colorScheme.primary)} }

@OptIn(ExperimentalMaterial3Api::class)
@Composable fun MealsWorkspaceScreen(
  overviewState:LoadState<WorkspaceOverview>,recordsState:LoadState<RecordPage>,assetPreviews:Map<String,LoadState<ByteArray>>,
  onLoadAsset:(String)->Unit,onRetry:()->Unit,onLoadMore:()->Unit,onBack:()->Unit,onDetail:(LifeDomain,String,String)->Unit,onCapture:(CaptureKind)->Unit
){
  var selectedDate by rememberSaveable{mutableStateOf(LocalDate.now().toString())};var query by rememberSaveable{mutableStateOf("")}
  val allRecords=(recordsState as? LoadState.Ready)?.value?.items.orEmpty().filter{it.meal!=null};val selected=allRecords.filter{it.meal?.occurredOn==selectedDate};val dates=(listOf(LocalDate.now().toString())+allRecords.mapNotNull{it.meal?.occurredOn}).distinct()
  val records=allRecords.filter{record->query.isBlank()||listOf(record.title,record.meal?.note.orEmpty(),mealTypeUi(record.meal?.mealType.orEmpty())).any{it.contains(query.trim(),ignoreCase=true)}}
  val nutrition=mealNutrition(selected)
  Scaffold(containerColor=MaterialTheme.colorScheme.background,topBar={TopAppBar(title={Column{Text("饮食");Text("餐次、餐照与已记录营养",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}},navigationIcon={IconButton(onClick=onBack){Text("‹",style=MaterialTheme.typography.headlineLarge)}},actions={FilledTonalIconButton(onClick={onCapture(CaptureKind.Meal)}){Icon(Icons.Default.Add,"记一餐")}})}){padding->
    LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(horizontal=20.dp,vertical=10.dp),verticalArrangement=Arrangement.spacedBy(18.dp)){
      item{DateNavigator(selectedDate,{selectedDate=it},dates)}
      item{MealNutritionHero(selectedDate,selected,nutrition,onCapture)}
      item{MealDayGroups(selected,assetPreviews,onLoadAsset,onDetail,onCapture)}
      val planning=(overviewState as? LoadState.Ready)?.value as? WorkspaceOverview.Meals
      if(planning!=null)item{LifeSection("餐单与采购"){LifeCard{Text("${planning.mealPlans} 份餐单 · ${planning.shoppingLists} 张购物清单",style=MaterialTheme.typography.titleMedium);Text(if(planning.openShoppingItems==0)"当前没有待采购食材" else "${planning.openShoppingItems} 项食材待采购",color=MaterialTheme.colorScheme.onSurfaceVariant)}}}
      item{LifeSection("查找饮食记录"){OutlinedTextField(query,{query=it},Modifier.fillMaxWidth(),singleLine=true,placeholder={Text("搜索已加载的食物、餐次或备注")},leadingIcon={Icon(Icons.Default.Search,null)});if(query.isNotBlank())Text("匹配 ${records.size} 条",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
      item{Text("最近记录",style=MaterialTheme.typography.titleLarge)}
      item{StateContent(recordsState,onRetry){} }
      if(recordsState is LoadState.Ready){items(records.size){index->val record=records[index];MealHistoryRow(record,assetPreviews,onLoadAsset){onDetail(LifeDomain.Meals,record.detailId?:record.id,record.title)}};if(records.isEmpty()&&query.isNotBlank())item{EmptyState("已加载记录中没有匹配内容")};if(recordsState.value.nextCursor!=null)item{TextButton(onClick=onLoadMore,Modifier.fillMaxWidth()){Text("加载更早记录")}}}
      item{Spacer(Modifier.height(12.dp))}
    }
  }
}

@Composable private fun DateNavigator(selected:String,onSelect:(String)->Unit,dates:List<String>){Column(verticalArrangement=Arrangement.spacedBy(10.dp)){
  Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){OutlinedButton(onClick={onSelect(runCatching{LocalDate.parse(selected).minusDays(1).toString()}.getOrDefault(selected))}){Text("‹")};Column(Modifier.weight(1f),horizontalAlignment=Alignment.CenterHorizontally){Text(if(selected==LocalDate.now().toString())"今天" else selected,style=MaterialTheme.typography.titleLarge);Text(selected,color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.labelMedium)};OutlinedButton(onClick={onSelect(runCatching{LocalDate.parse(selected).plusDays(1).coerceAtMost(LocalDate.now()).toString()}.getOrDefault(selected))},enabled=selected<LocalDate.now().toString()){Text("›")}}
  Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(7.dp)){dates.take(12).forEach{date->FilterChip(selected==date,{onSelect(date)},{Text(if(date==LocalDate.now().toString())"今天" else date.takeLast(5))})}}
}}

private data class MealNutrition(val kcal:Double,val protein:Double,val fat:Double,val carb:Double,val knownItems:Int,val totalItems:Int,val estimated:Boolean)
private fun mealNutrition(records:List<RecordSummary>):MealNutrition{val foods=records.flatMap{it.meal?.foods.orEmpty()};return MealNutrition(foods.sumOf{it.energyKcal?.toDoubleOrNull()?:0.0},foods.sumOf{it.proteinG?.toDoubleOrNull()?:0.0},foods.sumOf{it.fatG?.toDoubleOrNull()?:0.0},foods.sumOf{it.carbG?.toDoubleOrNull()?:0.0},foods.count{it.energyKcal!=null||it.proteinG!=null||it.fatG!=null||it.carbG!=null},foods.size,foods.any{it.estimated})}

@Composable private fun MealNutritionHero(date:String,records:List<RecordSummary>,nutrition:MealNutrition,onCapture:(CaptureKind)->Unit){LifeCard{
  Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.Top){Column(Modifier.weight(1f)){Text(if(date==LocalDate.now().toString())"今日饮食" else "$date 饮食",style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.tertiary);Text(if(nutrition.knownItems>0)"${number(nutrition.kcal)} kcal" else "营养尚未记录",style=MaterialTheme.typography.headlineLarge);Text("${records.size} 餐 · ${nutrition.knownItems}/${nutrition.totalItems} 个食物条目含营养",color=MaterialTheme.colorScheme.onSurfaceVariant)};FilledTonalIconButton(onClick={onCapture(CaptureKind.Meal)}){Icon(Icons.Default.Add,"添加餐次")}}
  if(nutrition.knownItems>0){NutrientBar(nutrition);Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp)){NutrientChip("蛋白",nutrition.protein,"g",MaterialTheme.colorScheme.primary,Modifier.weight(1f));NutrientChip("碳水",nutrition.carb,"g",MaterialTheme.colorScheme.secondary,Modifier.weight(1f));NutrientChip("脂肪",nutrition.fat,"g",MaterialTheme.colorScheme.tertiary,Modifier.weight(1f))}}
  Text(buildString{append("仅汇总已记录条目，不代表全天完整摄入");if(nutrition.estimated)append(" · 含估算值")},style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
}}

@Composable private fun NutrientBar(value:MealNutrition){val total=value.protein*4+value.carb*4+value.fat*9;Row(Modifier.fillMaxWidth().height(8.dp).clip(RoundedCornerShape(99.dp))){if(total<=0)Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.outline)) else {Box(Modifier.weight((value.protein*4/total).toFloat().coerceAtLeast(.01f)).fillMaxHeight().background(MaterialTheme.colorScheme.primary));Box(Modifier.weight((value.carb*4/total).toFloat().coerceAtLeast(.01f)).fillMaxHeight().background(MaterialTheme.colorScheme.secondary));Box(Modifier.weight((value.fat*9/total).toFloat().coerceAtLeast(.01f)).fillMaxHeight().background(MaterialTheme.colorScheme.tertiary))}}}
@Composable private fun NutrientChip(label:String,value:Double,unit:String,color:Color,modifier:Modifier){Surface(modifier,shape=RoundedCornerShape(16.dp),color=color.copy(alpha=.12f)){Column(Modifier.padding(11.dp)){Text(label,style=MaterialTheme.typography.labelMedium,color=color);Text("${number(value)} $unit",style=MaterialTheme.typography.titleMedium)}}}

@Composable private fun MealDayGroups(records:List<RecordSummary>,assetPreviews:Map<String,LoadState<ByteArray>>,onLoadAsset:(String)->Unit,onDetail:(LifeDomain,String,String)->Unit,onCapture:(CaptureKind)->Unit){LifeSection("餐次与餐照"){mealOrder.forEach{type->val group=records.filter{it.meal?.mealType==type};if(group.isEmpty())EmptyMealGroup(type,onCapture) else group.forEach{record->MealGroupCard(record,assetPreviews,onLoadAsset){onDetail(LifeDomain.Meals,record.detailId?:record.id,record.title)}}}}}

@Composable private fun EmptyMealGroup(type:String,onCapture:(CaptureKind)->Unit){Surface(Modifier.fillMaxWidth().clickable(role=Role.Button){onCapture(CaptureKind.Meal)},shape=RoundedCornerShape(20.dp),color=MaterialTheme.colorScheme.surface,border=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outline.copy(alpha=.55f))){Row(Modifier.padding(16.dp),verticalAlignment=Alignment.CenterVertically){Text(mealTypeUi(type),style=MaterialTheme.typography.titleMedium,modifier=Modifier.weight(1f));Text("未记录  ＋",color=MaterialTheme.colorScheme.onSurfaceVariant)}}}

@Composable private fun MealGroupCard(record:RecordSummary,assetPreviews:Map<String,LoadState<ByteArray>>,onLoadAsset:(String)->Unit,onClick:()->Unit){val meal=record.meal?:return;val nutrition=mealNutrition(listOf(record));LifeCard(onClick=onClick){
  Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(14.dp)){MealPhoto(meal.photoAssetVersionId,assetPreviews,onLoadAsset,Modifier.size(96.dp));Column(Modifier.weight(1f)){Row(Modifier.fillMaxWidth()){Text(mealTypeUi(meal.mealType),style=MaterialTheme.typography.titleLarge,modifier=Modifier.weight(1f));Text(meal.occurredAt?.takeIf{it.length>=16}?.substring(11,16)?:meal.occurredOn.takeLast(5),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)};Text(meal.foods.joinToString("、"){it.name}.ifBlank{"仅保存了餐照"},maxLines=3,overflow=TextOverflow.Ellipsis);if(nutrition.knownItems>0)Text("${number(nutrition.kcal)} kcal · 蛋白 ${number(nutrition.protein)} g",color=MaterialTheme.colorScheme.tertiary,style=MaterialTheme.typography.bodySmall);meal.note?.let{Text(it,maxLines=2,overflow=TextOverflow.Ellipsis,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}
  if(meal.foods.isNotEmpty())Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(7.dp)){meal.foods.forEach{food->AssistChip(onClick=onClick,label={Text(food.name)})}}
}}

@Composable private fun MealHistoryRow(record:RecordSummary,assetPreviews:Map<String,LoadState<ByteArray>>,onLoadAsset:(String)->Unit,onClick:()->Unit){val meal=record.meal;if(meal==null){RecordRow(record,onClick);return};Row(Modifier.fillMaxWidth().clickable(role=Role.Button,onClick=onClick).padding(vertical=8.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)){MealPhoto(meal.photoAssetVersionId,assetPreviews,onLoadAsset,Modifier.size(58.dp));Column(Modifier.weight(1f)){Text(mealTypeUi(meal.mealType),style=MaterialTheme.typography.titleMedium);Text(record.title,maxLines=1,overflow=TextOverflow.Ellipsis,color=MaterialTheme.colorScheme.onSurfaceVariant);Text(meal.occurredOn,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)};record.trailing?.let{Text(it,style=MaterialTheme.typography.labelMedium)}}}

@Composable private fun MealPhoto(versionId:String?,states:Map<String,LoadState<ByteArray>>,onLoad:(String)->Unit,modifier:Modifier){
  if(versionId==null){Surface(modifier,shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.tertiary.copy(alpha=.12f)){Box(contentAlignment=Alignment.Center){Column(horizontalAlignment=Alignment.CenterHorizontally){Text("◇",style=MaterialTheme.typography.headlineMedium,color=MaterialTheme.colorScheme.tertiary);Text("暂无餐照",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}}};return}
  LaunchedEffect(versionId){onLoad(versionId)};when(val state=states[versionId]){
    is LoadState.Ready->{val bitmap=remember(state.value){BitmapFactory.decodeByteArray(state.value,0,state.value.size)?.asImageBitmap()};if(bitmap!=null)Image(bitmap,"餐次照片",modifier.clip(RoundedCornerShape(18.dp)),contentScale=ContentScale.Crop) else PhotoLoadFallback(modifier,"无法解码")}
    is LoadState.Failed->PhotoLoadFallback(modifier,"点击重试"){onLoad(versionId)}
    else->Surface(modifier,shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.surfaceVariant){Box(contentAlignment=Alignment.Center){CircularProgressIndicator(Modifier.size(24.dp),strokeWidth=2.dp)}}
  }
}
@Composable private fun PhotoLoadFallback(modifier:Modifier,label:String,onClick:(()->Unit)?=null){Surface(modifier.then(if(onClick!=null)Modifier.clickable(role=Role.Button,onClick=onClick) else Modifier),shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.surfaceVariant){Box(contentAlignment=Alignment.Center){Text(label,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}

@Composable private fun TrendChart(points:List<HealthTrendPoint>,modifier:Modifier,color:Color){
  val values=points.map{it.value};val outline=MaterialTheme.colorScheme.outline;val surface=MaterialTheme.colorScheme.surface
  Canvas(modifier){
    val left=6.dp.toPx();val right=size.width-6.dp.toPx();val top=12.dp.toPx();val bottom=size.height-12.dp.toPx()
    repeat(4){index->val y=top+(bottom-top)*index/3f;drawLine(outline.copy(alpha=.45f),Offset(left,y),Offset(right,y),1.dp.toPx())}
    if(values.isEmpty())return@Canvas
    val min=values.minOrNull()?:0.0;val max=values.maxOrNull()?:min;val range=(max-min).takeIf{abs(it)>.000001}?:1.0
    fun pointOffset(index:Int,value:Double):Offset=Offset(
      if(values.size==1)(left+right)/2 else left+(right-left)*index/values.lastIndex.toFloat(),
      bottom-(bottom-top)*((value-min)/range).toFloat()
    )
    if(values.size>1){val path=Path();values.forEachIndexed{index,value->val point=pointOffset(index,value);if(index==0)path.moveTo(point.x,point.y) else path.lineTo(point.x,point.y)};drawPath(path,color,style=Stroke(2.5.dp.toPx()))}
    values.forEachIndexed{index,value->val point=pointOffset(index,value);drawCircle(surface,5.dp.toPx(),point);drawCircle(color,3.2.dp.toPx(),point)}
  }
}
@Composable private fun MiniTrend(points:List<HealthTrendPoint>,modifier:Modifier){if(points.isEmpty()){Box(modifier,contentAlignment=Alignment.CenterStart){Text("等待数据",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}} else TrendChart(points.takeLast(20),modifier,MaterialTheme.colorScheme.primary)}
@Composable private fun ChartEmpty(text:String){Box(Modifier.fillMaxWidth().height(150.dp).clip(RoundedCornerShape(16.dp)).background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha=.5f)),contentAlignment=Alignment.Center){Text(text,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
@Composable private fun ActivityRing(steps:Long?,modifier:Modifier){
  val progress=((steps?:0)/10_000f).coerceIn(0f,1f);val outline=MaterialTheme.colorScheme.outline;val primary=MaterialTheme.colorScheme.primary
  Box(modifier,contentAlignment=Alignment.Center){Canvas(Modifier.fillMaxSize()){drawArc(outline.copy(alpha=.55f),-90f,360f,false,style=Stroke(10.dp.toPx()));drawArc(primary,-90f,360f*progress,false,style=Stroke(10.dp.toPx()))};Column(horizontalAlignment=Alignment.CenterHorizontally){Text(steps?.toString()?:"—",style=MaterialTheme.typography.titleLarge);Text("步",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
}
@Composable private fun HealthFact(label:String,value:String,modifier:Modifier=Modifier){Column(modifier.padding(vertical=5.dp)){Text(label,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);Text(value,style=MaterialTheme.typography.titleMedium)}}

@Composable private fun healthSourceColor(overview:WorkspaceOverview.Health?)=when{overview==null->MaterialTheme.colorScheme.onSurfaceVariant;overview.sourcesNeedingAttention>0->MaterialTheme.colorScheme.error;else->MaterialTheme.colorScheme.primary}
private fun healthSourceLine(value:WorkspaceOverview.Health?)=when{value==null->"正在读取健康数据";value.sources==0->"尚未接入数据来源";value.sourcesNeedingAttention>0->"${value.sourcesNeedingAttention} 个来源需要处理";else->"已连接 ${value.sources} 个来源 · ${value.streams} 条数据流"}
private fun sourceLabel(value:String)=mapOf("scale" to "小米体脂秤","samsung" to "Samsung Health","health_connect" to "Health Connect","manual" to "手动记录","legacy_health" to "旧 Health 迁移")[value]?:value
private fun mealTypeUi(value:String)=mapOf("breakfast" to "早餐","lunch" to "午餐","dinner" to "晚餐","snack" to "加餐","other" to "其他")[value]?:"一餐"
private fun minutesLabel(value:Long)="${value/60} 小时 ${value%60} 分"
private fun signed(value:Double)=(if(value>0)"+" else "")+number(value)
private fun number(value:Double):String=BigDecimal.valueOf(value).setScale(if(abs(value)>=100)0 else 1,RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
