package com.shadow.life

/** Ambiguous overlap keeps the originals; it never ends the user's session. */
internal class OrderImageProgress(private val width:Int,private val screenHeight:Int) {
 var pages=1;private set
 var height=screenHeight;private set
 var separateImages=false;private set
 val canReadNext get()=pages<12
 fun add(delta:Int?):Boolean {
  if(!canReadNext||delta!=null&&delta<16)return false
  if(delta==null||height+delta>18000||width.toLong()*(height+delta)>24_000_000)separateImages=true
  if(!separateImages)height+=checkNotNull(delta)
  pages++
  return true
 }
}
