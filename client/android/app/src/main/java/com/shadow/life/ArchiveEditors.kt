package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

@Composable internal fun LabResultEditor(
  accountId:String,result:JSONObject?,initialReport:JSONObject?,onBack:()->Unit,onSaved:()->Unit
){
  val original=result?:initialReport
  var reportId by rememberSaveable{mutableStateOf(original?.optNullableString("report_id"))}
  var reportTitle by rememberSaveable{mutableStateOf(original?.optNullableString("report_title"))}
  var reportRevision by rememberSaveable{mutableIntStateOf(original?.getInt("report_revision")?:0)}
  var pickReport by rememberSaveable{mutableStateOf(false)}
  var page by rememberSaveable{mutableStateOf(result?.getInt("page")?.toString()?: "1")}
  var date by rememberSaveable{mutableStateOf(original?.optNullableString("tested_on")?:LocalDate.now().toString())}
  var name by rememberSaveable{mutableStateOf(result?.optNullableString("raw_name").orEmpty())}
  var value by rememberSaveable{mutableStateOf(result?.optNullableString("value").orEmpty())}
  var unit by rememberSaveable{mutableStateOf(result?.optNullableString("unit").orEmpty())}
  var reference by rememberSaveable{mutableStateOf(result?.optNullableString("reference").orEmpty())}

  RecordWriteScreen(accountId,if(result==null)"新增检验结果" else "编辑检验结果","health.save_lab_result",onBack,onSaved){enabled,save->
    OutlinedButton(enabled=enabled,onClick={pickReport=true},modifier=Modifier.fillMaxWidth()){
      Text(reportTitle?.let{"$it · 第 $reportRevision 版"}?:"选择体检报告")
    }
    ArchiveTextField(page,{page=it},"原报告页码",enabled,KeyboardType.Number)
    LifeDateField(date,{date=it},"检验日期",enabled)
    ArchiveTextField(name,{name=it.take(200)},"项目原名",enabled)
    ArchiveTextField(value,{value=it.take(200)},"原报告结果",enabled)
    ArchiveTextField(unit,{unit=it.take(200)},"单位（可选）",enabled)
    ArchiveTextField(reference,{reference=it.take(200)},"参考范围（可选）",enabled)
    val pageNumber=page.toIntOrNull()
    Button(enabled=enabled&&reportRevision>0&&pageNumber!=null&&pageNumber>0&&name.isNotBlank()&&value.isNotBlank(),onClick={
      save{
        JSONObject().put("report_id",reportId).put("report_revision",reportRevision).put("page",pageNumber)
          .put("tested_on",date).put("raw_name",name.trim()).put("value",value.trim())
          .putText("unit",unit).putText("reference",reference).apply{
            if(result!=null)put("id",result.getString("id")).put("expected_revision",result.getInt("revision"))
          }
      }
    }){Text("保存检验结果")}
  }
  if(pickReport)LabReportPicker(accountId,{pickReport=false}){row->
    reportId=row.id
    reportTitle=row.title
    reportRevision=checkNotNull(row.revision)
    pickReport=false
  }
}

@Composable private fun LabReportPicker(accountId:String,onBack:()->Unit,onSelect:(LibrarySummary)->Unit){
  val context=LocalContext.current
  val repo=remember(accountId){NativeLifeRepository(context,context.applicationContext as ShadowApp)}
  var query by rememberSaveable{mutableStateOf("")}
  var search by rememberSaveable{mutableStateOf("")}
  var cursor by rememberSaveable{mutableStateOf<String?>(null)}
  var retry by remember{mutableIntStateOf(0)}
  var state by remember(accountId,search,cursor,retry){mutableStateOf<LoadState<LibraryPage>>(LoadState.Loading)}
  LaunchedEffect(accountId,search,cursor,retry){
    try{state=LoadState.Ready(repo.library(search,cursor))}
    catch(error:CancellationException){throw error}
    catch(error:Exception){state=LoadState.Failed(error.message?:"无法读取资料")}
  }
  LifeFullScreen("选择体检报告",onBack){
    Column(Modifier.fillMaxSize(),verticalArrangement=Arrangement.spacedBy(8.dp)){
      OutlinedTextField(query,{query=it},Modifier.fillMaxWidth(),label={Text("搜索资料标题")},singleLine=true,
        trailingIcon={TextButton(onClick={search=query.trim();cursor=null;retry++}){Text("搜索")}})
      StateContent(state,{retry++}){page->
        LazyColumn(Modifier.weight(1f)){
          if(page.items.isEmpty())item{EmptyState("没有匹配的资料")}
          items(page.items,key={it.id}){row->
            TextButton(enabled=row.revision!=null,onClick={onSelect(row)},modifier=Modifier.fillMaxWidth()){
              Text(row.title,Modifier.weight(1f))
              row.revision?.let{Text("第 $it 版")}
            }
          }
          page.nextCursor?.let{next->item{TextButton(onClick={cursor=next}){Text("查看更早资料")}}}
        }
      }
    }
  }
}

@Composable internal fun EpisodeEditor(accountId:String,row:JSONObject?,onBack:()->Unit,onSaved:()->Unit){
  val zone=remember(row){ZoneId.of(row?.optNullableString("time_zone")?:ZoneId.systemDefault().id)}
  var title by rememberSaveable{mutableStateOf(row?.optNullableString("title").orEmpty())}
  var startedOn by rememberSaveable{mutableStateOf(row?.optNullableString("started_on")?:LocalDate.now(zone).toString())}
  var endedOn by rememberSaveable{mutableStateOf(row?.optNullableString("ended_on").orEmpty())}
  var startTime by rememberSaveable{mutableStateOf(row?.optNullableString("started_at")?.let{episodeTime(it,zone)}.orEmpty())}
  var endTime by rememberSaveable{mutableStateOf(row?.optNullableString("ended_at")?.let{episodeTime(it,zone)}.orEmpty())}
  var note by rememberSaveable{mutableStateOf(row?.optNullableString("note").orEmpty())}
  var points by rememberSaveable(stateSaver=listSaver<List<String>,String>(save={it},restore={it.toList()})){
    mutableStateOf(row?.optJSONArray("points")?.trainingObjects().orEmpty().map(JSONObject::toString))
  }
  var editingPoint by rememberSaveable{mutableStateOf<Int?>(null)}
  RecordWriteScreen(accountId,if(row==null)"记录不适" else "更新不适发作","health.save_episode",onBack,onSaved){enabled,save->
    ArchiveTextField(title,{title=it.take(200)},"发作名称",enabled)
    LifeDateField(startedOn,{startedOn=it},"开始日期",enabled)
    ArchiveTextField(startTime,{startTime=it},"开始时间 HH:mm（可选）",enabled)
    LifeDateField(endedOn,{endedOn=it},"结束日期（可选）",enabled)
    if(endedOn.isNotBlank()){
      ArchiveTextField(endTime,{endTime=it},"结束时间 HH:mm（可选）",enabled)
      TextButton(enabled=enabled,onClick={endedOn="";endTime=""}){Text("清除结束日期")}
    }
    Text("时区 · ${zone.id}",style=MaterialTheme.typography.bodySmall)
    Text("进展",style=MaterialTheme.typography.titleMedium)
    points.forEachIndexed{index,encoded->
      val point=JSONObject(encoded)
      val time=editablePersonalTime(Instant.parse(point.getString("at")),zone).replace('T',' ')
      val summary=listOfNotNull(time,point.optNullableString("severity")?.let{"$it 分"},point.optNullableString("note"))
      TextButton(enabled=enabled,onClick={editingPoint=index}){Text(summary.joinToString(" · "))}
    }
    TextButton(enabled=enabled&&points.size<100,onClick={editingPoint=points.size}){Text("＋ 添加进展")}
    ArchiveTextField(note,{note=it.take(4000)},"备注（可选）",enabled,singleLine=false)
    Button(enabled=enabled&&title.isNotBlank(),onClick={
      save{
        require(endedOn.isBlank()||endedOn>=startedOn){"结束日期须在开始日期当天或之后"}
        val from=optionalEpisodeInstant(startedOn,startTime,zone)
        val to=optionalEpisodeInstant(endedOn,endTime,zone)
        require(from==null||to==null||Instant.parse(to)>=Instant.parse(from)){"结束时刻须在开始时刻之后"}
        val entries=points.map(::JSONObject)
        require(entries.all{point->
          val instant=Instant.parse(point.getString("at"))
          val day=instant.atZone(zone).toLocalDate().toString()
          day>=startedOn&&(endedOn.isBlank()||day<=endedOn)&&
            (from==null||instant>=Instant.parse(from))&&(to==null||instant<=Instant.parse(to))
        }){"进展时间须在发作期间内"}
        JSONObject().put("title",title.trim()).put("started_on",startedOn).put("time_zone",zone.id)
          .putText("ended_on",endedOn).putText("note",note).put("points",JSONArray(entries)).apply{
            from?.let{put("started_at",it)}
            to?.let{put("ended_at",it)}
            if(row!=null)put("id",row.getString("id")).put("expected_revision",row.getInt("revision"))
          }
      }
    }){Text("保存发作记录")}
  }
  editingPoint?.let{index->
    key(index){
      EpisodePointEditor(points.getOrNull(index)?.let(::JSONObject),startedOn,zone,{editingPoint=null},
        onRemove=if(index<points.size){{points=points.filterIndexed{position,_->position!=index};editingPoint=null}}else null){value->
        points=if(index==points.size)points+value.toString()
          else points.mapIndexed{position,entry->if(position==index)value.toString() else entry}
        editingPoint=null
      }
    }
  }
}

@Composable private fun EpisodePointEditor(
  point:JSONObject?,initialDay:String,zone:ZoneId,onBack:()->Unit,onRemove:(()->Unit)?,onSave:(JSONObject)->Unit
){
  val instant=point?.optNullableString("at")
  var day by rememberSaveable{mutableStateOf(instant?.let{Instant.parse(it).atZone(zone).toLocalDate().toString()}?:initialDay)}
  var time by rememberSaveable{mutableStateOf(instant?.let{episodeTime(it,zone)}.orEmpty())}
  var severity by rememberSaveable{mutableStateOf(point?.optNullableString("severity")?.toIntOrNull())}
  var note by rememberSaveable{mutableStateOf(point?.optNullableString("note").orEmpty())}
  var error by rememberSaveable{mutableStateOf<String?>(null)}
  LifeFullScreen(if(point==null)"添加进展" else "编辑进展",onBack){
    Column(verticalArrangement=Arrangement.spacedBy(8.dp),
      modifier=Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(bottom=24.dp)){
      LifeDateField(day,{day=it},"记录日期")
      ArchiveTextField(time,{time=it},"记录时间 HH:mm",true)
      InlineScoreField("不适程度",severity){severity=it}
      ArchiveTextField(note,{note=it.take(200)},"备注（可选）",true)
      error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
      Row{
        Button(enabled=time.isNotBlank()&&(severity!=null||note.isNotBlank()),onClick={
          try{
            val value=JSONObject().put("at",checkNotNull(optionalEpisodeInstant(day,time,zone))).putText("note",note)
            severity?.let{value.put("severity",it)}
            onSave(value)
          }catch(failure:IllegalArgumentException){error=failure.message}
        }){Text("保留进展")}
        if(onRemove!=null)TextButton(onClick=onRemove){Text("移除此条")}
      }
    }
  }
}

private fun episodeTime(instant:String,zone:ZoneId)=editablePersonalTime(Instant.parse(instant),zone).substringAfter('T')

private fun optionalEpisodeInstant(day:String,time:String,zone:ZoneId):String?{
  if(time.isBlank())return null
  require(day.isNotBlank()){"请先选择日期"}
  val value=runCatching{personalInstant("${day}T${time.trim()}",zone.id)}.getOrNull()
  require(value!=null&&Instant.parse(value).atZone(zone).toLocalDate().toString()==day){"请填写有效的当地时间，例如 08:30"}
  return value
}

@Composable private fun ArchiveTextField(
  value:String,onChange:(String)->Unit,label:String,enabled:Boolean,
  keyboard:KeyboardType=KeyboardType.Text,singleLine:Boolean=true
){
  OutlinedTextField(value,onChange,Modifier.fillMaxWidth(),label={Text(label)},enabled=enabled,singleLine=singleLine,
    keyboardOptions=KeyboardOptions(keyboardType=keyboard))
}

@Composable internal fun ReturnCaseEditor(
  accountId:String,purchase:JSONObject?,existing:JSONObject?,onBack:()->Unit,onSaved:()->Unit
){
  val source=existing?:checkNotNull(purchase)
  val currency=source.getString("currency")
  val refunds=existing?.optJSONArray("refunds")?.trainingObjects().orEmpty()
  var amount by rememberSaveable{mutableStateOf(existing?.optNullableString("expected_amount").orEmpty())}
  var returnedOn by rememberSaveable{mutableStateOf(existing?.optNullableString("returned_on").orEmpty())}
  var note by rememberSaveable{mutableStateOf(existing?.optNullableString("note").orEmpty())}
  var allocations by rememberSaveable{
    mutableStateOf(JSONObject().apply{
      refunds.forEach{refund->
        val allocated=refund.getString("allocated")
        if(allocated.toBigDecimal().signum()>0)put(refund.getString("refund_entry_id"),allocated)
      }
    }.toString())
  }
  RecordWriteScreen(accountId,if(existing==null)"新建售后单" else "编辑售后与退款","money.save_return_case",onBack,onSaved){enabled,save->
    Text(source.optNullableString("name")?:source.getString("raw_name"),style=MaterialTheme.typography.titleMedium)
    ArchiveTextField(amount,{amount=it},"预计退款（$currency）",enabled,KeyboardType.Decimal)
    LifeDateField(returnedOn,{returnedOn=it},"寄回日期（可选）",enabled)
    if(returnedOn.isNotBlank())TextButton(enabled=enabled,onClick={returnedOn=""}){Text("清除寄回日期")}
    ArchiveTextField(note,{note=it.take(2000)},"备注（可选）",enabled,singleLine=false)
    if(existing!=null){
      Text("本单已到账退款",style=MaterialTheme.typography.titleMedium)
      if(refunds.isEmpty())Text("暂无已关联的到账退款")
      refunds.forEachIndexed{index,refund->
        val id=refund.getString("refund_entry_id")
        val values=JSONObject(allocations)
        val selected=values.has(id)
        val allocated=values.optString(id)
        val available=refund.getString("available")
        Text("退款 ${index+1} · 到账 ${refund.getString("amount")} $currency",style=MaterialTheme.typography.bodyMedium)
        Text("本售后单可用 $available $currency",style=MaterialTheme.typography.bodySmall)
        FilterChip(selected,onClick={
          allocations=values.apply{if(!selected)put(id,available) else remove(id)}.toString()
        },enabled=enabled&&(available.toBigDecimal().signum()>0||selected),label={Text("分配至本单")})
        if(selected)ArchiveTextField(allocated,{value->
          allocations=values.put(id,value).toString()
        },"分配金额（$currency）",enabled,KeyboardType.Decimal)
      }
    }
    Button(enabled=enabled&&amount.trim().toBigDecimalOrNull()?.signum()==1,onClick={
      save{
        val values=JSONObject(allocations)
        val entries=JSONArray()
        for(refund in refunds){
          val id=refund.getString("refund_entry_id")
          val raw=values.optString(id).trim()
          if(raw.isBlank())continue
          val allocated=raw.toBigDecimalOrNull()
          require(allocated!=null&&allocated.signum()>=0&&allocated<=refund.getString("available").toBigDecimal()){
            "退款分配金额必须在该笔退款的可用金额内"
          }
          if(allocated.signum()>0)entries.put(JSONObject().put("refund_entry_id",id).put("amount",raw))
        }
        JSONObject().put("purchase_item_id",existing?.getString("purchase_item_id")?:source.getString("id"))
          .put("currency",currency).put("expected_amount",amount.trim()).put("allocations",entries)
          .putText("returned_on",returnedOn).putText("note",note).apply{
            if(existing!=null)put("case_id",existing.getString("id")).put("expected_revision",existing.getInt("revision"))
          }
      }
    }){Text("保存售后单")}
  }
}
