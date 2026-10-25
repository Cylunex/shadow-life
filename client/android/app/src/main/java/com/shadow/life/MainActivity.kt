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
import android.Manifest
import android.content.pm.PackageManager
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID

class MainActivity:ComponentActivity(){
  private lateinit var oidc:OidcSessions
  private var session by mutableStateOf<ProductSession?>(null)
  private var appearance by mutableStateOf(Appearance.Dark)
  private var loginError by mutableStateOf<String?>(null)
  private var pendingShare by mutableStateOf<SharePayload?>(null)
  private var notificationAuthorization by mutableStateOf<String?>(null)
  private var openInboxNonce by mutableStateOf(0L)
  private lateinit var scalePreferences:ScalePreferences
  private var scaleSettings by mutableStateOf(ScaleProfileSettings())
  private var loginMode=LoginMode.None
  private var restoringSession=false

  private val loginResult=registerForActivityResult(ActivityResultContracts.StartActivityForResult()){result->
    val completedMode=loginMode
    loginMode=LoginMode.None
    val data=result.data
    if(data==null){handleLoginFailure(completedMode,"登录已取消");return@registerForActivityResult}
    oidc.complete(data){value->runOnUiThread{if(value==null)handleLoginFailure(completedMode,"登录失败，请重试") else{session=value;loginError=null;resumeAccount(value)}}}
  }
  private val healthPermissions=registerForActivityResult(PermissionController.createRequestPermissionResultContract()){
    lifecycleScope.launch{
      if(!HealthConnectSync.enabled())return@launch
      val current=session?:return@launch
      val client=androidx.health.connect.client.HealthConnectClient.getOrCreate(this@MainActivity)
      val granted=client.permissionController.getGrantedPermissions()
      if(HealthConnectSync.hasAnySupportedPermission(granted)){
        HealthConnectScheduler.schedule(this@MainActivity,current.accountId)
        HealthConnectSync.backgroundPermission(client)?.takeIf{it !in granted}?.let{loginError="后台健康读取未开启；前台手动同步仍可使用"}
      }else loginError="未获得 Health Connect 数据权限，其他功能仍可使用"
    }
  }
  private val notificationPermission=registerForActivityResult(ActivityResultContracts.RequestPermission()){granted->notificationAuthorization=if(granted)"enabled" else "denied";if(!granted)loginError="系统通知未开启，提醒仍会保留在 Life 收件箱"}
  private val scalePermissions=registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()){granted->
    if(granted.isNotEmpty()&&granted.values.all{it})startScaleService() else{
      session?.let{(application as ShadowApp).deviceSync.updateScale(it.accountId,"needs_permission","未获得附近设备权限，无法接收体脂秤广播")}
    }
  }

  override fun onCreate(savedInstanceState:Bundle?){
    super.onCreate(savedInstanceState)
    enableEdgeToEdge()
    val app=application as ShadowApp
    scalePreferences=ScalePreferences(this);scaleSettings=scalePreferences.current()
    pendingShare=if(savedInstanceState!=null)savedInstanceState.savedSharePayload() else intent.sharePayload()
    if(intent.getBooleanExtra(OPEN_INBOX_EXTRA,false))openInboxNonce++
    oidc=OidcSessions(this,app.sessions)
    session=app.sessions.active()
    val appearances=AppearanceStore(this)
    appearance=appearances.current()
    setContent{LifeTheme(appearance){val model:NativeLifeViewModel=viewModel();LifeApp(session,model,appearance,loginError,pendingShare,notificationAuthorization,openInboxNonce,scaleSettings,{payload->model.importShare(payload){pendingShare=null}},{pendingShare=null},{loginError=null},{appearance=it;appearances.save(it)},::login,::logout,::syncHealth,::syncSamsung,::startScale,::saveScaleSettings,::requestNotifications)}}
  }
  override fun onStart(){super.onStart();session?.let(::restoreSession)}
  override fun onDestroy(){oidc.close();super.onDestroy()}
  override fun onSaveInstanceState(outState:Bundle){super.onSaveInstanceState(outState);outState.putBoolean(SHARE_PRESENT,pendingShare!=null);pendingShare?.let{payload->outState.putString(SHARE_ID,payload.ingressId);outState.putString(SHARE_TEXT,payload.text);outState.putStringArrayList(SHARE_URIS,ArrayList(payload.uris))}}
  override fun onNewIntent(intent:Intent){super.onNewIntent(intent);setIntent(intent);intent.sharePayload()?.let{pendingShare=it};if(intent.getBooleanExtra(OPEN_INBOX_EXTRA,false))openInboxNonce++}

  private fun login(){launchLogin(LoginMode.Interactive)}
  private fun launchLogin(mode:LoginMode){
    if(loginMode!=LoginMode.None)return
    loginMode=mode
    loginError=if(mode==LoginMode.Silent)"登录状态已过期，正在自动恢复…" else null
    oidc.loginIntent(silent=mode==LoginMode.Silent){intent->runOnUiThread{
      if(intent==null){loginMode=LoginMode.None;loginError="登录配置不可用"}else loginResult.launch(intent)
    }}
  }
  private fun handleLoginFailure(completedMode:LoginMode,message:String){
    when(nextLoginModeAfterFailure(completedMode)){
      LoginMode.Interactive->launchLogin(LoginMode.Interactive)
      else->loginError=message
    }
  }
  private fun restoreSession(value:ProductSession){
    if(restoringSession||loginMode!=LoginMode.None)return
    restoringSession=true
    lifecycleScope.launch{
      val refreshed=(application as ShadowApp).sessions.fresh(value.accountId,this@MainActivity)
      restoringSession=false
      if(session?.accountId!=value.accountId)return@launch
      when(refreshed){
        is SessionRefresh.Ready->{session=refreshed.value.session;loginError=null;resumeAccount(refreshed.value.session)}
        SessionRefresh.Retryable->loginError="暂时无法验证登录，已保留本地数据，请稍后重试"
        SessionRefresh.ReauthRequired->{session=null;launchLogin(LoginMode.Silent)}
      }
    }
  }
  private fun resumeAccount(value:ProductSession){
    if(!HealthConnectSync.enabled())WorkManager.getInstance(this).cancelUniqueWork(HealthConnectScheduler.workName(value.accountId))
    lifecycleScope.launch{val app=application as ShadowApp;withContext(Dispatchers.IO){app.queue.secureLegacy(value)};delay(500);if(session?.accountId!=value.accountId)return@launch;SyncScheduler.retryNow(this@MainActivity,value.accountId);delay(1_500);if(session?.accountId==value.accountId)SamsungHealthBridge.startIfAuthorized(this@MainActivity,value.accountId)}
  }
  private fun logout(){session?.let{current->WorkManager.getInstance(this).cancelUniqueWork(SyncScheduler.workName(current.accountId));WorkManager.getInstance(this).cancelUniqueWork(HealthConnectScheduler.workName(current.accountId));WorkManager.getInstance(this).cancelUniqueWork("shadow-samsung-${current.accountId}");WorkManager.getInstance(this).cancelUniqueWork("shadow-samsung-now-${current.accountId}");stopService(Intent(this,ScaleScanService::class.java));NotificationSyncScheduler.cancel(this,current.accountId);oidc.logout(current)};session=null}
  private fun syncHealth(){
    val current=session?:return
    if(!HealthConnectSync.enabled()){loginError="Health Connect 当前已关闭";return}
    if(!HealthConnectSync.available(this)){loginError="此设备未提供 Health Connect";return}
    lifecycleScope.launch{
      val client=androidx.health.connect.client.HealthConnectClient.getOrCreate(this@MainActivity)
      val granted=client.permissionController.getGrantedPermissions()
      val requested=HealthConnectSync.requestedPermissions(client)
      if(granted.containsAll(requested))HealthConnectScheduler.schedule(this@MainActivity,current.accountId)
      else healthPermissions.launch(requested-granted)
    }
  }
  private fun requestNotifications(){if(Build.VERSION.SDK_INT>=33)notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS) else notificationAuthorization="enabled"}
  private fun startScale(){
    val current=session?:return
    loginError=null
    val required=if(Build.VERSION.SDK_INT>=31)arrayOf(Manifest.permission.BLUETOOTH_SCAN,Manifest.permission.BLUETOOTH_CONNECT) else arrayOf(Manifest.permission.ACCESS_FINE_LOCATION)
    val missing=required.filter{ContextCompat.checkSelfPermission(this,it)!=PackageManager.PERMISSION_GRANTED}
    (application as ShadowApp).deviceSync.updateScale(current.accountId,"starting",if(missing.isEmpty())"正在启动蓝牙接收" else "请允许附近设备权限以开始接收")
    if(missing.isEmpty())startScaleService() else scalePermissions.launch(missing.toTypedArray())
  }
  private fun startScaleService(){
    val current=session?:return
    try{
      ContextCompat.startForegroundService(this,Intent(this,ScaleScanService::class.java).putExtra(ScaleScanService.EXTRA_ACCOUNT_ID,current.accountId))
    }catch(error:Exception){
      val message=error.message?.takeIf(String::isNotBlank)?:"无法启动体脂秤数据接收"
      (application as ShadowApp).deviceSync.updateScale(current.accountId,"error",message)
    }
  }
  private fun saveScaleSettings(value:ScaleProfileSettings){try{scalePreferences.save(value);scaleSettings=scalePreferences.current();loginError="体脂秤档案已安全保存"}catch(error:Exception){loginError=error.message?:"体脂秤档案保存失败"}}
  private fun syncSamsung(){val current=session?:return;SamsungHealthBridge.enable(this,current.accountId).onFailure{loginError=it.cause?.message?:it.message?:"Samsung Health 连接失败"}}
}

private fun Intent.sharePayload():SharePayload?{
  if(action!=Intent.ACTION_SEND&&action!=Intent.ACTION_SEND_MULTIPLE)return null
  val values=mutableListOf<Uri>();clipData?.let{clip->repeat(clip.itemCount){values+=clip.getItemAt(it).uri?:return@repeat}}
  if(Build.VERSION.SDK_INT>=33){getParcelableExtra(Intent.EXTRA_STREAM,Uri::class.java)?.let(values::add);getParcelableArrayListExtra(Intent.EXTRA_STREAM,Uri::class.java)?.let(values::addAll)}else{@Suppress("DEPRECATION")(getParcelableExtra<Uri>(Intent.EXTRA_STREAM))?.let(values::add);@Suppress("DEPRECATION")(getParcelableArrayListExtra<Uri>(Intent.EXTRA_STREAM))?.let(values::addAll)}
  val text=getCharSequenceExtra(Intent.EXTRA_TEXT)?.toString()?.takeIf(String::isNotBlank)
  val ingressId=getStringExtra(SHARE_ID)?:UUID.randomUUID().toString().replace("-","").also{putExtra(SHARE_ID,it)}
  return SharePayload(ingressId,text,values.map(Uri::toString).distinct()).takeIf{it.text!=null||it.uris.isNotEmpty()}
}

private fun Bundle.savedSharePayload():SharePayload?=if(!getBoolean(SHARE_PRESENT,false))null else getString(SHARE_ID)?.let{SharePayload(it,getString(SHARE_TEXT),getStringArrayList(SHARE_URIS)?.toList().orEmpty())}
private const val SHARE_PRESENT="com.shadow.life.share.PRESENT"
private const val SHARE_ID="com.shadow.life.share.INGRESS_ID"
private const val SHARE_TEXT="com.shadow.life.share.TEXT"
private const val SHARE_URIS="com.shadow.life.share.URIS"

internal enum class LoginMode{None,Silent,Interactive}
internal fun nextLoginModeAfterFailure(mode:LoginMode)=if(mode==LoginMode.Silent)LoginMode.Interactive else LoginMode.None
