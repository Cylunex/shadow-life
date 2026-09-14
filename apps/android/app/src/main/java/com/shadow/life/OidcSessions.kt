package com.shadow.life

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.sync.withLock
import net.openid.appauth.AuthState
import net.openid.appauth.AuthorizationException
import net.openid.appauth.AuthorizationRequest
import net.openid.appauth.AuthorizationResponse
import net.openid.appauth.AuthorizationService
import net.openid.appauth.AuthorizationServiceConfiguration
import net.openid.appauth.ResponseTypeValues
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.security.SecureRandom
import java.util.Base64
import java.util.concurrent.Executors
import kotlin.coroutines.resume

data class FreshSession(val session:ProductSession,val accessToken:String)
sealed interface SessionRefresh { data class Ready(val value:FreshSession):SessionRefresh;data object Retryable:SessionRefresh;data object ReauthRequired:SessionRefresh }

class OidcSessions(private val activity:Activity,private val store:SessionStore) {
  private val service=AuthorizationService(activity)
  private val executor=Executors.newSingleThreadExecutor()
  val configured:Boolean get()=BuildConfig.SHADOW_OIDC_ISSUER.isNotBlank()&&BuildConfig.SHADOW_OIDC_CLIENT_ID.isNotBlank()&&BuildConfig.SHADOW_OIDC_RESOURCE.isNotBlank()

  fun loginIntent(silent:Boolean=false,callback:(Intent?)->Unit){
    if(!configured){callback(null);return}
    AuthorizationServiceConfiguration.fetchFromIssuer(Uri.parse(BuildConfig.SHADOW_OIDC_ISSUER)){configuration,error->
      if(configuration==null||error!=null){callback(null);return@fetchFromIssuer}
      val state=randomToken();val nonce=randomToken();store.beginAttempt(state,nonce)
      val builder=AuthorizationRequest.Builder(configuration,BuildConfig.SHADOW_OIDC_CLIENT_ID,ResponseTypeValues.CODE,Uri.parse(BuildConfig.SHADOW_OIDC_REDIRECT_URI)).setState(state).setNonce(nonce).setScope("openid profile offline_access").setAdditionalParameters(mapOf("resource" to BuildConfig.SHADOW_OIDC_RESOURCE))
      if(silent)builder.setPrompt("none")
      val request=builder.build()
      val darkColors=CustomTabColorSchemeParams.Builder().setToolbarColor(Color.rgb(10,16,20)).setNavigationBarColor(Color.BLACK).build()
      val customTab=service.createCustomTabsIntentBuilder(configuration.authorizationEndpoint)
        .setShowTitle(true)
        .setShareState(CustomTabsIntent.SHARE_STATE_OFF)
        .setDefaultColorSchemeParams(darkColors)
        .setColorScheme(CustomTabsIntent.COLOR_SCHEME_DARK)
        .build()
      callback(service.getAuthorizationRequestIntent(request,customTab))
    }
  }

  fun complete(intent:Intent,callback:(ProductSession?)->Unit){
    val response=AuthorizationResponse.fromIntent(intent);val attempt=store.pendingAttempt()
    if(response==null||attempt==null||response.request.state!=attempt.state||response.request.nonce!=attempt.nonce){store.cancelAttempt();callback(null);return}
    val state=AuthState().also{it.update(response,null)}
    service.performTokenRequest(response.createTokenExchangeRequest()){tokens,error->
      state.update(tokens,error);val accessToken=state.accessToken
      if(error!=null||tokens==null||accessToken==null){store.cancelAttempt();callback(null);return@performTokenRequest}
      executor.execute{
        val identity=runCatching{loadIdentity(accessToken)}.getOrNull()
        if(identity==null){store.cancelAttempt();callback(null);return@execute}
        val accountId="${identity.issuer}|${identity.oidcSub}|${identity.environmentId}"
        val value=ProductSession(accountId,identity.subjectId,BuildConfig.SHADOW_API_BASE,state.jsonSerializeString(),identity.oidcSub,identity.issuer,identity.environmentId,attempt.generation,1,identity.displayName)
        callback(value.takeIf{store.acceptLogin(attempt,it)})
      }
    }
  }

  fun close(){service.dispose();executor.shutdownNow()}
  fun logout(value:ProductSession){
    store.revoke(value.accountId)
    executor.execute{
      runCatching{
        val state=AuthState.jsonDeserialize(value.authStateJson);val token=state.refreshToken?:return@runCatching
        val endpoint=state.authorizationServiceConfiguration?.discoveryDoc?.docJson?.optString("revocation_endpoint")?.takeIf(String::isNotBlank)?:return@runCatching
        val payload="token=${form(token)}&token_type_hint=refresh_token&client_id=${form(BuildConfig.SHADOW_OIDC_CLIENT_ID)}"
        val connection=(URL(endpoint).openConnection() as HttpURLConnection).apply{requestMethod="POST";connectTimeout=8_000;readTimeout=8_000;doOutput=true;setRequestProperty("Content-Type","application/x-www-form-urlencoded");outputStream.bufferedWriter().use{it.write(payload)}}
        try{connection.responseCode}finally{connection.disconnect()}
      }
    }
  }
  private fun loadIdentity(token:String):IdentityView { val connection=(URL(BuildConfig.SHADOW_API_BASE.trimEnd('/')+"/api/me").openConnection() as HttpURLConnection).apply{connectTimeout=10_000;readTimeout=15_000;setRequestProperty("Authorization","Bearer $token");setRequestProperty("Accept","application/json")};try{if(connection.responseCode!=200)error("Identity admission failed");val json=JSONObject(connection.inputStream.bufferedReader().use{it.readText()});return IdentityView(json.getString("issuer"),json.getString("oidc_sub"),json.getString("life_subject_id"),json.getString("environment_id"),json.optString("display_name").takeIf(String::isNotBlank))}finally{connection.disconnect()} }
}
private data class IdentityView(val issuer:String,val oidcSub:String,val subjectId:String,val environmentId:String,val displayName:String?)

suspend fun SessionStore.fresh(accountId:String,context:Context):SessionRefresh=refreshMutex.withLock<SessionRefresh>{
  val saved=load(accountId)?:return@withLock SessionRefresh.ReauthRequired
  val generation=saved.generation
  val state=runCatching{AuthState.jsonDeserialize(saved.authStateJson)}.getOrNull()?:run{revoke(accountId);return@withLock SessionRefresh.ReauthRequired}
  suspendCancellableCoroutine{continuation->
    val service=AuthorizationService(context);continuation.invokeOnCancellation{service.dispose()}
    state.performActionWithFreshTokens(service){token,_,error->
      if(!continuation.isActive){service.dispose();return@performActionWithFreshTokens}
      if(error!=null||token==null){val permanent=error?.type==AuthorizationException.TYPE_OAUTH_TOKEN_ERROR&&error.error !in setOf("server_error","temporarily_unavailable");if(permanent)revoke(accountId);continuation.resume(if(permanent)SessionRefresh.ReauthRequired else SessionRefresh.Retryable)}
      else{val updated=saved.copy(authStateJson=state.jsonSerializeString(),tokenRevision=saved.tokenRevision+1);continuation.resume(if(saveIfCurrent(generation,updated))SessionRefresh.Ready(FreshSession(updated,token))else SessionRefresh.ReauthRequired)}
      service.dispose()
    }
  }
}

private fun randomToken():String{val bytes=ByteArray(32);SecureRandom().nextBytes(bytes);return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)}
private fun form(value:String)=java.net.URLEncoder.encode(value,Charsets.UTF_8.name())
