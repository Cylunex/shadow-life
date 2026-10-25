package com.shadow.life

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import java.net.URLEncoder
import java.nio.charset.StandardCharsets
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

internal fun travelDates(trip:TravelTripSummary,days:List<TravelDaySummary>):List<String>{
  val start=LocalDate.parse(trip.startsOn);val end=LocalDate.parse(trip.endsOn)
  val count=ChronoUnit.DAYS.between(start,end).coerceIn(0,3660).toInt()
  return ((0..count).map{start.plusDays(it.toLong()).toString()}+days.filter{it.tripId==trip.id}.map{it.date}).distinct().sorted()
}
internal fun newTravelStopId():String="stop_${java.util.UUID.randomUUID().toString().replace("-","")}"
internal fun travelSelectedDate(dates:List<String>,selected:String?,today:String):String? = selected?.takeIf{it in dates}?:today.takeIf{it in dates}?:dates.firstOrNull()
internal fun travelTime(value:String?,zone:String):String = value?.let{runCatching{Instant.parse(it).atZone(ZoneId.of(zone)).format(DateTimeFormatter.ofPattern("HH:mm"))}.getOrDefault(it)}?:"时间待定"
internal fun travelLabel(value:String):String = mapOf("walk" to "步行","bike" to "骑行","taxi" to "出租车","car" to "驾车","bus" to "公交","metro" to "地铁","rail" to "铁路","flight" to "航班","hotel" to "住宿","restaurant" to "餐厅","activity" to "活动","ferry" to "轮渡","other" to "其他","planned" to "计划中","confirmed" to "已确认","cancelled" to "已取消","active" to "进行中","completed" to "已完成","arrived" to "已到达","skipped" to "已跳过","owner" to "创建者","editor" to "可编辑","viewer" to "可查看","shared" to "共享","private" to "私密")[value]?:value

internal data class TravelDayMap(val markers:List<TravelMapMarker>,val routes:List<List<TravelMapPoint>>)
internal fun googleDirectionsUrl(origin:TravelMapPoint,destination:TravelMapPoint):String{
  fun encoded(point:TravelMapPoint)=URLEncoder.encode("${point.latitude},${point.longitude}",StandardCharsets.UTF_8.name())
  return "https://www.google.com/maps/dir/?api=1&origin=${encoded(origin)}&destination=${encoded(destination)}"
}
internal fun travelDayMap(day:TravelDaySummary?,places:List<TravelPlaceSummary>,dayLabel:String?=null):TravelDayMap{
  val byId=places.associateBy{it.id};val markers=mutableListOf<TravelMapMarker>();val routes=mutableListOf<List<TravelMapPoint>>();var segment=mutableListOf<TravelMapPoint>()
  fun finish(){if(segment.size>1)routes+=segment.toList();segment=mutableListOf()}
  day?.stops.orEmpty().forEachIndexed{index,stop->
    val place=stop.placeId?.let(byId::get);val latitude=place?.latitude;val longitude=place?.longitude
    if(latitude==null||longitude==null||!latitude.isFinite()||!longitude.isFinite()||kotlin.math.abs(latitude)>90||kotlin.math.abs(longitude)>180){if(place==null&&Regex("早餐|午餐|晚餐|用餐|休息|整理行李|收拾行李").containsMatchIn(stop.title)&&!Regex("备选|可选|候选|弹性|视情况|如果有时间|自由活动").containsMatchIn("${stop.title} ${stop.note.orEmpty()}"))return@forEachIndexed;finish();return@forEachIndexed}
    val label=listOfNotNull(dayLabel,(index+1).toString()).joinToString("-")
    markers+=TravelMapMarker("${day?.id}:${stop.id}",place.name,latitude,longitude,place.favorite,place.address,label)
    if(Regex("备选|可选|候选|弹性|视情况|如果有时间|自由活动").containsMatchIn("${stop.title} ${stop.note.orEmpty()}")){finish();return@forEachIndexed}
    segment+=TravelMapPoint(latitude,longitude)
  }
  finish();return TravelDayMap(markers,routes)
}

@Composable internal fun TravelDatePicker(dates:List<String>,selected:String?,days:List<TravelDaySummary>,onSelect:(String)->Unit){
  LazyRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){
    items(dates,key={it}){date->FilterChip(selected==date,{onSelect(date)},label={Column(Modifier.padding(vertical=6.dp)){Text(date);Text("${days.firstOrNull{it.date==date}?.stops?.size?:0} 站",style=MaterialTheme.typography.labelSmall)}})}
  }
}

internal fun LazyListScope.travelDayContent(day:TravelDaySummary?,date:String?,zone:String,places:List<TravelPlaceSummary> = emptyList(),onVisit:((TravelStopSummary)->Unit)?=null){
  val stops=day?.stops.orEmpty()
  item("day-heading"){Text("${date.orEmpty()} · ${stops.size} 个停留点",style=MaterialTheme.typography.titleLarge,modifier=Modifier.padding(top=12.dp))}
  if(stops.isEmpty())item("day-empty"){EmptyState("当天还没有安排，可以添加地点或留作自由活动")}
  items(stops,key={"stop:${it.id}"}){stop->
    val index=stops.indexOf(stop);val place=places.firstOrNull{it.id==stop.placeId}
    LifeCard{
      Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.Top,horizontalArrangement=Arrangement.spacedBy(12.dp)){
        Text("${index+1}",style=MaterialTheme.typography.headlineSmall,color=MaterialTheme.colorScheme.primary)
        Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(5.dp)){
          Text(travelTime(stop.startsAt,zone),style=MaterialTheme.typography.labelLarge,color=MaterialTheme.colorScheme.primary)
          Text(stop.title,style=MaterialTheme.typography.titleMedium)
          place?.let{Text(listOfNotNull(it.name,it.address).joinToString(" · "),color=MaterialTheme.colorScheme.onSurfaceVariant)}
          stop.note?.takeIf(String::isNotBlank)?.let{Text(it,color=MaterialTheme.colorScheme.onSurfaceVariant)}
        }
      }
      if(onVisit!=null)TextButton(onClick={onVisit(stop)}){Text("记录实际到访")}
    }
  }
}

data class TravelDayDraft(val tripId:String,val date:String,val revision:Int?,val stops:List<TravelStopSummary>)

internal fun travelStopInstant(date:String,time:String,zone:String):String?{
  if(time.isBlank())return null
  val local=LocalDateTime.parse("${date}T${time.trim()}")
  val offsets=ZoneId.of(zone).rules.getValidOffsets(local)
  require(offsets.size==1){"该时间处于夏令时切换区间，请选择一个明确的时间"}
  return local.toInstant(offsets.single()).toString()
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun TravelDayEditor(trip:TravelTripSummary,date:String,day:TravelDaySummary?,places:List<TravelPlaceSummary>,state:SubmitState,onDismiss:()->Unit,onSave:(TravelDayDraft)->Unit){
  var stops by remember(trip.id,date){mutableStateOf(day?.stops.orEmpty())}
  var title by rememberSaveable{mutableStateOf("")};var time by rememberSaveable{mutableStateOf("")};var note by rememberSaveable{mutableStateOf("")};var placeId by rememberSaveable{mutableStateOf<String?>(null)}
  var editingId by rememberSaveable{mutableStateOf<String?>(null)};var error by remember{mutableStateOf<String?>(null)}
  val pending=state is SubmitState.Sending||state is SubmitState.Reconciling||state is SubmitState.Saved
  ModalBottomSheet(onDismissRequest={if(!pending)onDismiss()}){
    androidx.compose.foundation.lazy.LazyColumn(Modifier.fillMaxWidth().imePadding(),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(12.dp)){
      item{Text("安排 $date",style=MaterialTheme.typography.headlineSmall);Text("${trip.title} · ${trip.timeZone}",color=MaterialTheme.colorScheme.onSurfaceVariant)}
      items(stops,key={it.id}){stop->val index=stops.indexOf(stop);LifeCard{
        Text("${index+1}. ${stop.title}",style=MaterialTheme.typography.titleMedium);Text(travelTime(stop.startsAt,trip.timeZone))
        Row(Modifier.horizontalScroll(rememberScrollState())){
          TextButton(enabled=!pending&&index>0,onClick={stops=stops.toMutableList().apply{add(index-1,removeAt(index))}}){Text("上移")}
          TextButton(enabled=!pending&&index<stops.lastIndex,onClick={stops=stops.toMutableList().apply{add(index+1,removeAt(index))}}){Text("下移")}
          TextButton(enabled=!pending,onClick={editingId=stop.id;title=stop.title;time=stop.startsAt?.let{travelTime(it,trip.timeZone)}.orEmpty();note=stop.note.orEmpty();placeId=stop.placeId}){Text("编辑")}
          TextButton(enabled=!pending,onClick={stops=stops.filterNot{it.id==stop.id};if(editingId==stop.id){editingId=null;title="";time="";note="";placeId=null}}){Text("移除")}
        }
      }}
      item{
        Text(if(editingId==null)"添加停留点" else "编辑停留点",style=MaterialTheme.typography.titleMedium)
        OutlinedTextField(title,{title=it},label={Text("地点或安排")},modifier=Modifier.fillMaxWidth(),enabled=!pending)
        OutlinedTextField(time,{time=it},label={Text("时间（HH:mm，可留空）")},modifier=Modifier.fillMaxWidth(),enabled=!pending)
        OutlinedTextField(note,{note=it},label={Text("备注")},modifier=Modifier.fillMaxWidth(),enabled=!pending)
      }
      item{Row(Modifier.horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(6.dp)){
        FilterChip(placeId==null,{placeId=null},enabled=!pending,label={Text("不关联地点")})
        places.forEach{place->FilterChip(placeId==place.id,{placeId=place.id;if(title.isBlank())title=place.name},enabled=!pending,label={Text(place.name)})}
      }}
      item{OutlinedButton(enabled=!pending&&title.isNotBlank()&&title.trim().length<=200&&note.length<=1000&&(stops.size<100||editingId!=null),onClick={runCatching{
        val stop=TravelStopSummary(editingId?:newTravelStopId(),title.trim(),stops.firstOrNull{it.id==editingId}?.startsAt?.takeIf{travelTime(it,trip.timeZone)==time}?:travelStopInstant(date,time,trip.timeZone),placeId,note.trim().ifBlank{null})
        stops=if(editingId==null)stops+stop else stops.map{if(it.id==editingId)stop else it}
        editingId=null;title="";time="";note="";placeId=null;error=null
      }.onFailure{error=it.message?:"请检查时间格式"}}){Text(if(editingId==null)"加入当天" else "完成点位修改")}}
      error?.let{item{Text(it,color=MaterialTheme.colorScheme.error)}}
      if(state is SubmitState.Rejected)item{Text(state.message,color=MaterialTheme.colorScheme.error)}
      if(state is SubmitState.Saved)item{Text("安排已进入同步队列，完成后会自动更新。",color=MaterialTheme.colorScheme.primary)}
      item{if(state is SubmitState.Saved)Button(onClick=onDismiss,modifier=Modifier.fillMaxWidth()){Text("完成")} else Button(enabled=!pending&&title.isBlank(),onClick={onSave(TravelDayDraft(trip.id,date,day?.revision,stops))},modifier=Modifier.fillMaxWidth()){Text(if(pending)"保存中…" else "保存当天安排")};if(title.isNotBlank())Text("先完成当前点位，再保存当天安排。",style=MaterialTheme.typography.bodySmall)}
    }
  }
}
