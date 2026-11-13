package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId

private fun JSONObject.cardText(key:String)=optString(key).takeUnless{it=="null"}.orEmpty()
@Composable internal fun DestinationCard(accountId:String,trip:TravelTripSummary,date:String,places:List<TravelPlaceSummary>){
  val context=LocalContext.current
  val app=context.applicationContext as ShadowApp
  val repo=remember(accountId){NativeLifeRepository(context,app)}
  val cache=remember(accountId){UiDraftStore(context,accountId)}
  val cacheKey="destination/${trip.id}/$date"
  val scope=rememberCoroutineScope()
  var row by remember(cacheKey){mutableStateOf<JSONObject?>(null)}
  var hotels by remember(cacheKey){mutableStateOf<List<JSONObject>>(emptyList())}
  var offline by remember{mutableStateOf(false)}
  var savedAt by remember{mutableStateOf("")}
  var show by rememberSaveable(cacheKey){mutableStateOf(false)}
  var editing by rememberSaveable(cacheKey){mutableStateOf(false)}
  var retry by remember{mutableIntStateOf(0)}
  var message by remember(cacheKey){mutableStateOf("")}
  var queued by rememberSaveable(cacheKey){mutableStateOf<String?>(null)}
  var busy by remember{mutableStateOf(false)}
  var hotel by rememberSaveable(cacheKey){mutableStateOf("")}
  var place by rememberSaveable(cacheKey){mutableStateOf("")}
  var name by rememberSaveable(cacheKey){mutableStateOf("")}
  var address by rememberSaveable(cacheKey){mutableStateOf("")}
  var entrance by rememberSaveable(cacheKey){mutableStateOf("")}
  LaunchedEffect(accountId,cacheKey,retry){
    val old=cache.read(cacheKey,"card")?.let{runCatching{JSONObject(it)}.getOrNull()}
    row=old?.optJSONObject("destination");savedAt=old?.cardText("saved_at").orEmpty()
    try{
      check(app.sessions.active()?.accountId==accountId){"账号已切换"}
      val result=repo.destinations(trip.id,date)
      offline=false;message=""
      row=result.getJSONArray("items").optJSONObject(0);savedAt=result.getString("as_of")
      val current=row
      if(current==null||current.cardText("name").isBlank())cache.clear(cacheKey) else{
        val safe=JSONObject()
        listOf("name","local_name","address","entrance").forEach{k->safe.put(k,current.cardText(k))}
        cache.write(cacheKey,"card",JSONObject().put("destination",safe).put("saved_at",savedAt).toString())
      }
    }catch(e:CancellationException){throw e}catch(e:Exception){offline=true;message=if(old!=null)"离线卡保存于 $savedAt" else e.message?:"无法读取目的地";return@LaunchedEffect}
    try{
      val zone=ZoneId.of(trip.timeZone)
      hotels=repo.connectionReservations(trip.id).filter{b->
        fun day(key:String)=runCatching{Instant.parse(b.getString(key)).atZone(zone).toLocalDate().toString()}.getOrNull()
        b.cardText("state")=="confirmed"&&b.cardText("reservation_type")=="hotel"&&day("starts_at")?.let{it<=date}==true&&day("ends_at")?.let{it>date}==true
      }
    }catch(e:CancellationException){throw e}catch(e:Exception){message="住宿列表暂时无法读取"}
  }
  LaunchedEffect(accountId,queued){
    val id=queued?:return@LaunchedEffect
    val session=app.sessions.active()?.takeIf{it.accountId==accountId}?:return@LaunchedEffect
    app.database.commands().observeCommandState(accountId,session.subjectId,id).collect{state->
      when(state){"committed"->{queued=null;editing=false;retry++};"failed","blocked"->{queued=null;message="保存失败，请重新读取"}}
    }
  }
  LifeCard{
    Text("目的地卡",style=MaterialTheme.typography.titleLarge)
    val display=row?.let{r->listOf("local_name","name","address","entrance").map{r.cardText(it)}.filter{it.isNotBlank()}.distinct()}.orEmpty()
    if(display.isNotEmpty())TextButton(onClick={show=true}){Text("给司机看 · ${display.first()}")}
    if(show&&display.isNotEmpty())Dialog(onDismissRequest={show=false},properties=DialogProperties(usePlatformDefaultWidth=false)){
      Surface(Modifier.fillMaxSize()){Column(Modifier.padding(28.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(20.dp)){
        display.forEach{Text(it,fontSize=36.sp,lineHeight=43.sp)}
        TextButton(onClick={show=false}){Text("关闭大字卡")}
      }}
    }
    if(!offline)TextButton(enabled=!busy&&queued==null,onClick={
      editing=!editing;hotel=row?.cardText("hotel_id").orEmpty();place=row?.cardText("place_id").orEmpty()
      name=row?.cardText("local_name").orEmpty();address=row?.cardText("address").orEmpty();entrance=row?.cardText("entrance").orEmpty()
    }){Text(if(editing)"收起" else "编辑目的地卡")}
    if(editing&&!offline){
      TextButton(onClick={hotel=""}){Text("手选地点")}
      hotels.forEach{h->FilterChip(hotel==h.getString("id"),{hotel=h.getString("id");address=h.cardText("destination")},label={Text(h.getString("title"))})}
      places.forEach{p->FilterChip(place==p.id,{place=if(place==p.id)"" else p.id;address=p.address.orEmpty()},label={Text(p.name)})}
      OutlinedTextField(name,{name=it},label={Text("当地名称")});OutlinedTextField(address,{address=it},label={Text("街道地址")})
      OutlinedTextField(entrance,{entrance=it},label={Text("入口说明")})
      Button(enabled=!busy&&queued==null&&(hotel.isNotEmpty()||place.isNotEmpty()),onClick={
        val input=JSONObject().put("trip_id",trip.id).put("on",date)
        listOf("reservation_id" to hotel,"place_id" to place,"local_name" to name,"address" to address,"entrance" to entrance).forEach{(k,v)->if(v.isNotBlank())input.put(k,v.trim())}
        row?.optInt("revision")?.takeIf{it>0}?.let{input.put("expected_revision",it)}
        busy=true
        scope.launch{try{queued=repo.captureWrite("travel.save_destination",input,accountId).commandId;message="已保存到本机，待同步"}
          catch(e:CancellationException){throw e}catch(e:Exception){message=e.message?:"保存失败"}finally{busy=false}}
      }){Text("保存目的地")}
    }
    if(message.isNotBlank()){Text(message);TextButton(onClick={retry++}){Text("重新读取")}}
  }
}
