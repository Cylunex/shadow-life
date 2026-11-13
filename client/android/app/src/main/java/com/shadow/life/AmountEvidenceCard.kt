package com.shadow.life

import android.graphics.BitmapFactory
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
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
          Box(Modifier.fillMaxWidth().aspectRatio(bitmap.width.toFloat()/bitmap.height)){
            Image(bitmap.asImageBitmap(),"金额来源原图",modifier=Modifier.fillMaxSize())
            row.optJSONObject("region")?.let{region->
              val w=region.getInt("image_width");val h=region.getInt("image_height")
              if(kotlin.math.abs(bitmap.width.toDouble()/bitmap.height-w.toDouble()/h)<0.01)
                Canvas(Modifier.fillMaxSize()){
                  drawRect(Color.Red,Offset(size.width*region.getInt("x")/w,size.height*region.getInt("y")/h),
                    Size(size.width*region.getInt("width")/w,size.height*region.getInt("height")/h),style=Stroke(3f))
                }
            }
          }
        }
      }
      if(message.isNotBlank()){Text(message);TextButton(onClick={retry++}){Text("重新读取")}}
    }
  }
}
