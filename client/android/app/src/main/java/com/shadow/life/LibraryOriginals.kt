package com.shadow.life

import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable internal fun LibraryOriginals(accountId:String,assets:List<DetailAsset>){
  val context=LocalContext.current
  val app=context.applicationContext as ShadowApp
  val repository=remember(accountId){NativeLifeRepository(context,app)}
  val scope=rememberCoroutineScope()
  var selected by remember{mutableStateOf<DetailAsset?>(null)}
  var preview by remember{mutableStateOf<DetailAsset?>(null)}
  var image by remember{mutableStateOf<ByteArray?>(null)}
  var busy by remember{mutableStateOf(false)}
  var message by remember{mutableStateOf<String?>(null)}
  fun checkAccount(){check(app.sessions.active()?.accountId==accountId){"账号已切换"}}
  val export=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")){uri->
    val asset=selected
    if(uri!=null&&asset!=null)scope.launch{busy=true;try{checkAccount();repository.exportAsset(asset.versionId,uri,accountId);checkAccount();message="原件已保存到所选位置"}catch(e:CancellationException){throw e}catch(e:Exception){message=e.message}finally{busy=false}}
  }
  val firstImage=assets.firstOrNull{it.mediaType.startsWith("image/")}
  var inlineImage by remember(accountId,firstImage?.versionId){mutableStateOf<ByteArray?>(null)}
  LaunchedEffect(accountId,firstImage?.versionId){if(firstImage!=null)try{checkAccount();val bytes=repository.assetPreview(firstImage.versionId);checkAccount();inlineImage=bytes}catch(e:CancellationException){throw e}catch(_:Exception){}}
  val inlineBitmap=remember(inlineImage){inlineImage?.let{BitmapFactory.decodeByteArray(it,0,it.size)?.asImageBitmap()}}
  inlineBitmap?.let{bitmap->Image(bitmap,firstImage?.title,Modifier.fillMaxWidth().heightIn(max=360.dp),contentScale=ContentScale.Fit)}
  LifeCard{
    Text("原件",style=MaterialTheme.typography.titleMedium)
    assets.forEach{asset->
      Text(asset.mediaType,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
      Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
        if(asset.mediaType.startsWith("image/"))TextButton(enabled=!busy,onClick={preview=asset;image=null;message=null;scope.launch{busy=true;try{checkAccount();val bytes=repository.assetPreview(asset.versionId);checkAccount();image=bytes}catch(e:CancellationException){throw e}catch(e:Exception){message=e.message}finally{busy=false}}}){Text("查看图片")}
        TextButton(enabled=!busy,onClick={selected=asset;val extension=when(asset.mediaType){"application/pdf"->"pdf";"image/png"->"png";"image/jpeg"->"jpg";"text/html"->"html";else->"bin"};export.launch(asset.title.replace('/','_').take(80)+".$extension")}){Text("保存原件")}
      }
    }
    if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
    message?.let{Text(it,style=MaterialTheme.typography.bodyMedium)}
  }
  preview?.let{asset->LifeFullScreen("图片原件",{preview=null;image=null}){
    val bitmap=remember(image){image?.let{BitmapFactory.decodeByteArray(it,0,it.size)?.asImageBitmap()}}
    var zoom by remember{mutableFloatStateOf(1f)}
    var pan by remember{mutableStateOf(Offset.Zero)}
    val transform=rememberTransformableState{scale,offset,_->zoom=(zoom*scale).coerceIn(1f,5f);pan=if(zoom==1f)Offset.Zero else pan+offset}
    Column{
      Row{TextButton(onClick={zoom=(zoom-.5f).coerceAtLeast(1f)}){Text("缩小")};TextButton(onClick={zoom=(zoom+.5f).coerceAtMost(5f)}){Text("放大")};TextButton(onClick={zoom=1f;pan=Offset.Zero}){Text("还原")}}
      if(bitmap!=null)Box(Modifier.fillMaxSize().clipToBounds()){Image(bitmap,asset.title,Modifier.fillMaxSize().transformable(transform).graphicsLayer{scaleX=zoom;scaleY=zoom;translationX=pan.x;translationY=pan.y},contentScale=ContentScale.Fit)}
      else if(busy)LinearProgressIndicator(Modifier.fillMaxWidth()) else Text(message?:"原件无法解码，可保存后使用文件应用打开")
    }
  }}
}
