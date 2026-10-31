package com.shadow.life

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp

internal fun detailAccent(kind:DetailPresentation)=when(kind){
  DetailPresentation.HealthMetric,DetailPresentation.Activity->Color(0xFFB9EF68)
  DetailPresentation.Sleep->Color(0xFFDCD1FF)
  DetailPresentation.Meal->Color(0xFFFFD39C)
  DetailPresentation.Workout->Color(0xFFFFBFAE)
  DetailPresentation.Money->Color(0xFFFFE586)
  DetailPresentation.Travel->Color(0xFFAEE7F3)
  DetailPresentation.Library->Color(0xFFF7C5E3)
  else->Color(0xFFC9D6FF)
}
internal fun domainSectionHandled(detail:RecordDetail,section:DetailSection)=when(detail.presentation){
  DetailPresentation.HealthMetric->detail.metrics.isNotEmpty()&&section.title=="本次测量全部指标"
  DetailPresentation.Sleep,DetailPresentation.Workout,DetailPresentation.Activity,DetailPresentation.Habit->section.title=="概要"
  DetailPresentation.Meal->section.title=="食物与营养"
  DetailPresentation.Money->section.title=="购买明细"
  else->false
}

@Composable internal fun DomainDetailContent(detail:RecordDetail,onLink:(DetailLink)->Unit){
  val accent=detailAccent(detail.presentation)
  Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(20.dp)){
    when(detail.presentation){
      DetailPresentation.HealthMetric->if(detail.metrics.isNotEmpty()){
        Text("本次 ${detail.metrics.size} 项测量",style=MaterialTheme.typography.titleLarge)
        detail.metrics.chunked(if(androidx.compose.ui.platform.LocalDensity.current.fontScale>1.3f)1 else 2).forEach{pair->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(16.dp)){pair.forEach{metric->Column(Modifier.weight(1f).clickable{onLink(DetailLink("health_record",metric.id,metric.label))}.padding(vertical=10.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){Text(metric.label,color=MaterialTheme.colorScheme.onSurfaceVariant);Text("${metric.value} ${metric.unit}",style=MaterialTheme.typography.headlineSmall,color=accent);Text(if(metric.derived)"计算值" else "设备值",style=MaterialTheme.typography.labelSmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}};if(pair.size==1)Spacer(Modifier.weight(1f))}}
        if(detail.trend.isNotEmpty()){
          Text("${detail.title} · 最近 ${detail.trend.size} 次",style=MaterialTheme.typography.titleMedium)
          val points=detail.trend
          Canvas(Modifier.fillMaxWidth().height(110.dp)){
            val low=points.minOf{it.value};val high=points.maxOf{it.value};val span=(high-low).takeIf{it>0}?:1.0
            val path=Path();points.forEachIndexed{i,p->val x=if(points.size==1)size.width/2 else 8f+(size.width-16f)*i/(points.size-1);val y=if(high==low)size.height/2 else 10f+((high-p.value)/span*(size.height-20f)).toFloat();if(i==0)path.moveTo(x,y)else path.lineTo(x,y);drawCircle(accent,3.dp.toPx(),androidx.compose.ui.geometry.Offset(x,y))};drawPath(path,accent,style=Stroke(2.dp.toPx()))
          }
          Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text(points.first().occurredOn,style=MaterialTheme.typography.labelSmall);Text(points.last().occurredOn,style=MaterialTheme.typography.labelSmall)}
          Text("范围 ${points.minOf{it.value}}–${points.maxOf{it.value}} ${points.first().unit} · 仅展示已记录数据",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      DetailPresentation.Sleep->{
        if(detail.sleepStages.isNotEmpty()){
          Text("睡眠阶段构成",style=MaterialTheme.typography.titleLarge)
          val total=detail.sleepStages.sumOf{it.minutes}
          if(total>0)Row(Modifier.fillMaxWidth().height(26.dp),horizontalArrangement=Arrangement.spacedBy(3.dp)){detail.sleepStages.filter{it.minutes>0}.forEachIndexed{i,stage->Surface(Modifier.weight(stage.minutes.toFloat()).fillMaxHeight(),color=listOf(Color(0xFF8270CC),Color(0xFFB7A2F5),Color(0xFFEDB3DE),Color(0xFFFFE586))[i%4],shape=RoundedCornerShape(4.dp)) {}}}
          detail.sleepStages.forEach{stage->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text(stage.label);Text("${stage.minutes} 分钟")}}
          Text("按来源提供的阶段总量展示，未记录阶段不推断",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
        DetailMetricGrid(detail.sections.firstOrNull{it.title=="概要"}?.facts.orEmpty().filter{it.label !in setOf("深睡","浅睡","REM","清醒")},accent)
      }
      DetailPresentation.Workout,DetailPresentation.Activity,DetailPresentation.Habit->{
        Text(if(detail.presentation==DetailPresentation.Workout)"实际运动" else if(detail.presentation==DetailPresentation.Activity)"当天活动" else "这次记录",style=MaterialTheme.typography.titleLarge)
        DetailMetricGrid(detail.sections.firstOrNull{it.title=="概要"}?.facts.orEmpty(),accent)
      }
      DetailPresentation.Meal,DetailPresentation.Money->{
        val meal=detail.presentation==DetailPresentation.Meal
        val groups=detail.sections.firstOrNull{it.title==if(meal)"食物与营养" else "购买明细"}?.groups.orEmpty()
        if(groups.isNotEmpty()){
          Text(if(meal)"这一餐吃了什么" else "买了什么",style=MaterialTheme.typography.titleLarge)
          groups.forEach{group->Column(verticalArrangement=Arrangement.spacedBy(8.dp)){Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){Text(group.title,Modifier.weight(1f),style=MaterialTheme.typography.titleMedium);Text(group.facts.firstOrNull{it.label in setOf("份量","数量") }?.value.orEmpty(),color=accent)};group.facts.filter{it.label !in setOf("份量","数量")}.forEach{Text("${it.label}  ${it.value}",style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)};HorizontalDivider(color=MaterialTheme.colorScheme.outlineVariant.copy(alpha=.35f))}}
        }
        if(meal){val items=detail.mealIntakes;val known=items.mapNotNull{item->item.energyKcal?.toBigDecimalOrNull()?.multiply(item.consumedFraction?.toBigDecimalOrNull()?:java.math.BigDecimal.ONE)};if(items.isNotEmpty()){Text("热量已知 ${known.size}/${items.size} 项",color=accent);if(known.isNotEmpty())Text("${if(known.size==items.size)"本餐" else "已知部分"} ${known.fold(java.math.BigDecimal.ZERO){a,b->a+b}.stripTrailingZeros().toPlainString()} kcal",style=MaterialTheme.typography.headlineSmall);Text("份量与营养以当前记录为准，缺项保留未知",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
      }
      else->Unit
    }
  }
}
@Composable private fun DetailMetricGrid(facts:List<DetailFact>,accent:Color){
  facts.chunked(if(androidx.compose.ui.platform.LocalDensity.current.fontScale>1.3f)1 else 2).forEach{pair->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(20.dp)){pair.forEach{fact->Column(Modifier.weight(1f).padding(vertical=10.dp),verticalArrangement=Arrangement.spacedBy(7.dp)){Text(fact.label,style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.onSurfaceVariant);Text(fact.value,style=MaterialTheme.typography.titleLarge,color=accent)}};if(pair.size==1)Spacer(Modifier.weight(1f))}}
}
