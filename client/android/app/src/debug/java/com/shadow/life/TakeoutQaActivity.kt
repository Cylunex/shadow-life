package com.shadow.life
import android.app.Activity
import android.os.Bundle
import android.graphics.BitmapFactory
import android.graphics.BitmapRegionDecoder
import android.graphics.Rect
import kotlinx.coroutines.*
import java.io.File
import org.json.JSONObject
/** Emulator-only pixel-alignment probe. No OCR, model calls, session or API writes. */
class TakeoutQaActivity:Activity(){override fun onCreate(state:Bundle?){super.onCreate(state)
 val name=intent.getStringExtra("fixture")?:"fixture.jpg";val segmented=intent.getBooleanExtra("segments",false)
 require(Regex("fixture[12]?\\.jpg").matches(name))
 CoroutineScope(Dispatchers.Main).launch{try{
  val result=if(!segmented)sharedImageMetadata(this@TakeoutQaActivity,"qa") else withContext(Dispatchers.IO){
   @Suppress("DEPRECATION") val decoder=BitmapRegionDecoder.newInstance(File(filesDir,name).absolutePath,false)!!
   try{
    val height=minOf(1800,decoder.height);var y=0;var previous:OrderImageSample?=null;val shifts=mutableListOf<Int>()
    while(true){val image=decoder.decodeRegion(Rect(0,y,decoder.width,y+height),BitmapFactory.Options())?:error("Cannot decode fixture")
     val sample=try{orderImageSample(image)}finally{image.recycle()}
     previous?.let{shifts+=orderImageOffset(it,sample,height)?:error("Pixel alignment failed at segment $y")};previous=sample
     if(y+height>=decoder.height)break
     y=minOf(y+650,decoder.height-height)
    }
    JSONObject().put("method","pixel_alignment_only").put("shifts",org.json.JSONArray(shifts)).toString()
   }finally{decoder.recycle()}
  }
  File(filesDir,"$name${if(segmented)".segments" else ""}.json").writeText(result)
 }catch(e:Exception){File(filesDir,"$name${if(segmented)".segments" else ""}.json").writeText(JSONObject().put("error",e.toString()).toString())}finally{finish()}}
}}
