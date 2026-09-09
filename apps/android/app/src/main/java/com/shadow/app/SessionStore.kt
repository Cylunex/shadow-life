package com.shadow.app

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONObject

data class ProductSession(val accountId:String,val subjectId:String,val apiBase:String,val authStateJson:String)
class SessionStore(context:Context) {
  private val preferences=EncryptedSharedPreferences.create(context,"shadow_sessions",MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
  fun save(value:ProductSession){preferences.edit().putString(value.accountId,JSONObject().put("account",value.accountId).put("subject",value.subjectId).put("api",value.apiBase.trimEnd('/')).put("auth_state",value.authStateJson).toString()).apply()}
  fun load(accountId:String):ProductSession?=preferences.getString(accountId,null)?.let{runCatching{val json=JSONObject(it);ProductSession(json.getString("account"),json.getString("subject"),json.getString("api"),json.getString("auth_state"))}.getOrNull()}
  fun active():ProductSession?=preferences.getString("active",null)?.let(::load)
  fun activate(accountId:String){check(load(accountId)!=null);preferences.edit().putString("active",accountId).apply()}
  fun revoke(accountId:String){preferences.edit().remove(accountId).apply();if(preferences.getString("active",null)==accountId)preferences.edit().remove("active").apply()}
}
