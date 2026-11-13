package com.shadow.life

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.time.*
import java.io.File
import android.media.MediaPlayer

private fun JSONObject.clean(key:String):String=if(isNull(key)) "" else optString(key)
private fun personalInitial(f:JSONObject):String=when(val default=f.clean("initial")){
  "today"->LocalDate.now().toString()
  "week"->LocalDate.now().minusDays(6).toString()
  "zone"->ZoneId.systemDefault().id
  else->default
}
private fun personalInstant(value:String,zone:String):String=runCatching{OffsetDateTime.parse(value).toInstant().toString()}
  .getOrElse{LocalDateTime.parse(value.replace(' ','T')).atZone(ZoneId.of(zone)).toInstant().toString()}
private fun personalValue(field:JSONObject,value:String,zone:String):Any=when(field.getString("type")){
  "int"->value.toInt()
  "seconds"->value.toBigDecimal().movePointRight(3).intValueExact()
  "bool"->value.toBooleanStrict()
  "instant"->personalInstant(value,zone)
  "evidence"->{val a=value.split(Regex("\\s+"));when(a[0]){
    "menu_photo"->JSONObject().put("kind",a[0]).put("library_item_id",a[1])
    "meal_intake"->JSONObject().put("kind",a[0]).put("meal_id",a[1]).put("intake_id",a[2])
    else->JSONObject().put("kind","note").put("note",value)
  }}
  "refs","points","allocations"->JSONArray().apply{value.lineSequence().filter{it.isNotBlank()}.forEach{line->
    val a=line.trim().split(Regex("\\s+"),limit=3)
    put(when(field.getString("type")){
      "refs"->JSONObject().put("kind",a[0]).put("id",a[1])
      "allocations"->JSONObject().put("refund_entry_id",a[0]).put("amount",a[1])
      else->JSONObject().put("at",personalInstant(a[0],zone)).put("severity",a[1].toInt()).apply{a.getOrNull(2)?.let{put("note",it)}}
    })
  }}
  else->value
}
private fun fillPersonal(key:String,r:JSONObject,source:String):String{
  val list=r.optJSONArray(source)?.trainingObjects().orEmpty()
  return when(key){
    "refs"->list.joinToString("\n"){it.clean("kind")+" "+it.clean("id")}
    "points"->list.joinToString("\n"){it.clean("at")+" "+it.clean("severity")+" "+it.clean("note")}
    "allocations"->list.filter{it.optDouble("allocated",0.0)>0}.joinToString("\n"){it.clean("refund_entry_id")+" "+it.clean("allocated")}
    "start_ms","end_ms"->(r.optLong(source)/1000.0).toString()
    else->r.clean(source)
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun PersonalRecordsCard(accountId:String,section:String?=null){
  val context=LocalContext.current
  val app=context.applicationContext as ShadowApp
  val repo=remember(accountId){NativeLifeRepository(context,app)}
  val groups=remember(section){context.assets.open("personal-records.json").bufferedReader().use{JSONArray(it.readText()).trainingObjects().filter{g->section==null||g.getString("title")==section}}}
  val labels=remember{buildMap<String,String>{
    groups.forEach{g->g.getJSONArray("actions").trainingObjects().forEach{a->a.getJSONArray("fields").trainingObjects().forEach{put(it.getString("key"),it.getString("label"))}}}
    putAll(mapOf("records" to "正式明细","basis" to "核对依据","received" to "到账","remaining" to "差额","group" to "分组","sleep_minutes" to "主睡眠分钟","quote" to "原文","path" to "位置","raw_name" to "原名","distance_km" to "公里","duration_minutes" to "分钟","minutes_per_km" to "分钟/公里","rpe" to "主观用力","heart_rate_avg" to "平均心率","relation" to "关联","external_id" to "外部编号","kind" to "来源","refunds" to "退款及可用份额","service_number" to "车次","origin" to "发站","destination" to "到站","starts_at" to "发车","printed_fare" to "票面金额","confirmation_code" to "订票编号","provenance" to "出处","happened_on" to "日期","supporting" to "详情"))
  }}
  val scope=rememberCoroutineScope()
  var open by rememberSaveable(accountId){mutableStateOf(false)}
  var group by rememberSaveable(accountId){mutableIntStateOf(0)}
  var action by rememberSaveable(accountId){mutableIntStateOf(0)}
  var allowed by remember(accountId){mutableStateOf<Set<String>?>(null)}
  var formState by rememberSaveable(accountId){mutableStateOf("{}")}
  val form=remember(formState){JSONObject(formState)}
  var rows by remember(accountId){mutableStateOf(emptyList<JSONObject>())}
  var result by remember{mutableStateOf(JSONObject())}
  var next by remember{mutableStateOf(emptyMap<String,String>())}
  var busy by remember{mutableStateOf(false)}
  var status by rememberSaveable(accountId){mutableStateOf("")}
  var pending by rememberSaveable(accountId){mutableStateOf<String?>(null)}
  var selection by remember{mutableStateOf(emptySet<String>())}
  var reportAsset by rememberSaveable(accountId){mutableStateOf("")}
  var export by remember{mutableStateOf("")}
  var audio by remember{mutableStateOf<MediaPlayer?>(null)}
  var clipFile by remember{mutableStateOf<File?>(null)}
  DisposableEffect(accountId){onDispose{audio?.release();clipFile?.delete()}}
  val exporter=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json")){uri->
    if(uri!=null)scope.launch{try{withContext(Dispatchers.IO){context.contentResolver.openOutputStream(uri)?.bufferedWriter()?.use{it.write(export)}?:error("导出失败")};status="已导出"}catch(e:Exception){status=e.message?:"导出失败"}}
  }
  fun set(key:String,value:String){formState=JSONObject(formState).put(key,value).toString()}
  fun clearResults(){rows=emptyList();result=JSONObject();next=emptyMap();selection=emptySet();status=""}
  val actions=groups[group].getJSONArray("actions").trainingObjects().filter{allowed?.contains(it.getString("cap"))!=false}
  val current=actions.getOrNull(action)?:actions.firstOrNull()
  val cap=current?.getString("cap").orEmpty()
  fun task(block:suspend ()->Unit){busy=true;scope.launch{try{check(app.sessions.active()?.accountId==accountId){"账号已切换"};block()}catch(e:CancellationException){throw e}catch(e:Exception){status=e.message?:"操作失败"}finally{busy=false}}}
  LaunchedEffect(accountId,open){if(open&&allowed==null)try{allowed=repo.personalRecordsPage("/api/capabilities",emptyMap()).getJSONArray("capabilities").trainingObjects().map{it.getString("name")}.toSet()}catch(e:CancellationException){throw e}catch(e:Exception){status="能力目录暂不可用"}}
  LaunchedEffect(accountId,pending){
    val key=pending?:return@LaunchedEffect
    val session=app.sessions.active()?.takeIf{it.accountId==accountId}?:return@LaunchedEffect
    app.database.commands().observeCommandState(accountId,session.subjectId,key).collect{state->when(state){
      "committed"->{pending=null;status="已同步，可重新查询";set("id","");set("case_id","");set("expected_revision","")}
      "failed","blocked"->{pending=null;status="同步失败，请读取当前版本"}
    }}
  }
  suspend fun submit(name:String,input:JSONObject){pending=repo.captureWrite(name,input,accountId).commandId;status="已存入本机队列，待同步"}
  val reportExport=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")){uri->
    if(uri!=null)task{repo.exportAsset(reportAsset,uri,accountId);status="报告原件已导出"}
  }
  fun run(more:Boolean=false){val a=current?:return;task{
    val payload=JSONObject()
    for(f in a.getJSONArray("fields").trainingObjects()){
      val key=f.getString("key");val value=if(form.has(key))form.clean(key) else personalInitial(f)
      if(value.isNotBlank())payload.put(key,personalValue(f,value.trim(),form.clean("time_zone").ifBlank{ZoneId.systemDefault().id}))
    }
    if(!a.has("path")){
      if(cap=="life.place_item"&&!payload.has("container_id"))payload.put("container_id",JSONObject.NULL)
      if(cap=="life.record_meal"){
        val intake=JSONObject().put("name",payload.remove("dish")).put("food_ref_id",payload.remove("food_ref_id"))
        payload.remove("amount_g")?.let{intake.put("amount_g",it).put("estimate",true).put("evidence_note","本次估重")};payload.put("items",JSONArray().put(intake))
      }
      submit(cap,payload)
    }else{
      val page=repo.personalRecordsPage(a.getString("path"),payload.keys().asSequence().associateWith{payload.getString(it)}+(if(more)next else emptyMap()))
      val rowKey=a.clean("rows");val items=if(rowKey=="ticket")listOf(page) else page.optJSONArray(rowKey)?.trainingObjects().orEmpty()
      check(app.sessions.active()?.accountId==accountId){"账号已切换"}
      rows=(if(more)rows else emptyList())+items;result=page;selection=emptySet()
      next=when{
        !page.isNull("next_cursor")->mapOf("cursor" to page.getString("next_cursor"))
        !page.isNull("next_offset")->mapOf("offset" to page.getInt("next_offset").toString())
        page.opt("next") is String->mapOf("after" to page.getString("next"))
        page.opt("next") is JSONObject->page.getJSONObject("next").let{n->n.keys().asSequence().associateWith{n.getString(it)}}
        page.optBoolean("more_"+rowKey)->mapOf("offset" to rows.size.toString())
        else->emptyMap()
      }
      status=if(rows.isEmpty())"没有匹配的记录" else ""
    }
  }}
  LifeCard{
    TextButton(onClick={open=!open}){Text(section?:"生活记录与复盘")}
    if(open){
      FlowRow{groups.forEachIndexed{i,g->if(allowed==null||g.getJSONArray("actions").trainingObjects().any{allowed!!.contains(it.getString("cap"))})TextButton(enabled=!busy,onClick={group=i;action=0;formState="{}";clearResults()}){Text(g.getString("title"))}}}
      FlowRow{actions.forEachIndexed{i,a->TextButton(enabled=!busy,onClick={action=i;clearResults()}){Text(a.getString("title"))}}}
      current?.let{a->
        Text(a.getString("title"),style=MaterialTheme.typography.titleMedium)
        for(f in a.getJSONArray("fields").trainingObjects()){
          val k=f.getString("key");val v=if(form.has(k))form.clean(k) else personalInitial(f)
          val choices=f.optJSONObject("choices")?:if(f.getString("type")=="bool")JSONObject().put("true","是").put("false","否") else null
          if(choices!=null){Text(f.getString("label"));FlowRow{choices.keys().forEach{code->FilterChip(selected=v==code,onClick={set(k,code)},label={Text(choices.getString(code))})}}}
          else OutlinedTextField(v,{set(k,it)},label={Text(f.getString("label"))},placeholder={Text(when(f.getString("type")){
            "refs"->"每行：visit / photo / audio 加编号";"points"->"每行：时刻 程度 备注";"allocations"->"每行：退款编号 分配金额";"evidence"->"出处说明，或 menu_photo 照片编号";"instant"->"2026-11-13T09:00";else->""})})
        }
        FlowRow{TextButton(enabled=!busy&&pending==null,onClick={run()}){Text(if(a.has("path"))"查询" else a.getString("title"))};TextButton(enabled=!busy,onClick={formState="{}";clearResults()}){Text("清空选择")}}
      }
      if(status.isNotBlank())Text(status)
      if(result.has("confirmed_expenses"))Text("正式支出 ${result.optInt("confirmed_expenses")} 笔，合计 ${result.clean("gross_amount")} ${result.clean("currency")}。同日同额的 ${result.optInt("candidate_groups")} 组仍计入合计。")
      if(result.has("active_minutes"))Text("已记录 ${result.optDouble("active_minutes")} 分钟，其他时间覆盖未知")
      if(result.has("evening"))for((key,title) in listOf("evening" to "晚间训练","rest" to "休息日"))result.optJSONObject(key)?.let{Text("$title · ${it.optInt("samples")} 个样本 · 缺测 ${it.optInt("missing")} · 平均 ${it.clean("average_minutes").ifBlank{"未知"}} 分钟")}
      rows.forEach{r->
        HorizontalDivider()
        for(k in r.keys())if(labels.containsKey(k)&&!r.isNull(k)&&r.clean(k)!="[]"&&r.clean(k)!="{}")Text("${labels[k]}  ${r.clean(k)}")
        current?.optJSONObject("pick")?.let{mapping->if(r.optBoolean("editable",true))TextButton(onClick={
          val patch=JSONObject(formState);mapping.keys().forEach{k->patch.put(k,fillPersonal(k,r,mapping.getString(k)))};formState=patch.toString();status="已选择，可切换到对应操作"
        }){Text("选择这条记录")}}
        if(cap=="health.lab_results")TextButton(enabled=!busy,onClick={task{
          val doc=repo.personalRecordsPage("/api/library/items/"+r.getString("report_id"),emptyMap())
          val version=doc.optJSONArray("sources")?.trainingObjects()?.firstNotNullOfOrNull{it.optJSONObject("asset")?.clean("id")?.takeIf{v->v.isNotBlank()}}
          if(version!=null){reportAsset=version;reportExport.launch(r.clean("report_title"))}else{val revision=doc.optJSONArray("revisions")?.trainingObjects()?.find{it.optInt("revision")==r.optInt("report_revision")};status=revision?.clean("text")?.ifBlank{null}?:"该报告没有可下载原件"}
        }}){Text("查看报告原件 · 第 ${r.optInt("page")} 页")}
        if(cap=="health.lab_results")FlowRow{for((key,title) in listOf("left_id" to "选为第一项","right_id" to "选为第二项"))TextButton(onClick={set(key,r.getString("id"));status=title}){Text(title)}}
        if(cap=="health.episodes")FilterChip(selected=r.getString("id") in selection,onClick={val id=r.getString("id");selection=if(id in selection)selection-id else selection+id},label={Text("加入导出")})
        if(cap=="life.clips")TextButton(enabled=!r.isNull("asset_version_id")&&!busy,onClick={task{
          audio?.release();clipFile?.delete();val file=File.createTempFile("clip-",".audio",context.cacheDir);clipFile=file
          repo.exportAsset(r.getString("asset_version_id"),android.net.Uri.fromFile(file),accountId)
          audio=MediaPlayer().apply{setDataSource(file.absolutePath);prepare();seekTo(r.getInt("start_ms"));start()};val player=audio
          scope.launch{delay((r.getInt("end_ms")-r.getInt("start_ms")).toLong());if(audio===player)audio?.pause()}
        }}){Text(if(r.isNull("asset_version_id"))"原声不可用" else "播放选段")}
        if(cap=="travel.diary")TextButton(onClick={task{
          val copy=JSONObject(r.toString());for(ref in copy.getJSONArray("refs").trainingObjects())if(!ref.isNull("asset_version_id")){
            val tmp=File.createTempFile("diary-",".bin",context.cacheDir);try{repo.exportAsset(ref.getString("asset_version_id"),android.net.Uri.fromFile(tmp),accountId);ref.put("base64",withContext(Dispatchers.IO){android.util.Base64.encodeToString(tmp.readBytes(),android.util.Base64.NO_WRAP)})}finally{tmp.delete()}
          };export=copy.toString(2);exporter.launch("旅行小记-${r.clean("local_day")}.json")
        }}){Text("导出此篇及所选原件")}
        if(cap=="travel.rail_ticket"&&!r.isNull("service_number")){
          val matches=r.getJSONArray("matched").trainingObjects()
          for(existing in matches.ifEmpty{listOf(JSONObject())})TextButton(enabled=!busy&&pending==null,onClick={task{
            val input=JSONObject().put("reservation_type","rail").put("title",listOf("service_number","origin","destination").map{r.clean(it)}.filter{it.isNotBlank()}.joinToString(" ")).put("visibility","private").put("state","confirmed")
            for(k in listOf("confirmation_code","starts_at","origin","destination","service_number"))if(!r.isNull(k))input.put(k,r.get(k))
            input.put("source",JSONObject().put("kind","text").put("external_id","library:${r.clean("library_item_id")}:r${r.optInt("library_revision")}").put("captured_on",LocalDate.now().toString()).put("original_text",r.clean("quote")))
            if(existing.has("id"))submit("travel.correct_reservation",input.put("reservation_id",existing.getString("id")).put("expected_revision",existing.getInt("revision")).put("reason","按铁路确认单更正"))
            else submit("travel.add_reservation",input.put("trip_id",form.getString("trip_id")))
          }}){Text(if(existing.has("id"))"更正 ${existing.clean("title")}" else "保存为私人铁路预订")}
        }
      }
      if(selection.isNotEmpty())TextButton(onClick={export=JSONArray(rows.filter{it.clean("id") in selection}).toString(2);exporter.launch("发作摘要.json")}){Text("导出选中的 ${selection.size} 条")}
      if(next.isNotEmpty())TextButton(enabled=!busy,onClick={run(true)}){Text("下一页")}
    }
  }
}
