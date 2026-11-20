package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId

@Composable internal fun HealthArchiveScreen(accountId:String,onBack:()->Unit,onReport:(String)->Unit){
  var section by rememberSaveable{mutableStateOf("reports")}
  var reportId by rememberSaveable{mutableStateOf<String?>(null)}
  var indicator by rememberSaveable{mutableStateOf<String?>(null)}
  var offset by rememberSaveable(section,reportId,indicator){mutableIntStateOf(0)}
  val context=LocalContext.current
  val repo=remember(accountId){NativeLifeRepository(context,context.applicationContext as ShadowApp)}
  var retry by remember{mutableIntStateOf(0)}
  var state by remember(section,reportId,indicator,offset,retry){mutableStateOf<LoadState<JSONObject>>(LoadState.Loading)}
  LaunchedEffect(accountId,section,reportId,indicator,offset,retry){
    val path=if(section=="reports")"/api/health/lab-results" else "/api/health/episodes"
    val params=buildMap{
      put("offset",offset.toString())
      if(section=="reports"&&indicator==null)reportId?.let{put("report_id",it)}
    }
    try{state=LoadState.Ready(repo.personalRecordsPage(path,params))}
    catch(error:CancellationException){throw error}
    catch(error:Exception){state=LoadState.Failed(error.message?:"读取健康档案失败")}
  }
  LifeFullScreen("健康档案",onBack){
    LazyColumn(verticalArrangement=Arrangement.spacedBy(10.dp)){
      item{
        LifeTabs(section,{section=it;reportId=null;indicator=null},listOf("reports" to "体检报告","episodes" to "不适发作"))
      }
      val page=(state as? LoadState.Ready)?.value
      val rows=page?.getJSONArray("items")?.trainingObjects().orEmpty()
      if(page==null)item{StateContent(state,{retry++}){}}
      if(page!=null&&rows.isEmpty())item{Text(if(section=="reports")"暂无结构化检验结果" else "暂无发作记录")}
      if(section=="reports"){
        if(reportId==null&&indicator==null){
          items(rows.groupBy{it.getString("report_id")}.entries.toList(),key={it.key}){(id,tests)->
            val first=tests.first()
            LifeCard(onClick={reportId=id}){
              Text(first.getString("report_title"),style=MaterialTheme.typography.titleMedium)
              Text(first.getString("tested_on"))
            }
          }
        }else{
          item{TextButton(onClick={if(indicator!=null)indicator=null else reportId=null}){Text("‹ 返回报告")}}
          val shown=if(indicator==null)rows else rows.filter{labIndicator(it)==indicator}
          val comparable=if(indicator==null)emptyList() else shown.filter{!it.isNull("unit")&&it.getString("value").toBigDecimalOrNull()!=null}
            .sortedBy{it.getString("tested_on")}
          if(comparable.map{it.getString("tested_on")}.distinct().size>=2&&comparable.map{it.getString("unit")}.distinct().size==1){
            item{
              val first=comparable.first()
              val last=comparable.last()
              LifeCard{
                Text("本页可比检验结果",style=MaterialTheme.typography.titleMedium)
                Text("${first.getString("tested_on")} ${first.getString("value")} → ${last.getString("tested_on")} ${last.getString("value")} ${last.getString("unit")}")
              }
            }
          }
          items(shown,key={it.getString("id")}){row->
            LifeCard{
              Text(row.getString("raw_name"),style=MaterialTheme.typography.titleMedium)
              Text(listOfNotNull(row.getString("value"),row.optString("unit").takeUnless{row.isNull("unit")}).joinToString(" "))
              Text("${row.getString("tested_on")} · 报告第 ${row.getInt("page")} 页")
              if(!row.isNull("reference"))Text("报告参考范围 · ${row.getString("reference")}")
              TextButton(onClick={onReport(row.getString("report_id"))}){Text("打开报告原件")}
              if(indicator==null)TextButton(onClick={indicator=labIndicator(row)}){Text("看同项历次结果")}
            }
          }
          if(shown.isEmpty()&&page!=null)item{Text("此页暂无对应指标，可继续查看下一页。")}
        }
      }else{
        items(rows,key={it.getString("id")}){row->
          var expanded by rememberSaveable{mutableStateOf(false)}
          val zone=ZoneId.of(row.getString("time_zone"))
          LifeCard(onClick={expanded=!expanded}){
            Text(row.getString("title"),style=MaterialTheme.typography.titleMedium)
            Text(row.getString("started_on")+if(row.isNull("ended_on"))" 起" else " 至 ${row.getString("ended_on")}")
            if(expanded){
              if(!row.isNull("note"))Text(row.getString("note"))
              row.getJSONArray("points").trainingObjects().sortedBy{it.getString("at")}.forEach{point->
                val local=Instant.parse(point.getString("at")).atZone(zone).toLocalDateTime().toString().replace('T',' ')
                Text(listOfNotNull(local,point.optInt("severity",-1).takeIf{it in 0..10}?.let{"程度 $it／10"},
                  point.optString("note").takeUnless{point.isNull("note")}).joinToString(" · "))
              }
            }
          }
        }
      }
      item{
        Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){
          if(offset>0)TextButton(onClick={offset=(offset-40).coerceAtLeast(0)}){Text("上一页")}
          if(page!=null&&!page.isNull("next_offset"))TextButton(onClick={offset=page.getInt("next_offset")}){Text("下一页")}
        }
      }
      item { PersonalRecordsCard(accountId,if(section=="reports")"体检项目对照" else "不适发作") }
    }
  }
}

private fun labIndicator(row:JSONObject)=row.getString("raw_name").trim()+"\n"+
  row.optString("unit").takeUnless{row.isNull("unit")}.orEmpty()

@Composable internal fun ReturnCasesScreen(accountId:String,onBack:()->Unit,onOrder:(String)->Unit){
  val context=LocalContext.current
  val repo=remember(accountId){NativeLifeRepository(context,context.applicationContext as ShadowApp)}
  var offset by rememberSaveable{mutableIntStateOf(0)}
  var retry by remember{mutableIntStateOf(0)}
  var state by remember(offset,retry){mutableStateOf<LoadState<JSONObject>>(LoadState.Loading)}
  LaunchedEffect(accountId,offset,retry){
    try{state=LoadState.Ready(repo.personalRecordsPage("/api/money/return-cases",mapOf("offset" to offset.toString())))}
    catch(error:CancellationException){throw error}
    catch(error:Exception){state=LoadState.Failed(error.message?:"暂时读不到售后记录")}
  }
  LifeFullScreen("售后与退款",onBack){
    LazyColumn(verticalArrangement=Arrangement.spacedBy(10.dp)){
      val page=(state as? LoadState.Ready)?.value
      val rows=page?.getJSONArray("items")?.trainingObjects().orEmpty()
      if(page==null)item{StateContent(state,{retry++}){}}
      if(page!=null&&rows.isEmpty())item{Text("此页没有售后记录")}
      items(rows,key={it.getString("id")}){row->
        val currency=row.getString("currency")
        LifeCard{
          Text(row.getString("name"),style=MaterialTheme.typography.titleMedium)
          Text("待退差额 · ${row.getString("remaining")} $currency",style=MaterialTheme.typography.titleLarge)
          Text("预计退款 ${row.getString("expected_amount")} · 已分配到账 ${row.getString("received")} $currency")
          TextButton(onClick={onOrder(row.getString("record_id"))}){Text("打开购买记录")}
        }
      }
      item{
        Row{
          if(offset>0)TextButton(onClick={offset=(offset-30).coerceAtLeast(0)}){Text("上一页")}
          if(page!=null&&!page.isNull("next_offset"))TextButton(onClick={offset=page.getInt("next_offset")}){Text("下一页")}
          TextButton(onClick={retry++}){Text("刷新")}
        }
      }
      item{PersonalRecordsCard(accountId,"售后与消费来源")}
    }
  }
}
