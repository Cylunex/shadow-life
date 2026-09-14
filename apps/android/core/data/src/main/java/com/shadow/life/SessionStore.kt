package com.shadow.life

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.sync.Mutex
import org.json.JSONObject
import java.util.UUID

class SessionStore(context:Context) {
  private val preferences=EncryptedSharedPreferences.create(context,"shadow_life_sessions",MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
  val refreshMutex=Mutex()

  @Synchronized fun save(value:ProductSession){check(preferences.edit().putString(sessionKey(value.accountId),encode(value)).commit()){"Unable to persist account session"}}
  fun load(accountId:String):ProductSession?=preferences.getString(sessionKey(accountId),null)?.let{runCatching{val json=JSONObject(it);ProductSession(json.getString("account"),json.getString("subject"),json.getString("api"),json.getString("auth_state"),json.optString("oidc_sub",json.getString("subject")),json.optString("issuer",""),json.optString("environment","default"),json.optLong("generation"),json.optLong("token_revision",1),json.optString("display_name").takeIf(String::isNotBlank))}.getOrNull()}
  fun active():ProductSession?=preferences.getString("active_account",null)?.let(::load)
  @Synchronized fun installationId():String=preferences.getString("notification_installation_id",null)?:"installation_${UUID.randomUUID().toString().replace("-","")}".also{check(preferences.edit().putString("notification_installation_id",it).commit()){"Unable to persist installation identity"}}
  @Synchronized fun activate(accountId:String){check(load(accountId)!=null);check(preferences.edit().putString("active_account",accountId).commit()){"Unable to activate account"}}

  @Synchronized fun beginAttempt(state:String,nonce:String):AuthAttempt{val generation=preferences.getLong("session_generation",0)+1;val createdAt=System.currentTimeMillis();check(preferences.edit().putLong("session_generation",generation).putString("auth_attempt",JSONObject().put("state",state).put("nonce",nonce).put("generation",generation).put("created_at",createdAt).toString()).commit()){"Unable to persist login attempt"};return AuthAttempt(state,nonce,generation,createdAt)}
  fun pendingAttempt():AuthAttempt?=preferences.getString("auth_attempt",null)?.let{runCatching{val value=JSONObject(it);AuthAttempt(value.getString("state"),value.getString("nonce"),value.getLong("generation"),value.getLong("created_at"))}.getOrNull()}?.takeIf{System.currentTimeMillis()-it.createdAt<=10*60*1000}
  @Synchronized fun cancelAttempt(){preferences.edit().remove("auth_attempt").commit()}
  @Synchronized fun acceptLogin(attempt:AuthAttempt,value:ProductSession):Boolean{val current=pendingAttempt();if(current?.state!=attempt.state||current.generation!=attempt.generation||preferences.getLong("session_generation",0)!=attempt.generation)return false;val accepted=value.copy(generation=attempt.generation);return preferences.edit().putString(sessionKey(accepted.accountId),encode(accepted)).putString("active_account",accepted.accountId).remove("auth_attempt").commit()}
  @Synchronized fun saveIfCurrent(expectedGeneration:Long,value:ProductSession):Boolean{if(preferences.getLong("session_generation",0)!=expectedGeneration||active()?.accountId!=value.accountId)return false;return preferences.edit().putString(sessionKey(value.accountId),encode(value)).commit()}
  @Synchronized fun revoke(accountId:String){val generation=preferences.getLong("session_generation",0)+1;val editor=preferences.edit().putLong("session_generation",generation).remove(sessionKey(accountId)).remove("auth_attempt");if(preferences.getString("active_account",null)==accountId)editor.remove("active_account");editor.commit()}
  private fun encode(value:ProductSession)=JSONObject().put("account",value.accountId).put("subject",value.subjectId).put("oidc_sub",value.oidcSub).put("issuer",value.issuer).put("environment",value.environmentId).put("api",value.apiBase.trimEnd('/')).put("auth_state",value.authStateJson).put("generation",value.generation).put("token_revision",value.tokenRevision).putOpt("display_name",value.displayName).toString()
  private fun sessionKey(accountId:String)="session:$accountId"
}
