package com.shadow.life

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.sync.Mutex
import org.json.JSONObject

data class ProductSession(
  val accountId:String,val subjectId:String,val apiBase:String,val authStateJson:String,
  val oidcSub:String=subjectId,val issuer:String=BuildConfig.SHADOW_OIDC_ISSUER,val environmentId:String="default",
  val generation:Long=0,val tokenRevision:Long=1,val displayName:String?=null
)
data class AuthAttempt(val state:String,val nonce:String,val generation:Long,val createdAt:Long)

class SessionStore(context:Context) {
  private val preferences=EncryptedSharedPreferences.create(context,"shadow_life_sessions",MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
  internal val refreshMutex=Mutex()

  @Synchronized fun save(value:ProductSession){preferences.edit().putString(sessionKey(value.accountId),JSONObject().put("account",value.accountId).put("subject",value.subjectId).put("oidc_sub",value.oidcSub).put("issuer",value.issuer).put("environment",value.environmentId).put("api",value.apiBase.trimEnd('/')).put("auth_state",value.authStateJson).put("generation",value.generation).put("token_revision",value.tokenRevision).putOpt("display_name",value.displayName).toString()).apply()}
  fun load(accountId:String):ProductSession?=preferences.getString(sessionKey(accountId),null)?.let{runCatching{val json=JSONObject(it);ProductSession(json.getString("account"),json.getString("subject"),json.getString("api"),json.getString("auth_state"),json.optString("oidc_sub",json.getString("subject")),json.optString("issuer",BuildConfig.SHADOW_OIDC_ISSUER),json.optString("environment","default"),json.optLong("generation"),json.optLong("token_revision",1),json.optString("display_name").takeIf(String::isNotBlank))}.getOrNull()}
  fun active():ProductSession?=preferences.getString("active_account",null)?.let(::load)
  @Synchronized fun activate(accountId:String){check(load(accountId)!=null);preferences.edit().putString("active_account",accountId).apply()}

  @Synchronized fun beginAttempt(state:String,nonce:String):AuthAttempt{val generation=preferences.getLong("session_generation",0)+1;preferences.edit().putLong("session_generation",generation).putString("auth_attempt",JSONObject().put("state",state).put("nonce",nonce).put("generation",generation).put("created_at",System.currentTimeMillis()).toString()).apply();return AuthAttempt(state,nonce,generation,System.currentTimeMillis())}
  fun pendingAttempt():AuthAttempt?=preferences.getString("auth_attempt",null)?.let{runCatching{val value=JSONObject(it);AuthAttempt(value.getString("state"),value.getString("nonce"),value.getLong("generation"),value.getLong("created_at"))}.getOrNull()}?.takeIf{System.currentTimeMillis()-it.createdAt<=10*60*1000}
  @Synchronized fun cancelAttempt(){preferences.edit().remove("auth_attempt").apply()}
  @Synchronized fun acceptLogin(attempt:AuthAttempt,value:ProductSession):Boolean{val current=pendingAttempt();if(current?.state!=attempt.state||current.generation!=attempt.generation||preferences.getLong("session_generation",0)!=attempt.generation)return false;save(value.copy(generation=attempt.generation));preferences.edit().putString("active_account",value.accountId).remove("auth_attempt").apply();return true}
  @Synchronized fun saveIfCurrent(expectedGeneration:Long,value:ProductSession):Boolean{if(preferences.getLong("session_generation",0)!=expectedGeneration||active()?.accountId!=value.accountId)return false;save(value);return true}
  @Synchronized fun revoke(accountId:String){val generation=preferences.getLong("session_generation",0)+1;preferences.edit().putLong("session_generation",generation).remove(sessionKey(accountId)).remove("auth_attempt").apply();if(preferences.getString("active_account",null)==accountId)preferences.edit().remove("active_account").apply()}
  private fun sessionKey(accountId:String)="session:$accountId"
}
