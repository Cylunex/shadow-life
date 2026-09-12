package com.shadow.app

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.util.Base64
import android.webkit.HttpAuthHandler
import android.webkit.JavascriptInterface
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.IOException

private const val MAX_HOST_EXPORT_BYTES = 5 * 1024 * 1024
private val allowedUploadTypes = arrayOf("image/*", "application/pdf", "text/plain", "text/markdown", "application/json", "application/gpx+xml", "text/calendar")
private fun effectivePort(uri:Uri)=if(uri.port>=0)uri.port else if(uri.scheme=="https")443 else 80
internal fun isAllowedLifeNavigation(base:String,target:String):Boolean=runCatching{
  val expected=Uri.parse(base)
  val actual=Uri.parse(target)
  actual.scheme=="https"&&actual.scheme==expected.scheme&&actual.host==expected.host&&effectivePort(actual)==effectivePort(expected)
}.getOrDefault(false)
internal fun isAllowedLifeOidcNavigation(issuer:String,target:String):Boolean=runCatching{
  if(issuer.isBlank())return@runCatching false
  val expected=Uri.parse(issuer)
  val actual=Uri.parse(target)
  expected.scheme=="https"&&actual.scheme==expected.scheme&&actual.host==expected.host&&effectivePort(actual)==effectivePort(expected)
}.getOrDefault(false)
internal fun isAllowedLifeAuthHost(base:String,host:String):Boolean=runCatching{
  val expected=Uri.parse(base).host?:return@runCatching false
  host.removePrefix("[").substringBefore(']').substringBefore(':').equals(expected,ignoreCase=true)
}.getOrDefault(false)
internal fun safeExportName(value:String):String=value.substringAfterLast('/').replace(Regex("[^A-Za-z0-9._\\-\\u4e00-\\u9fff]"),"_").take(120).ifBlank{"shadow-life-export.txt"}

private data class Credentials(val username:String,val password:String)
private data class AuthPrompt(val host:String,val realm:String)
private data class PendingExport(val filename:String,val mimeType:String,val bytes:ByteArray)

private class LifeHostBridge(private val deliver:(String,String,ByteArray)->Unit,private val syncHealth:()->Unit){
  @JavascriptInterface fun saveExport(filename:String,mimeType:String,base64:String){
    if(base64.length>MAX_HOST_EXPORT_BYTES*2)return
    val bytes=runCatching{Base64.decode(base64,Base64.DEFAULT)}.getOrNull()?:return
    if(bytes.isEmpty()||bytes.size>MAX_HOST_EXPORT_BYTES)return
    deliver(safeExportName(filename),mimeType.take(120),bytes)
  }
  @JavascriptInterface fun syncHealth()=syncHealth.invoke()
}

@Composable
fun LifeWebScreen(url:String,onHealthSync:()->Unit){
  val context=LocalContext.current
  val scope=rememberCoroutineScope()
  var webView by remember{mutableStateOf<WebView?>(null)}
  val pendingAuthHandlers=remember{mutableListOf<HttpAuthHandler>()}
  var authPrompt by remember{mutableStateOf<AuthPrompt?>(null)}
  var sessionCredentials by remember{mutableStateOf<Credentials?>(null)}
  var authReuseRemaining by remember{mutableIntStateOf(0)}
  var username by remember{mutableStateOf("")}
  var password by remember{mutableStateOf("")}
  var loading by remember{mutableStateOf(true)}
  var loadError by remember{mutableStateOf<String?>(null)}
  var hostMessage by remember{mutableStateOf<String?>(null)}
  var fileCallback by remember{mutableStateOf<ValueCallback<Array<Uri>>?>(null)}
  var pendingExport by remember{mutableStateOf<PendingExport?>(null)}

  val filePicker=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()){result->
    val callback=fileCallback
    fileCallback=null
    val parsed=WebChromeClient.FileChooserParams.parseResult(result.resultCode,result.data)
      ?.filter{uri->uri.scheme=="content"&&runCatching{context.contentResolver.getType(uri)}.getOrNull()?.let(::allowedMimeType)==true}
      ?.toTypedArray()
    callback?.onReceiveValue(parsed?.takeIf{it.isNotEmpty()})
  }
  val exportPicker=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()){result->
    val export=pendingExport
    pendingExport=null
    val target=result.data?.data
    if(result.resultCode!=Activity.RESULT_OK||export==null||target?.scheme!="content"){hostMessage="已取消保存";return@rememberLauncherForActivityResult}
    scope.launch{
      val saved=withContext(Dispatchers.IO){runCatching{context.contentResolver.openOutputStream(target)?.use{it.write(export.bytes)}?:throw IOException("No output stream")}.isSuccess}
      hostMessage=if(saved)"已保存 ${export.filename}" else "导出保存失败，请重新选择位置"
    }
  }

  fun cancelAuth(){pendingAuthHandlers.toList().forEach(HttpAuthHandler::cancel);pendingAuthHandlers.clear();authPrompt=null;password=""}
  fun requestExport(filename:String,mimeType:String,bytes:ByteArray){
    webView?.post{
      pendingExport=PendingExport(filename,mimeType.ifBlank{"application/octet-stream"},bytes)
      val intent=Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(mimeType.ifBlank{"application/octet-stream"}).putExtra(Intent.EXTRA_TITLE,filename)
      runCatching{exportPicker.launch(intent)}.onFailure{pendingExport=null;hostMessage="设备没有可用的文件保存器"}
    }
  }

  BackHandler(enabled=webView?.canGoBack()==true){webView?.goBack()}
  DisposableEffect(Unit){onDispose{cancelAuth();fileCallback?.onReceiveValue(null);fileCallback=null;webView?.removeJavascriptInterface("ShadowLifeHost");webView?.destroy()}}

  Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background)){
    AndroidView(
      modifier=Modifier.fillMaxSize(),
      factory={viewContext->WebView(viewContext).apply{
        setBackgroundColor(Color.TRANSPARENT)
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        settings.javaScriptEnabled=true
        settings.domStorageEnabled=true
        settings.allowFileAccess=false
        settings.allowContentAccess=false
        settings.javaScriptCanOpenWindowsAutomatically=false
        settings.setSupportMultipleWindows(false)
        settings.mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW
        addJavascriptInterface(LifeHostBridge(::requestExport){webView?.post{onHealthSync()}},"ShadowLifeHost")
        webChromeClient=object:WebChromeClient(){
          override fun onProgressChanged(view:WebView,newProgress:Int){loading=newProgress<100&&loadError==null}
          override fun onShowFileChooser(view:WebView,callback:ValueCallback<Array<Uri>>,params:WebChromeClient.FileChooserParams):Boolean{
            fileCallback?.onReceiveValue(null)
            val requested=params.acceptTypes.filter(String::isNotBlank)
            val types=if(requested.isEmpty()||requested.any{it=="*/*"})allowedUploadTypes else allowedUploadTypes.filter{allowed->requested.any{request->mimeMatches(allowed,request)}}.toTypedArray()
            if(types.isEmpty()){callback.onReceiveValue(null);hostMessage="网页请求了不支持的文件类型";return true}
            fileCallback=callback
            val intent=runCatching{params.createIntent()}.getOrElse{Intent(Intent.ACTION_OPEN_DOCUMENT)}.apply{
              action=Intent.ACTION_OPEN_DOCUMENT;addCategory(Intent.CATEGORY_OPENABLE);type=if(types.size==1)types[0] else "*/*";putExtra(Intent.EXTRA_MIME_TYPES,types);putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.mode==WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE)
            }
            runCatching{filePicker.launch(intent)}.onFailure{fileCallback=null;callback.onReceiveValue(null);hostMessage="设备没有可用的文件选择器"}
            return true
          }
        }
        webViewClient=object:WebViewClient(){
          override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest):Boolean{
            val target=request.url.toString()
            if(isAllowedLifeNavigation(url,target)||isAllowedLifeOidcNavigation(BuildConfig.SHADOW_OIDC_ISSUER,target))return false
            if(request.url.scheme=="https"||request.url.scheme=="http")runCatching{context.startActivity(Intent(Intent.ACTION_VIEW,request.url))}.onFailure{loadError="无法打开外部链接。"}
            else loadError="已阻止不受支持的外部链接。"
            return true
          }
          override fun onPageStarted(view:WebView,target:String,favicon:android.graphics.Bitmap?){if(isAllowedLifeNavigation(url,target)||isAllowedLifeOidcNavigation(BuildConfig.SHADOW_OIDC_ISSUER,target)){loading=true;loadError=null}}
          override fun onReceivedHttpAuthRequest(view:WebView,handler:HttpAuthHandler,host:String,realm:String){
            if(!isAllowedLifeAuthHost(url,host)){handler.cancel();loadError="已阻止非 Shadow Life 站点的认证请求。";return}
            val credentials=sessionCredentials
            if(credentials!=null&&authReuseRemaining>0){authReuseRemaining-=1;handler.proceed(credentials.username,credentials.password);return}
            pendingAuthHandlers.add(handler)
            if(authPrompt==null)authPrompt=AuthPrompt(host,realm)
          }
          override fun onReceivedHttpError(view:WebView,request:WebResourceRequest,response:WebResourceResponse){if(request.isForMainFrame&&response.statusCode>=400&&response.statusCode!=401){loading=false;loadError="页面请求失败（HTTP ${response.statusCode}）"}}
          override fun onReceivedSslError(view:WebView,handler:SslErrorHandler,error:android.net.http.SslError){handler.cancel();loading=false;loadError="站点证书校验失败，已停止加载。"}
          override fun onReceivedError(view:WebView,request:WebResourceRequest,error:WebResourceError){if(request.isForMainFrame){loading=false;loadError="页面加载失败：${error.description}"}}
          override fun onPageFinished(view:WebView,target:String){if(isAllowedLifeNavigation(url,target)||isAllowedLifeOidcNavigation(BuildConfig.SHADOW_OIDC_ISSUER,target)){loading=false;if(view.title?.isNotBlank()==true)loadError=null}}
        }
        loadUrl(url)
        webView=this
      }}
    )
    if(loading&&loadError==null)Column(Modifier.align(Alignment.Center).padding(24.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(12.dp)){CircularProgressIndicator();Text("正在打开 Shadow Life…")}
    loadError?.let{message->Column(Modifier.align(Alignment.Center).padding(28.dp),horizontalAlignment=Alignment.CenterHorizontally,verticalArrangement=Arrangement.spacedBy(12.dp)){Text(message);Button(onClick={loadError=null;loading=true;webView?.reload()}){Text("重新加载")}}}
    hostMessage?.let{message->Text(message,Modifier.align(Alignment.BottomCenter).padding(18.dp).background(MaterialTheme.colorScheme.surface).padding(12.dp))}
  }

  authPrompt?.let{prompt->AlertDialog(
    onDismissRequest=::cancelAuth,
    title={Text("登录 Shadow Life")},
    text={Column{Text("请输入 ${prompt.host} 的 NAS 访问账号。凭据仅保留在本次 App 运行内，用于同一站点的页面和静态资源认证。");OutlinedTextField(username,{username=it},label={Text("用户名")},singleLine=true);OutlinedTextField(password,{password=it},label={Text("密码")},singleLine=true,visualTransformation=PasswordVisualTransformation())}},
    confirmButton={Button(enabled=username.isNotBlank()&&password.isNotEmpty(),onClick={
      val credentials=Credentials(username.trim(),password)
      sessionCredentials=credentials;authReuseRemaining=1
      val handlers=pendingAuthHandlers.toList();pendingAuthHandlers.clear();authPrompt=null;password=""
      handlers.forEach{it.proceed(credentials.username,credentials.password)}
    }){Text("登录")}},
    dismissButton={TextButton(onClick=::cancelAuth){Text("取消")}}
  )}
}

private fun allowedMimeType(value:String)=allowedUploadTypes.any{mimeMatches(it,value)}
private fun mimeMatches(allowed:String,requested:String):Boolean{
  val left=allowed.lowercase().substringBefore(';').trim()
  val right=requested.lowercase().substringBefore(';').trim()
  if(left==right||left=="*/*"||right=="*/*")return true
  return (left.endsWith("/*")&&right.startsWith(left.substringBefore('/'))) || (right.endsWith("/*")&&left.startsWith(right.substringBefore('/')))
}
