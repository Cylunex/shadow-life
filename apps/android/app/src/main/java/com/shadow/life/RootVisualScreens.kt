package com.shadow.life

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.itemsIndexed
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

@OptIn(ExperimentalLayoutApi::class)
@Composable fun TodayVisualScreen(
  accountId:String,state:LoadState<TodaySnapshot>,healthState:LoadState<WorkspaceOverview.Health>,deviceStatus:DeviceSyncStatus,queueState:LoadState<QueueSummary>,samsungAvailable:Boolean,onRetry:()->Unit,
  onWorkspace:(LifeDomain,String)->Unit,onItems:()->Unit,onPlans:()->Unit,onLibrary:()->Unit,onDetail:(LifeDomain,String,String)->Unit,onRecords:()->Unit,onInbox:()->Unit,onFeatures:()->Unit,onCapture:(CaptureKind)->Unit,
  onHealthSync:()->Unit,onSamsungSync:()->Unit,onScale:()->Unit,onProjects:()->Unit,onSettings:()->Unit
){
  val context=LocalContext.current
  val layoutStore=remember(context,accountId){TodayCardLayoutStore(context,accountId)}
  var cards by remember(accountId){mutableStateOf(layoutStore.current())}
  var editCards by rememberSaveable(accountId){mutableStateOf(false)}
  val updateCards:(List<TodayCardKind>)->Unit={next->cards=next;layoutStore.save(next)}
  val today=(state as? LoadState.Ready)?.value
  val health=(healthState as? LoadState.Ready)?.value
  RootPage("今天",onProjects,onSettings,onRecords){padding->LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(20.dp,8.dp,20.dp,112.dp),verticalArrangement=Arrangement.spacedBy(20.dp)){
    item{Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text(LocalDate.now().format(DateTimeFormatter.ofPattern("M 月 d 日 EEEE",Locale.CHINA)),Modifier.weight(1f),style=MaterialTheme.typography.titleMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);TextButton(onClick={editCards=true}){Text("编辑卡片")}}}
    item{StateContent(state,onRetry){} }
    if(cards.isEmpty())item{EmptyState("首页还没有卡片","添加卡片"){editCards=true}}
    cards.forEach{card->when(card){
      TodayCardKind.Focus->today?.let{item(key=card.key){TodayFocusCard(it,{domain->onWorkspace(domain,"")},onDetail)}}
      TodayCardKind.Scale->item(key=card.key){TodayScaleReceiver(deviceStatus,queueState,onScale,onSettings)}
      TodayCardKind.Health->today?.let{item(key=card.key){TodayHealthOverviewCard(it,health){onWorkspace(LifeDomain.Health,"overview")}}}
      TodayCardKind.Body->today?.let{item(key=card.key){TodayBodyCard(it,health){onWorkspace(LifeDomain.Health,"body")}}}
      TodayCardKind.Activity->today?.let{item(key=card.key){TodayActivityCard(it,health){onWorkspace(LifeDomain.Health,"activity")}}}
      TodayCardKind.Sleep->today?.let{item(key=card.key){TodaySleepCard(it,health){onWorkspace(LifeDomain.Health,"sleep")}}}
      TodayCardKind.Meals->today?.let{item(key=card.key){TodayMealsCard(it){onWorkspace(LifeDomain.Meals,"")}}}
      TodayCardKind.Money->today?.let{item(key=card.key){val money=it.moneyTotals.firstOrNull();TodayLinkCard("消费",money?.let{value->"${value.currency} ${value.netSpending}"}?:"今天无收支",if(it.moneyTotals.size>1)"${it.moneyTotals.size} 种币种分别统计 · 查看本月明细" else "预算、订阅与本月收支明细","¥",MaterialTheme.colorScheme.secondary){onWorkspace(LifeDomain.Money,"")}}}
      TodayCardKind.Travel->today?.let{item(key=card.key){val trip=it.currentTrips.firstOrNull();TodayLinkCard("旅行",trip?.title?:"还没有进行中的旅程",trip?.let{value->"${value.startsOn} — ${value.endsOn}"}?:"行程、地点、轨迹与回忆","行",MaterialTheme.colorScheme.tertiary){onWorkspace(LifeDomain.Travel,"overview")}}}
      TodayCardKind.TravelMap->today?.let{item(key=card.key){TodayLinkCard("旅行地图",it.currentTrips.firstOrNull()?.title?:"打开足迹地图","真实地点、主题地图和上传轨迹","⌖",MaterialTheme.colorScheme.secondary){onWorkspace(LifeDomain.Travel,"map")}}}
      TodayCardKind.Items->item(key=card.key){TodayLinkCard("物品","使用、维护与补给","保修、退货、资料和维护事件","◇",MaterialTheme.colorScheme.primary,onItems)}
      TodayCardKind.Plans->today?.let{item(key=card.key){TodayLinkCard("计划",if(it.dueItems.isEmpty())"今天没有待处理事项" else "${it.dueItems.size} 项待处理","项目行动、生活计划与回顾","计",MaterialTheme.colorScheme.secondary,onPlans)}}
      TodayCardKind.Agenda->today?.let{item(key=card.key){TodayAgenda(it,onInbox)}}
      TodayCardKind.QuickCapture->item(key=card.key){QuickCaptureGrid(onCapture,onFeatures)}
      TodayCardKind.Library->today?.let{item(key=card.key){TodayLinkCard("资料",it.libraryCaptured?.let{count->"今天收存 $count 份"}?:"打开资料库","照片、文件、链接、笔记与票券","资",MaterialTheme.colorScheme.secondary,onLibrary)}}
      TodayCardKind.Records->item(key=card.key){TodayLinkCard("全部记录","生活时间线","按领域和时间筛选，并进入每条记录详情","录",MaterialTheme.colorScheme.primary,onRecords)}
      TodayCardKind.DeviceSync->item(key=card.key){CompactTodaySync(deviceStatus,queueState,samsungAvailable,onHealthSync,onSamsungSync,onSettings)}
    }
    }
  }}
  if(editCards)TodayCardManager(cards,updateCards,{cards=layoutStore.reset()},{editCards=false})
}

@Composable private fun TodayFocusCard(value:TodaySnapshot,onWorkspace:(LifeDomain)->Unit,onDetail:(LifeDomain,String,String)->Unit){
  val trip=value.currentTrips.firstOrNull()
  val open:()->Unit=if(trip!=null){{onDetail(LifeDomain.Travel,trip.id,trip.title)}} else {{onWorkspace(LifeDomain.Health)}}
  val headline=trip?.title?:when(value.health.state){HealthSummaryState.Ready->value.health.weight?.let{"最近体重 $it ${value.health.weightUnit.orEmpty()}"}?:"健康数据已更新";HealthSummaryState.Failed->"健康摘要需要重试";else->"从一条真实记录开始"}
  val subtitle=trip?.let{"${it.startsOn} — ${it.endsOn}"}?:listOfNotNull(value.health.steps?.let{"$it 步"},value.health.sleepMinutes?.let{"睡眠 ${rootMinutes(it)}"}).joinToString(" · ").ifBlank{"今天可以保持空白，不会填充虚构状态"}
  LifeCard(onClick=open){Text(if(trip!=null)"今日旅程" else "今日状态",style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.primary);Text(headline,style=MaterialTheme.typography.headlineMedium,fontWeight=FontWeight.SemiBold);Text(subtitle,color=MaterialTheme.colorScheme.onSurfaceVariant);if(trip!=null)Button(onClick=open){Text("继续旅程")}}
}

@Composable private fun TodayHealthOverviewCard(value:TodaySnapshot,health:WorkspaceOverview.Health?,onClick:()->Unit){
  val daily=health?.daily;val history=health?.history.orEmpty().takeLast(7);val tone=MaterialTheme.colorScheme.primary
  PremiumTodayCard(tone,onClick){
    TodayCardHeader("健康总览","健",tone,"今日与近 7 天")
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp)){
      TodayMetric("步数",(daily?.steps?:value.health.steps)?.let{String.format(Locale.US,"%,d",it)}?:"—","步",tone,Modifier.weight(1f))
      TodayMetric("活跃",daily?.activeMinutes?.toString()?:"—","分钟",MaterialTheme.colorScheme.secondary,Modifier.weight(1f))
      TodayMetric("睡眠",(daily?.sleepMinutes?:value.health.sleepMinutes)?.let{String.format(Locale.US,"%.1f",it/60.0)}?:"—","小时",MaterialTheme.colorScheme.tertiary,Modifier.weight(1f))
    }
    MiniBarChart(history.map{it.steps?.toDouble()},tone,Modifier.fillMaxWidth().height(66.dp))
    Text(if(history.any{it.steps!=null})"每日步数趋势" else "同步 Samsung Health 后显示真实趋势",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@Composable private fun TodayBodyCard(value:TodaySnapshot,health:WorkspaceOverview.Health?,onClick:()->Unit){
  val tone=MaterialTheme.colorScheme.tertiary;val weight=health.metric("weight");val bodyFat=health.metric("body_fat");val muscle=health.metric("muscle_mass").ifEmpty{health.metric("skeletal_muscle")};val latest=weight.lastOrNull()
  PremiumTodayCard(tone,onClick){
    TodayCardHeader("身体分析","体",tone,latest?.occurredOn?:value.health.weightOn?:"等待测量")
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.Bottom){
      Text(latest?.valueText?:value.health.weight?:"—",style=MaterialTheme.typography.displaySmall,fontWeight=FontWeight.SemiBold)
      Text(" ${latest?.unit?:value.health.weightUnit.orEmpty()}",Modifier.padding(bottom=5.dp),style=MaterialTheme.typography.titleMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
      Spacer(Modifier.weight(1f));Text(trendDelta(weight),style=MaterialTheme.typography.labelLarge,color=tone)
    }
    MiniSparkline(weight.map{it.value},tone,Modifier.fillMaxWidth().height(62.dp))
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp)){
      BodyFact("体脂率",bodyFat.lastOrNull(),Modifier.weight(1f));BodyFact("肌肉量",muscle.lastOrNull(),Modifier.weight(1f));BodyFact("数据点",weight.size.toString(),"条",Modifier.weight(1f))
    }
  }
}

@Composable private fun TodayActivityCard(value:TodaySnapshot,health:WorkspaceOverview.Health?,onClick:()->Unit){
  val tone=MaterialTheme.colorScheme.primary;val history=health?.history.orEmpty().takeLast(7);val today=health?.daily
  PremiumTodayCard(tone,onClick){
    TodayCardHeader("运动与活动","动",tone,"Samsung Health")
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.Bottom){Text((today?.steps?:value.health.steps)?.let{String.format(Locale.US,"%,d",it)}?:"—",style=MaterialTheme.typography.displaySmall,fontWeight=FontWeight.SemiBold);Text(" 步",Modifier.padding(bottom=5.dp),color=MaterialTheme.colorScheme.onSurfaceVariant);Spacer(Modifier.weight(1f));Column(horizontalAlignment=Alignment.End){Text(today?.activeMinutes?.let{"$it 分钟"}?:"活跃时长 —",style=MaterialTheme.typography.titleMedium);Text(today?.caloriesKcal?.let{"$it 千卡"}?:"能量未提供",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
    MiniBarChart(history.map{it.steps?.toDouble()},tone,Modifier.fillMaxWidth().height(78.dp))
    Text("近 7 天 · ${history.count{it.steps!=null}} 天有步数",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@Composable private fun TodaySleepCard(value:TodaySnapshot,health:WorkspaceOverview.Health?,onClick:()->Unit){
  val tone=MaterialTheme.colorScheme.secondary;val history=health?.history.orEmpty().takeLast(7);val today=health?.daily;val minutes=today?.sleepMinutes?:value.health.sleepMinutes
  PremiumTodayCard(tone,onClick){
    TodayCardHeader("睡眠","眠",tone,today?.sleepSource?.let(::sourceLabelForToday)?:"最近记录")
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.Bottom){Text(minutes?.let(::rootMinutes)?:"—",style=MaterialTheme.typography.headlineLarge,fontWeight=FontWeight.SemiBold);Spacer(Modifier.weight(1f));Column(horizontalAlignment=Alignment.End){Text(today?.deepMinutes?.let{"深睡 ${rootMinutes(it)}"}?:"深睡 —",style=MaterialTheme.typography.bodyMedium);Text(today?.remMinutes?.let{"REM ${rootMinutes(it)}"}?:"REM —",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
    MiniBarChart(history.map{it.sleepMinutes?.toDouble()},tone,Modifier.fillMaxWidth().height(70.dp))
    Text("近 7 天实际睡眠时长",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@Composable private fun TodayMealsCard(value:TodaySnapshot,onClick:()->Unit){val tone=MaterialTheme.colorScheme.tertiary;PremiumTodayCard(tone,onClick){TodayCardHeader("饮食","食",tone,"食物、营养与餐照");Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.Bottom){Text(value.mealCount?.toString()?:"0",style=MaterialTheme.typography.displaySmall,fontWeight=FontWeight.SemiBold);Text(" 餐记录",Modifier.padding(bottom=5.dp),color=MaterialTheme.colorScheme.onSurfaceVariant);Spacer(Modifier.weight(1f));Text("查看全部 ›",color=tone,fontWeight=FontWeight.SemiBold)};Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){listOf("餐次","营养","图片").forEach{label->Surface(shape=RoundedCornerShape(99.dp),color=tone.copy(alpha=.12f)){Text(label,Modifier.padding(horizontal=12.dp,vertical=7.dp),style=MaterialTheme.typography.labelMedium,color=tone)}}}}}

@Composable private fun PremiumTodayCard(tone:Color,onClick:()->Unit,content:@Composable ColumnScope.()->Unit){
  val shape=RoundedCornerShape(25.dp);val surface=MaterialTheme.colorScheme.surface;val variant=MaterialTheme.colorScheme.surfaceVariant
  Box(Modifier.fillMaxWidth().shadow(12.dp,shape,ambientColor=tone.copy(alpha=.12f),spotColor=tone.copy(alpha=.18f)).clip(shape).background(Brush.linearGradient(listOf(tone.copy(alpha=.11f),surface,variant.copy(alpha=.72f)))).border(1.dp,Brush.linearGradient(listOf(tone.copy(alpha=.62f),MaterialTheme.colorScheme.outline.copy(alpha=.25f),tone.copy(alpha=.16f))),shape).clickable(role=Role.Button,onClick=onClick)){
    Column(Modifier.fillMaxWidth().padding(18.dp),verticalArrangement=Arrangement.spacedBy(13.dp),content=content)
  }
}

@Composable private fun TodayCardHeader(title:String,mark:String,tone:Color,trailing:String){Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Surface(Modifier.size(38.dp),shape=RoundedCornerShape(13.dp),color=tone.copy(alpha=.16f)){Box(contentAlignment=Alignment.Center){Text(mark,fontWeight=FontWeight.Bold,color=tone)}};Spacer(Modifier.width(10.dp));Text(title,Modifier.weight(1f),style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.SemiBold);Text(trailing,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);Spacer(Modifier.width(5.dp));Text("›",style=MaterialTheme.typography.titleLarge,color=MaterialTheme.colorScheme.onSurfaceVariant)} }
@Composable private fun TodayMetric(label:String,value:String,unit:String,tone:Color,modifier:Modifier){Column(modifier){Text(label,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);Row(verticalAlignment=Alignment.Bottom){Box(Modifier.size(7.dp).background(tone,RoundedCornerShape(99.dp)));Spacer(Modifier.width(6.dp));Text(value,style=MaterialTheme.typography.titleLarge,fontWeight=FontWeight.SemiBold,maxLines=1);Text(" $unit",Modifier.padding(bottom=2.dp),style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}}
@Composable private fun BodyFact(label:String,point:HealthTrendPoint?,modifier:Modifier){BodyFact(label,point?.valueText?:"—",point?.unit.orEmpty(),modifier)}
@Composable private fun BodyFact(label:String,value:String,unit:String,modifier:Modifier){Surface(modifier,shape=RoundedCornerShape(15.dp),color=MaterialTheme.colorScheme.surface.copy(alpha=.62f)){Column(Modifier.padding(10.dp)){Text(label,style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant);Text("$value${unit.takeIf(String::isNotBlank)?.let{" $it"}.orEmpty()}",style=MaterialTheme.typography.titleSmall,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis)}}}

@Composable private fun MiniBarChart(values:List<Double?>,tone:Color,modifier:Modifier){Canvas(modifier){val valid=values.filterNotNull();if(valid.isEmpty())return@Canvas;val max=valid.maxOrNull()?.coerceAtLeast(1.0)?:1.0;val gap=5.dp.toPx();val count=values.size.coerceAtLeast(1);val width=((size.width-gap*(count-1))/count).coerceAtLeast(3.dp.toPx());values.forEachIndexed{index,value->val ratio=((value?:0.0)/max).toFloat().coerceIn(0f,1f);val left=index*(width+gap);drawRoundRect(color=tone.copy(alpha=if(value==null).12f else .82f),topLeft=Offset(left,size.height*(1f-ratio.coerceAtLeast(.08f))),size=androidx.compose.ui.geometry.Size(width,size.height*ratio.coerceAtLeast(.08f)),cornerRadius=androidx.compose.ui.geometry.CornerRadius(width/2,width/2))}}}
@Composable private fun MiniSparkline(values:List<Double>,tone:Color,modifier:Modifier){Canvas(modifier){if(values.isEmpty())return@Canvas;val min=values.minOrNull()?:0.0;val max=values.maxOrNull()?:min;val span=(max-min).takeIf{it>0}?:1.0;val points=values.mapIndexed{index,value->Offset(if(values.size==1)size.width else size.width*index/(values.lastIndex),size.height-(size.height*((value-min)/span).toFloat()*.72f+size.height*.14f))};points.zipWithNext().forEach{(a,b)->drawLine(tone,a,b,3.dp.toPx(),StrokeCap.Round)};points.lastOrNull()?.let{drawCircle(tone,4.dp.toPx(),it)}}}
private fun WorkspaceOverview.Health?.metric(key:String)=this?.metrics?.firstOrNull{it.key==key}?.points.orEmpty()
private fun trendDelta(points:List<HealthTrendPoint>):String{val pair=points.takeLast(2);if(pair.size<2)return "趋势待积累";val delta=pair[1].value-pair[0].value;return (if(delta>0)"↑ " else if(delta<0)"↓ " else "→ ")+java.math.BigDecimal.valueOf(kotlin.math.abs(delta)).setScale(1,java.math.RoundingMode.HALF_UP).stripTrailingZeros().toPlainString()}
private fun sourceLabelForToday(value:String)=when(value.lowercase()){"samsung","samsung_health","samsung_data_sdk"->"Samsung Health";"health_connect"->"Health Connect";else->value}

@Composable private fun TodayLinkCard(title:String,value:String,subtitle:String,mark:String,tone:Color,onClick:()->Unit){PremiumTodayCard(tone,onClick){TodayCardHeader(title,mark,tone,"查看");Text(value,style=MaterialTheme.typography.headlineSmall,fontWeight=FontWeight.SemiBold,maxLines=1,overflow=TextOverflow.Ellipsis);Text(subtitle,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant,maxLines=2,overflow=TextOverflow.Ellipsis)}}

@Composable private fun TodayCardManager(cards:List<TodayCardKind>,onChange:(List<TodayCardKind>)->Unit,onReset:()->Unit,onDismiss:()->Unit){
  val hidden=TodayCardKind.entries.filterNot{it in cards}
  Dialog(onDismissRequest=onDismiss){
    Surface(Modifier.fillMaxWidth().heightIn(max=700.dp),shape=RoundedCornerShape(28.dp),color=MaterialTheme.colorScheme.surface,border=androidx.compose.foundation.BorderStroke(1.dp,MaterialTheme.colorScheme.outline)){
      Column(Modifier.padding(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Column(Modifier.weight(1f)){Text("编辑首页卡片",style=MaterialTheme.typography.headlineSmall);Text("添加、隐藏并调整显示顺序",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};TextButton(onClick=onDismiss){Text("完成")}}
        HorizontalDivider()
        LazyColumn(Modifier.weight(1f,false),verticalArrangement=Arrangement.spacedBy(10.dp)){
          if(cards.isNotEmpty())item{Text("首页已显示",style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.primary)}
          itemsIndexed(cards,key={_,item->"visible:${item.key}"}){index,item->
            Surface(shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.surfaceVariant.copy(alpha=.5f)){
              Column(Modifier.padding(12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
                Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Surface(Modifier.size(30.dp),shape=RoundedCornerShape(99.dp),color=MaterialTheme.colorScheme.primaryContainer){Box(contentAlignment=Alignment.Center){Text("${index+1}",style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onPrimaryContainer)}};Spacer(Modifier.width(10.dp));Column(Modifier.weight(1f)){Text(item.title,style=MaterialTheme.typography.titleMedium);Text(item.description,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};TextButton(onClick={onChange(cards.filterNotSame(item))}){Text("隐藏")}}
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)){OutlinedButton(onClick={if(index>0)onChange(moveTodayCard(cards,index,index-1))},enabled=index>0,modifier=Modifier.weight(1f)){Text("上移")};OutlinedButton(onClick={if(index<cards.lastIndex)onChange(moveTodayCard(cards,index,index+1))},enabled=index<cards.lastIndex,modifier=Modifier.weight(1f)){Text("下移")}}
              }
            }
          }
          if(hidden.isNotEmpty())item{Text("可添加卡片",Modifier.padding(top=8.dp),style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.primary)}
          items(hidden,key={"hidden:${it.key}"}){item->Surface(shape=RoundedCornerShape(18.dp),color=MaterialTheme.colorScheme.surfaceVariant.copy(alpha=.34f)){Row(Modifier.fillMaxWidth().padding(12.dp),verticalAlignment=Alignment.CenterVertically){Column(Modifier.weight(1f)){Text(item.title,style=MaterialTheme.typography.titleMedium);Text(item.description,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};Button(onClick={onChange(cards+item)}){Text("添加")}}}}
        }
        HorizontalDivider()
        TextButton(onClick=onReset,modifier=Modifier.align(Alignment.Start)){Text("恢复默认布局")}
      }
    }
  }
}

private fun List<TodayCardKind>.filterNotSame(item:TodayCardKind)=filterNot{it==item}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun QuickCaptureGrid(onCapture:(CaptureKind)->Unit,onFeatures:()->Unit){LifeSection("快速记录",action={TextButton(onClick=onFeatures){Text("全部")}}){FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){listOf(CaptureKind.Expense to "记一笔",CaptureKind.Health to "记体重",CaptureKind.Meal to "记饮食",CaptureKind.Workout to "记运动",CaptureKind.Visit to "记到访",CaptureKind.Library to "记随记").forEach{(kind,label)->FilledTonalButton(onClick={onCapture(kind)}){Text(label)}}}}}
@Composable private fun TodayAgenda(value:TodaySnapshot,onInbox:()->Unit){
  LifeSection("接下来",action={TextButton(onClick=onInbox){Text("全部提醒")}}){
    if(value.dueItems.isEmpty())EmptyState("今天没有待处理事项") else value.dueItems.take(3).forEach{due->
      LifeCard(onClick=onInbox){Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Box(Modifier.size(12.dp).background(MaterialTheme.colorScheme.primary,RoundedCornerShape(99.dp)));Spacer(Modifier.width(12.dp));Column(Modifier.weight(1f)){Text(due.title,style=MaterialTheme.typography.titleMedium);Text(due.dueOn,color=MaterialTheme.colorScheme.onSurfaceVariant)};due.amount?.let{Text("${due.currency.orEmpty()} $it")}}}
    }
  }
}
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

@Composable private fun CompactTodaySync(status:DeviceSyncStatus,queue:LoadState<QueueSummary>,samsungAvailable:Boolean,onHealth:()->Unit,onSamsung:()->Unit,onSettings:()->Unit){val q=(queue as? LoadState.Ready)?.value;LifeSection("其他数据源",action={TextButton(onClick=onSettings){Text("管理")}}){LifeCard{Text(listOfNotNull(if(samsungAvailable)"Samsung ${status.samsungMessage}" else null,q?.takeIf{it.waiting>0||it.reconciling>0||it.failed>0}?.let{"${it.waiting} 待发送 · ${it.reconciling} 核对中 · ${it.failed} 失败"}).joinToString(" · ").ifBlank{"数据同步正常"},color=MaterialTheme.colorScheme.onSurfaceVariant);Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(7.dp)){if(samsungAvailable)AssistChip(onSamsung,{Text("同步三星")});if(HealthConnectSync.enabled())AssistChip(onHealth,{Text("Health Connect")})}}}}

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
