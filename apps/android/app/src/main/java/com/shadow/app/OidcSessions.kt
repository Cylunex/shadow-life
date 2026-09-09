package com.shadow.app

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.util.Base64
import kotlinx.coroutines.suspendCancellableCoroutine
import net.openid.appauth.AuthState
import net.openid.appauth.AuthorizationRequest
import net.openid.appauth.AuthorizationResponse
import net.openid.appauth.AuthorizationService
import net.openid.appauth.AuthorizationServiceConfiguration
import net.openid.appauth.ResponseTypeValues
import org.json.JSONObject
import kotlin.coroutines.resume

data class FreshSession(val session:ProductSession,val accessToken:String)

class OidcSessions(private val activity:Activity,private val store:SessionStore) {
  private val service=AuthorizationService(activity)
  val configured:Boolean get()=BuildConfig.SHADOW_OIDC_ISSUER.isNotBlank()&&BuildConfig.SHADOW_OIDC_CLIENT_ID.isNotBlank()

  fun loginIntent(callback:(Intent?)->Unit){
    if(!configured){callback(null);return}
    AuthorizationServiceConfiguration.fetchFromIssuer(Uri.parse(BuildConfig.SHADOW_OIDC_ISSUER)){configuration,error->
      if(configuration==null||error!=null){callback(null);return@fetchFromIssuer}
      val request=AuthorizationRequest.Builder(configuration,BuildConfig.SHADOW_OIDC_CLIENT_ID,ResponseTypeValues.CODE,Uri.parse(BuildConfig.SHADOW_OIDC_REDIRECT_URI)).setScope("openid profile offline_access").build()
      callback(service.getAuthorizationRequestIntent(request))
    }
  }

  fun complete(intent:Intent,callback:(ProductSession?)->Unit){
    val response=AuthorizationResponse.fromIntent(intent)?:run{callback(null);return}
    val state=AuthState().also{it.update(response,null)}
    service.performTokenRequest(response.createTokenExchangeRequest()){tokens,error->
      state.update(tokens,error)
      val accessToken=state.accessToken
      val subject=(state.idToken?.let(::subjectFromJwt)?:accessToken?.let(::subjectFromJwt))
      if(error!=null||tokens==null||subject==null){callback(null);return@performTokenRequest}
      val accountId="${BuildConfig.SHADOW_OIDC_ISSUER}|$subject"
      val session=ProductSession(accountId,subject,BuildConfig.SHADOW_API_BASE,state.jsonSerializeString())
      store.save(session);store.activate(accountId);callback(session)
    }
  }

  fun close(){service.dispose()}
}

suspend fun SessionStore.fresh(accountId:String,context:android.content.Context):FreshSession?=suspendCancellableCoroutine{continuation->
  val saved=load(accountId)?:run{continuation.resume(null);return@suspendCancellableCoroutine}
  val state=runCatching{AuthState.jsonDeserialize(saved.authStateJson)}.getOrNull()?:run{revoke(accountId);continuation.resume(null);return@suspendCancellableCoroutine}
  val service=AuthorizationService(context)
  continuation.invokeOnCancellation{service.dispose()}
  state.performActionWithFreshTokens(service){token,_,error->
    if(!continuation.isActive){service.dispose();return@performActionWithFreshTokens}
    if(error!=null||token==null){revoke(accountId);continuation.resume(null)}else{val updated=saved.copy(authStateJson=state.jsonSerializeString());save(updated);continuation.resume(FreshSession(updated,token))}
    service.dispose()
  }
}

private fun subjectFromJwt(token:String):String?=runCatching{
  val payload=token.split('.').getOrNull(1)?:return@runCatching null
  val json=JSONObject(String(Base64.decode(payload,Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP),Charsets.UTF_8))
  (json.optString("shadow_subject").ifBlank{json.optString("sub")}).takeIf{it.matches(Regex("^[a-z][a-z0-9_]{7,127}$"))}
}.getOrNull()
