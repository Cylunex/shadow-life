package com.shadow.life

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

data class NativeOfflineItinerary(val tripId:String,val filename:String,val html:String)

private fun escapeHtml(value:String):String=value.replace("&","&amp;").replace("<","&lt;").replace(">","&gt;").replace("\"","&quot;").replace("'","&#39;")
private fun JSONArray.objects():List<JSONObject> = (0 until length()).map{getJSONObject(it)}
private fun JSONObject.text(key:String):String=if(isNull(key))"" else optString(key,"")
private fun localTime(value:String,zone:ZoneId):String=runCatching{Instant.parse(value).atZone(zone).format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"))}.getOrDefault("")

fun renderNativeOfflineItinerary(tripId:String,detail:JSONObject,workspace:JSONObject):NativeOfflineItinerary{
  val trip=detail.getJSONObject("trip")
  val zone=ZoneId.of(trip.getString("time_zone"))
  val start=LocalDate.parse(trip.getString("starts_on"))
  val end=LocalDate.parse(trip.getString("ends_on"))
  require(!end.isBefore(start)&&ChronoUnit.DAYS.between(start,end)<=3660){"旅程日期超出离线行程单范围"}
  val plans=detail.getJSONArray("day_plans").objects().associateBy{it.getString("plan_date")}
  val reservations=detail.getJSONArray("reservations").objects()
  val segments=detail.getJSONArray("segments").objects()
  val visits=detail.getJSONArray("visits").objects()
  fun entries(rows:List<JSONObject>,value:(JSONObject)->String):String=rows.joinToString(""){"<li>${value(it)}</li>"}.ifBlank{"<li>无</li>"}
  fun day(value:JSONObject):String=localTime(value.text("starts_at"),zone).take(10)
  val checklist=workspace.optJSONObject("checklist")?.optJSONArray("items")?.objects().orEmpty()
  val checks=entries(checklist){"☐ ${escapeHtml(it.text("title"))}（${escapeHtml(when(it.text("state")){"packed"->"已备好";"skipped"->"无需准备";else->"待准备"})}）"}
  val days=(0..ChronoUnit.DAYS.between(start,end).toInt()).joinToString(""){offset->
    val date=start.plusDays(offset.toLong()).toString()
    val stops=plans[date]?.optJSONArray("items")?.objects().orEmpty()
    val stopRows=entries(stops){"${escapeHtml(localTime(it.text("starts_at"),zone).takeLast(5).ifBlank{"时间待定"})} · ${escapeHtml(it.text("title"))}${it.text("note").takeIf(String::isNotBlank)?.let{note->"<small>${escapeHtml(note)}</small>"}.orEmpty()}"}
    val bookings=entries(reservations.filter{day(it)==date}){"${escapeHtml(localTime(it.text("starts_at"),zone).takeLast(5))} · ${escapeHtml(it.text("title"))}（${escapeHtml(it.text("state"))}）${it.text("confirmation_code").takeIf(String::isNotBlank)?.let{code->"<small>确认号：${escapeHtml(code)}</small>"}.orEmpty()}"}
    val transit=entries(segments.filter{day(it)==date}){"${escapeHtml(localTime(it.text("starts_at"),zone).takeLast(5))} · ${escapeHtml(it.text("origin"))} → ${escapeHtml(it.text("destination"))}（${escapeHtml(it.text("mode"))}）"}
    "<section><h2>${escapeHtml(date)}</h2><h3>计划停留</h3><ol>$stopRows</ol><h3>预订</h3><ul>$bookings</ul><h3>交通</h3><ul>$transit</ul></section>"
  }
  val undatedReservations=entries(reservations.filter{it.text("starts_at").isBlank()}){escapeHtml(it.text("title"))}
  val undatedSegments=entries(segments.filter{it.text("starts_at").isBlank()}){"${escapeHtml(it.text("origin"))} → ${escapeHtml(it.text("destination"))}"}
  val actual=entries(visits){"${escapeHtml(it.text("occurred_on"))} · ${escapeHtml(it.text("place_name"))}"}
  val title=trip.getString("title")
  val safeName=title.replace(Regex("[^\\p{L}\\p{N}_-]+"),"-").take(80)
  val html="<!doctype html><html lang=\"zh-CN\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>${escapeHtml(title)} · 离线行程单</title><style>body{font:16px/1.6 sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem}section{border-top:1px solid #ccc;padding:1rem 0}li{margin:.4rem 0}small{display:block;color:#555}</style></head><body><h1>${escapeHtml(title)}</h1><p>${start} 至 ${end} · ${escapeHtml(zone.id)}</p><p>下载时可见事实的离线副本；计划与实际到访分开。</p><section><h2>清单</h2><ul>$checks</ul></section>$days<section><h2>未定时间</h2><h3>预订</h3><ul>$undatedReservations</ul><h3>交通</h3><ul>$undatedSegments</ul></section><section><h2>实际到访</h2><ul>$actual</ul></section></body></html>"
  return NativeOfflineItinerary(tripId,"${start}-$safeName-行程单.html",html)
}
