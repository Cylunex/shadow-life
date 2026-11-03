package com.shadow.life

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.flow.MutableStateFlow
import java.security.MessageDigest

internal object OfflineReads {
  val cached=MutableStateFlow<Map<String,Map<String,Long>>>(emptyMap())
  @Synchronized fun update(account:String,path:String,at:Long?){
    val paths=cached.value[account].orEmpty().toMutableMap()
    if(at==null)paths.remove(path) else paths[path]=at
    cached.value=cached.value+(account to paths)
  }
}
internal class OfflineReadCache(context:Context){
  private val preferences=EncryptedSharedPreferences.create(context,"shadow-life-read-cache",
    MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
  private fun hash(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString(""){"%02x".format(it)}
  private fun prefix(session:ProductSession)=hash(session.accountId+"\u0000"+session.subjectId+"\u0000"+session.apiBase)+"/"
  private fun key(session:ProductSession,path:String)=prefix(session)+hash(path)
  fun allowed(path:String)=path.startsWith("/api/")&&!listOf("/api/operations","/api/threads","/api/runs","/api/agent","/api/assets","/api/session","/api/auth").any{path.startsWith(it)}
  @Synchronized fun write(session:ProductSession,path:String,body:String){
    if(!allowed(path)||body.toByteArray().size>512*1024)return
    if(runCatching{org.json.JSONObject(body)}.isFailure)return
    val name=key(session,path)
    val value=org.json.JSONObject().put("at",System.currentTimeMillis()).put("body",body).toString()
    val keys=preferences.all.filterKeys{it.startsWith(prefix(session))}
    val oldest=keys.entries.sortedBy{runCatching{org.json.JSONObject(it.value as String).getLong("at")}.getOrDefault(0)}
    preferences.edit().apply{oldest.take((keys.size-127).coerceAtLeast(0)).forEach{remove(it.key)};putString(name,value)}.apply()
  }
  fun read(session:ProductSession,path:String):Pair<String,Long>?=runCatching{
    if(!allowed(path))return null
    val value=org.json.JSONObject(preferences.getString(key(session,path),null)?:return null)
    val at=value.getLong("at")
    if(System.currentTimeMillis()-at !in 0..30L*24*60*60*1000)return null
    value.getString("body") to at
  }.getOrNull()
  @Synchronized fun clear(session:ProductSession){OfflineReads.cached.value=OfflineReads.cached.value-session.accountId;preferences.edit().apply{preferences.all.keys.filter{it.startsWith(prefix(session))}.forEach{remove(it)}}.commit()}
}
@Composable internal fun OfflineReadBanner(accountId:String,onRetry:()->Unit){
  val cached by OfflineReads.cached.collectAsState()
  val times=cached[accountId].orEmpty().values
  if(times.isNotEmpty())Surface(color=MaterialTheme.colorScheme.secondaryContainer){
    Row(Modifier.fillMaxWidth().padding(horizontal=16.dp),horizontalArrangement=Arrangement.SpaceBetween){
      Text("部分内容为离线副本 · "+java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT,java.text.DateFormat.SHORT).format(java.util.Date(times.min())),Modifier.weight(1f).padding(vertical=12.dp),style=MaterialTheme.typography.bodySmall)
      TextButton(onClick=onRetry){Text("重试")}
    }
  }
}
