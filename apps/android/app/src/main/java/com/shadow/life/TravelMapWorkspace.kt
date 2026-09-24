package com.shadow.life

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.CancellationException

private data class RoadMapResult(val key:String,val routes:List<GoogleRoadRoute>,val unavailable:Int)

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun TravelMapWorkspace(
  value:WorkspaceOverview.Travel,trip:TravelTripSummary?,days:List<TravelDaySummary>,dates:List<String>,selectedDate:String?,onSelectDate:(String)->Unit,onGestureActive:(Boolean)->Unit
){
  val context=LocalContext.current
  var scope by rememberSaveable(trip?.id){mutableStateOf("day")}
  var selectedMap by rememberSaveable{mutableStateOf<String?>(null)}
  var providerName by rememberSaveable{mutableStateOf(TravelMapPreference.provider(context).name)}
  var satellite by rememberSaveable{mutableStateOf(false)}
  var showMarkers by rememberSaveable{mutableStateOf(true)}
  var showRoutes by rememberSaveable{mutableStateOf(true)}
  var fullscreen by rememberSaveable{mutableStateOf(false)}
  var listExpanded by rememberSaveable{mutableStateOf(true)}
  var amapConsent by remember{mutableStateOf(TravelMapPreference.hasAmapConsent(context))}
  var showAmapConsent by remember{mutableStateOf(false)}
  LaunchedEffect(trip?.id){if(trip!=null&&scope=="theme")scope="day"}
  val provider=TravelMapProvider.entries.firstOrNull{it.name==providerName}?:TravelMapProvider.Google
  val orderedDays=days.sortedBy{it.date}
  val dayMap=travelDayMap(orderedDays.firstOrNull{it.date==selectedDate},value.placeItems)
  val allMaps=orderedDays.mapIndexed{index,day->travelDayMap(day,value.placeItems,"${index+1}")}
  val allMarkers=allMaps.flatMap{it.markers}.groupBy{Triple(it.title,it.latitude,it.longitude)}.values.map{samePlace->samePlace.first().copy(label=samePlace.mapNotNull{it.label}.joinToString("/").take(6),supporting="日程 ${samePlace.mapNotNull{it.label}.joinToString("、")}")}
  val selected=value.mapItems.firstOrNull{it.id==selectedMap}
  val themePlaces=selected?.items?.map{it.placeId}?.toSet()?.let{ids->value.placeItems.filter{it.id in ids}}?:value.placeItems
  val markers=when(scope){"day"->dayMap.markers;"all"->allMarkers;else->travelMapMarkers(value,themePlaces,selectedMap==null)}
  val routes=when(scope){"day"->dayMap.routes;"all"->allMaps.flatMap{it.routes};else->emptyList()}
  val tracks=if(scope=="theme"&&selectedMap==null)value.tracks else emptyList()
  val displayMarkers=if(showMarkers)markers else emptyList()
  val roadCache=remember{mutableMapOf<String,GoogleRoadRoute>()}
  val roadKey=routes.joinToString("|"){segment->segment.joinToString(";"){"${it.latitude},${it.longitude}"}}
  val roadMap by produceState<RoadMapResult?>(initialValue=null,provider,showRoutes,roadKey){
    this.value=null
    if(provider==TravelMapProvider.Google&&showRoutes&&routes.isNotEmpty()){
      val found=mutableListOf<GoogleRoadRoute>();var unavailable=0
      for(segment in routes){
        val key=segment.joinToString(";"){"${it.latitude},${it.longitude}"}
        val route=roadCache[key]?:try{fetchGoogleRoadRoute(context,segment,BuildConfig.GOOGLE_MAPS_API_KEY)?.also{roadCache[key]=it}}catch(error:CancellationException){throw error}catch(_:Exception){null}
        if(route==null)unavailable++ else found+=route
      }
      this.value=RoadMapResult(roadKey,found,unavailable)
    }
  }
  val activeRoadMap=roadMap?.takeIf{it.key==roadKey}
  val displayRoutes=if(!showRoutes)emptyList() else if(provider==TravelMapProvider.Google)activeRoadMap?.routes?.map{it.points}.orEmpty() else routes
  val routeStatus=when{
    scope=="theme"->"主题地图和导入轨迹与行程计划分别保存。"
    provider==TravelMapProvider.Amap->"高德底图上的橙线仅示意地点顺序，不是道路导航。"
    !showRoutes->"路线已隐藏；计划地点不代表实际到访。"
    routes.isEmpty()->"当前范围没有连续的可定位地点。"
    activeRoadMap==null->"正在计算 Google 驾车道路路线…"
    activeRoadMap.routes.isEmpty()->"没有可用的驾车道路路线；可在地点清单中逐段打开 Google 地图。"
    else->"Google 驾车道路路线 · ${"%.1f".format(activeRoadMap.routes.sumOf{it.distanceMeters}/1000.0)} 公里 · 约 ${(activeRoadMap.routes.sumOf{it.durationSeconds}+30)/60} 分钟${if(activeRoadMap.unavailable>0)"；${activeRoadMap.unavailable} 段无可用道路" else ""}。计划地点不代表实际到访。"
  }
  val visibleDays=if(scope=="day")orderedDays.filter{it.date==selectedDate} else orderedDays
  fun selectProvider(next:TravelMapProvider){
    if(next==TravelMapProvider.Amap&&!amapConsent&&providerConfigured(next))showAmapConsent=true
    else{providerName=next.name;TravelMapPreference.setProvider(context,next)}
  }
  LaunchedEffect(provider,amapConsent){if(provider==TravelMapProvider.Amap&&!amapConsent&&providerConfigured(provider))showAmapConsent=true}
  if(showAmapConsent)AlertDialog(
    onDismissRequest={showAmapConsent=false},title={Text("启用高德地图")},
    text={Text("高德地图 SDK 会联网加载地图服务。首次使用前需要同意高德地图隐私政策；不同意仍可切换 Google 地图或查看本地坐标预览。")},
    confirmButton={Button(onClick={TravelMapPreference.setAmapConsent(context,true);amapConsent=true;providerName=TravelMapProvider.Amap.name;TravelMapPreference.setProvider(context,TravelMapProvider.Amap);showAmapConsent=false}){Text("同意并启用")}},
    dismissButton={TextButton(onClick={showAmapConsent=false;providerName=TravelMapProvider.Google.name;TravelMapPreference.setProvider(context,TravelMapProvider.Google)}){Text("暂不使用")}}
  )

  @Composable fun mapView(modifier:Modifier,gesture:(Boolean)->Unit){
    if(provider==TravelMapProvider.Amap&&!amapConsent&&providerConfigured(provider)){
      Box(modifier){TravelMapCanvas(displayMarkers,tracks,Modifier.fillMaxSize(),displayRoutes);TextButton(onClick={showAmapConsent=true},Modifier.align(Alignment.BottomCenter)){Text("同意隐私说明后加载高德地图")}}
    }else TravelNativeMap(provider,displayMarkers,tracks,modifier,displayRoutes,satellite,gesture)
  }
  @Composable fun controls(){
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
      TravelMapProvider.entries.forEach{item->FilterChip(provider==item,{selectProvider(item)},label={Text(item.label+if(providerConfigured(item))"" else " · 待配置")})}
    }
    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
      FilterChip(satellite,{satellite=!satellite},label={Text(if(satellite)"卫星图" else "标准图")})
      FilterChip(showMarkers,{showMarkers=!showMarkers},label={Text("地点标记")})
      if(scope!="theme")FilterChip(showRoutes,{showRoutes=!showRoutes},label={Text(if(provider==TravelMapProvider.Google)"道路路线" else "示意路线")})
    }
  }
  @Composable fun stops(gesture:(Boolean)->Unit){
    if(scope!="theme")TravelMapStopPanel(scope,visibleDays,dates,selectedDate,value.placeItems,markers.size,displayRoutes,listExpanded,{listExpanded=!listExpanded},gesture)
    else Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
      Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp)){
        FilterChip(selectedMap==null,{selectedMap=null},label={Text("全部足迹 ${markers.size}")})
        value.mapItems.forEach{map->FilterChip(selectedMap==map.id,{selectedMap=map.id},label={Text("${map.title} ${map.items.size}")})}
      }
    }
  }
  if(fullscreen){
    Dialog(onDismissRequest={fullscreen=false;listExpanded=true},properties=DialogProperties(usePlatformDefaultWidth=false,decorFitsSystemWindows=false)){
      Surface(Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background){
        Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().padding(horizontal=12.dp,vertical=8.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
          Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text(trip?.title?:"旅行地图",Modifier.weight(1f),style=MaterialTheme.typography.titleLarge);TextButton(onClick={fullscreen=false;listExpanded=true}){Text("返回旅程")}}
          TravelMapDateTabs(trip,dates,orderedDays,scope,selectedDate,{scope=it},onSelectDate)
          controls()
          mapView(Modifier.fillMaxWidth().weight(1f),{})
          stops({})
          Text(routeStatus,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
    }
    Spacer(Modifier.fillMaxWidth().height(480.dp))
  }else Column(verticalArrangement=Arrangement.spacedBy(10.dp)){
    Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Text("旅行地图",Modifier.weight(1f),style=MaterialTheme.typography.headlineSmall);FilledTonalButton(onClick={fullscreen=true;listExpanded=false}){Text("展开地图")}}
    TravelMapDateTabs(trip,dates,orderedDays,scope,selectedDate,{scope=it},onSelectDate)
    controls()
    mapView(Modifier.fillMaxWidth().height(480.dp),onGestureActive)
    stops(onGestureActive)
    Text(routeStatus,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
    if(markers.isEmpty()&&tracks.isEmpty())Text("当前范围没有带经纬度的地点；可在日程中关联已保存地点。",color=MaterialTheme.colorScheme.onSurfaceVariant)
  }
}

@Composable private fun TravelMapDateTabs(trip:TravelTripSummary?,dates:List<String>,days:List<TravelDaySummary>,scope:String,selectedDate:String?,onScope:(String)->Unit,onDate:(String)->Unit){
  val selectedTab=remember{BringIntoViewRequester()}
  LaunchedEffect(trip?.id,selectedDate,scope,days){if(scope=="day"&&selectedDate in dates)selectedTab.bringIntoView()}
  Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=Alignment.CenterVertically){
    if(trip!=null){
      FilterChip(scope=="all",{onScope("all")},label={Text("全部")})
      dates.forEachIndexed{index,date->FilterChip(scope=="day"&&selectedDate==date,{onDate(date);onScope("day")},modifier=if(scope=="day"&&selectedDate==date)Modifier.bringIntoViewRequester(selectedTab) else Modifier,label={Column{Text("第 ${index+1} 天 · ${date.takeLast(5)}");Text("${days.firstOrNull{it.date==date}?.stops?.size?:0} 站",style=MaterialTheme.typography.labelSmall)}})}
    }
    FilterChip(scope=="theme",{onScope("theme")},label={Text("足迹与主题地图")})
  }
}

@Composable private fun TravelMapStopPanel(scope:String,days:List<TravelDaySummary>,dates:List<String>,selectedDate:String?,places:List<TravelPlaceSummary>,markerCount:Int,routes:List<List<TravelMapPoint>>,expanded:Boolean,onToggle:()->Unit,onGestureActive:(Boolean)->Unit){
  val context=LocalContext.current
  val stopScroll=rememberScrollState()
  LaunchedEffect(scope,selectedDate,days){stopScroll.scrollTo(0)}
  val stopCount=days.sumOf{it.stops.size}
  Surface(shape=MaterialTheme.shapes.large,color=MaterialTheme.colorScheme.surfaceVariant.copy(alpha=.55f)){
    Column(Modifier.fillMaxWidth().padding(12.dp),verticalArrangement=Arrangement.spacedBy(5.dp)){
      Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically){Column(Modifier.weight(1f)){Text(if(scope=="day")"第 ${dates.indexOf(selectedDate)+1} 天 · ${selectedDate.orEmpty()}" else "全部日期",style=MaterialTheme.typography.titleMedium);Text("$markerCount 个地图标记 · $stopCount 项日程",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)};TextButton(onClick=onToggle){Text(if(expanded)"收起地点" else "展开地点")}}
      if(expanded){
        Column(Modifier.fillMaxWidth().heightIn(max=250.dp).pointerInput(onGestureActive){awaitEachGesture{awaitFirstDown(requireUnconsumed=false);onGestureActive(true);try{do{val event=awaitPointerEvent()}while(event.changes.any{it.pressed})}finally{onGestureActive(false)}}}.verticalScroll(stopScroll),verticalArrangement=Arrangement.spacedBy(8.dp)){
          if(days.isEmpty())Text("当天尚无日程。")
          days.forEach{day->
            if(scope=="all")Text("第 ${dates.indexOf(day.date)+1} 天 · ${day.date}",style=MaterialTheme.typography.titleSmall,color=MaterialTheme.colorScheme.primary)
            if(day.stops.isEmpty())Text("当天留空或自由活动",style=MaterialTheme.typography.bodySmall)
            day.stops.forEachIndexed{index,stop->
              val place=places.firstOrNull{it.id==stop.placeId}
              Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp)){
                Text("${index+1}.",color=MaterialTheme.colorScheme.primary)
                Column{Text(stop.title);Text(place?.name?:"未关联可定位地点",style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}
              }
              HorizontalDivider()
            }
          }
          if(scope=="day")routes.flatMap{it.zipWithNext()}.forEachIndexed{index,(origin,destination)->TextButton(onClick={runCatching{context.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(googleDirectionsUrl(origin,destination))))}}){Text("在 Google 地图查看第 ${index+1} 段道路路线 ↗")}}
        }
      }
    }
  }
}
