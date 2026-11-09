package com.shadow.life

import android.graphics.Bitmap
import kotlin.math.abs
import kotlin.math.roundToInt

internal data class OrderImageSample(val width:Int,val height:Int,val pixels:IntArray)
internal fun orderImageSample(bitmap:Bitmap):OrderImageSample {
 val width=96;val height=(bitmap.height.toDouble()*width/bitmap.width).roundToInt()
 val scaled=Bitmap.createScaledBitmap(bitmap,width,height,true)
 try{val rgb=IntArray(width*height);scaled.getPixels(rgb,0,width,0,0,width,height)
  return OrderImageSample(width,height,IntArray(rgb.size){i->val c=rgb[i];(((c shr 16)and 255)*3+((c shr 8)and 255)*6+(c and 255))/10})
 }finally{if(scaled!==bitmap)scaled.recycle()}
}

/** Match overlapping pixels, never recognize text. Reject blank or ambiguous matches. */
internal fun orderImageOffset(previous:OrderImageSample,next:OrderImageSample,screenHeight:Int):Int? {
 if(previous.width!=next.width||previous.height!=next.height)return null
 val w=previous.width;val h=previous.height;val top=h*15/100;val bottom=h*84/100
 data class Match(val shift:Int,val error:Double)
 val matches=mutableListOf<Match>()
 for(shift in 0..h*55/100){
  var error=0L;var count=0;var textured=0
  for(y in top until bottom-shift)for(x in w/10 until w*9/10){
   val a=previous.pixels[(y+shift)*w+x];val b=next.pixels[y*w+x]
   val edge=abs(a-previous.pixels[(y+shift)*w+x-1])+abs(b-next.pixels[y*w+x-1])
   if(edge>24){error+=abs(a-b);count++;textured++}
  }
  if(textured>=40&&count>0)matches+=Match(shift,error.toDouble()/count)
 }
 val best=matches.minByOrNull{it.error}?:return null
 val other=matches.filter{abs(it.shift-best.shift)>2}.minByOrNull{it.error}
 if(best.error>24||other!=null&&other.error<best.error+4)return null
 return (best.shift.toDouble()*screenHeight/h).roundToInt()
}
