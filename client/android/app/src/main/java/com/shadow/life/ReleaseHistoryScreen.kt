package com.shadow.life

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.YearMonth
import java.time.temporal.ChronoUnit

@Composable internal fun ReleaseHistoryWorkspace(state:LoadState<HealthReleaseHistoryResultDto>,onLoad:(String,String)->Unit,onDetail:(LifeDomain,String,String)->Unit){
  var monthText by rememberSaveable{mutableStateOf(YearMonth.now().toString())}
  var selectedDay by rememberSaveable(monthText){mutableStateOf<String?>(null)}
  val month=YearMonth.parse(monthText);val from=month.atDay(1).toString();val to=minOf(month.atEndOfMonth(),LocalDate.now()).toString()
  LaunchedEffect(from,to){onLoad(from,to)}
  Column(verticalArrangement=Arrangement.spacedBy(16.dp)){
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){OutlinedButton(onClick={monthText=month.minusMonths(1).toString()}){Text("‹")};Text("${month.year} 年 ${month.monthValue} 月",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge,textAlign=androidx.compose.ui.text.style.TextAlign.Center);OutlinedButton(onClick={monthText=month.plusMonths(1).toString()},enabled=month<YearMonth.now()){Text("›")}}
    Text("起飞记录",style=MaterialTheme.typography.headlineMedium)
    Text("只统计明确记录的次数，不计入运动或活动消耗。",style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
    StateContent(state,{onLoad(from,to)}){}
    val data=(state as? LoadState.Ready)?.value?.takeIf{it.from==from&&it.to==to}
    if(data!=null){
      LifeCard{Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){ReleaseFact("本月已记录","${data.totalCount} 次");ReleaseFact("有记录的日期","${data.recordedDays} 天")};data.latestOn?.let{latest->val days=ChronoUnit.DAYS.between(LocalDate.parse(latest),LocalDate.now());Text("本月最近一次：$latest · 距今 $days 天",style=MaterialTheme.typography.bodyMedium)}}
      if(data.truncated)Text("记录较多，日历和列表仅含最近 ${data.items.size} 条；月度次数为完整统计。",color=MaterialTheme.colorScheme.error)
      val recordedDates=data.items.filter{!it.explicitDenial&&it.doneCount>0}.map{it.occurredOn}.distinct().sorted()
      if(!data.truncated&&recordedDates.size>1){val intervals=recordedDates.zipWithNext{left,right->ChronoUnit.DAYS.between(LocalDate.parse(left),LocalDate.parse(right)).toDouble()};Text("本月记录日期平均间隔 ${healthValueText(intervals.average(),"天")} 天 · 仅描述已记录日期",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
      val groups=data.items.groupBy{it.occurredOn}
      LifeCard{
        Row(Modifier.fillMaxWidth()){listOf("一","二","三","四","五","六","日").forEach{Text(it,Modifier.weight(1f),textAlign=androidx.compose.ui.text.style.TextAlign.Center)}}
        val offset=month.atDay(1).dayOfWeek.value-1
        (0 until ((offset+month.lengthOfMonth()+6)/7)).forEach{week->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(3.dp)){
          repeat(7){weekday->val day=week*7+weekday-offset+1;val date=if(day in 1..month.lengthOfMonth())month.atDay(day) else null;val rows=groups[date?.toString()].orEmpty();val count=rows.filter{!it.explicitDenial}.sumOf{it.doneCount};val isSelected=selectedDay==date?.toString()&&date!=null
            Column(Modifier.weight(1f).heightIn(min=60.dp).background(if(isSelected)MaterialTheme.colorScheme.secondaryContainer else if(count>0)MaterialTheme.colorScheme.primaryContainer.copy(alpha=.55f) else MaterialTheme.colorScheme.surfaceVariant.copy(alpha=.3f),RoundedCornerShape(10.dp)).then(if(date!=null&&date<=LocalDate.now())Modifier.clickable(role=Role.Button){selectedDay=if(isSelected)null else date.toString()} else Modifier).padding(vertical=8.dp),horizontalAlignment=Alignment.CenterHorizontally){Text(date?.dayOfMonth?.toString().orEmpty());Text(if(count>0)"${count}次" else if(rows.any{it.explicitDenial})"明确无" else "",style=MaterialTheme.typography.labelSmall)}
          }
        }}
        Text("空白表示未记录；次数颜色仅表示有记录。",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
      }
      val visible=if(selectedDay==null)data.items else groups[selectedDay].orEmpty()
      Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text(selectedDay?:"本月明细",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge);if(selectedDay!=null)TextButton(onClick={selectedDay=null}){Text("整月")}}
      if(visible.isEmpty())EmptyState("这个${if(selectedDay==null)"月份" else "日期"}没有记录")
      visible.forEach{item->LifeCard{Column(Modifier.fillMaxWidth().clickable(role=Role.Button){onDetail(LifeDomain.Health,item.id,"起飞记录")},verticalArrangement=Arrangement.spacedBy(7.dp)){Row(Modifier.fillMaxWidth()){Text(item.occurredOn,Modifier.weight(1f),style=MaterialTheme.typography.titleMedium);Text(if(item.explicitDenial)"明确记录无" else "${item.doneCount} 次")};Text(listOfNotNull(localDateTime(item.startedAt,item.timeZone,includeDate=false)?:"仅记录日期",item.durationMinutes?.let{"${healthValueText(it,"分钟")} 分钟"},sourceLabel(item.sourceType)).joinToString(" · "),color=MaterialTheme.colorScheme.onSurfaceVariant);item.note?.let{Text(it,style=MaterialTheme.typography.bodySmall)}}}}
    }
  }
}
@Composable private fun ReleaseFact(label:String,value:String){Column{Text(label,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant);Text(value,style=MaterialTheme.typography.headlineSmall)}}
