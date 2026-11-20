package com.shadow.life

import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.Image
import androidx.compose.foundation.gestures.rememberTransformableState
import androidx.compose.foundation.gestures.transformable
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.awaitCancellation
import java.io.File

@Composable internal fun LibraryPdfViewer(
  accountId:String,repository:NativeLifeRepository,asset:DetailAsset,initialPage:Int,onBack:()->Unit
){
  val context=LocalContext.current
  var file by remember(accountId,asset.versionId){mutableStateOf<File?>(null)}
  var errorMessage by remember(accountId,asset.versionId){mutableStateOf<String?>(null)}
  var retry by remember{mutableIntStateOf(0)}
  var page by rememberSaveable(asset.versionId,initialPage){mutableIntStateOf(initialPage-1)}
  LaunchedEffect(accountId,asset.versionId,retry){
    val temporary=File.createTempFile("life-preview-",".pdf",context.cacheDir)
    try{
      repository.exportAsset(asset.versionId,Uri.fromFile(temporary),accountId)
      file=temporary
      awaitCancellation()
    }catch(error:kotlinx.coroutines.CancellationException){throw error}
    catch(error:Exception){errorMessage=error.message?:"无法读取 PDF"}
    finally{file=null;temporary.delete()}
  }
  LifeFullScreen(asset.title,onBack){
    val ready=file
    if(errorMessage!=null)SectionError(errorMessage!!,{errorMessage=null;retry++})
    else if(ready==null)LinearProgressIndicator(Modifier.fillMaxWidth())
    else{
      val preview=rememberLifeRead(ready,page){
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO){
          ParcelFileDescriptor.open(ready,ParcelFileDescriptor.MODE_READ_ONLY).use{descriptor->
            val duplicate=ParcelFileDescriptor.dup(descriptor.fileDescriptor)
            val renderer=try{PdfRenderer(duplicate)}catch(error:Exception){duplicate.close();throw error}
            renderer.use{pdf->
              val index=page.coerceIn(0,pdf.pageCount-1)
              pdf.openPage(index).use{sheet->
                val scale=minOf(2f,1600f/maxOf(sheet.width,sheet.height))
                val bitmap=Bitmap.createBitmap((sheet.width*scale).toInt().coerceAtLeast(1),(sheet.height*scale).toInt().coerceAtLeast(1),Bitmap.Config.ARGB_8888)
                bitmap.eraseColor(Color.WHITE)
                sheet.render(bitmap,null,null,PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
                Triple(bitmap,index,pdf.pageCount)
              }
            }
          }
        }
      }
      StateContent(preview.state,preview.retry){(bitmap,index,count)->
        var zoom by remember(index){mutableFloatStateOf(1f)}
        var pan by remember(index){mutableStateOf(Offset.Zero)}
        val gesture=rememberTransformableState{scale,offset,_->
          zoom=(zoom*scale).coerceIn(1f,4f)
          pan=if(zoom==1f)Offset.Zero else pan+offset
        }
        Column{
          Row(horizontalArrangement=Arrangement.spacedBy(10.dp)){
            TextButton(onClick={page=index-1},enabled=index>0){Text("上一页")}
            Text("${index+1} / $count",Modifier.padding(top=12.dp))
            TextButton(onClick={page=index+1},enabled=index+1<count){Text("下一页")}
          }
          Image(bitmap.asImageBitmap(),"原报告第 ${index+1} 页",Modifier.fillMaxSize().clipToBounds().transformable(gesture).graphicsLayer{
            scaleX=zoom;scaleY=zoom;translationX=pan.x;translationY=pan.y
          })
        }
      }
    }
  }
}
