package com.shadow.life

import android.content.Intent
import android.os.Bundle
import android.os.Build
import android.net.Uri
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.health.connect.client.PermissionController
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.work.WorkManager
import kotlinx.coroutines.launch
import java.util.UUID

class MainActivity:ComponentActivity(){
  private lateinit var oidc:OidcSessions
  private var session by mutableStateOf<ProductSession?>(null)
  private var appearance by mutableStateOf(Appearance.Dark)
  private var loginError by mutableStateOf<String?>(null)
  private var pendingShare by mutableStateOf<SharePayload?>(null)

  private val loginResult=registerForActivityResult(ActivityResultContracts.StartActivityForResult()){result->
    val data=result.data
    if(data==null){loginError="登录已取消";return@registerForActivityResult}
    oidc.complete(data){value->runOnUiThread{session=value;loginError=if(value==null)"登录失败，请重试" else null}}
  }
  private val healthPermissions=registerForActivityResult(PermissionController.createRequestPermissionResultContract()){granted->
    session?.let{HealthConnectScheduler.schedule(this,it.accountId)}
    if(granted.isEmpty())loginError="未获得 Health Connect 权限，其他功能仍可使用"
  }

  override fun onCreate(savedInstanceState:Bundle?){
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    val app=application as ShadowApp
    pendingShare=intent.sharePayload()
    oidc=OidcSessions(this,app.sessions)
    session=app.sessions.active()
    val appearances=AppearanceStore(this)
    appearance=appearances.current()
    setContent{LifeTheme(appearance){val model:NativeLifeViewModel=viewModel();LifeApp(session,model,appearance,loginError,pendingShare,{payload->model.importShare(payload){pendingShare=null}},{pendingShare=null},{loginError=null},{appearance=it;appearances.save(it)},::login,::logout,::syncHealth)}}
  }
  override fun onDestroy(){oidc.close();super.onDestroy()}
  override fun onNewIntent(intent:Intent){super.onNewIntent(intent);setIntent(intent);intent.sharePayload()?.let{pendingShare=it}}

  private fun login(){loginError=null;oidc.loginIntent{intent->runOnUiThread{if(intent==null)loginError="登录配置不可用" else loginResult.launch(intent)}}}
  private fun logout(){session?.let{current->WorkManager.getInstance(this).cancelUniqueWork(SyncScheduler.workName(current.accountId));WorkManager.getInstance(this).cancelUniqueWork(HealthConnectScheduler.workName(current.accountId));oidc.logout(current)};session=null}
  private fun syncHealth(){
    val current=session?:return
    if(!HealthConnectSync.available(this)){loginError="此设备未提供 Health Connect";return}
    lifecycleScope.launch{
      val client=androidx.health.connect.client.HealthConnectClient.getOrCreate(this@MainActivity)
      val granted=client.permissionController.getGrantedPermissions()
      if(HealthConnectSync.hasAnySupportedPermission(granted)){
        HealthConnectScheduler.schedule(this@MainActivity,current.accountId)
        if(!granted.containsAll(HealthConnectSync.permissions))healthPermissions.launch(HealthConnectSync.permissions-granted)
      }else healthPermissions.launch(HealthConnectSync.permissions)
    }
  }
}

private fun Intent.sharePayload():SharePayload?{
  if(action!=Intent.ACTION_SEND&&action!=Intent.ACTION_SEND_MULTIPLE)return null
  val values=mutableListOf<Uri>();clipData?.let{clip->repeat(clip.itemCount){values+=clip.getItemAt(it).uri?:return@repeat}}
  if(Build.VERSION.SDK_INT>=33){getParcelableExtra(Intent.EXTRA_STREAM,Uri::class.java)?.let(values::add);getParcelableArrayListExtra(Intent.EXTRA_STREAM,Uri::class.java)?.let(values::addAll)}else{@Suppress("DEPRECATION")(getParcelableExtra<Uri>(Intent.EXTRA_STREAM))?.let(values::add);@Suppress("DEPRECATION")(getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM))?.let(values::addAll)}
  val text=getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.takeIf(String::isNotBlank)
  return SharePayload(UUID.randomUUID().toString().replace("-",""),text,values.map(Uri::toString).distinct()).takeIf{it.text!=null||it.uris.isNotEmpty()}
}
