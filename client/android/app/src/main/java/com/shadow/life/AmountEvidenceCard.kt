package com.shadow.life

import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

@Composable internal fun AmountEvidenceCard(accountId:String,recordId:String){
  val context=LocalContext.current
  val app=context.applicationContext as ShadowApp
  val repository=remember(accountId){NativeLifeRepository(context,app)}
  var open by rememberSaveable{mutableStateOf(false)}
  var retry by remember{mutableIntStateOf(0)}
  var rows by remember{mutableStateOf<List<JSONObject>>(emptyList())}
  var selected by remember{mutableStateOf<JSONObject?>(null)}
  var message by remember{mutableStateOf("")}
  var preview by remember{mutableStateOf<android.graphics.Bitmap?>(null)}
  var fullSize by rememberSaveable{mutableStateOf(false)}
  val fields=mapOf("paid" to "实付","discount" to "优惠","delivery" to "配送费")
  LaunchedEffect(open,accountId,recordId,retry){
    if(!open)return@LaunchedEffect
    try{
      check(app.sessions.active()?.accountId==accountId){"账号已切换"}
      rows=repository.amountEvidence(recordId).getJSONArray("items").trainingObjects()
      message=if(rows.isEmpty())"当前没有已定位的金额" else ""
    }catch(e:CancellationException){throw e}catch(e:Exception){message=e.message?:"读取失败"}
  }
  LaunchedEffect(accountId,selected){
    preview=null
    val row=selected?:return@LaunchedEffect
    if(row.isNull("asset_version_id"))return@LaunchedEffect
    try{
      check(app.sessions.active()?.accountId==accountId){"账号已切换"}
      val bytes=repository.assetPreview(row.getString("asset_version_id"))
      preview=withContext(Dispatchers.Default){BitmapFactory.decodeByteArray(bytes,0,bytes.size)}
      message=if(preview==null)"该格式无法显示图片预览" else ""
    }catch(e:CancellationException){throw e}catch(e:Exception){message=e.message?:"原件无法预览"}
  }
  LifeCard{
    TextButton(onClick={open=!open}){Text("核对金额来源")}
    if(open){
      rows.forEach{row->TextButton(onClick={selected=row}){Text("${fields[row.getString("field")]} ${row.getString("amount")} · 查看依据")}}
      selected?.let{row->
        if(!row.isNull("page"))Text("来源第 ${row.getInt("page")} 页／屏")
        if(!row.isNull("quote"))Text(row.getString("quote"))
        preview?.let{bitmap->
          TextButton(onClick={fullSize=true}){Text("放大核对原件")}
          Box(Modifier.fillMaxWidth().heightIn(max=240.dp).aspectRatio(bitmap.width.toFloat()/bitmap.height)){
            AmountEvidenceImage(bitmap,row.optJSONObject("region"))
          }
          if(fullSize)LifeFullScreen("金额来源原图",{fullSize=false}){
            var zoom by remember{mutableFloatStateOf(1f)}
            var pan by remember{mutableStateOf(Offset.Zero)}
            val transform=rememberTransformableState{scale,offset,_ ->
              zoom=(zoom*scale).coerceIn(1f,5f)
              pan=if(zoom==1f)Offset.Zero else pan+offset
            }
            Column{
              Row{
                TextButton(onClick={zoom=(zoom+.5f).coerceAtMost(5f)}){Text("放大")}
                TextButton(onClick={zoom=1f;pan=Offset.Zero}){Text("还原")}
              }
              Box(Modifier.fillMaxWidth().weight(1f).clipToBounds().transformable(transform),
                contentAlignment=androidx.compose.ui.Alignment.Center){
                Box(Modifier.fillMaxWidth().aspectRatio(bitmap.width.toFloat()/bitmap.height).graphicsLayer{
                  scaleX=zoom;scaleY=zoom;translationX=pan.x;translationY=pan.y
                }){
                  AmountEvidenceImage(bitmap,row.optJSONObject("region"))
                }
              }
            }
          }
        }
      }
      if(message.isNotBlank()){Text(message);TextButton(onClick={retry++}){Text("重新读取")}}
    }
  }
}


@Composable private fun AmountEvidenceImage(bitmap:android.graphics.Bitmap,region:JSONObject?){
  val image=remember(bitmap){bitmap.asImageBitmap()}
  Image(image,"金额来源原图",modifier=Modifier.fillMaxSize(),contentScale=ContentScale.Fit)
  if(region==null)return
  val width=region.getInt("image_width")
  val height=region.getInt("image_height")
  if(width<=0||height<=0||kotlin.math.abs(bitmap.width.toDouble()/bitmap.height-width.toDouble()/height)>=.01)return
  Canvas(Modifier.fillMaxSize()){
    val scale=minOf(size.width/width,size.height/height)
    val x=(size.width-width*scale)/2
    val y=(size.height-height*scale)/2
    drawRect(Color.Red,Offset(x+region.getInt("x")*scale,y+region.getInt("y")*scale),
      Size(region.getInt("width")*scale,region.getInt("height")*scale),style=Stroke(3f))
  }
}
