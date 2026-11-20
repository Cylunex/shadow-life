package com.shadow.life

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.text.NumberFormat
import kotlin.math.*

private val stageNames=mapOf("awake" to "清醒","rem" to "REM","light" to "浅睡","deep" to "深睡")
internal fun sleepBandColor(label:String)=when(label){
  "清醒"->Color(0xFFE09A53)
  "REM"->Color(0xFFBB89CB)
  "浅睡"->Color(0xFF8B8AE1)
  else->Color(0xFF6457BE)
}
private fun epoch(value:String)=Instant.parse(value).toEpochMilli()
private fun stamp(value:String,zone:String)=localDateTime(value,zone,includeDate=false)?:value
private fun chartNumber(value:Double)=NumberFormat.getNumberInstance().apply{maximumFractionDigits=1}.format(value)
private fun fraction(value:Long,from:Long,to:Long)=if(to>from)((value-from).toDouble()/(to-from)).toFloat() else .5f

@Composable internal fun SleepRecordingChart(record:SleepRecording){
  val stages=record.intervals
  if(stages.isEmpty()){
    record.score?.let{Text("三星睡眠评分  $it / 100",style=MaterialTheme.typography.titleMedium)}
    return
  }
  val left=minOf(record.start?.let(::epoch)?:Long.MAX_VALUE,epoch(stages.first().start))
  val right=maxOf(record.end?.let(::epoch)?:Long.MIN_VALUE,epoch(stages.last().end))
  val times=remember(stages){stages.map{epoch(it.start) to epoch(it.end)}}
  var selected by rememberSaveable(record.start,stages.first().start){mutableIntStateOf(0)}
  val index=selected.coerceIn(stages.indices)
  val selectedStage=stages[index]
  val grid=MaterialTheme.colorScheme.outlineVariant
  val cursor=MaterialTheme.colorScheme.onSurface
  val labels=stageNames.values.toList()
  LifeCard{
    Text("整晚睡眠阶段",style=MaterialTheme.typography.titleLarge)
    record.score?.let{Text("三星睡眠评分  $it / 100",style=MaterialTheme.typography.labelLarge)}
    Text("${localDateTime(Instant.ofEpochMilli(left).toString(),record.zone)} — ${localDateTime(Instant.ofEpochMilli(right).toString(),record.zone)}",style=MaterialTheme.typography.bodySmall)
    Row(Modifier.fillMaxWidth().height(136.dp),verticalAlignment=Alignment.CenterVertically){
      Column(Modifier.fillMaxHeight().padding(end=8.dp),verticalArrangement=Arrangement.SpaceAround){
        labels.forEach{Text(it,style=MaterialTheme.typography.labelSmall)}
      }
      Canvas(Modifier.weight(1f).fillMaxHeight().semantics{contentDescription="睡眠阶段时间图"}.pointerInput(times,left,right){
        detectTapGestures{pos->
          val time=left+((right-left)*(pos.x/size.width).toDouble()).toLong()
          val hit=times.indexOfFirst{(a,b)->time in a until b}
          if(hit>=0)selected=hit
        }
      }){
        val band=size.height/4
        fun y(i:Int)=(labels.indexOf(stageNames[stages[i].stage.wireValue])+.5f)*band
        labels.indices.forEach{row->val y=(row+.5f)*band;drawLine(grid,Offset(0f,y),Offset(size.width,y))}
        times.forEachIndexed{i,(a,b)->
          val x=fraction(a,left,right)*size.width
          val end=fraction(b,left,right)*size.width
          val color=sleepBandColor(stageNames.getValue(stages[i].stage.wireValue))
          if(i>0&&times[i-1].second==a)drawLine(color,Offset(x,y(i-1)),Offset(x,y(i)),1.5.dp.toPx())
          drawLine(color,Offset(x,y(i)),Offset(end,y(i)),7.dp.toPx())
        }
        val x=fraction(times[index].first+(times[index].second-times[index].first)/2,left,right)*size.width
        drawCircle(cursor,4.dp.toPx(),Offset(x,y(index)))
      }
    }
    SampleSelector(index,stages.size,{selected=it},
      "${stageNames[selectedStage.stage.wireValue]}  ${stamp(selectedStage.start,record.zone)}–${stamp(selectedStage.end,record.zone)}","时段")
  }
}

private data class SessionPoint(val at:Long,val x:Double,val y:Double)
private enum class WorkoutView(val title:String){Route("轨迹"),Heart("心率"),Speed("速度")}

private fun routePlot(record:WorkoutRecording):List<SessionPoint>{
  val points=record.route
  if(points.isEmpty())return emptyList()
  val latitude=points.map{it.latitude}.average()
  val longitudeScale=cos(Math.toRadians(latitude))
  var previous=points.first().longitude
  var east=0.0
  return points.map{
    east+=((it.longitude-previous+540)%360-180)*longitudeScale
    previous=it.longitude
    SessionPoint(epoch(it.at),east,it.latitude-latitude)
  }
}

@Composable internal fun WorkoutRecordingChart(record:WorkoutRecording){
  val views=remember(record){buildList{
    if(record.route.isNotEmpty())add(WorkoutView.Route)
    if(record.samples.any{it.heartRate!=null})add(WorkoutView.Heart)
    if(record.samples.any{it.speedMps!=null})add(WorkoutView.Speed)
  }}
  if(views.isEmpty())return
  var choice by rememberSaveable{mutableStateOf(views.first().name)}
  val view=views.firstOrNull{it.name==choice}?:views.first()
  val route=view==WorkoutView.Route
  val points=remember(record,view){
    if(route)routePlot(record) else record.samples.mapNotNull{sample->
      val value=if(view==WorkoutView.Heart)sample.heartRate else sample.speedMps?.times(3.6)
      value?.let{val time=epoch(sample.at);SessionPoint(time,time.toDouble(),it)}
    }
  }
  val bounds=remember(points){listOf(points.minOf{it.x},points.maxOf{it.x},points.minOf{it.y},points.maxOf{it.y})}
  var pickedAt by rememberSaveable(record.samples.firstOrNull()?.at,record.route.firstOrNull()?.at){mutableLongStateOf(points.first().at)}
  val index=remember(points,pickedAt){points.indices.minBy{abs(points[it].at-pickedAt)}}
  val current=points[index]
  val color=MaterialTheme.colorScheme.primary
  val grid=MaterialTheme.colorScheme.outlineVariant
  val unit=if(view==WorkoutView.Heart)"次/分" else "km/h"
  LifeCard{
    Text("运动过程",style=MaterialTheme.typography.titleLarge)
    Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
      views.forEach{option->FilterChip(view==option,{choice=option.name},{Text(option.title)})}
    }
    val subtitle=if(route)"GPS 轨迹 · 北向上" else "${chartNumber(bounds[2])}–${chartNumber(bounds[3])} $unit"
    Text(subtitle,style=MaterialTheme.typography.labelMedium)
    Canvas(Modifier.fillMaxWidth().height(170.dp).semantics{contentDescription=subtitle}){
      val pad=9.dp.toPx()
      val width=(size.width-pad*2).coerceAtLeast(1f)
      val height=(size.height-pad*2).coerceAtLeast(1f)
      val dx=bounds[1]-bounds[0];val dy=bounds[3]-bounds[2]
      val scale=min(if(dx>0)width/dx else Double.POSITIVE_INFINITY,if(dy>0)height/dy else Double.POSITIVE_INFINITY).takeIf{it.isFinite()}?:1.0
      fun position(point:SessionPoint):Offset{
        val x=point.x-(bounds[0]+dx/2);val y=point.y-(bounds[2]+dy/2)
        return Offset(size.width/2+(x*(if(route)scale else if(dx>0)width/dx else 0.0)).toFloat(),
          size.height/2-(y*(if(route)scale else if(dy>0)height/dy else 0.0)).toFloat())
      }
      if(!route)repeat(3){val y=pad+height*it/2;drawLine(grid,Offset(pad,y),Offset(size.width-pad,y))}
      points.forEachIndexed{i,point->
        val pos=position(point)
        if(i>0&&point.at-points[i-1].at<=300_000L)drawLine(color,position(points[i-1]),pos,2.dp.toPx(),StrokeCap.Round)
        drawCircle(color,1.5.dp.toPx(),pos)
      }
      val pos=position(current)
      if(!route)drawLine(color.copy(alpha=.4f),Offset(pos.x,pad),Offset(pos.x,size.height-pad))
      drawCircle(color,5.dp.toPx(),pos)
    }
    val value=if(route)"轨迹点" else "${chartNumber(current.y)} $unit"
    SampleSelector(index,points.size,{pickedAt=points[it].at},"${stamp(Instant.ofEpochMilli(current.at).toString(),record.zone)} · $value","采样点")
  }
}

@Composable private fun SampleSelector(index:Int,count:Int,onSelect:(Int)->Unit,label:String,kind:String){
  Text(label,style=MaterialTheme.typography.titleMedium)
  if(count>1)Slider(value=index.toFloat(),onValueChange={onSelect(it.roundToInt().coerceIn(0,count-1))},
    valueRange=0f..(count-1).toFloat(),modifier=Modifier.fillMaxWidth().semantics{contentDescription="查看$kind"})
}
