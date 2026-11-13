package com.shadow.life

import android.graphics.Bitmap
import kotlin.math.abs
import kotlin.math.roundToInt

internal data class OrderImageSample(val width:Int,val height:Int,val pixels:IntArray)
internal fun orderImageSample(bitmap:Bitmap):OrderImageSample {
 val width=192;val height=(bitmap.height.toDouble()*width/bitmap.width).roundToInt()
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
 // Require moving detail in several parts of the page. An animated badge
 // or a pinned column cannot by itself establish a displacement.
 for(shift in 0..h*55/100){
  val sums=LongArray(6)
  val counts=IntArray(6)
  val rows=bottom-shift-top
  val left=w/10
  val columns=w*9/10-left
  for(y in top until bottom-shift step 2)for(x in left until left+columns step 2){
   val i=(y+shift)*w+x
   val j=y*w+x
   val a=previous.pixels[i];val b=next.pixels[j]
   val edge=abs(a-previous.pixels[i-1])+abs(b-next.pixels[j-1])
   if(edge>18){
    val tile=(y-top)*2/rows*3+(x-left)*3/columns
    sums[tile]+=abs(a-b);counts[tile]++
   }
  }
  val scores=counts.indices.filter{counts[it]>=10}.map{sums[it].toDouble()/counts[it]}.sorted()
  if(scores.size>=3){
   // One moving advertisement may disagree with an otherwise stable overlap.
   val agreeing=if(scores.size>=4)scores.dropLast(1) else scores
   matches+=Match(shift,agreeing.average())
  }
 }
 val best=matches.minByOrNull{it.error}?:return null
 val other=matches.filter{abs(it.shift-best.shift)>2}.minByOrNull{it.error}
 if(best.error>24||other!=null&&other.error<best.error+4)return null
 return (best.shift.toDouble()*screenHeight/h).roundToInt()
}

/** Ignore system bars and isolated changes (clock, scrollbar, animated icon). */
internal fun orderImageStill(a: OrderImageSample, b: OrderImageSample): Boolean {
    if (a.width != b.width || a.height != b.height) return false
    var changed = 0
    var compared = 0
    for (y in a.height / 8 until a.height * 7 / 8) {
        for (x in a.width / 12 until a.width * 11 / 12) {
            val index = y * a.width + x
            if (abs(a.pixels[index] - b.pixels[index]) > 8) changed++
            compared++
        }
    }
    return compared > 0 && changed * 1000 <= compared * 2
}
