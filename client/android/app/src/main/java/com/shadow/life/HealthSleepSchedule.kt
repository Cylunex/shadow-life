package com.shadow.life

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import kotlin.math.ceil
import kotlin.math.floor

@Composable internal fun HealthSleepSchedule(accountId:String,history:List<HealthDailyOverview>,onOpen:(String)->Unit){
  val context=LocalContext.current
  val repo=remember(accountId){NativeLifeRepository(context,context.applicationContext as ShadowApp)}
  val first=LocalDate.now().minusDays(6).toString()
  val nights=history.filter{it.occurredOn>=first&&it.sleepId!=null}
  var state by remember(nights){mutableStateOf<List<HealthRecordResultDtoSleepSessionFact>?>(null)}
  LaunchedEffect(nights){
    state=coroutineScope{
      nights.mapNotNull{it.sleepId}.map{id->
        async{
          try{repo.sleepWindow(id)}catch(error:CancellationException){throw error}catch(_:Exception){null}
        }
      }.awaitAll().filterNotNull()
    }
  }
  val facts=state?:return
  val formatter=DateTimeFormatter.ofPattern("HH:mm")
  val windows=facts.mapNotNull{fact->
    val start=fact.startedAt?.let(Instant::parse)?:return@mapNotNull null
    val end=fact.endedAt?.let(Instant::parse)?:return@mapNotNull null
    if(end<=start)return@mapNotNull null
    val zone=ZoneId.of(fact.timeZone)
    val startLocal=start.atZone(zone).toLocalDateTime()
    val endLocal=end.atZone(zone).toLocalDateTime()
    val midnight=LocalDate.parse(fact.wakeDate).atStartOfDay()
    val from=Duration.between(midnight,startLocal).toMinutes().toFloat()
    val to=Duration.between(midnight,endLocal).toMinutes().toFloat()
    if(to<=from)return@mapNotNull null
    SleepWindow(fact.id,fact.wakeDate,from,to,"${startLocal.format(formatter)} – ${endLocal.format(formatter)}")
  }.sortedByDescending{it.date}
  if(windows.isEmpty())return
  val min=floor(windows.minOf{it.start}/60f)*60f
  val max=ceil(windows.maxOf{it.end}/60f)*60f
  LifeCard{
    Text("近七晚入睡与醒来",style=MaterialTheme.typography.titleMedium)
    Text("${windows.size} 晚有完整起止时间 · 按各记录当地时刻",style=MaterialTheme.typography.bodySmall)
    windows.forEach{value->
      TextButton(onClick={onOpen(value.id)},modifier=Modifier.fillMaxWidth(),contentPadding=PaddingValues(4.dp)){
        Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(5.dp)){
          Text("${value.date} · ${value.label}")
          Row(Modifier.fillMaxWidth()){
            val prefix=(value.start-min)/(max-min)
            val length=(value.end-value.start)/(max-min)
            val suffix=1f-prefix-length
            if(prefix>0)Spacer(Modifier.weight(prefix))
            Box(Modifier.weight(length).height(8.dp).background(MaterialTheme.colorScheme.tertiary,RoundedCornerShape(4.dp)))
            if(suffix>0)Spacer(Modifier.weight(suffix))
          }
        }
      }
    }
  }
}
private data class SleepWindow(val id:String,val date:String,val start:Float,val end:Float,val label:String)
