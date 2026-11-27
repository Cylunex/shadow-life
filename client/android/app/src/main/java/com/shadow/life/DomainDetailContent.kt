package com.shadow.life

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp

@Composable internal fun detailAccent(kind:DetailPresentation):Color{
  val dark=MaterialTheme.colorScheme.background.luminance()<.5f
  return when(kind){
    DetailPresentation.HealthMetric,DetailPresentation.Activity->if(dark)Color(0xFFB9EF68) else Color(0xFF286B36)
    DetailPresentation.Sleep->if(dark)Color(0xFFDCD1FF) else Color(0xFF62509E)
    DetailPresentation.Meal->if(dark)Color(0xFFFFD39C) else Color(0xFF91521C)
    DetailPresentation.Workout->if(dark)Color(0xFFFFBFAE) else Color(0xFFA24E3D)
    DetailPresentation.Money->if(dark)Color(0xFFFFE586) else Color(0xFF7A5C10)
    DetailPresentation.Travel->if(dark)Color(0xFFAEE7F3) else Color(0xFF266878)
    DetailPresentation.Library->if(dark)Color(0xFFF7C5E3) else Color(0xFF8A456F)
    else->if(dark)Color(0xFFC9D6FF) else Color(0xFF475D98)
  }
}
internal fun domainSectionHandled(detail:RecordDetail,section:DetailSection)=when(detail.presentation){
  DetailPresentation.HealthMetric->detail.metrics.isNotEmpty()&&section.title=="本次测量全部指标"
  DetailPresentation.Sleep,DetailPresentation.Workout,DetailPresentation.Activity,DetailPresentation.Habit->section.title=="概要"
  DetailPresentation.Meal->detail.meal!=null&&section.title=="食物与营养"
  DetailPresentation.Money->section.title=="购买明细"
  else->false
}

@Composable internal fun DomainDetailContent(detail:RecordDetail,onLink:(DetailLink)->Unit,preferences:Map<String,String> = emptyMap(),onPurchaseLine:(PurchaseLineRef)->Unit={}){
  val accent=detailAccent(detail.presentation)
  Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(20.dp)){
    when(detail.presentation){
      DetailPresentation.HealthMetric->if(detail.metrics.isNotEmpty()){
        Text("本次 ${detail.metrics.size} 项测量",style=MaterialTheme.typography.titleLarge)
        detail.metrics.chunked(if(androidx.compose.ui.platform.LocalDensity.current.fontScale>1.3f)1 else 2).forEach{pair->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(16.dp)){pair.forEach{metric->Column(Modifier.weight(1f).clickable{onLink(DetailLink("health_record",metric.id,metric.label))}.padding(vertical=10.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){Text(metric.label,color=MaterialTheme.colorScheme.onSurfaceVariant);Text("${metric.value} ${metric.unit}",style=MaterialTheme.typography.headlineSmall,color=accent);Text(if(metric.derived)"计算值" else "设备值",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}};if(pair.size==1)Spacer(Modifier.weight(1f))}}
        if(detail.trend.isNotEmpty()){
          Text("${detail.title} · 最近 ${detail.trend.size} 次",style=MaterialTheme.typography.titleMedium)
          val points=detail.trend
          val currentId=detail.assistantRef?.id?:detail.editSeed?.detailId
          val current=points.indexOfFirst{it.id==currentId}
          val latest=points.getOrNull(current)
          val previous=points.getOrNull(current-1)
          if(latest!=null){
            Text(metricAssessment(detail.metrics.firstOrNull{it.id==currentId}?.key.orEmpty(),latest.value,latest.unit).label,
              style=MaterialTheme.typography.bodySmall)
            if(previous!=null&&previous.unit==latest.unit&&previous.sourceKind==latest.sourceKind){
              val delta=latest.value-previous.value
              Text("较上次同来源 "+(if(delta>0)"+" else "")+healthValueText(delta,latest.unit)+" "+unitLabel(latest.unit))
            }
          }
          Canvas(Modifier.fillMaxWidth().height(110.dp)){
            val low=points.minOf{it.value};val high=points.maxOf{it.value};val span=(high-low).takeIf{it>0}?:1.0
            val path=Path();points.forEachIndexed{i,p->val x=if(points.size==1)size.width/2 else 8f+(size.width-16f)*i/(points.size-1);val y=if(high==low)size.height/2 else 10f+((high-p.value)/span*(size.height-20f)).toFloat();if(i==0)path.moveTo(x,y)else path.lineTo(x,y);drawCircle(accent,if(i==current)6.dp.toPx() else 3.dp.toPx(),androidx.compose.ui.geometry.Offset(x,y))};drawPath(path,accent,style=Stroke(2.dp.toPx()))
          }
          Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text(points.first().occurredOn,style=MaterialTheme.typography.labelSmall);Text(points.last().occurredOn,style=MaterialTheme.typography.labelSmall)}
          Text("范围 ${points.minOf{it.value}}–${points.maxOf{it.value}} ${points.first().unit} · 仅展示已记录数据",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      DetailPresentation.Sleep->{
        detail.sleepRecording?.let{SleepRecordingChart(it)}
        if(detail.sleepStages.isNotEmpty()){
          Text("睡眠阶段构成",style=MaterialTheme.typography.titleLarge)
          val total=detail.sleepStages.sumOf{it.minutes}
          if(total>0)Row(Modifier.fillMaxWidth().height(26.dp),horizontalArrangement=Arrangement.spacedBy(3.dp)){detail.sleepStages.filter{it.minutes>0}.forEach{stage->Surface(Modifier.weight(stage.minutes.toFloat()).fillMaxHeight(),color=sleepBandColor(stage.label),shape=RoundedCornerShape(4.dp)) {}}}
          detail.sleepStages.forEach{stage->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text(stage.label);Text("${stage.minutes} 分钟")}}
          if(detail.sleepRecording?.intervals.isNullOrEmpty())Text("来源仅提供阶段总量",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        DetailMetricGrid(detail.sections.firstOrNull{it.title=="概要"}?.facts.orEmpty().filter{it.label !in setOf("深睡","浅睡","REM","清醒")},accent)
      }
      DetailPresentation.Workout,DetailPresentation.Activity,DetailPresentation.Habit->{
        detail.workoutRecording?.let{WorkoutRecordingChart(it)}
        Text(if(detail.presentation==DetailPresentation.Workout)"实际运动" else if(detail.presentation==DetailPresentation.Activity)"当天活动" else "这次记录",style=MaterialTheme.typography.titleLarge)
        DetailMetricGrid(detail.sections.firstOrNull{it.title=="概要"}?.facts.orEmpty(),accent)
      }
      DetailPresentation.Money->{
        val groups=detail.sections.firstOrNull{it.title=="购买明细"}?.groups.orEmpty()
        if(groups.isNotEmpty()){
          Text("买了什么",style=MaterialTheme.typography.titleLarge)
          LifeCard{
            groups.forEachIndexed{index,group->
              val line=detail.purchaseLines.firstOrNull{it.id==group.id}
              val quantity=group.facts.firstOrNull{it.label=="数量"||it.label=="份量"}?.value
              val amount=group.facts.firstOrNull{it.label=="金额"}?.value
              val unitPrice=group.facts.firstOrNull{it.label=="单价"}?.value
              Row(Modifier.fillMaxWidth().then(if(line!=null)Modifier.clickable{onPurchaseLine(line)} else Modifier).padding(vertical=9.dp),
                horizontalArrangement=Arrangement.spacedBy(12.dp)){
                Column(Modifier.weight(1f)){
                  Text(group.title,style=MaterialTheme.typography.titleMedium)
                  unitPrice?.let{Text("单价 "+it,style=MaterialTheme.typography.bodySmall)}
                  preferences[group.title]?.let{label->
                    Text(label,style=MaterialTheme.typography.labelSmall,
                      color=if(label=="避开")MaterialTheme.colorScheme.tertiary else MaterialTheme.colorScheme.primary)
                  }
                }
                Column(horizontalAlignment=Alignment.End){
                  Text(amount?:"—")
                  quantity?.let{Text(it,style=MaterialTheme.typography.bodySmall)}
                }
              }
              if(index<groups.lastIndex)HorizontalDivider()
            }
          }
        }
      }
      else->Unit
    }
  }
}
@Composable private fun DetailMetricGrid(facts:List<DetailFact>,accent:Color){
  val columns=if(androidx.compose.ui.platform.LocalDensity.current.fontScale>=1.15f) 1 else 2
  facts.chunked(columns).forEach { row ->
    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(16.dp)) {
      row.forEach { fact ->
        Column(Modifier.weight(1f).padding(vertical=8.dp),verticalArrangement=Arrangement.spacedBy(5.dp)) {
          Text(fact.label,style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.onSurfaceVariant)
          Text(fact.value,style=MaterialTheme.typography.titleLarge,color=accent)
        }
      }
      if(row.size<columns) Spacer(Modifier.weight(1f))
    }
  }
}
