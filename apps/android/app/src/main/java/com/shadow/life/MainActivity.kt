package com.shadow.life

import android.content.Intent
import android.os.Bundle
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
import kotlinx.coroutines.launch

class MainActivity:ComponentActivity(){
  private lateinit var oidc:OidcSessions
  private var session by mutableStateOf<ProductSession?>(null)
  private var appearance by mutableStateOf(Appearance.Dark)
  private var loginError by mutableStateOf<String?>(null)

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
    oidc=OidcSessions(this,app.sessions)
    session=app.sessions.active()
    val appearances=AppearanceStore(this)
    appearance=appearances.current()
    setContent{LifeTheme(appearance){val model:NativeLifeViewModel=viewModel();LifeApp(session,model,appearance,loginError,{loginError=null},{appearance=it;appearances.save(it)},::login,::logout,::syncHealth)}}
  }
  override fun onDestroy(){oidc.close();super.onDestroy()}
  override fun onNewIntent(intent:Intent){super.onNewIntent(intent);setIntent(intent)}

  private fun login(){loginError=null;oidc.loginIntent{intent->runOnUiThread{if(intent==null)loginError="登录配置不可用" else loginResult.launch(intent)}}}
  private fun logout(){session?.let{(application as ShadowApp).sessions.revoke(it.accountId)};session=null}
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
