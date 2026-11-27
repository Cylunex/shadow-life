package com.shadow.life

import android.graphics.BitmapFactory
import android.graphics.Paint
import android.graphics.Typeface
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
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
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.math.BigDecimal
import java.math.RoundingMode
import java.time.LocalDate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.withContext
import kotlin.math.abs

private val healthTabs=listOf("overview" to "健康","body" to "身体","activity" to "运动","training" to "训练","sleep" to "睡眠","release" to "起飞")
private val mealOrder=listOf("breakfast","lunch","dinner","snack","other")
private val ActivityGreen:Color @Composable get()=if(MaterialTheme.colorScheme.background.luminance()<.5f)Color(0xFF7CEB52) else Color(0xFF346A23)
private val ActivityBlue:Color @Composable get()=if(MaterialTheme.colorScheme.background.luminance()<.5f)Color(0xFF48A9FF) else Color(0xFF286899)
private val ActivityPurple:Color @Composable get()=if(MaterialTheme.colorScheme.background.luminance()<.5f)Color(0xFFB285FF) else Color(0xFF7454A1)
private val BodyOrange:Color @Composable get()=if(MaterialTheme.colorScheme.background.luminance()<.5f)Color(0xFFFF9F43) else Color(0xFF885C1A)
private val SleepPurple:Color @Composable get()=if(MaterialTheme.colorScheme.background.luminance()<.5f)Color(0xFFA982FF) else Color(0xFF70579C)
private val MealCoral:Color @Composable get()=if(MaterialTheme.colorScheme.background.luminance()<.5f)Color(0xFFFF806F) else Color(0xFFA54737)

@OptIn(ExperimentalMaterial3Api::class,ExperimentalLayoutApi::class)
@Composable fun HealthWorkspaceScreen(
  accountId:String,overviewState:LoadState<WorkspaceOverview>,recordsState:LoadState<RecordPage>,deviceStatus:DeviceSyncStatus,queueState:LoadState<QueueSummary>,samsungAvailable:Boolean,
  onRetry:()->Unit,onLoadMore:()->Unit,onBack:()->Unit,onDetail:(LifeDomain,String,String)->Unit,onCapture:(CaptureKind)->Unit,
  onHealthSync:()->Unit,onSamsungSync:()->Unit,onScale:()->Unit,onSettings:()->Unit,onMeals:(String)->Unit,initialTab:String="overview",releaseState:LoadState<HealthReleaseHistoryResultDto>,onReleaseLoad:(String,String)->Unit,onArchive:()->Unit={},onReview:(String,Int)->Unit={_,_->},trainingContent:@Composable ()->Unit={},readRevision:Int=0
){
  var tab by rememberSaveable(initialTab){mutableStateOf(initialTab.takeIf{value->healthTabs.any{it.first==value}}?:"overview")}
  val context=LocalContext.current
  val repository=remember(accountId){NativeLifeRepository(context,context.applicationContext as ShadowApp)}
  val today=LocalDate.now().toString()
  var selectedDate by rememberSaveable(accountId,initialTab){
    mutableStateOf(initialTab.removePrefix("day/").takeIf{initialTab.startsWith("day/")&&runCatching{LocalDate.parse(it)}.isSuccess&&it<=today}?:today)
  }
  val visibilityStore=remember(accountId){HealthMetricVisibilityStore(context,accountId)}
  var hiddenMetrics by remember(accountId){mutableStateOf(visibilityStore.hidden())}
  fun toggleMetric(key:String){hiddenMetrics=if(key in hiddenMetrics)hiddenMetrics-key else hiddenMetrics+key;visibilityStore.save(hiddenMetrics)}
  val workspaceScroll=rememberModuleListState(tab)
  val legacySleepWindows=remember(accountId){mutableStateMapOf<Pair<String,String>,HealthDailyResultDtoResultSleepWindow>()}
  val overview=(overviewState as? LoadState.Ready)?.value as? WorkspaceOverview.Health
  val cachedDay=overview?.history?.firstOrNull{it.occurredOn==selectedDate}
  val selectedDay=rememberLifeRead(accountId,selectedDate,enabled=tab=="overview"&&cachedDay==null,refreshKey=readRevision){
    repository.healthDay(selectedDate)
  }
  val dayState=cachedDay?.let{LoadState.Ready(it)}?:selectedDay.state
  val showOverviewStatus=when(overviewState){
    LoadState.Loading->tab!="overview"
    is LoadState.Ready->overviewState.refreshing||overviewState.refreshError!=null||overviewState.updateAvailable
    else->true
  }
  Scaffold(containerColor=MaterialTheme.colorScheme.background,
    topBar={LifeModuleTopBar(LifeModule.Health,onBack)},
    floatingActionButton={if(tab=="overview"&&selectedDate==today)ModuleCaptureAction("记体重"){onCapture(CaptureKind.Health)}},
    bottomBar={LifeModuleBottomBar(when(tab){"training"->"activity";"release"->"overview";else->tab},healthModuleTabs){tab=it}}
  ){padding->
    LazyColumn(Modifier.fillMaxSize().padding(padding),state=workspaceScroll,contentPadding=PaddingValues(start=16.dp,end=16.dp,top=8.dp,bottom=if(tab=="overview")88.dp else 8.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
      if(showOverviewStatus)item("health-overview-state"){StateContent(overviewState,onRetry){}}
      if(tab in setOf("activity","training"))item{
        FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){
          FilterChip(tab=="training",{tab=if(tab=="training")"activity" else "training"},label={Text("训练")})
        }
      }
      if(tab=="training")item{trainingContent()}
      if(tab=="release")item{ReleaseHistoryWorkspace(releaseState,onReleaseLoad,onDetail)}
      if(overview!=null){
        when(tab){
          "body"->item{BodyMetricsWorkspace(accountId,overview.metrics,hiddenMetrics,::toggleMetric,onDetail,onCapture,{days->onReview(today,days)})}
          "activity"->{item{ActivityWorkspace(overview.history,onDetail,onCapture)};item{HealthSurface{Text("下一次训练",style=MaterialTheme.typography.titleLarge);when(val suggestions=overview.progression){null->Text("建议暂时不可读取");else->if(suggestions.isEmpty())Text("尚无进行中的训练计划") else suggestions.forEach{plan->Text(plan.title,style=MaterialTheme.typography.titleMedium);Text(plan.reason);if(plan.status in setOf("increase_duration","hold"))plan.nextDurationMinutes?.let{Text("${it} 分钟")};plan.evidence.forEach{Text(it,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}}}}
          "sleep"->{
            item{SleepWorkspace(overview.history,overview.sleepInsights){id->onDetail(LifeDomain.Health,id,"主睡眠")}}
            item{HealthSleepSchedule(accountId,overview.history,overview.unavailableDays,legacySleepWindows){id->onDetail(LifeDomain.Health,id,"主睡眠")}}
            item{MorningCheckinCard(accountId)}
          }
          "release","training"->Unit
          else->Unit
        }
      }
      if(tab=="overview"){
        item("health-date-selector"){
          val shownDay=(dayState as? LoadState.Ready)?.value
          val knownDates=(overview?.history.orEmpty()+listOfNotNull(shownDay))
            .filter{it.steps!=null||it.activeMinutes!=null||it.caloriesKcal!=null||it.sleepId!=null||it.workouts>0||it.weights.isNotEmpty()}
            .map{it.occurredOn}.toSet()
          DateNavigator(selectedDate,{selectedDate=it},knownDates,"有健康记录",ActivityGreen)
        }
        item("health-daily-summary"){
          StateContent(dayState,selectedDay.retry){day->
            DailyActivityHero(selectedDate,day)
            Spacer(Modifier.height(12.dp))
            LifeCard{
              val sleepId=day?.sleepId
              if(sleepId!=null)HealthSummaryRow("主睡眠","按醒来日统计",day.sleepMinutes?.let(::minutesLabel)?:"—",SleepPurple){
                onDetail(LifeDomain.Health,sleepId,"主睡眠")
              } else Text("当天没有主睡眠记录",color=MaterialTheme.colorScheme.onSurfaceVariant)
              val weights=day?.weights.orEmpty()
              weights.forEach{weight->
                HorizontalDivider()
                HealthSummaryRow("体重","当天测量",healthValueText(weight.value,weight.unit)+" "+unitLabel(weight.unit),ActivityGreen){
                  onDetail(LifeDomain.Health,weight.id,"身体测量")
                }
              }
              if(weights.isEmpty()&&selectedDate==today)overview?.metrics?.firstOrNull{it.key=="weight"}?.points?.lastOrNull()?.let{last->
                HorizontalDivider()
                HealthSummaryRow("最近称重",last.occurredOn,"${last.valueText} ${unitLabel(last.unit)}",ActivityGreen){
                  onDetail(LifeDomain.Health,last.id,"身体测量")
                }
              }
              day?.workoutItems.orEmpty().forEach{workout->
                HorizontalDivider()
                HealthSummaryRow(workoutTypeUi(workout.sessionType),localDateTime(workout.startedAt,workout.timeZone,false)?:"当天运动",
                  workout.durationMinutes?.let(::minutesLabel)?:"查看记录",ActivityBlue){
                  onDetail(LifeDomain.Health,workout.id,"运动详情")
                }
              }
            }
          }
        }
        item("health-day-links"){
          Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
            TextButton(onClick={onMeals(selectedDate)}){Text("同日饮食")}
            TextButton(onClick={onReview(selectedDate,7)}){Text("截至当天的周复盘")}
          }
        }
      }
      if(tab=="activity")item{PersonalRecordsCard(accountId,"路线与训练复盘")}
      if(tab=="overview"&&selectedDate==today){
        item{Text("最近健康记录",style=MaterialTheme.typography.titleLarge)}
        item{StateContent(recordsState,onRetry){} }
        if(recordsState is LoadState.Ready){items(recordsState.value.items.size){index->val record=recordsState.value.items[index];RecordRow(record){onDetail(LifeDomain.Health,record.detailId?:record.id,record.title)}};if(recordsState.value.nextCursor!=null)item{TextButton(onClick=onLoadMore,Modifier.fillMaxWidth()){Text("加载更多健康记录")}}}
      }
      if(tab=="overview")item{
        LifeSection("健康档案"){
          FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){
            TextButton(onClick=onArchive){Text("体检与不适")}
            TextButton(onClick={tab="release"}){Text("起飞记录")}
          }
        }
      }
      if(tab=="overview"||tab=="body")item{CompactDeviceStatus(deviceStatus,queueState,samsungAvailable,onHealthSync,onSamsungSync,onScale,onSettings)}
    }
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun DailyActivityHero(date:String,day:HealthDailyOverview?) {
  LifeCard{
    Text(if(date==LocalDate.now().toString())"今日活动" else "$date 活动",style=MaterialTheme.typography.titleMedium)
    if(day?.steps==null&&day?.activeMinutes==null&&day?.caloriesKcal==null){
      Text("当天暂无活动数据",color=MaterialTheme.colorScheme.onSurfaceVariant)
    }else{
      FlowRow(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
        RingLegend("步数",day.steps?.toString()?:"—","步",ActivityGreen)
        RingLegend("活跃时间",day.activeMinutes?.toString()?:"—","分钟",ActivityBlue)
        RingLegend("活动热量",day.caloriesKcal?.let{healthValueText(it,"kcal")}?:"—","kcal",MealCoral)
      }
    }
    var goals by rememberSaveable{mutableStateOf(false)}
    TextButton(onClick={goals=!goals}){Text(if(goals)"收起活动目标" else "活动目标")}
    if(goals)FlowRow(horizontalArrangement=Arrangement.spacedBy(18.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
      ActivityMetric("步数","steps",day?.steps?.toDouble(),"步")
      ActivityMetric("活跃时间","active_minutes",day?.activeMinutes?.toDouble(),"分钟")
      ActivityMetric("活动热量","active_calories",day?.caloriesKcal?.toDoubleOrNull(),"kcal")
    }
  }
}

@Composable internal fun ModuleCaptureAction(label:String,onClick:()->Unit){
  ExtendedFloatingActionButton(
    text={Text(label)},icon={Icon(Icons.Default.Add,null)},onClick=onClick,
    modifier=Modifier.semantics{contentDescription=label}
  )
}

@Composable private fun HealthSummaryRow(title:String,subtitle:String,value:String,tone:Color,onClick:()->Unit){
  Row(Modifier.fillMaxWidth().clickable(role=Role.Button,onClick=onClick).heightIn(min=48.dp),
    horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=Alignment.CenterVertically){
    Column(Modifier.weight(1f)){
      Text(title,style=MaterialTheme.typography.titleSmall)
      Text(subtitle,color=MaterialTheme.colorScheme.onSurfaceVariant,style=MaterialTheme.typography.bodySmall)
    }
    Text(value,Modifier.weight(1f),style=MaterialTheme.typography.titleMedium,color=tone,textAlign=androidx.compose.ui.text.style.TextAlign.End)
  }
}

@Composable private fun RingLegend(label:String,value:String,unit:String,color:Color){Row(verticalAlignment=Alignment.CenterVertically){Box(Modifier.size(9.dp).clip(CircleShape).background(color));Spacer(Modifier.width(9.dp));Column{Text(label,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);Row(verticalAlignment=Alignment.Bottom){Text(value,style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.SemiBold,color=color);Spacer(Modifier.width(4.dp));Text(unit,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}}

@Composable private fun BodyMetricsWorkspace(accountId:String,metrics:List<HealthMetricTrend>,hiddenMetrics:Set<String>,onToggleMetric:(String)->Unit,onDetail:(LifeDomain,String,String)->Unit,onCapture:(CaptureKind)->Unit,onReview:(Int)->Unit){
  var metricKey by rememberSaveable{mutableStateOf("weight")};var days by rememberSaveable{mutableIntStateOf(30)};val available=metrics.filter{it.key !in hiddenMetrics&&!it.unavailable&&it.points.isNotEmpty()};val metric=available.firstOrNull{it.key==metricKey}?:available.firstOrNull();val cutoff=LocalDate.now().minusDays(days.toLong()-1);val shown=metric?.points.orEmpty().filter{runCatching{LocalDate.parse(it.occurredOn) in cutoff..LocalDate.now()}.getOrDefault(false)};val latest=shown.lastOrNull();val first=shown.firstOrNull();val average=shown.map{it.value}.average().takeUnless{it.isNaN()}
  val assessment=metricAssessment(metric?.key.orEmpty(),latest?.value,latest?.unit.orEmpty());val editReference=LocalEditHealthReference.current
  var managing by rememberSaveable{mutableStateOf(false)}
  Column(verticalArrangement=Arrangement.spacedBy(18.dp)){
    metrics.firstOrNull{it.key=="weight"}?.points?.lastOrNull()?.let{weight->
      val context=LocalContext.current
      val repo=remember(accountId){NativeLifeRepository(context,context.applicationContext as ShadowApp)}
      var composition by remember(accountId,weight){mutableStateOf(emptyList<DetailMetric>())}
      LaunchedEffect(accountId,weight){
        composition=try{
          repo.bodyComposition(weight.id).filter{it.id!=weight.id&&it.key!="weight"}
        }catch(error:kotlinx.coroutines.CancellationException){throw error}
        catch(_:Exception){emptyList()}
      }
      LifeCard(onClick={onDetail(LifeDomain.Health,weight.id,"本次称重")}){
        Text("最近称重",style=MaterialTheme.typography.labelLarge)
        Text("${weight.valueText} ${unitLabel(weight.unit)}",style=MaterialTheme.typography.headlineMedium,color=ActivityGreen)
        val time=weight.occurredAt?.let{runCatching{java.time.Instant.parse(it).atZone(java.time.ZoneId.systemDefault()).toLocalDateTime().toString().replace('T',' ')}.getOrNull()}
        Text("${time?:weight.occurredOn} · ${sourceLabel(weight.sourceKind)}")
        if(composition.isNotEmpty())BodyCompositionGrid(composition)
        Text("查看本次测量")
      }
    }
    TextButton(onClick={managing=!managing}){Text(if(managing)"收起显示管理" else "管理显示项目")}
    if(managing)HealthSurface{Text("身体趋势项目",style=MaterialTheme.typography.titleMedium);Text("收起不常看的趋势；手动录入仍可选择任何指标。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant);Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(7.dp)){metrics.filter{it.points.isNotEmpty()}.forEach{item->FilterChip(selected=item.key !in hiddenMetrics,onClick={onToggleMetric(item.key)},label={Text(item.label)})}}}
    ReferenceLegend()
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){available.forEach{item->FilterChip(metric?.key==item.key,{metricKey=item.key},{Text(item.label)})}}
    HealthSurface{Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.Top){Column(Modifier.weight(1f)){Text("${metric?.label?:"身体指标"}变化",style=MaterialTheme.typography.titleLarge);Text(latest?.let{"${it.valueText} ${unitLabel(it.unit)}"}?:"未记录",style=MaterialTheme.typography.headlineLarge,fontWeight=FontWeight.SemiBold,color=healthTone(assessment.tone));Text(latest?.let{"${it.occurredOn} · ${sourceLabel(it.sourceKind)}"}?:"等待设备同步或手动补记",color=MaterialTheme.colorScheme.onSurfaceVariant)};FilledTonalIconButton(onClick={onCapture(CaptureKind.Health)}){Icon(Icons.Default.Add,"添加记录")}};AssessmentLabel(assessment);if(metric!=null&&latest!=null)TextButton(onClick={editReference(metric.key,metric.label,latest.unit,false)}){Text("设置参考范围")};Row(horizontalArrangement=Arrangement.spacedBy(7.dp)){listOf(7,30,90).forEach{value->FilterChip(days==value,{days=value},{Text("$value 天")})}};if(shown.isEmpty())ChartEmpty("所选期间没有${metric?.label.orEmpty()}数据") else {TrendChart(shown,Modifier.fillMaxWidth().height(210.dp),healthTone(assessment.tone),metric?.key){point->onDetail(LifeDomain.Health,point.id,"身体测量")};ChartDateRange(shown.first().occurredOn,shown.last().occurredOn)};LifeMetricGrid{SummaryFact("平均",average?.let{"${number(it)} ${latest?.unit?.let(::unitLabel).orEmpty()}"}?:"—",Modifier.weight(1f));SummaryFact("最低",shown.minOfOrNull{it.value}?.let{"${number(it)} ${latest?.unit?.let(::unitLabel).orEmpty()}"}?:"—",Modifier.weight(1f));SummaryFact("最高",shown.maxOfOrNull{it.value}?.let{"${number(it)} ${latest?.unit?.let(::unitLabel).orEmpty()}"}?:"—",Modifier.weight(1f))};if(first!=null&&latest!=null&&first.id!=latest.id)Text("期间变化 ${signed(latest.value-first.value)} ${unitLabel(latest.unit)} · ${shown.size} 个真实测量点",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
    TextButton(onClick={onReview(days)}){Text("查看同期饮食 · $days 天")}
    latest?.let{point->TextButton(onClick={onDetail(LifeDomain.Health,point.id,"${metric?.label}记录")}){Text("查看最近测量详情")}}
    if(metric?.truncated==true)Text("仅显示最近 ${metric.coveragePoints} 个测量点，部分历史未包含。",style=MaterialTheme.typography.bodySmall)
    if(metric?.key?.startsWith("skin_temperature")==true)Text("这是手腕皮肤温度，用于观察同类测量变化。",style=MaterialTheme.typography.bodySmall)
    if(metric?.key?.startsWith("heart_rate_daily")==true)Text("全天极值包含睡眠和活动，不作为静息心率判断。",style=MaterialTheme.typography.bodySmall)
    LifeSection("测量历史"){if(shown.isEmpty())EmptyState("没有可显示的真实测量点") else shown.asReversed().take(12).forEach{point->Surface(Modifier.fillMaxWidth().clickable(role=Role.Button){onDetail(LifeDomain.Health,point.id,"${metric?.label}记录")},shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.surfaceVariant.copy(alpha=.42f)){Row(Modifier.padding(15.dp),verticalAlignment=Alignment.CenterVertically){Column(Modifier.weight(1f)){Text(point.occurredOn,style=MaterialTheme.typography.titleMedium);Text(sourceLabel(point.sourceKind),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};Column(horizontalAlignment=Alignment.End){val status=metricAssessment(metric?.key.orEmpty(),point.value,point.unit);Text("${point.valueText} ${unitLabel(point.unit)}",style=MaterialTheme.typography.titleMedium,color=healthTone(status.tone));AssessmentLabel(status,false)}}}};if(shown.size>12)Text("显示最近 12 次测量",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun BodyCompositionGrid(metrics:List<DetailMetric>){
  val columns=if(androidx.compose.ui.platform.LocalDensity.current.fontScale>1.3f)1 else 2
  FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(8.dp),maxItemsInEachRow=columns){
    val preferred=listOf("body_fat","skeletal_muscle","muscle_mass","visceral_fat","body_water","bmi")
    metrics.sortedBy{preferred.indexOf(it.key).takeIf{index->index>=0}?:preferred.size}.take(6).forEach{metric->
      Surface(Modifier.widthIn(min=110.dp).weight(1f),shape=MaterialTheme.shapes.small,
        color=MaterialTheme.colorScheme.surfaceContainer){
        Column(Modifier.padding(8.dp)){
          Text(metric.label,style=MaterialTheme.typography.labelMedium)
          Text("${metric.value} ${metric.unit}",style=MaterialTheme.typography.titleMedium)
          Text(if(metric.derived)"计算值" else "设备值",style=MaterialTheme.typography.labelSmall)
        }
      }
    }
  }
}

@Composable private fun ActivityWorkspace(history:List<HealthDailyOverview>,onDetail:(LifeDomain,String,String)->Unit,onCapture:(CaptureKind)->Unit){
  var metric by rememberSaveable{mutableStateOf("steps")}
  var selectedDay by rememberSaveable{mutableStateOf<String?>(null)}
  val days=lastSevenDays(history)
  val selected=selectedDay?.takeIf{date->days.any{it.first.toString()==date}}
  val workouts=history.filter{selected==null||it.occurredOn==selected}.flatMap{it.workoutItems}.sortedByDescending{it.startedAt?:it.occurredOn}
  val values=days.map{(_,day)->when(metric){"minutes"->day?.activeMinutes?.toDouble();"calories"->day?.caloriesKcal?.toDoubleOrNull();else->day?.steps?.toDouble()}}
  val unit=when(metric){"minutes"->"分钟";"calories"->"kcal";else->"步"}
  val tone=when(metric){"minutes"->ActivityBlue;"calories"->ActivityPurple;else->ActivityGreen}
  Column(verticalArrangement=Arrangement.spacedBy(18.dp)){
    HealthSurface{
      Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
        Column(Modifier.weight(1f)){
          Text("近 7 天活动",style=MaterialTheme.typography.titleLarge)
          Text(if(values.any{it!=null})"${values.count{it!=null}} 天有记录 · 合计 ${number(values.filterNotNull().sum())} $unit" else "近 7 天暂无记录",style=MaterialTheme.typography.bodySmall)
        }
        TextButton(onClick={onCapture(CaptureKind.Workout)}){Text("记录运动")}
      }
      Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(7.dp)){
        listOf("steps" to "步数","minutes" to "活跃时间","calories" to "活动热量").forEach{(key,label)->FilterChip(metric==key,{metric=key},{Text(label)})}
      }
      WeekBarChart(days.map{it.first},values,tone,unit,selected){selectedDay=it}
    }
    LifeSection(selected?.let{"$it 运动"}?:"本周运动",action={
      if(selected!=null)TextButton(onClick={selectedDay=null}){Text("看全周")}
    }){
      if(workouts.isEmpty())ChartEmpty(if(selected==null)"近 7 天没有同步到运动明细" else "当天没有运动明细")
      workouts.forEach{workout->WorkoutCard(workout){onDetail(LifeDomain.Health,workout.id,"${workoutTypeUi(workout.sessionType)}记录")}}
    }
  }
}

@Composable private fun WorkoutCard(workout:HealthWorkoutSummary,onClick:()->Unit){val title=workoutTypeUi(workout.sessionType);val tone=workoutTone(workout.sessionType);HealthSurface(onClick=onClick){Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.Top){Box(Modifier.size(48.dp).clip(CircleShape).background(tone.copy(alpha=.16f)),contentAlignment=Alignment.Center){Text(workoutGlyph(workout.sessionType),style=MaterialTheme.typography.titleLarge,color=tone)};Spacer(Modifier.width(13.dp));Column(Modifier.weight(1f)){Text(title,style=MaterialTheme.typography.titleLarge);Text("${workout.occurredOn}${localDateTime(workout.startedAt,workout.timeZone,includeDate=false)?.let{" · $it"}.orEmpty()}",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};Column(horizontalAlignment=Alignment.End,verticalArrangement=Arrangement.spacedBy(5.dp)){workout.sourceKind?.let{SourcePill(sourceLabel(it),tone)};workout.autoDetected?.let{SourcePill(if(it)"自动记录" else "手动记录",if(it)ActivityBlue else tone)}}};val facts=listOfNotNull(workout.distanceKm?.let{"距离" to "${healthValueText(it,"km")} km"},workout.durationMinutes?.let{"时长" to minutesLabel(it)},workout.caloriesKcal?.let{"热量" to "${healthValueText(it,"kcal")} kcal"},workout.heartRateAvg?.let{"运动平均心率" to "$it 次/分"},workoutPerformance(workout),workout.rpe?.let{"主观强度" to "$it / 10"});if(facts.isNotEmpty())Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(20.dp)){facts.forEach{(label,value)->HealthFact(label,value)}} else Text("这条运动记录没有更多指标。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}

@Composable private fun SleepWorkspace(history:List<HealthDailyOverview>,insights:HealthSleepInsightsResultDto?,onNight:(String)->Unit){
  val days=lastSevenDays(history)
  var picked by rememberSaveable{mutableStateOf<String?>(null)}
  val date=picked?.takeIf{date->days.any{it.first.toString()==date}}?:history.lastOrNull{it.sleepMinutes!=null}?.occurredOn?:LocalDate.now().toString()
  val night=history.firstOrNull{it.occurredOn==date}
  Column(verticalArrangement=Arrangement.spacedBy(18.dp)){
    HealthSurface{
      Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
        Column(Modifier.weight(1f)){
          Text("主睡眠",style=MaterialTheme.typography.titleLarge)
          Text("$date 醒来",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        night?.sleepSource?.let{SourcePill(sourceLabel(it),SleepPurple)}
      }
      Text(night?.sleepMinutes?.let(::minutesLabel)?:"当天没有睡眠记录",style=MaterialTheme.typography.headlineLarge)
      night?.sleepMinutes?.let{minutes->
        AssessmentLabel(metricAssessment("sleep_minutes",minutes.toDouble(),"分钟",true))
        SleepStageBar(night)
        Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(18.dp)){
          sleepStages(night).forEach{(label,minutes,tone)->RingLegend(label,minutes?.let(::minutesLabel)?:"未提供","",tone)}
        }
        night.sleepId?.let{id->TextButton(onClick={onNight(id)}){Text("查看本晚详情")}}
      }
    }
    HealthSurface{
      Text("近 7 晚",style=MaterialTheme.typography.titleLarge)
      val values=days.map{it.second?.sleepMinutes?.toDouble()?.div(60)}
      Text("${values.count{it!=null}} 晚有记录",style=MaterialTheme.typography.bodySmall)
      WeekBarChart(days.map{it.first},values,SleepPurple,"小时",date){picked=it}
    }
    if(night!=null&&night.napMinutes.isNotEmpty())HealthSurface{
      Text("当天其他睡眠",style=MaterialTheme.typography.titleLarge)
      night.napMinutes.forEachIndexed{index,minutes->HealthFact("时段 ${index+1}",minutesLabel(minutes))}
      Text("各时段合计 ${night.sleepTotalDayMinutes?.let(::minutesLabel)?:"—"} · 可能含重叠记录",style=MaterialTheme.typography.bodySmall)
    }
    SleepInsightsCard(insights)
  }
}

@Composable private fun SleepInsightsCard(insights:HealthSleepInsightsResultDto?){HealthSurface{
  Text("近 30 天睡眠统计",style=MaterialTheme.typography.titleLarge)
  if(insights==null){Text("统计暂不可用，请稍后重试",color=MaterialTheme.colorScheme.onSurfaceVariant);return@HealthSurface}
  Text("${insights.nights} 晚有有效记录 · ${insights.atLeastSevenHours} 晚达到 7 小时",color=MaterialTheme.colorScheme.onSurfaceVariant)
  if(insights.nights==0L){Text("暂无可统计的睡眠时长",color=MaterialTheme.colorScheme.onSurfaceVariant);return@HealthSurface}
  Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(18.dp)){
    HealthFact("平均时长",insights.averageMinutes?.let(::minutesLabel)?:"—")
    HealthFact("睡眠效率",insights.averageEfficiencyPercent?.let{"$it% · ${insights.efficiencyNights} 晚"}?:"缺少完整起止时间")
    HealthFact("深睡占比",insights.deepPercent?.let{"$it%"}?:"未提供")
    HealthFact("REM 占比",insights.remPercent?.let{"$it%"}?:"未提供")
  }
  if(insights.bedtimeNights>=3&&insights.averageBedtime!=null){Text("平均入睡 ${insights.averageBedtime} · 时间波动约 ${insights.bedtimeVariationMinutes} 分钟（${insights.bedtimeNights} 晚）")}
  else Text("有起始时间的睡眠少于 3 晚，暂不计算入睡规律",color=MaterialTheme.colorScheme.onSurfaceVariant)
  Text("每个醒来日选最长有效会话；分段睡眠与跨来源记录不重复相加。仅作记录统计。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
}}

private fun sleepStages(day:HealthDailyOverview?)=listOf(
  Triple("深睡",day?.deepMinutes,sleepBandColor("深睡")),
  Triple("浅睡",day?.lightMinutes,sleepBandColor("浅睡")),
  Triple("REM",day?.remMinutes,sleepBandColor("REM")),
  Triple("清醒",day?.awakeMinutes,sleepBandColor("清醒"))
)

@Composable private fun SleepStageBar(day:HealthDailyOverview?){
  val stages=sleepStages(day).filter{(_,minutes,_) -> minutes!=null&&minutes>0}
  if(stages.isNotEmpty())Row(Modifier.fillMaxWidth().height(12.dp).clip(CircleShape)){
    stages.forEach{(_,minutes,color)->Box(Modifier.weight(minutes!!.toFloat()).fillMaxHeight().background(color))}
  }
}

@Composable private fun CompactDeviceStatus(status:DeviceSyncStatus,queueState:LoadState<QueueSummary>,samsungAvailable:Boolean,onHealthSync:()->Unit,onSamsungSync:()->Unit,onScale:()->Unit,onSettings:()->Unit){
  val queue=(queueState as? LoadState.Ready)?.value
  val scaleWeight=status.scalePendingWeight?.let{"本次 $it kg"}?:status.scaleLastWeight?.let{"最近 $it kg"}
  val scaleSummary=listOfNotNull(scaleWeight,status.scaleMessage).joinToString(" · ")
  LifeSection("设备与同步",action={TextButton(onClick=onSettings){Text("管理")}}){
    HealthSurface {
      SyncRow("Samsung Health",if(!samsungAvailable)"当前包未包含 SDK" else status.samsungMessage,status.samsungState,onSamsungSync,enabled=samsungAvailable&&!status.samsungReading)
      HorizontalDivider(color=MaterialTheme.colorScheme.outline.copy(alpha=.32f))
      SyncRow("小米体脂秤",scaleSummary,status.scaleState,onScale,enabled=!status.scaleActive)
      if(HealthConnectSync.enabled()){
        HorizontalDivider(color=MaterialTheme.colorScheme.outline.copy(alpha=.32f))
        SyncRow("Health Connect","读取系统已授权的聚合健康数据","idle",onHealthSync)
      }
      queue?.let{Text("离线队列：${it.waiting} 待发送 · ${it.reconciling} 核对中 · ${it.failed} 需处理",style=MaterialTheme.typography.bodySmall,color=if(it.failed>0)MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)}
    }
  }
}

@Composable private fun SyncRow(title:String,subtitle:String,state:String,onClick:()->Unit,enabled:Boolean=true){Row(Modifier.fillMaxWidth().clickable(enabled=enabled,role=Role.Button,onClick=onClick).padding(vertical=7.dp),verticalAlignment=Alignment.CenterVertically){Box(Modifier.size(10.dp).clip(CircleShape).background(if(state in setOf("complete","committed","queued","detected","collecting"))ActivityGreen else if(state in setOf("needs_config","key_mismatch"))MaterialTheme.colorScheme.tertiary else if(state in setOf("error","timeout","needs_permission"))MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.outline));Spacer(Modifier.width(11.dp));Column(Modifier.weight(1f)){Text(title,style=MaterialTheme.typography.titleMedium);Text(subtitle,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=2,overflow=TextOverflow.Ellipsis)};if(enabled)Icon(Icons.Default.Refresh,"立即操作",tint=MaterialTheme.colorScheme.primary)}}

@OptIn(ExperimentalMaterial3Api::class,ExperimentalLayoutApi::class)
@Composable fun MealsWorkspaceScreen(overviewState:LoadState<WorkspaceOverview>,recordsState:LoadState<RecordPage>,assetPreviews:Map<String,LoadState<ByteArray>>,onLoadAsset:(String)->Unit,onRetry:()->Unit,onLoadMore:()->Unit,onBack:()->Unit,onDetail:(LifeDomain,String,String)->Unit,onMealCapture:(String,String)->Unit,onAddPhoto:(RecordSummary)->Unit,photoState:SubmitState,onStats:()->Unit,mealPlanningState:SubmitState,onSaveMealPlan:(NativeMealPlanDraft)->Unit,onBuildShopping:(MealPlanningResultDtoMealPlansEntry,String)->Unit,onUpdateShopping:(MealPlanningResultDtoShoppingListsEntryItemsEntry,String)->Unit,onSetFoodStock:(MealPlanningResultDtoStockLotsEntry?,String,String,String,String?)->Unit,onSaveRecipe:(String,String,String,String,String)->Unit,onResetMealPlanning:()->Unit,initialTab:String="records",accountId:String,onCopyMeal:(RecordSummary,String)->Unit,onDishCatalog:(String)->Unit,onDishStats:(String)->Unit,onReview:(String)->Unit,onPriceBook:()->Unit,focusStockId:String="",onStockPurchase:(String)->Unit={},onHealthDay:(String)->Unit,readRevision:Int=0){
  var mealTab by rememberSaveable(initialTab){mutableStateOf(initialTab.takeIf{it in setOf("planning","shopping","stock","recipes","history")}?:"records")}
  val context=LocalContext.current
  val repository=remember(accountId){NativeLifeRepository(context,context.applicationContext as ShadowApp)}
  val app=context.applicationContext as ShadowApp
  var selectedDate by rememberSaveable(accountId,initialTab){
    mutableStateOf(initialTab.removePrefix("day/").takeIf{initialTab.startsWith("day/")&&runCatching{LocalDate.parse(it)}.isSuccess}?:LocalDate.now().toString())
  }
  val showsDay=mealTab=="records"
  var pendingMeals by remember(accountId,selectedDate){mutableStateOf<List<PendingMealPreview>>(emptyList())}
  LaunchedEffect(accountId,selectedDate,showsDay){
    if(!showsDay)return@LaunchedEffect
    val date=selectedDate
    val session=withContext(Dispatchers.IO){app.sessions.active()}
      ?.takeIf{it.accountId==accountId}?:return@LaunchedEffect
    app.queue.observeMeals(session).collectLatest{commands->
      pendingMeals=withContext(Dispatchers.IO){
        commands.filter{it.state!="committed"}.mapNotNull{command->
          val input=runCatching{org.json.JSONObject(app.queue.commandBody(command)).getJSONObject("input")}.getOrNull()
            ?:return@mapNotNull null
          if(input.optString("occurred_on")!=date)return@mapNotNull null
          val foods=input.optJSONArray("items")
          val names=foods?.let{items->(0 until items.length()).mapNotNull{items.optJSONObject(it)?.optString("name")}}
          PendingMealPreview(command.commandId,command.state in setOf("failed","blocked"),names.orEmpty().joinToString("、"))
        }
      }
    }
  }
  var query by rememberSaveable{mutableStateOf("")}
  val allRecords=(recordsState as? LoadState.Ready)?.value?.items.orEmpty().filter{it.meal!=null}
  var submittedHistory by rememberSaveable{mutableStateOf("")}
  val day=rememberLifeRead(accountId,selectedDate,enabled=showsDay,refreshKey=readRevision){repository.mealsOn(selectedDate)}
  val dayPage=(day.state as? LoadState.Ready)?.value
  val dayRecords=dayPage?.items.orEmpty()
  val nutrition=remember(dayRecords){mealNutrition(dayRecords)}
  val groupedMeals=remember(dayRecords){dayRecords.groupBy{it.meal?.mealType}}
  val monday=remember(selectedDate){LocalDate.parse(selectedDate).let{it.minusDays(it.dayOfWeek.value-1L)}}
  val week=rememberLifeRead(accountId,monday,enabled=showsDay,refreshKey=readRevision){
    repository.dietReview(monday.plusDays(6).coerceAtMost(LocalDate.now()).toString(),7)
  }
  val weekReview=(week.state as? LoadState.Ready)?.value
  val weekDays=remember(weekReview,monday){weekReview?.wellness?.days.orEmpty().filter{it.date>=monday.toString()}}
  val completeness=weekReview?.diary?.firstOrNull{it.date==selectedDate}?.state?.wireValue
  val history=rememberRecordPages(accountId,submittedHistory,enabled=mealTab=="history",refreshKey=readRevision){
    cursor->repository.records(LifeDomain.Meals,submittedHistory,cursor)
  }
  val mealScroll=rememberModuleListState(mealTab)
  Scaffold(containerColor=MaterialTheme.colorScheme.background,
    topBar={Column{
      LifeModuleTopBar(LifeModule.Meals,onBack)
      if(mealTab=="records"||mealTab=="history")TextButton(onClick={mealTab=if(mealTab=="records")"history" else "records"}){
        Text(if(mealTab=="records")"查找历史饮食" else "返回当日饮食")
      }
    }},
    floatingActionButton={if(mealTab=="records")ModuleCaptureAction("记一餐"){onMealCapture(selectedDate,"other")}},
    bottomBar={LifeModuleBottomBar(when(mealTab){"recipes"->"planning";"history"->"records";else->mealTab},mealModuleTabs){mealTab=it}}
  ){padding->LazyColumn(Modifier.fillMaxSize().padding(padding),state=mealScroll,contentPadding=PaddingValues(start=16.dp,end=16.dp,top=8.dp,bottom=if(mealTab=="records")88.dp else 8.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
    if(mealTab=="records"){
      item{
        val recordedDates=weekDays.filter{it.meals>0}.map{it.date}.toSet()+
          if(dayRecords.isNotEmpty())setOf(selectedDate) else emptySet()
        DateNavigator(selectedDate,{selectedDate=it},recordedDates)
        if(week.state is LoadState.Failed)TextButton(onClick=week.retry){Text("重试读取本周餐次标记")}
        Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
          OutlinedButton(onClick={onDishCatalog(selectedDate)},modifier=Modifier.weight(1f)){Text("门店菜单")}
          OutlinedButton(onClick={onDishStats(selectedDate)},modifier=Modifier.weight(1f)){Text("菜品统计")}
        }
      }
      item{StateContent(day.state,day.retry){}}
      if(dayPage!=null){
        item{MealNutritionHero(selectedDate,dayRecords,nutrition,dayPage.nextCursor!=null,completeness){record->onDetail(LifeDomain.Meals,record.id,record.title)}}
        if(weekDays.any{it.meals>0})item{
          var expanded by rememberSaveable{mutableStateOf(false)}
          TextButton(onClick={expanded=!expanded}){Text(if(expanded)"收起本周摄入" else "查看本周摄入")}
          if(expanded)MealWeekIntake(weekDays,selectedDate){selectedDate=it}
        }
        mealDayGroups(groupedMeals,assetPreviews,onLoadAsset,onDetail,{type->onMealCapture(selectedDate,type)},onAddPhoto,
          {record->onCopyMeal(record,selectedDate)})
      }
      item{
        FlowRow(horizontalArrangement=Arrangement.spacedBy(4.dp)){
          TextButton(onClick={onHealthDay(selectedDate)}){Text("同日健康")}
          TextButton(onClick={onReview(selectedDate)}){Text("饮食与体重复盘")}
          TextButton(onClick=onStats){Text("订单与消费统计")}
        }
      }
    if(photoState is SubmitState.Sending)item{LinearProgressIndicator(Modifier.fillMaxWidth())}
    if(photoState is SubmitState.Rejected)item{Text(photoState.message,color=MaterialTheme.colorScheme.error)}

    }
    if(mealTab=="records"&&allRecords.isNotEmpty())item{
      var copying by rememberSaveable{mutableStateOf(false)}
      TextButton(onClick={copying=!copying}){Text("用最近一餐")}
      if(copying)allRecords.take(10).forEach{record->TextButton(onClick={onCopyMeal(record,selectedDate)}){Text("${record.meal?.occurredOn} · ${record.title}")}}
    }
    if(showsDay)items(pendingMeals,key={"pending-meal:${it.id}"}){meal->
      HealthSurface{
        Text(if(meal.failed)"本机餐次 · 同步需要处理" else "本机餐次 · 待同步",style=MaterialTheme.typography.titleMedium)
        Text(meal.foods)
        Text("同步确认后会并入当天餐次；当前营养汇总采用已接收记录。",style=MaterialTheme.typography.bodySmall)
      }
    }
    val planning=(overviewState as? LoadState.Ready)?.value as? WorkspaceOverview.Meals
    if(mealTab !in setOf("records","history"))item{StateContent(overviewState,onRetry){}}
    if(mealTab=="shopping")item{TextButton(onClick=onPriceBook){Text("查看常购价格")}}
    if(planning!=null&&mealTab !in setOf("records","history"))item{NativeMealPlanningSection(planning,mealPlanningState,onSaveMealPlan,onBuildShopping,onUpdateShopping,onSetFoodStock,onSaveRecipe,onResetMealPlanning,initialTab,accountId,controlledSection=mealTab,onSectionChange={mealTab=it},focusStockId=focusStockId,onStockPurchase=onStockPurchase)}
    if(mealTab=="history"){
      item{
        Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
          OutlinedTextField(query,{query=it.take(200)},Modifier.weight(1f),singleLine=true,label={Text("食物、餐次或备注")})
          TextButton(onClick={submittedHistory=query.trim()}){Text("搜索")}
        }
      }
      item{StateContent(history.state,history.retry){}}
      val page=(history.state as? LoadState.Ready)?.value
      if(page?.items?.isEmpty()==true)item{EmptyState("没有匹配的饮食记录")}
      items(page?.items.orEmpty(),key={"meal-history:${it.kind}:${it.id}"}){record->
        MealHistoryRow(record,assetPreviews,onLoadAsset,{if(record.meal!=null)onAddPhoto(record)}){
          onDetail(LifeDomain.Meals,record.detailId?:record.id,record.title)
        }
      }
      if(page?.nextCursor!=null)item{TextButton(onClick=history.more){Text("加载更早记录")}}
    }
  }}
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun DateNavigator(selected:String,onSelect:(String)->Unit,recordedDates:Set<String>,markerLabel:String="有餐次",markerColor:Color=MealCoral){
  val day=LocalDate.parse(selected)
  val today=LocalDate.now()
  val monday=day.minusDays(day.dayOfWeek.value.toLong()-1)
  var calendar by rememberSaveable{mutableStateOf(false)}
  Column {
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically){
      TextButton(onClick={onSelect(day.minusWeeks(1).toString())}){Text("上周")}
      TextButton(onClick={calendar=true}){Text(selected)}
      TextButton(onClick={onSelect(day.plusWeeks(1).coerceAtMost(today).toString())},enabled=monday.plusWeeks(1)<=today){Text("下周")}
    }
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(2.dp)){
      repeat(7){offset->
        val date=monday.plusDays(offset.toLong())
        val active=date==day
        val hasRecords=date.toString() in recordedDates
        Surface(modifier=Modifier.weight(1f).heightIn(min=48.dp).semantics{
          this.selected=active
          contentDescription=date.toString()+if(hasRecords)"，$markerLabel" else ""
        },onClick={onSelect(date.toString())},enabled=date<=today,
          shape=RoundedCornerShape(12.dp),color=if(active)MaterialTheme.colorScheme.tertiaryContainer else MaterialTheme.colorScheme.surface){
          Column(horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.Center){
            Text("一二三四五六日"[offset].toString(),style=MaterialTheme.typography.labelSmall)
            Text(date.dayOfMonth.toString(),style=MaterialTheme.typography.labelLarge)
            if(hasRecords)Box(Modifier.size(4.dp).clip(CircleShape).background(markerColor)) else Spacer(Modifier.height(4.dp))
          }
        }
      }
    }
  }
  if(calendar){
    val picker=rememberDatePickerState(initialSelectedDateMillis=day.atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli())
    DatePickerDialog(onDismissRequest={calendar=false},
      confirmButton={TextButton(onClick={
        picker.selectedDateMillis?.let{onSelect(java.time.Instant.ofEpochMilli(it).atOffset(java.time.ZoneOffset.UTC).toLocalDate().coerceAtMost(today).toString())}
        calendar=false
      }){Text("查看")}},dismissButton={TextButton(onClick={calendar=false}){Text("取消")}}){DatePicker(picker)}
  }
}

@Composable internal fun MealNutritionHero(date:String,records:List<RecordSummary>,nutrition:MealNutrition,hasMore:Boolean,completeness:String?,onMeal:(RecordSummary)->Unit){
  var nutrient by rememberSaveable(date){mutableStateOf<String?>(null)}
  val editReference=LocalEditHealthReference.current
  val coverage=mealEnergyCoverage(records)
  val energy=when {
    coverage.total==0->HealthAssessment(HealthTone.Neutral,"未记录","当前日期没有可汇总的食物")
    coverage.recorded==0->HealthAssessment(HealthTone.Neutral,"未记热量","食物尚未记录热量")
    coverage.recorded<coverage.total->HealthAssessment(HealthTone.Neutral,"部分已记录","${coverage.total-coverage.recorded} 项食物未记热量，当前数值仅为已记录部分，暂不比较参考范围")
    else->metricAssessment("meal_kcal",nutrition.kcal,"kcal")
  }
  HealthSurface{
    Text(if(date==LocalDate.now().toString())"今日已记录热量" else "$date 已记录热量",style=MaterialTheme.typography.labelLarge)
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){
      Text(nutrition.kcal?.let{"${number(it)} kcal"}?:"—",Modifier.weight(1f),style=MaterialTheme.typography.displaySmall,fontWeight=FontWeight.SemiBold,color=MealCoral)
      if(coverage.total>0)TextButton(onClick={nutrient="热量"}){Text("热量来源")}
    }
    Text("${coverage.recorded}／${coverage.total} 项有热量"+if(hasMore)" · 仅已加载餐次" else "",style=MaterialTheme.typography.bodySmall)
    val diaryLabel=when(completeness){
      "complete"->"基本记全"
      "partial"->"部分记录"
      "recheck"->"待重新核对"
      "unknown"->"未标记完整性"
      else->null
    }
    val annotations=listOfNotNull(diaryLabel,"含估算".takeIf{nutrition.estimated})
    if(annotations.isNotEmpty())Text(annotations.joinToString(" · "),style=MaterialTheme.typography.labelSmall)
    if(nutrition.knownItems>0){NutrientBar(nutrition);Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){
      NutrientChip("蛋白质",nutrition.protein,ActivityGreen,Modifier.weight(1f)){nutrient="蛋白质"}
      NutrientChip("碳水",nutrition.carb,ActivityBlue,Modifier.weight(1f)){nutrient="碳水"}
      NutrientChip("脂肪",nutrition.fat,BodyOrange,Modifier.weight(1f)){nutrient="脂肪"}
    }
      if(!nutrition.completeMacros)Text("营养素有缺项，仅汇总已记录的克数",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    }
    var explained by rememberSaveable{mutableStateOf(false)}
    TextButton(onClick={explained=!explained}){Text(if(explained)"收起统计说明" else "如何计算")}
    if(explained){
      AssessmentLabel(energy)
      if(nutrition.completeMacros){
        listOf("蛋白质" to "protein","碳水" to "carb","脂肪" to "fat").forEach{(label,key)->
          val assessment=macroAssessment(nutrition,key)
          Text("$label · ${assessment.basis}",style=MaterialTheme.typography.bodySmall)
        }
      }
      Text("这里汇总有数据的食物。全天记录完整情况可在饮食与体重复盘中查看。",style=MaterialTheme.typography.bodySmall)
      TextButton(onClick={editReference("meal_kcal","每日摄入热量","kcal",false)}){Text("设置热量参考范围")}
    }
  }
  nutrient?.let{label->
    val contributors=records.flatMap{record->
      record.meal?.foods.orEmpty().map{food->
        val amount=when(label){"热量"->food.energyKcal;"蛋白质"->food.proteinG;"碳水"->food.carbG;else->food.fatG}
        Triple(record,food.name,amount?.toDoubleOrNull()?.takeIf(Double::isFinite))
      }
    }
    LifeFullScreen("$label 来源",{nutrient=null}){
      LazyColumn(verticalArrangement=Arrangement.spacedBy(8.dp)){
        items(contributors.sortedWith(compareByDescending<Triple<RecordSummary,String,Double?>>{it.third!=null}.thenByDescending{it.third?:0.0})){(record,name,value)->
          LifeCard(onClick={nutrient=null;onMeal(record)}){
            Text(name,style=MaterialTheme.typography.titleMedium)
            Text("${record.meal?.mealType?.let(::mealTypeUi).orEmpty()} · "+(value?.let{"${number(it)} "+if(label=="热量")"kcal" else "g"}?:"未记录"))
          }
        }
      }
    }
  }
}

@Composable private fun MealWeekIntake(days:List<DietReviewResultDtoWellnessDaysEntry>,selected:String,onDay:(String)->Unit){
  val max=days.mapNotNull{it.nutrients.energyKcal.knownTotal?.toDoubleOrNull()}.maxOrNull()?.coerceAtLeast(1.0)?:1.0
  LifeCard{
    Text("本周已记录热量",style=MaterialTheme.typography.titleMedium)
    days.sortedBy{it.date}.forEach{day->
      val energy=day.nutrients.energyKcal
      val total=energy.knownTotal?.toDoubleOrNull()
      val value=when{
        day.meals==0L->"未记餐次"
        total==null->"热量未提供"
        else->"${number(total)} kcal"
      }
      Row(Modifier.fillMaxWidth().clickable(role=Role.Button){onDay(day.date)}.heightIn(min=48.dp),
        verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)){
        Text(day.date.takeLast(5),color=if(selected==day.date)MealCoral else MaterialTheme.colorScheme.onSurface)
        Column(Modifier.weight(1f)){
          if(total!=null)LinearProgressIndicator({(total/max).toFloat().coerceIn(0f,1f)},Modifier.fillMaxWidth(),color=MealCoral)
          if(day.meals>0)Text("${energy.knownItems}/${day.items} 项有热量",style=MaterialTheme.typography.labelSmall)
        }
        Text(value,style=MaterialTheme.typography.labelLarge)
      }
    }
  }
}

@Composable internal fun NutrientBar(value:MealNutrition){
  if(!value.completeMacros)return
  val parts=listOf(value.protein!!*4 to ActivityGreen,value.carb!!*4 to ActivityBlue,value.fat!!*9 to BodyOrange)
  if(parts.sumOf{it.first}<=0)return
  Row(Modifier.fillMaxWidth().height(10.dp).clip(CircleShape)){parts.filter{it.first>0}.forEach{(amount,color)->Box(Modifier.weight(amount.toFloat()).fillMaxHeight().background(color))}}
}
@Composable private fun NutrientChip(label:String,value:Double?,color:Color,modifier:Modifier,onClick:()->Unit){
  Surface(onClick=onClick,modifier=modifier,shape=MaterialTheme.shapes.small,color=color.copy(alpha=.10f)){
    Column(Modifier.padding(10.dp),verticalArrangement=Arrangement.spacedBy(4.dp)){
      Text(label,style=MaterialTheme.typography.labelMedium)
      Text(value?.let{"${number(it)} g"}?:"未记录",style=MaterialTheme.typography.titleMedium,color=color)
    }
  }
}
@Composable private fun ActivityMetric(label:String,key:String,value:Double?,unit:String){val status=metricAssessment(key,value,unit,true);val edit=LocalEditHealthReference.current;val hasGoal=LocalHealthReferences.current[key]!=null;Column(Modifier.clickable(role=Role.Button){edit(key,label,unit,true)},verticalArrangement=Arrangement.spacedBy(5.dp)){RingLegend(label,value?.let{healthValueText(it,unit)}?:"—",unit,healthTone(status.tone));if(hasGoal)AssessmentLabel(status,false);Text(if(!hasGoal)"设置目标" else status.basis,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}

private data class PendingMealPreview(val id:String,val failed:Boolean,val foods:String)

@OptIn(ExperimentalLayoutApi::class)
private fun LazyListScope.mealDayGroups(
  grouped:Map<String?,List<RecordSummary>>,assetPreviews:Map<String,LoadState<ByteArray>>,onLoadAsset:(String)->Unit,
  onDetail:(LifeDomain,String,String)->Unit,onCapture:(String)->Unit,onAddPhoto:(RecordSummary)->Unit,onCopy:(RecordSummary)->Unit
){
  item("meal-day-heading"){Text("当天餐次",style=MaterialTheme.typography.titleLarge)}
  mealOrder.forEach{type->
    items(grouped[type].orEmpty(),key={"meal-day:${it.id}"}){record->
      MealGroupCard(record,assetPreviews,onLoadAsset,{onAddPhoto(record)},{onCopy(record)}){
        onDetail(LifeDomain.Meals,record.detailId?:record.id,record.title)
      }
    }
  }
  val missing=mealOrder.filter{it!="other"&&grouped[it].isNullOrEmpty()}
  if(missing.isNotEmpty())item("meal-day-capture"){
    FlowRow(horizontalArrangement=Arrangement.spacedBy(6.dp)){
      missing.forEach{type->AssistChip(onClick={onCapture(type)},label={Text("＋${mealTypeUi(type)}")})}
    }
  }
}
@OptIn(ExperimentalLayoutApi::class)
@Composable private fun MealGroupCard(
  record:RecordSummary,assetPreviews:Map<String,LoadState<ByteArray>>,onLoadAsset:(String)->Unit,
  onAddPhoto:()->Unit,onCopy:()->Unit,onClick:()->Unit
){
  val meal=record.meal?:return
  val nutrition=mealNutrition(listOf(record))
  HealthSurface(onClick=onClick){
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp)){
      if(meal.photoAssetVersionId!=null)MealPhoto(meal.photoAssetVersionId,assetPreviews,onLoadAsset,Modifier.size(76.dp))
      Column(Modifier.weight(1f)){
        Text(mealTypeUi(meal.mealType),style=MaterialTheme.typography.titleMedium)
        localDateTime(meal.occurredAt,meal.timeZone,includeDate=false)?.let{Text(it,style=MaterialTheme.typography.bodySmall)}
        Text(meal.foods.joinToString("、"){food->listOfNotNull(food.name,food.quantity,food.unit).joinToString(" ")}.ifBlank{"仅保存了餐照"},
          maxLines=3,overflow=TextOverflow.Ellipsis)
        nutrition.kcal?.let{Text("已记录 ${number(it)} kcal",color=MealCoral)}
      }
    }
    FlowRow(horizontalArrangement=Arrangement.spacedBy(6.dp)){
      if(meal.photoAssetVersionId==null)TextButton(onClick=onAddPhoto){Text("添加餐照")}
      if(meal.foods.isNotEmpty())TextButton(onClick=onCopy){Text("照这餐再记")}
    }
  }
}

@Composable private fun MealHistoryRow(record:RecordSummary,assetPreviews:Map<String,LoadState<ByteArray>>,onLoadAsset:(String)->Unit,onAddPhoto:()->Unit,onClick:()->Unit){val meal=record.meal;if(meal==null){RecordRow(record,onClick);return};Row(Modifier.fillMaxWidth().clickable(role=Role.Button,onClick=onClick).padding(vertical=8.dp),verticalAlignment=Alignment.CenterVertically,horizontalArrangement=Arrangement.spacedBy(12.dp)){MealPhoto(meal.photoAssetVersionId,assetPreviews,onLoadAsset,Modifier.size(58.dp),onAddPhoto);Column(Modifier.weight(1f)){Text(mealTypeUi(meal.mealType),style=MaterialTheme.typography.titleMedium);Text(record.title,maxLines=1,overflow=TextOverflow.Ellipsis,color=MaterialTheme.colorScheme.onSurfaceVariant);Text(meal.occurredOn,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)};record.trailing?.let{Text(it,style=MaterialTheme.typography.labelMedium)}}}
@Composable private fun MealPhoto(
  versionId:String?,states:Map<String,LoadState<ByteArray>>,onLoad:(String)->Unit,modifier:Modifier,onAdd:(()->Unit)?=null
){
  if(versionId==null){
    Surface(modifier.then(if(onAdd!=null)Modifier.clickable(role=Role.Button,onClick=onAdd) else Modifier),
      shape=RoundedCornerShape(20.dp),color=MealCoral.copy(alpha=.11f)){
      Box(contentAlignment=Alignment.Center){
        Column(horizontalAlignment=Alignment.CenterHorizontally){
          Text("＋",style=MaterialTheme.typography.headlineMedium,color=MealCoral)
          Text("添加餐照",style=MaterialTheme.typography.labelMedium,color=MealCoral)
        }
      }
    }
    return
  }
  LaunchedEffect(versionId){onLoad(versionId)}
  when(val state=states[versionId]){
    is LoadState.Ready->{
      val bytes=state.value
      val preview=rememberLifeRead(bytes){decodeMealThumbnail(bytes)}
      when(val result=preview.state){
        is LoadState.Ready->MealPhotoPreview(result.value,bytes,modifier)
        is LoadState.Failed->PhotoLoadFallback(modifier,"无法解码")
        else->PhotoLoading(modifier)
      }
    }
    is LoadState.Failed->PhotoLoadFallback(modifier,"点击重试"){onLoad(versionId)}
    else->PhotoLoading(modifier)
  }
}

private fun decodeMealThumbnail(bytes:ByteArray):ImageBitmap{
  val bounds=BitmapFactory.Options().apply{inJustDecodeBounds=true}
  BitmapFactory.decodeByteArray(bytes,0,bytes.size,bounds)
  var sample=1
  val edge=maxOf(bounds.outWidth,bounds.outHeight)
  while(edge/sample>768)sample*=2
  val options=BitmapFactory.Options().apply{inSampleSize=sample}
  return checkNotNull(BitmapFactory.decodeByteArray(bytes,0,bytes.size,options)){"无法解码餐照"}.asImageBitmap()
}

@Composable private fun PhotoLoading(modifier:Modifier){
  Surface(modifier,shape=RoundedCornerShape(20.dp),color=MaterialTheme.colorScheme.surfaceVariant){
    Box(contentAlignment=Alignment.Center){CircularProgressIndicator(Modifier.size(24.dp),strokeWidth=2.dp)}
  }
}

@Composable private fun MealPhotoPreview(thumbnail:ImageBitmap,bytes:ByteArray,modifier:Modifier){
  var full by rememberSaveable{mutableStateOf(false)}
  Image(thumbnail,"查看餐次照片",modifier.clip(RoundedCornerShape(20.dp)).clickable(role=Role.Button){full=true},contentScale=ContentScale.Crop)
  if(full)LifeFullScreen("餐次照片",{full=false}){
    val original=rememberLifeRead(bytes){
      checkNotNull(BitmapFactory.decodeByteArray(bytes,0,bytes.size)){"无法解码餐照"}.asImageBitmap()
    }
    var zoom by remember{mutableFloatStateOf(1f)}
    var offset by remember{mutableStateOf(Offset.Zero)}
    val transform=rememberTransformableState{scale,pan,_->
      zoom=(zoom*scale).coerceIn(1f,5f)
      offset=if(zoom==1f)Offset.Zero else offset+pan
    }
    Column(Modifier.fillMaxSize()){
      if(original.state is LoadState.Loading)LinearProgressIndicator(Modifier.fillMaxWidth())
      if(original.state is LoadState.Failed)StateContent(original.state,original.retry){}
      val bitmap=(original.state as? LoadState.Ready)?.value?:thumbnail
      Box(Modifier.weight(1f).fillMaxWidth().clipToBounds().transformable(transform)){
        Image(bitmap,"餐次照片",Modifier.fillMaxSize().graphicsLayer{
          scaleX=zoom;scaleY=zoom;translationX=offset.x;translationY=offset.y
        },contentScale=ContentScale.Fit)
      }
    }
  }
}
@Composable private fun PhotoLoadFallback(modifier:Modifier,label:String,onClick:(()->Unit)?=null){Surface(modifier.then(if(onClick!=null)Modifier.clickable(role=Role.Button,onClick=onClick) else Modifier),shape=RoundedCornerShape(20.dp),color=MaterialTheme.colorScheme.surfaceVariant){Box(contentAlignment=Alignment.Center){Text(label,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}

@Composable private fun HealthSurface(modifier:Modifier=Modifier,onClick:(()->Unit)?=null,content:@Composable ColumnScope.()->Unit){LifeCard(modifier,onClick,content)}
@Composable private fun TrendChart(
  points:List<HealthTrendPoint>,modifier:Modifier,color:Color,metricKey:String?=null,onOpen:((HealthTrendPoint)->Unit)?=null
){
  val epochs=remember(points){points.map{LocalDate.parse(it.occurredOn).toEpochDay()}}
  val positions=remember(epochs){
    val first=epochs.minOrNull()?:0L
    val span=((epochs.maxOrNull()?:first)-first).coerceAtLeast(1)
    epochs.map{(it-first).toFloat()/span}
  }
  val values=remember(points){points.map{it.value}}
  val reference=metricKey?.let{LocalHealthReferences.current[it]?:defaultHealthReference(it)}
  val palette=HealthTone.entries.map{healthTone(it)}
  val colors=remember(points,reference,palette,color,metricKey){
    points.map{if(metricKey==null)color else palette[assessHealth(it.value,it.unit,reference,false).tone.ordinal]}
  }
  val measurementsByDay=remember(points){
    points.groupBy{it.occurredOn}.mapValues{(_,readings)->readings.sortedBy{it.occurredAt.orEmpty()}}
  }
  val scheme=MaterialTheme.colorScheme
  val hitBounds=remember{floatArrayOf(0f,1f)}
  val pointIds=remember(points){points.map{it.id}}
  var selected by rememberSaveable(pointIds){mutableIntStateOf(points.lastIndex.coerceAtLeast(0))}
  Column(modifier,verticalArrangement=Arrangement.spacedBy(8.dp)){
    points.getOrNull(selected)?.let{point->
      Text(point.occurredOn,style=MaterialTheme.typography.labelLarge)
      measurementsByDay[point.occurredOn].orEmpty().forEach{reading->
        val time=reading.occurredAt?.let{runCatching{java.time.Instant.parse(it).atZone(java.time.ZoneId.systemDefault()).toLocalTime().toString().take(5)}.getOrNull()}
        val label=listOfNotNull(time,"${reading.valueText} ${unitLabel(reading.unit)}",sourceLabel(reading.sourceKind)).joinToString(" · ")
        if(onOpen==null)Text(label,style=MaterialTheme.typography.bodySmall)
        else TextButton(onClick={onOpen(reading)}){Text(label)}
      }
    }
    Box(Modifier.fillMaxWidth().weight(1f).clipToBounds().pointerInput(positions){
      detectTapGestures{position->
        val fraction=(position.x-hitBounds[0])/(hitBounds[1]-hitBounds[0]).coerceAtLeast(1f)
        selected=positions.indices.minByOrNull{abs(positions[it]-fraction)}?:0
      }
    }.drawWithCache{
      if(values.isEmpty())return@drawWithCache onDrawBehind{}
      val axisPaint=textPaint(Paint.Align.RIGHT).apply{
        this.color=scheme.onSurfaceVariant.toArgb()
        textSize=11.sp.toPx()
      }
      val pointPaint=textPaint(Paint.Align.LEFT,true).apply{
        this.color=colors.last().toArgb()
        textSize=12.sp.toPx()
      }
      val rawMin=values.min()
      val rawMax=values.max()
      val padding=((rawMax-rawMin)*.12).takeIf{it>.000001}?:maxOf(abs(rawMax)*.01,.5)
      val min=rawMin-padding
      val max=rawMax+padding
      val range=max-min
      val unit=points.last().unit
      val ticks=List(4){index->healthValueText(max-range*index/3,unit)}
      val axisGap=8.dp.toPx()
      val left=ticks.maxOf{axisPaint.measureText(it)}+axisGap
      val right=size.width-6.dp.toPx()
      hitBounds[0]=left
      hitBounds[1]=right
      val top=pointPaint.fontSpacing+12.dp.toPx()
      val bottom=size.height-axisPaint.fontSpacing/2-4.dp.toPx()
      if(right<=left||bottom<=top)return@drawWithCache onDrawBehind{}
      val axisBaseline=-(axisPaint.ascent()+axisPaint.descent())/2
      val offsets=values.mapIndexed{index,value->
        Offset(if(values.size==1)(left+right)/2 else left+(right-left)*positions[index],
          bottom-(bottom-top)*((value-min)/range).toFloat())
      }
      val path=Path().apply{
        offsets.forEachIndexed{index,point->
          if(index==0||epochs[index]-epochs[index-1]>1)moveTo(point.x,point.y) else lineTo(point.x,point.y)
        }
      }
      val showAllMarkers=values.size<=1||(right-left)/values.lastIndex>=10.dp.toPx()
      val markerIndices=if(showAllMarkers)values.indices else values.lastIndex..values.lastIndex
      val latest=offsets.last()
      val label=healthValueText(values.last(),unit)
      val labelWidth=pointPaint.measureText(label)
      val labelPadding=3.dp.toPx()
      val labelBaseline=latest.y-9.dp.toPx()
      val labelX=if(labelWidth+labelPadding*2<=right-left)
        (latest.x-labelWidth/2).coerceIn(left+labelPadding,right-labelWidth-labelPadding) else null
      onDrawBehind{
        ticks.forEachIndexed{index,tick->
          val y=top+(bottom-top)*index/3f
          drawLine(scheme.outline.copy(alpha=.35f),Offset(left,y),Offset(right,y),1.dp.toPx())
          drawContext.canvas.nativeCanvas.drawText(tick,left-axisGap,y+axisBaseline,axisPaint)
        }
        if(values.size>1)drawPath(path,color,style=Stroke(3.dp.toPx(),cap=StrokeCap.Round))
        markerIndices.forEach{index->
          drawCircle(scheme.surface,5.dp.toPx(),offsets[index])
          drawCircle(colors[index],3.dp.toPx(),offsets[index])
        }
        val index=selected
        offsets.getOrNull(index)?.let{point->
          drawLine(scheme.outline,Offset(point.x,top),Offset(point.x,bottom),1.dp.toPx())
          drawCircle(colors[index],5.dp.toPx(),point)
        }
        if(labelX!=null){
          drawRoundRect(scheme.surface.copy(alpha=.94f),
            Offset(labelX-labelPadding,labelBaseline+pointPaint.ascent()-labelPadding),
            Size(labelWidth+labelPadding*2,pointPaint.descent()-pointPaint.ascent()+labelPadding*2),
            cornerRadius=androidx.compose.ui.geometry.CornerRadius(labelPadding))
          drawContext.canvas.nativeCanvas.drawText(label,labelX,labelBaseline,pointPaint)
        }
      }
    })
  }
}

private fun textPaint(align:Paint.Align,bold:Boolean=false)=Paint(Paint.ANTI_ALIAS_FLAG).apply{textAlign=align;typeface=if(bold)Typeface.create(Typeface.DEFAULT,Typeface.BOLD) else Typeface.DEFAULT}

@Composable private fun WeekBarChart(dates:List<LocalDate>,values:List<Double?>,color:Color,unit:String,selectedDay:String?,onDay:(String)->Unit){
  val max=values.filterNotNull().maxOrNull()?.coerceAtLeast(1.0)?:1.0
  Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(3.dp)){
    dates.forEachIndexed{index,date->
      val value=values[index]
      val selected=date.toString()==selectedDay
      Column(Modifier.weight(1f).clickable(role=Role.Button){onDay(date.toString())}.semantics{
        this.selected=selected
        contentDescription="$date，"+(value?.let{"${number(it)} $unit"}?:"未记录")
      },horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(4.dp)){
        Box(Modifier.fillMaxWidth(.48f).height(88.dp).clip(RoundedCornerShape(6.dp)).background(MaterialTheme.colorScheme.surfaceVariant),contentAlignment=Alignment.BottomCenter){
          if(value!=null&&value>0)Box(Modifier.fillMaxWidth().fillMaxHeight((value/max).toFloat().coerceIn(0f,1f)).background(color))
        }
        Text(dayUi(date),style=MaterialTheme.typography.labelMedium,color=if(selected)color else MaterialTheme.colorScheme.onSurfaceVariant)
        Text(value?.let(::number)?:"—",style=MaterialTheme.typography.labelSmall)
        Box(Modifier.size(5.dp).clip(CircleShape).background(if(selected)color else Color.Transparent))
      }
    }
  }
}
@Composable private fun MiniTrend(points:List<HealthTrendPoint>,modifier:Modifier,color:Color=MaterialTheme.colorScheme.primary){
  if(points.isEmpty()){
    Box(modifier,contentAlignment=Alignment.CenterStart){Text("等待数据",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}
    return
  }
  val values=points.takeLast(20).map{it.value}
  Canvas(modifier.clipToBounds()){
    // Compact cards need the full plotting area: no axes, labels or per-sample markers.
    val inset=5.dp.toPx()
    val width=size.width-inset*2
    val height=size.height-inset*2
    if(width<=0||height<=0)return@Canvas
    val min=values.minOrNull()?:return@Canvas
    val max=values.maxOrNull()?:return@Canvas
    val span=max-min
    val offsets=values.mapIndexed{index,value->
      Offset(
        if(values.size==1)size.width/2 else inset+width*index/values.lastIndex,
        if(span==0.0)size.height/2 else inset+height*(1-((value-min)/span).toFloat())
      )
    }
    val path=Path()
    offsets.forEachIndexed{index,point->if(index==0)path.moveTo(point.x,point.y) else path.lineTo(point.x,point.y)}
    drawPath(path,color,style=Stroke(2.dp.toPx(),cap=StrokeCap.Round))
    drawCircle(color,3.dp.toPx(),offsets.last())
  }
}
@Composable private fun ChartEmpty(text:String){Box(Modifier.fillMaxWidth().height(150.dp).clip(RoundedCornerShape(20.dp)).background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha=.34f)),contentAlignment=Alignment.Center){Text(text,color=MaterialTheme.colorScheme.onSurfaceVariant,modifier=Modifier.padding(24.dp))}}
@Composable private fun ChartDateRange(from:String,to:String){Row(Modifier.fillMaxWidth()){Text(from.takeLast(5),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);Spacer(Modifier.weight(1f));Text(to.takeLast(5),style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
@Composable private fun SummaryFact(label:String,value:String,modifier:Modifier=Modifier){Column(modifier){Text(label,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);Text(value,style=MaterialTheme.typography.titleMedium,maxLines=1,overflow=TextOverflow.Ellipsis)}}
@Composable private fun HealthFact(label:String,value:String,modifier:Modifier=Modifier){Column(modifier.padding(vertical=4.dp)){Text(label,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);Text(value,style=MaterialTheme.typography.titleMedium)}}
@Composable private fun SourcePill(label:String,tone:Color){Surface(shape=CircleShape,color=tone.copy(alpha=.12f)){Text(label,Modifier.padding(horizontal=10.dp,vertical=6.dp),style=MaterialTheme.typography.labelMedium,color=tone)}}

@Composable private fun healthSourceColor(overview:WorkspaceOverview.Health?)=when{overview==null->MaterialTheme.colorScheme.onSurfaceVariant;overview.sourcesNeedingAttention>0->MaterialTheme.colorScheme.error;else->ActivityGreen}
private fun healthSourceLine(value:WorkspaceOverview.Health?)=when{value==null->"正在读取健康数据";value.sources==0->"尚未接入数据来源";value.sourcesNeedingAttention>0->"${value.sourcesNeedingAttention} 个来源需要处理";else->"已接入 ${value.sources} 个数据来源"}
private fun bodySnapshotMetrics(metrics:List<HealthMetricTrend>):List<HealthMetricTrend>{val order=listOf("weight","bmi","body_fat","fat_mass","lean_mass","skeletal_muscle","muscle_mass","muscle_rate","body_water","body_water_rate","bone_mass","bone_rate","visceral_fat","bmr","heart_rate");val ordered=order.mapNotNull{key->metrics.firstOrNull{it.key==key}};return ordered.filter{it.points.isNotEmpty()}.ifEmpty{ordered.take(4)}}
private fun lastSevenDays(history:List<HealthDailyOverview>):List<Pair<LocalDate,HealthDailyOverview?>> = (0L..6L).map{LocalDate.now().minusDays(it)}.reversed().map{date->date to history.firstOrNull{it.occurredOn==date.toString()}}
private fun dayUi(date:LocalDate)=listOf("一","二","三","四","五","六","日")[date.dayOfWeek.value-1]
internal fun sourceLabel(value:String)=mapOf("scale" to "小米体脂秤","xiaomi_scale" to "小米体脂秤","samsung" to "Samsung Health","samsung_health" to "Samsung Health","samsung_data_sdk" to "Samsung Health","health_connect" to "Health Connect","manual" to "手动记录","legacy_health" to "旧 Health 迁移","derived" to "由原始测量计算")[value.lowercase()]?:value
internal fun unitLabel(value:String)=mapOf("level" to "级","kcal/day" to "kcal/天","bpm" to "次/分")[value.lowercase()]?:value
internal fun workoutTypeUi(value:String):String{val key=value.trim().lowercase().replace(' ','_').replace('-','_');return mapOf("walk" to "健走","walking" to "健走","brisk_walking" to "健走","run" to "跑步","running" to "跑步","track_running" to "田径跑","jogging" to "慢跑","treadmill" to "跑步机","treadmill_running" to "跑步机跑步","running_treadmill" to "跑步机跑步","walking_treadmill" to "跑步机健走","cycling" to "自行车","biking" to "自行车","stationary_biking" to "室内自行车","indoor_cycling" to "室内自行车","mountain_biking" to "山地自行车","hiking" to "徒步","backpacking" to "旅行徒步","swimming" to "游泳","pool_swimming" to "游泳","open_water_swimming" to "户外游泳","strength_training" to "力量训练","weight_training" to "力量训练","weightlifting" to "举重","weight_machine" to "器械训练","circuit_training" to "循环训练","hiit" to "高强度间歇训练","rowing" to "划船","rowing_machine" to "划船机","elliptical" to "椭圆机","stair_climbing" to "爬楼梯","stair_climbing_machine" to "登阶机","step_machine" to "踏步机","yoga" to "瑜伽","pilates" to "普拉提","stretching" to "拉伸","dance" to "舞蹈","dancing" to "舞蹈","aerobics" to "有氧操","jump_rope" to "跳绳","football" to "足球","soccer" to "足球","basketball" to "篮球","badminton" to "羽毛球","tennis" to "网球","table_tennis" to "乒乓球","other" to "其他运动")[key]?:if(value.any{it.code>127})value else "其他运动 · ${value.replace('_',' ')}"}
@Composable private fun workoutTone(value:String):Color=when{value.contains("run",true)||value.contains("walk",true)||value.contains("hik",true)||value.contains("backpack",true)->ActivityGreen;value.contains("swim",true)||value.contains("row",true)->ActivityBlue;value.contains("strength",true)||value.contains("weight",true)||value.contains("circuit",true)->BodyOrange;else->ActivityPurple}
private fun workoutGlyph(value:String)=when{value.contains("run",true)->"↗";value.contains("walk",true)||value.contains("hik",true)||value.contains("backpack",true)->"↟";value.contains("swim",true)->"≈";value.contains("cycl",true)||value.contains("bik",true)->"◎";value.contains("strength",true)||value.contains("weight",true)||value.contains("circuit",true)->"◆";else->"●"}
private fun mealTypeUi(value:String)=mapOf("breakfast" to "早餐","lunch" to "午餐","dinner" to "晚餐","snack" to "加餐","other" to "其他")[value]?:"一餐"
private fun minutesLabel(value:Long)=if(value>=60)"${value/60} 小时 ${value%60} 分" else "$value 分钟"
private fun signed(value:Double)=(if(value>0)"+" else "")+number(value)
private fun number(value:Double):String=BigDecimal.valueOf(value).setScale(if(abs(value)>=100)0 else 1,RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()
