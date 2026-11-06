package com.shadow.life

import kotlinx.serialization.json.*
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.launch
import kotlinx.coroutines.joinAll

internal data class RecentCaptureInfo(
  val key:String,val at:Long,val title:String,val state:String,val preview:String?,
  val sourceId:String?=null,val moneyRecordId:String?=null
)
internal data class HomeRecentInfo(
  val key:String,val at:Long,val title:String,val status:String,
  val domain:LifeDomain?=null,val targetId:String?=null,val preview:String?=null,val localState:String?=null
)
private fun JsonObject.text(key:String)=this[key]?.jsonPrimitive?.contentOrNull

internal fun recentCaptureEntries(commandId:String,at:Long,state:String,body:String,receipt:String?):List<RecentCaptureInfo> = runCatching {
  val command=Json.parseToJsonElement(body).jsonObject
  if(command.text("command_id")!=commandId||command.text("capability")!="life.ingest_activity")return emptyList()
  val all=command["input"]!!.jsonObject["items"]!!.jsonArray.map{it.jsonObject}
  val saved=receipt?.takeIf{it.isNotBlank()}?.let{Json.parseToJsonElement(it).jsonObject}
  val verified=state=="committed"&&saved?.text("protocol")=="shadow.execution-result"&&saved.text("status")=="committed"&&saved.text("command_id")==commandId&&saved.text("capability")=="life.ingest_activity"
  val resources=if(verified)saved!!["resources"]?.jsonArray?.map{it.jsonObject}.orEmpty() else emptyList()
  val sources=resources.filter{it.text("type")=="activity_capture"}
  val money=if(all.size==1&&resources.any{it.text("type")=="money_entry"})resources.singleOrNull{it.text("type")=="consumption_record"}?.text("id") else null
  all.mapNotNull{item->
    // Background app-usage intervals must not bury an intentional capture.
    if(item.text("kind") !in setOf("screen_text","manual"))return@mapNotNull null
    RecentCaptureInfo("$commandId:${item.text("source_id")}",at,
      if(state=="committed")"采集已同步" else item.text("title")?.takeIf{it.isNotBlank()}?:"采集材料",state,
      if(state=="committed")null else item.text("text")?.take(12000),
      // Batch receipts have no per-item association; never infer it from resource order.
      if(verified&&all.size==1&&sources.size==1)sources.single().text("id") else null,money)
  }
}.getOrElse{emptyList()}

internal fun recentCaptureState(state:String)=when(state){
  "pending"->"待同步 · 已保存在本机"
  "uploading"->"同步中 · 尚未确认入账"
  "unknown"->"结果待确认 · 正在核对"
  "failed"->"同步失败 · 查看重试入口"
  "blocked"->"同步受阻 · 查看账号与队列"
  "committed"->"材料已同步 · 正在读取入账结果"
  else->"状态待核对"
}
internal fun mergeHomeRecentInfo(local:List<HomeRecentInfo>,remote:List<HomeRecentInfo>,limit:Int=5):List<HomeRecentInfo> {
  fun identity(row:HomeRecentInfo)=if(row.domain!=null&&row.targetId!=null)"${row.domain}:${row.targetId}" else row.key
  val captures=local.groupBy(::identity).map{(_,rows)->
    val latest=rows.maxBy{it.at}
    val representative=rows.filter{it.status.startsWith("已入账")}.maxByOrNull{it.at}?:latest
    if(rows.size>1&&representative.domain==LifeDomain.Money)representative.copy(at=latest.at,status="${representative.status} · ${rows.size} 份采集材料") else representative
  }
  return (captures+remote).distinctBy(::identity).sortedByDescending{it.at}.take(limit)
}

internal fun hasNewCaptureResults(local:List<RecentCaptureInfo>,resolvedKeys:Set<String>):Boolean =
  local.any{it.state=="committed"&&it.key !in resolvedKeys}

internal fun recentInfoRefreshDelay(lastAttempt:Long?,now:Long,manual:Boolean=false,newResults:Boolean=false):Long =
  if(manual||newResults||lastAttempt==null)0 else (60_000L-(now-lastAttempt).coerceAtLeast(0)).coerceAtLeast(0)

// Publish each verified result immediately; a slow older source must not hide a new receipt.
internal suspend fun resolveRecentCaptures(
  items:List<RecentCaptureInfo>,read:suspend (RecentCaptureInfo)->HomeRecentInfo?,
  publish:(String,HomeRecentInfo?)->Unit
)=coroutineScope{items.map{item->launch{publish(item.key,read(item))}}.joinAll()}
