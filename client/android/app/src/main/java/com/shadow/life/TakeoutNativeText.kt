package com.shadow.life

import android.graphics.Rect
import android.os.Build
import android.view.accessibility.AccessibilityNodeInfo
import kotlin.math.abs

internal interface TakeoutTextNode:CaptureTextNode {
 val bounds:OrderTextBox
 override fun child(index:Int):TakeoutTextNode?
}

/** Keep leaf text and coordinates, including repeated quantities and prices. */
internal fun readTakeoutNodeBoxes(root:TakeoutTextNode,width:Int,height:Int):List<OrderTextBox>? {
 val result=mutableListOf<OrderTextBox>();var visited=0;var length=0
 fun visit(node:TakeoutTextNode,depth:Int):Boolean {
  try{
   check(++visited<=600&&depth<=64&&node.childCount<=100)
   check(!node.secret&&!(node.visible&&node.editable))
   var descendants=false
   for(i in 0 until node.childCount){val child=node.child(i)?:error("Incomplete accessibility tree");if(visit(child,depth+1))descendants=true}
   if(!node.visible)return descendants
   val text=(node.text?.trim()?.takeIf{it.isNotEmpty()}?:node.description?.trim()).orEmpty()
   length+=text.length;check(text.length<=2048&&length<=12000)
   if(text.isEmpty())return descendants
   if(!descendants){
    val b=node.bounds;val x=b.x.coerceAtLeast(0);val y=b.y.coerceAtLeast(0)
    val right=(b.x+b.width).coerceAtMost(width);val bottom=b.bottom.coerceAtMost(height)
    // A whole card's description has no reliable per-line geometry: OCR handles it.
    if(text.length<=300&&!text.contains('\n')&&right>x&&bottom>y&&b.height<=height*.12)
     result+=OrderTextBox(x,y,right-x,bottom-y,text)
   }
   return true
  }finally{node.release()}
 }
 return try{visit(root,0);joinTakeoutNumericRuns(result)}catch(_:Exception){null}
}

internal fun readTakeoutNodeBoxes(root:AccessibilityNodeInfo,width:Int,height:Int)=readTakeoutNodeBoxes(AndroidTakeoutNode(root),width,height)
private class AndroidTakeoutNode(private val node:AccessibilityNodeInfo):TakeoutTextNode {
 override val visible get()=node.isVisibleToUser
 override val editable get()=node.isEditable
 override val secret get()=node.isPassword||(Build.VERSION.SDK_INT>=34&&node.isAccessibilityDataSensitive)
 override val text get()=node.text?.toString()
 override val description get()=node.contentDescription?.toString()
 override val childCount get()=node.childCount
 override val bounds get()=Rect().also(node::getBoundsInScreen).let{OrderTextBox(it.left,it.top,it.width(),it.height(),"")}
 override fun child(index:Int)=node.getChild(index)?.let(::AndroidTakeoutNode)
 override fun release(){node.recycle()}
}

/** WebViews sometimes expose currency, integer/fraction and quantity as separate nodes. */
internal fun joinTakeoutNumericRuns(input:List<OrderTextBox>):List<OrderTextBox> {
 val result=input.sortedWith(compareBy<OrderTextBox>{it.y}.thenBy{it.x}).toMutableList()
 for(prefix in result.toList()){
  if(prefix !in result)continue
  if(prefix.text.trim() !in setOf("实付","¥","￥","×","x","X","*"))continue
  var current=prefix;val parts=mutableListOf(prefix)
  repeat(4){
   val next=result.filter{it !in parts&&it.x>=current.x+current.width-2&&it.x-current.x-current.width<=maxOf(16,current.height)&&abs(it.y+it.height/2-prefix.y-prefix.height/2)<maxOf(it.height,prefix.height)*.45}
    .minByOrNull{it.x}
   if(next!=null&&Regex("^(?:[¥￥]|\\d{1,8}(?:[.,]\\d{1,2})?|[.,]\\d{1,2})$").matches(next.text.trim())){parts+=next;current=next}
  }
  val text=parts.joinToString(""){it.text.trim()}
  if(parts.size>1&&Regex("^(?:(?:实付)?[¥￥]\\d{1,8}(?:[.,]\\d{1,2})?|实付\\d{1,8}(?:[.,]\\d{1,2})?|[×xX*]\\d{1,3})$").matches(text)){
   val left=parts.minOf{it.x};val top=parts.minOf{it.y}
   result.removeAll(parts.toSet());result+=OrderTextBox(left,top,parts.maxOf{it.x+it.width}-left,parts.maxOf{it.bottom}-top,text)
  }
 }
 return result
}

internal data class TakeoutTextMerge(val boxes:List<OrderTextBox>,val nativeUsed:Int)
/** Prefer localized native text; retain OCR where nodes are absent or spatially ambiguous. */
internal fun mergeTakeoutText(ocr:List<OrderTextBox>,native:List<OrderTextBox>):TakeoutTextMerge {
 val result=ocr.toMutableList();var used=0
 for(n in native){
  val matches=result.indices.filter{i->val o=result[i]
   val intersection=(minOf(n.x+n.width,o.x+o.width)-maxOf(n.x,o.x)).coerceAtLeast(0).toLong()*(minOf(n.bottom,o.bottom)-maxOf(n.y,o.y)).coerceAtLeast(0)
   val area=minOf(n.width.toLong()*n.height,o.width.toLong()*o.height)
   area>0&&intersection.toDouble()/area>=.65&&abs(n.y+n.height/2-o.y-o.height/2)<=maxOf(n.height,o.height)*.6
  }
  if(matches.isEmpty()){result+=n;used++;continue}
  if(matches.size!=1)continue
  val index=matches.single();val old=result[index];var text=n.text.trim()
  val scalar=Regex("^(?:实付\\s*)?[¥￥]\\s*\\d+(?:[.,]\\d{1,2})?$|^[×xX*]\\s*\\d{1,3}$").matches(old.text.trim())
  if(n.width<old.width*.65&&!scalar)continue
  if(scalar&&!text.any(Char::isDigit))continue
  if(Regex("^\\d{1,8}(?:[.,]\\d{1,2})?$").matches(text)){
   val prefix=Regex("^(实付\\s*[¥￥]?|[¥￥]|[×xX*])\\s*\\d").find(old.text)?.groupValues?.get(1)
   if(prefix!=null)text=prefix+text
  }
  // Preserve the OCR line's tight glyph rectangle for downstream row alignment.
  result[index]=old.copy(text=text);used++
 }
 return TakeoutTextMerge(result,used)
}
