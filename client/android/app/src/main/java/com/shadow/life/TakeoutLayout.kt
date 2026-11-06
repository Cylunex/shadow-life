package com.shadow.life

import kotlin.math.abs
import org.json.JSONArray
import org.json.JSONObject
import kotlinx.serialization.json.*

internal val takeoutPackages=mapOf("me.ele" to "eleme","me.ele.mall" to "eleme","com.taobao.taobao" to "eleme","com.sankuai.meituan" to "meituan","com.sankuai.meituan.takeoutnew" to "meituan")
// General shopping apps still need visible takeout evidence.
internal val dedicatedTakeoutPackages=setOf("me.ele","me.ele.mall","com.sankuai.meituan.takeoutnew")
internal data class OrderTextBox(val x:Int,val y:Int,val width:Int,val height:Int,val text:String){val bottom get()=y+height}
internal fun takeoutText(boxes:List<OrderTextBox>)=boxes.sortedWith(compareBy<OrderTextBox>{it.y}.thenBy{it.x}).joinToString("\n"){it.text}
internal fun isTakeoutPage(boxes:List<OrderTextBox>,knownTakeoutApp:Boolean=false)=isTakeoutDetailText(takeoutText(boxes),knownTakeoutApp)
/** Classification only: node text may supplement OCR, but never supplies product positions. */
internal fun isTakeoutDetailText(raw:String,knownTakeoutApp:Boolean=false):Boolean {
 val lines=raw.lineSequence().map{it.replace(Regex("\\s+"),"")}.filter{it.isNotEmpty()}.toList()
 if(lines.any{it in setOf("我的订单","全部订单","订单列表","搜索订单")})return false
 val text=lines.joinToString("").replace("支付万式","支付方式")
 val platform=knownTakeoutApp||listOf("闪购","饿了么","蜂鸟","美团").any(text::contains)
 if(!platform)return false
 val orderNumber=Regex("订单(?:号|编号)[:：]?\\d{8,40}").containsMatchIn(text)
 val footer=listOf("下单时间","支付方式","订单信息","收货信息").count(text::contains)
 if(orderNumber&&footer>=2)return true
 val quantities=Regex("[×xX*]\\d{1,3}(?!\\d)").findAll(text).count()
 val money=Regex("(?:[¥￥]|实付[:：]?)\\d").containsMatchIn(text)
 val fees=listOf("打包费","包装费","配送费","配迭费").any(text::contains)
 if(text.contains("价格明细")&&fees&&money)return true
 val detailHeading=listOf("订单详情","订单已完成","订单已送到","订单已送达","已送达","已完成配送","订单配送中","骑手正在配送","商家正在备餐","订单已取消").any(text::contains)
 return detailHeading&&money&&(quantities>0||fees||orderNumber)
}
internal fun takeoutEnded(boxes:List<OrderTextBox>):Boolean {
 val text=takeoutText(boxes).replace(" ","").replace("支付万式","支付方式")
 return (text.contains("订单号")||text.contains("订单编号"))&&text.contains("下单时间")&&text.contains("支付方式")&&
  (text.contains("安心权益")||text.contains("常见问题")||text.contains("订单信息"))
}
/** Finger moves upward so the next, lower section of the order becomes visible. */
internal fun takeoutForwardSwipeY(height:Int)=height*.78f to height*.42f
/** Compare stable body anchors; status-bar time and OCR ordering are not scroll progress. */
internal fun takeoutViewportUnchanged(previous:List<OrderTextBox>,next:List<OrderTextBox>,screenHeight:Int):Boolean {
 fun anchors(boxes:List<OrderTextBox>)=boxes.filter{it.y in (screenHeight*15/100)..(screenHeight*86/100)}
  .map{it.copy(text=it.text.replace(Regex("\\s+"),""))}
  .filter{it.text.length>=3&&!Regex("^[\\d¥￥.×xX*]+$").matches(it.text)}
 val before=anchors(previous);val after=anchors(next)
 val matched=before.filter{a->after.any{b->a.text==b.text&&abs(a.x-b.x)<=20&&abs(a.y-b.y)<=12}}.map{it.text}.distinct().size
 val total=maxOf(before.map{it.text}.distinct().size,after.map{it.text}.distinct().size)
 return matched>=3&&matched.toDouble()/total>=.75
}
/** Align by independent text anchors, not global string deduplication. Fixed toolbars have zero shift. */
internal fun takeoutScrollOffset(previous:List<OrderTextBox>,next:List<OrderTextBox>,screenHeight:Int):Int? {
 val candidates=previous.flatMap { a->if(a.text.length<3||Regex("^[\\d\\s¥￥.×x]+$").matches(a.text))emptyList() else next.filter{it.text==a.text&&abs(it.x-a.x)<20}.map{a to (a.y-it.y)} }
  .filter{it.second in 24..(screenHeight*4/5)}
 val best=candidates.maxByOrNull{candidate->candidates.count{abs(it.second-candidate.second)<=12}}?:return null
 val votes=candidates.filter{abs(it.second-best.second)<=12}
 if(votes.map{it.first.text}.distinct().size<2)return null
 return votes.map{it.second}.sorted()[votes.size/2]
}
internal fun mergeTakeoutBoxes(old:List<OrderTextBox>,next:List<OrderTextBox>,offset:Int,previousOffset:Int,screenHeight:Int):List<OrderTextBox>{
 val cut=(offset+previousOffset+screenHeight)/2
 return old.filter{it.y+it.height/2<cut}+next.map{it.copy(y=it.y+offset)}.filter{it.y+it.height/2>=cut}
}
internal fun takeoutEnvelope(platform:String,width:Int,height:Int,boxes:List<OrderTextBox>,complete:Boolean):String{
 val blocks=JSONArray();boxes.forEach{blocks.put(JSONArray().put(it.x).put(it.y).put(it.width).put(it.height).put(it.text))}
 val text="life.takeout.v1\n"+JSONObject().put("platform",platform).put("width",width).put("height",height).put("complete",complete).put("blocks",blocks)
 check(text.length<=12000&&boxes.size<=500){"订单内容过长，请分次分享订单截图"};return text
}
internal fun captureReadableText(text:String):String=if(text.startsWith("life.takeout.v1\n"))runCatching{Json.parseToJsonElement(text.substringAfter('\n')).jsonObject.getValue("blocks").jsonArray.sortedWith(compareBy({it.jsonArray[1].jsonPrimitive.int},{it.jsonArray[0].jsonPrimitive.int})).joinToString("\n"){it.jsonArray[4].jsonPrimitive.content}}.getOrDefault("订单材料") else text
