package com.shadow.life
import android.app.Activity
import android.os.Bundle
import android.net.Uri
import android.graphics.BitmapFactory
import android.graphics.BitmapRegionDecoder
import android.graphics.Rect
import kotlinx.coroutines.*
import java.io.File
import org.json.JSONObject
/** Emulator-only offline OCR probe. No API/session or production writes. */
class TakeoutQaActivity:Activity(){override fun onCreate(state:Bundle?){super.onCreate(state)
 val name=intent.getStringExtra("fixture")?:"fixture.jpg";val segmented=intent.getBooleanExtra("segments",false)
 require(Regex("fixture[12]?\\.jpg").matches(name))
 CoroutineScope(Dispatchers.Main).launch{try{
  val result=if(!segmented)sharedTakeoutMetadata(this@TakeoutQaActivity,Uri.fromFile(File(filesDir,name))) else withContext(Dispatchers.IO){
   @Suppress("DEPRECATION") val decoder=BitmapRegionDecoder.newInstance(File(filesDir,name).absolutePath,false)!!
   try{TakeoutOcr().use{ocr->
    val height=1800;var y=0;var offset=0;var previous=emptyList<OrderTextBox>();var all=emptyList<OrderTextBox>();val shifts=mutableListOf<Int>()
    while(true){val image=decoder.decodeRegion(Rect(0,y,decoder.width,minOf(y+height,decoder.height)),BitmapFactory.Options());val boxes=try{ocr.read(image)}finally{image.recycle()}
     if(y==0)all=boxes else {val delta=takeoutScrollOffset(previous,boxes,height)?:error("Alignment failed at segment $y");shifts+=delta;all=mergeTakeoutBoxes(all,boxes,offset+delta,offset,height);offset+=delta}
     previous=boxes
     if(takeoutEnded(all)||y+height>=decoder.height)break
     y=minOf(y+650,decoder.height-height)
    }
    JSONObject().put("shifts",org.json.JSONArray(shifts)).put("input",JSONObject().put("text",takeoutEnvelope("eleme",decoder.width,offset+height,all,takeoutEnded(all)))).toString()
   }}finally{decoder.recycle()}
  }
  File(filesDir,"$name${if(segmented)".segments" else ""}.json").writeText(result?:"null")
 }catch(e:Exception){File(filesDir,"$name${if(segmented)".segments" else ""}.json").writeText(JSONObject().put("error",e.toString()).toString())}finally{finish()}}
}}
