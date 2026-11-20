package com.shadow.life

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.ceil
import kotlin.math.floor

@Composable internal fun HealthSleepSchedule(
  accountId:String,history:List<HealthDailyOverview>,unavailableDays:Int,
  legacyWindows:SnapshotStateMap<Pair<String,String>,HealthDailyResultDtoResultSleepWindow>,
  onOpen:(String)->Unit
){
  val context=LocalContext.current
  val repo=remember(accountId){NativeLifeRepository(context,context.applicationContext as ShadowApp)}
  val nights=history.filter{it.sleepId!=null}
  val legacyNights=nights.filter{it.sleepWindow==null}
  val legacyKeys=legacyNights.map{checkNotNull(it.sleepId) to it.updatedAt}.toSet()
  var retry by remember{mutableIntStateOf(0)}
  var failures by remember(legacyKeys,retry){mutableIntStateOf(0)}
  var loading by remember(legacyKeys,retry){mutableStateOf(legacyKeys.any{it !in legacyWindows})}
  LaunchedEffect(accountId,legacyKeys,retry){
    legacyWindows.keys.retainAll(legacyKeys)
    failures=legacyKeys.filterNot(legacyWindows::containsKey).map{key->async{
      try{
        val fact=repo.sleepWindow(key.first)
        legacyWindows[key]=HealthDailyResultDtoResultSleepWindow(fact?.startedAt,fact?.endedAt,fact?.timeZone)
        true
      }catch(error:CancellationException){throw error}
      catch(_:Exception){false}
    }}.awaitAll().count{!it}
    loading=false
  }
  val windows=nights.mapNotNull{day->
    val id=checkNotNull(day.sleepId)
    val value=day.sleepWindow?:legacyWindows[id to day.updatedAt]?:return@mapNotNull null
    sleepWindow(id,day.occurredOn,value)
  }.sortedByDescending{it.date}
  val incomplete=nights.count{day->
    (day.sleepWindow!=null||(checkNotNull(day.sleepId) to day.updatedAt) in legacyWindows)&&
      windows.none{it.date==day.occurredOn}
  }
  LifeCard{
    Text("近七晚入睡与醒来",style=MaterialTheme.typography.titleMedium)
    Text("${windows.size} 晚有完整起止时间 · 按各记录当地时刻",style=MaterialTheme.typography.bodySmall)
    if(incomplete>0)Text("$incomplete 晚缺少可绘制的起止时间",style=MaterialTheme.typography.bodySmall)
    if(unavailableDays+failures>0)Text("${unavailableDays+failures} 晚暂时读不到",style=MaterialTheme.typography.bodySmall)
    if(loading)LinearProgressIndicator(Modifier.fillMaxWidth())
    if(failures>0)TextButton(onClick={retry++}){Text("重试读取作息")}
    if(windows.isNotEmpty())SleepScheduleChart(windows,onOpen)
  }
}

@Composable private fun SleepScheduleChart(windows:List<SleepWindow>,onOpen:(String)->Unit){
  val min=floor(windows.minOf{it.start}/60f).toInt()*60
  val max=ceil(windows.maxOf{it.end}/60f).toInt()*60
  val middle=(min+max)/2
  val spansMidnight=min<0&&max>0
  Row(Modifier.fillMaxWidth().padding(horizontal=4.dp)){
    Text(sleepAxisLabel(min),Modifier.weight(1f),style=MaterialTheme.typography.labelSmall)
    Text(sleepAxisLabel(middle),Modifier.weight(1f),style=MaterialTheme.typography.labelSmall,textAlign=TextAlign.Center)
    Text(sleepAxisLabel(max),Modifier.weight(1f),style=MaterialTheme.typography.labelSmall,textAlign=TextAlign.End)
  }
  if(spansMidnight)Text("细线标记醒来日 00:00",style=MaterialTheme.typography.labelSmall)
  windows.forEach{value->
    TextButton(onClick={onOpen(value.id)},modifier=Modifier.fillMaxWidth(),contentPadding=PaddingValues(4.dp)){
      Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(5.dp)){
        Text("${value.date} · ${value.label}")
        BoxWithConstraints(Modifier.fillMaxWidth()){
          Row(Modifier.fillMaxWidth()){
            val prefix=(value.start-min)/(max-min)
            val length=(value.end-value.start)/(max-min)
            val suffix=1f-prefix-length
            if(prefix>0)Spacer(Modifier.weight(prefix))
            Box(Modifier.weight(length).height(8.dp).background(MaterialTheme.colorScheme.tertiary,RoundedCornerShape(4.dp)))
            if(suffix>0)Spacer(Modifier.weight(suffix))
          }
          if(spansMidnight)Box(
            Modifier.offset(x=maxWidth*(-min.toFloat()/(max-min))).width(1.dp).height(8.dp)
              .background(MaterialTheme.colorScheme.onSurfaceVariant)
          )
        }
      }
    }
  }
}

private val sleepClock=DateTimeFormatter.ofPattern("HH:mm")

internal fun sleepAxisLabel(minutes:Int):String{
  val days=Math.floorDiv(minutes,1440)
  val clock=LocalTime.ofSecondOfDay(Math.floorMod(minutes,1440)*60L).format(sleepClock)
  return when(days){
    -1->"前一日 $clock"
    0->clock
    1->"次日 $clock"
    else->"${if(days>0)"+" else ""}$days 日 $clock"
  }
}

internal fun sleepWindow(id:String,date:String,window:HealthDailyResultDtoResultSleepWindow):SleepWindow?{
  val start=window.startedAt?.let(Instant::parse)?:return null
  val end=window.endedAt?.let(Instant::parse)?:return null
  if(end<=start)return null
  val zone=window.timeZone?.let(ZoneId::of)?:return null
  val startLocal=start.atZone(zone).toLocalDateTime()
  val endLocal=end.atZone(zone).toLocalDateTime()
  val midnight=LocalDate.parse(date).atStartOfDay()
  val from=Duration.between(midnight,startLocal).seconds/60f
  val to=Duration.between(midnight,endLocal).seconds/60f
  if(to<=from)return null
  return SleepWindow(id,date,from,to,"${startLocal.format(sleepClock)} – ${endLocal.format(sleepClock)}")
}

internal data class SleepWindow(val id:String,val date:String,val start:Float,val end:Float,val label:String)
