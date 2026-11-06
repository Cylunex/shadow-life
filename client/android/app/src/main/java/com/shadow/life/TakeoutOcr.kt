package com.shadow.life

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapRegionDecoder
import android.graphics.BitmapFactory
import android.graphics.Rect
import android.net.Uri
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.latin.TextRecognizerOptions
import com.google.mlkit.vision.text.chinese.ChineseTextRecognizerOptions
import kotlinx.coroutines.*
import kotlin.coroutines.suspendCoroutine
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId

internal class TakeoutOcr:AutoCloseable {
 private val recognizer=TextRecognition.getClient(ChineseTextRecognizerOptions.Builder().build())
 private val numbers=TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS)
 private suspend fun readRaw(bitmap:Bitmap,numeric:Boolean=false):List<OrderTextBox> = suspendCoroutine { continuation ->
  (if(numeric)numbers else recognizer).process(InputImage.fromBitmap(bitmap,0)).addOnSuccessListener{result->
   continuation.resume(result.textBlocks.flatMap{it.lines}.mapNotNull{line->line.boundingBox?.let{r->OrderTextBox(r.left.coerceAtLeast(0),r.top.coerceAtLeast(0),r.width().coerceAtLeast(1),r.height().coerceAtLeast(1),line.text.trim())}}.filter{it.text.isNotEmpty()})
  }.addOnFailureListener{continuation.resumeWithException(it)}
 }
 suspend fun read(bitmap:Bitmap):List<OrderTextBox>{
  val all=readRaw(bitmap).toMutableList()
  // Keep surrounding product text for isolated short prices (notably a zero option).
  for(box in readRaw(bitmap,true).filter{it.x>bitmap.width*.72&&it.text.any(Char::isDigit)}){
   val existing=all.indexOfFirst{kotlin.math.abs(it.y+it.height/2-box.y-box.height/2)<minOf(it.height,box.height)*.7&&kotlin.math.abs(it.x-box.x)<30}
   if(existing<0)all+=box
   else if((box.text.contains('¥')||box.text.contains('￥'))&&!(all[existing].text.contains('¥')||all[existing].text.contains('￥')))all[existing]=box
  }
  val left=(bitmap.width*.72).toInt();val crop=Bitmap.createBitmap(bitmap,left,0,bitmap.width-left,bitmap.height)
  val enlarged=Bitmap.createScaledBitmap(crop,crop.width*2,crop.height*2,true);crop.recycle()
  try{for(b in readRaw(enlarged,true)){
   val box=OrderTextBox(left+b.x/2,b.y/2,(b.width/2).coerceAtLeast(1),(b.height/2).coerceAtLeast(1),b.text)
   if(!box.text.any(Char::isDigit))continue
   val existing=all.indexOfFirst{kotlin.math.abs(it.y+it.height/2-box.y-box.height/2)<minOf(it.height,box.height)*.7&&kotlin.math.abs(it.x-box.x)<30}
   if(existing<0)all+=box
   else if((box.text.contains('¥')||box.text.contains('￥'))&&!(all[existing].text.contains('¥')||all[existing].text.contains('￥')))all[existing]=box
  }}finally{enlarged.recycle()}
  val quantities=all.filter{Regex("^[×xX*]\\s*\\d{1,3}$").matches(it.text.trim())}
  for(q in quantities.take(100)){
   if(all.any{it.x>bitmap.width*.75&&it.y in (q.y-3*q.height)..(q.y+q.height)&&it.text.any(Char::isDigit)})continue
   val top=(q.y-3*q.height).coerceAtLeast(0);val bottom=(q.bottom+q.height).coerceAtMost(bitmap.height)
   val region=Bitmap.createBitmap(bitmap,left,top,bitmap.width-left,bottom-top)
   val large=Bitmap.createScaledBitmap(region,region.width*3,region.height*3,true);region.recycle()
   try{
    val isolated=readRaw(large,true)
    all+=isolated.map{OrderTextBox(left+it.x/3,top+it.y/3,(it.width/3).coerceAtLeast(1),(it.height/3).coerceAtLeast(1),it.text)}
   }finally{large.recycle()}
  }
  return all
 }
 override fun close(){recognizer.close();numbers.close()}
}
/** Decode bounded overlapping strips; retain original coordinates and never shrink the whole long image. */
internal suspend fun sharedTakeoutMetadata(context:Context,uri:Uri):String?=withContext(Dispatchers.IO){
 val stream=context.contentResolver.openInputStream(uri)?:return@withContext null
 @Suppress("DEPRECATION") val decoder=stream.use{BitmapRegionDecoder.newInstance(it,false)}?:return@withContext null
 try{
  val width=decoder.width;val height=decoder.height
  if(width !in 200..4000||height !in 200..30000||width.toLong()*height>60_000_000)return@withContext null
  val all=mutableListOf<OrderTextBox>();val step=1400;val stripHeight=1800
  TakeoutOcr().use{ocr->
   var top=0
   while(top<height){
    ensureActive();val end=minOf(height,top+stripHeight)
    val bitmap=decoder.decodeRegion(Rect(0,top,width,end),BitmapFactory.Options())?:error("长截图无法读取")
    val boxes=try{ocr.read(bitmap)}finally{bitmap.recycle()}
    for(box in boxes.map{it.copy(y=it.y+top)}){
     val existing=all.indexOfFirst{old->kotlin.math.abs(old.y+old.height/2-box.y-box.height/2)<minOf(old.height,box.height)*.6&&kotlin.math.abs(old.x-box.x)<20}
     if(existing<0)all+=box
     else {val old=all[existing];fun score(b:OrderTextBox)=if(b.text.contains('¥')||b.text.contains('￥'))1000+b.text.length else b.text.length
      if(score(box)>score(old))all[existing]=box
     }
    }
    if(top==0&&!isTakeoutPage(all))return@withContext null
    if(end==height)break;top+=step
   }
  }
  val text=takeoutText(all);val platform=if(text.contains("闪购")||text.contains("蜂鸟"))"eleme" else "meituan"
  val encoded=takeoutEnvelope(platform,width,height,all,takeoutEnded(all))
  JSONObject().put("capability","life.capture_screenshot").put("input",JSONObject().put("title","外卖订单长截图").put("captured_at",Instant.now().toString()).put("time_zone",ZoneId.systemDefault().id).put("app_package","com.shadow.life.shared_order").put("text",encoded)).toString()
 }finally{decoder.recycle()}
}
