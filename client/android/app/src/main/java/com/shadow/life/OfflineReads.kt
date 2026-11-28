package com.shadow.life

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.flow.MutableStateFlow
import java.security.MessageDigest

internal object OfflineReads {
  val cached=MutableStateFlow<Map<String,Map<String,Long>>>(emptyMap())
  @Synchronized fun update(account:String,path:String,at:Long?){
    val paths=cached.value[account].orEmpty().toMutableMap()
    if(at==null)paths.remove(path) else paths[path]=at
    cached.value=cached.value+(account to paths)
  }
  @Synchronized fun clear(account:String){
    cached.value=cached.value-account
  }
}
internal class OfflineReadCache(context:Context){
  private val preferences=EncryptedSharedPreferences.create(context,"shadow-life-read-cache",
    MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
  // The encrypted preferences API decrypts every response when reading all entries.
  private val timestamps by lazy {
    preferences.all.mapValuesTo(mutableMapOf()) { (_, value) ->
      runCatching { org.json.JSONObject(value as String).getLong("at") }.getOrDefault(0L)
    }
  }
  private fun hash(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString(""){"%02x".format(it)}
  private fun prefix(session:ProductSession)=hash(session.accountId+"\u0000"+session.subjectId+"\u0000"+session.apiBase)+"/"
  private fun key(session:ProductSession,path:String)=prefix(session)+hash(path)
  fun allowed(path:String)=path.startsWith("/api/")&&!listOf("/api/operations","/api/threads","/api/runs","/api/agent","/api/assets","/api/session","/api/auth").any{path.startsWith(it)}
  @Synchronized fun write(session:ProductSession,path:String,body:String){
    if(!allowed(path)||body.toByteArray().size>512*1024)return
    if(runCatching{org.json.JSONObject(body)}.isFailure)return
    val prefix=prefix(session)
    val name=prefix+hash(path)
    val now=System.currentTimeMillis()
    val value=org.json.JSONObject().put("at",now).put("body",body).toString()
    val others=timestamps.entries.filter{it.key!=name&&it.key.startsWith(prefix)}
    val evicted=if(others.size>127)others.sortedBy{it.value}.take(others.size-127).map{it.key} else emptyList()
    preferences.edit().apply{evicted.forEach{remove(it)};putString(name,value)}.apply()
    evicted.forEach{timestamps.remove(it)}
    timestamps[name]=now
  }
  fun read(session:ProductSession,path:String):Pair<String,Long>?=runCatching{
    if(!allowed(path))return null
    val value=org.json.JSONObject(preferences.getString(key(session,path),null)?:return null)
    val at=value.getLong("at")
    if(System.currentTimeMillis()-at !in 0..30L*24*60*60*1000)return null
    value.getString("body") to at
  }.getOrNull()
  @Synchronized fun clear(session:ProductSession){
    OfflineReads.clear(session.accountId)
    val prefix=prefix(session)
    val keys=timestamps.keys.filter{it.startsWith(prefix)}
    preferences.edit().apply{keys.forEach{remove(it)}}.commit()
    keys.forEach{timestamps.remove(it)}
  }
}
