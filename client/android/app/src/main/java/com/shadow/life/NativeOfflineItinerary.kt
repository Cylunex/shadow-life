package com.shadow.life

import kotlinx.serialization.json.*
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

data class NativeOfflineItinerary(val tripId:String,val filename:String,val html:String)

private fun escapeHtml(value:String):String=value.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&#39;")
private fun JsonObject.text(key:String):String=(get(key) as? JsonPrimitive)?.contentOrNull.orEmpty()
private fun JsonObject.rows(key:String):List<JsonObject> = getValue(key).jsonArray.map{it.jsonObject}
private fun localTime(value:String,zone:ZoneId):String=runCatching{Instant.parse(value).atZone(zone).format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))}.getOrDefault("")

/** A standalone, escaped snapshot with no scripts or network-dependent content. */
fun renderNativeOfflineItinerary(tripId:String,detailJson:String,workspaceJson:String):NativeOfflineItinerary{
  val detail=Json.parseToJsonElement(detailJson).jsonObject
  val workspace=Json.parseToJsonElement(workspaceJson).jsonObject
  val trip=detail.getValue("trip").jsonObject
  val zone=ZoneId.of(trip.text("time_zone"))
  val start=LocalDate.parse(trip.text("starts_on"));val end=LocalDate.parse(trip.text("ends_on"))
  require(!end.isBefore(start)&&ChronoUnit.DAYS.between(start,end)<=3660){"旅程日期超出离线行程单范围"}
  val plans=detail.rows("day_plans").associateBy{it.text("plan_date")}
  val reservations=detail.rows("reservations");val segments=detail.rows("segments")
  fun rows(items:List<JsonObject>,render:(JsonObject)->String)=items.joinToString(""){"<li>${render(it)}</li>"}.ifBlank{"<li>无</li>"}
  fun day(item:JsonObject,key:String="starts_at")=localTime(item.text(key),zone).take(10)
  fun small(label:String,value:String)=if(value.isBlank())"" else "<small>${escapeHtml(label+value)}</small>"
  fun booking(item:JsonObject):String = escapeHtml(item.text("title"))+"（${escapeHtml(item.text("state"))}）"+
    small("开始：",localTime(item.text("starts_at"),zone))+small("结束：",localTime(item.text("ends_at"),zone))+
    (if(item.text("origin").isNotBlank()||item.text("destination").isNotBlank())small("",item.text("origin")+" → "+item.text("destination")) else "")+
    small("确认号：",item.text("confirmation_code"))+small("座位：",item.text("seat"))
  fun transit(item:JsonObject):String = escapeHtml(item.text("origin")+" → "+item.text("destination"))+"（${escapeHtml(item.text("mode"))}）"+
    small("出发：",localTime(item.text("starts_at"),zone))+small("到达：",localTime(item.text("ends_at"),zone))+small("",item.text("note"))
  val checklist=(workspace["checklist"] as? JsonObject)?.rows("items").orEmpty()
  val checks=rows(checklist){item->
    val (symbol,label)=when(item.text("state")){"packed"->"☑" to "已备好";"skipped"->"−" to "无需准备";else->"☐" to "待准备"}
    "$symbol ${escapeHtml(item.text("title"))}（$label）"+small("",item.text("note"))
  }
  val dates=(0..ChronoUnit.DAYS.between(start,end).toInt()).map{start.plusDays(it.toLong()).toString()}.toMutableSet()
  dates.addAll(plans.keys)
  (reservations+segments).forEach{item->listOf(day(item),day(item,"ends_at")).filter(String::isNotBlank).forEach(dates::add)}
  val days=dates.sorted().joinToString(""){date->
    val stops=rows(plans[date]?.rows("items").orEmpty()){item->
      escapeHtml(localTime(item.text("starts_at"),zone).ifBlank{"时间待定"})+" · "+escapeHtml(item.text("title"))+small("",item.text("note"))
    }
    val lodging=rows(reservations.filter{it.text("reservation_type")=="hotel"&&it.text("state") !in setOf("cancelled","refunded")&&day(it).isNotBlank()&&day(it,"ends_at").isNotBlank()&&day(it)<=date&&date<day(it,"ends_at")},::booking)
    val outside=if(date<start.toString()||date>end.toString())"<small>旅程日期范围外的安排</small>" else ""
    "<section><h2>${escapeHtml(date)}</h2>$outside<h3>计划停留</h3><ol>$stops</ol><h3>当晚住宿（按预订区间）</h3><ul>$lodging</ul><h3>预订</h3><ul>${rows(reservations.filter{day(it)==date},::booking)}</ul><h3>交通</h3><ul>${rows(segments.filter{day(it)==date},::transit)}</ul></section>"
  }
  val actual=rows(detail.rows("visits")){item->escapeHtml(item.text("occurred_on")+" · "+item.text("place_name"))}
  val title=trip.text("title");val safeName=title.replace(Regex("[^\\p{L}\\p{N}_-]+"),"-").take(80)
  val html="""<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · 离线行程单</title><style>body{font:16px/1.6 sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;overflow-wrap:anywhere}section{border-top:1px solid #ccc;padding:1rem 0}li{margin:.4rem 0}small{display:block;color:#555}</style></head><body><h1>${escapeHtml(title)}</h1><p>$start 至 $end · ${escapeHtml(zone.id)}</p><p>下载时可见事实的离线副本；计划、预订与实际到访分开，住宿显示不证明已入住。</p><section><h2>清单</h2><ul>$checks</ul></section>$days<section><h2>未定开始时间</h2><h3>预订</h3><ul>${rows(reservations.filter{it.text("starts_at").isBlank()},::booking)}</ul><h3>交通</h3><ul>${rows(segments.filter{it.text("starts_at").isBlank()},::transit)}</ul></section><section><h2>实际到访</h2><ul>$actual</ul></section></body></html>"""
  return NativeOfflineItinerary(tripId,"$start-$safeName-行程单.html",html)
}
