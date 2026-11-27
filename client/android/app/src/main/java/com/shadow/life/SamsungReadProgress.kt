package com.shadow.life

import java.time.LocalDate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject

internal data class SamsungReadProgress(
  val scope: String,
  val from: LocalDate,
  val through: LocalDate,
  val startedAt: Long,
  val completedTypes: Set<String> = emptySet(),
  val pages: Map<String, String?> = emptyMap()
) {
  fun complete(type: String) = copy(completedTypes = completedTypes + type, pages = pages - type)
  fun page(type: String, next: String?) = copy(pages = pages + (type to next))
  fun restartPages(type: String) = copy(pages = pages - type)

  fun encode(): String = JSONObject().put("scope", scope).put("from", from.toString())
    .put("through", through.toString()).put("started_at", startedAt)
    .put("completed_types", JSONArray(completedTypes.toList()))
    .put("pages", JSONObject().apply {
      pages.forEach { (type, token) -> put(type, token ?: JSONObject.NULL) }
    }).toString()

  companion object {
    fun decode(value: String?): SamsungReadProgress? = value?.let {
      runCatching {
        val data = JSONObject(it)
        val types = data.getJSONArray("completed_types")
        val pages = data.getJSONObject("pages")
        SamsungReadProgress(
          data.getString("scope"), LocalDate.parse(data.getString("from")),
          LocalDate.parse(data.getString("through")), data.getLong("started_at"),
          (0 until types.length()).map(types::getString).toSet(),
          pages.keys().asSequence().associateWith { key ->
            if (pages.isNull(key)) null else pages.getString(key)
          }
        )
      }.getOrNull()
    }
  }
}

internal suspend fun <T> forEachSamsungPage(
  key:String,progress:()->SamsungReadProgress,save:(SamsungReadProgress)->Unit,onPoint:suspend(T)->Unit,
  read:suspend(String?)->Pair<List<T>,String?>
){
  val saved=progress().pages
  var token=saved[key]
  if(key in saved&&token==null)return
  val seen=mutableSetOf<String>()
  token?.let(seen::add)
  do{
    val (records,next)=withTimeoutOrNull(20_000L){
      try{read(token)}
      catch(error:CancellationException){throw error}
      catch(error:Exception){
        // A provider can invalidate a token on a later run. Restart only this type.
        if(token!=null)save(progress().restartPages(key))
        throw error
      }
    }?:error("Samsung Health page timed out")
    val nextToken=next?.takeIf{it.isNotBlank()}
    if(nextToken!=null&&!seen.add(nextToken)){
      save(progress().restartPages(key))
      error("Samsung Health returned a repeated page token")
    }
    for(point in records)onPoint(point)
    save(progress().page(key,nextToken))
    token=nextToken
  }while(token!=null)
}
