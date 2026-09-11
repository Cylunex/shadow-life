package com.shadow.app

import android.content.Intent
import android.net.Uri
import android.webkit.HttpAuthHandler
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView

private fun effectivePort(uri:Uri)=if(uri.port>=0)uri.port else if(uri.scheme=="https")443 else 80
internal fun isAllowedLifeNavigation(base:String,target:String):Boolean=runCatching{
  val expected=Uri.parse(base)
  val actual=Uri.parse(target)
  actual.scheme=="https"&&actual.scheme==expected.scheme&&actual.host==expected.host&&effectivePort(actual)==effectivePort(expected)
}.getOrDefault(false)

@Composable
fun LifeWebScreen(url:String){
  val context=LocalContext.current
  var webView by remember{mutableStateOf<WebView?>(null)}
  var authHandler by remember{mutableStateOf<HttpAuthHandler?>(null)}
  var authHost by remember{mutableStateOf("")}
  var username by remember{mutableStateOf("")}
  var password by remember{mutableStateOf("")}
  var loadError by remember{mutableStateOf<String?>(null)}

  BackHandler(enabled=webView?.canGoBack()==true){webView?.goBack()}
  DisposableEffect(Unit){onDispose{authHandler?.cancel();webView?.destroy()}}

  Box(Modifier.fillMaxSize()){
    AndroidView(
      modifier=Modifier.fillMaxSize(),
      factory={viewContext->WebView(viewContext).apply{
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        settings.javaScriptEnabled=true
        settings.domStorageEnabled=true
        settings.allowFileAccess=false
        settings.allowContentAccess=false
        settings.mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW
        webViewClient=object:WebViewClient(){
          override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest):Boolean{
            val target=request.url.toString()
            if(isAllowedLifeNavigation(url,target))return false
            if(request.url.scheme=="https"||request.url.scheme=="http")runCatching{context.startActivity(Intent(Intent.ACTION_VIEW,request.url))}
            else loadError="已阻止不受支持的外部链接。"
            return true
          }
          override fun onReceivedHttpAuthRequest(view:WebView,handler:HttpAuthHandler,host:String,realm:String){
            if(host!=Uri.parse(url).host){handler.cancel();loadError="已阻止非 Shadow Life 站点的认证请求。";return}
            authHandler?.cancel()
            authHandler=handler
            authHost=host
          }
          override fun onReceivedError(view:WebView,request:WebResourceRequest,error:android.webkit.WebResourceError){
            if(request.isForMainFrame)loadError="页面加载失败：${error.description}"
          }
          override fun onPageFinished(view:WebView,url:String){loadError=null}
        }
        loadUrl(url)
        webView=this
      }}
    )
    loadError?.let{Text(it,Modifier.padding(20.dp))}
  }

  if(authHandler!=null)AlertDialog(
    onDismissRequest={authHandler?.cancel();authHandler=null;password=""},
    title={Text("登录 Shadow Life")},
    text={androidx.compose.foundation.layout.Column{
      Text("请输入 $authHost 的 NAS 访问账号。凭据只交给系统 WebView 的当前认证会话，不写入 APK。")
      OutlinedTextField(username,{username=it},label={Text("用户名")},singleLine=true)
      OutlinedTextField(password,{password=it},label={Text("密码")},singleLine=true,visualTransformation=PasswordVisualTransformation())
    }},
    confirmButton={Button(enabled=username.isNotBlank()&&password.isNotEmpty(),onClick={
      val pending=authHandler;authHandler=null;pending?.proceed(username,password);password=""
    }){Text("登录")}},
    dismissButton={TextButton(onClick={authHandler?.cancel();authHandler=null;password=""}){Text("取消")}}
  )
}
