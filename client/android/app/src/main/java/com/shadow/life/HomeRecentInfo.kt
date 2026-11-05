package com.shadow.life

import kotlinx.serialization.json.*

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
      if(state=="committed")"正在读取采集结果" else item.text("title")?.takeIf{it.isNotBlank()}?:"采集材料",state,
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
  "committed"->"已同步 · 正在读取结果"
  else->"状态待核对"
}
internal fun mergeHomeRecentInfo(local:List<HomeRecentInfo>,remote:List<HomeRecentInfo>,limit:Int=5):List<HomeRecentInfo> =
  (local+remote).distinctBy{if(it.domain!=null&&it.targetId!=null)"${it.domain}:${it.targetId}" else it.key}.sortedByDescending{it.at}.take(limit)
