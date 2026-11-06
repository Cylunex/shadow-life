package com.shadow.life

import kotlin.math.abs
import org.json.JSONArray
import org.json.JSONObject

internal val takeoutPackages=mapOf("me.ele" to "eleme","me.ele.mall" to "eleme","com.taobao.taobao" to "eleme","com.sankuai.meituan" to "meituan","com.sankuai.meituan.takeoutnew" to "meituan")
internal data class OrderTextBox(val x:Int,val y:Int,val width:Int,val height:Int,val text:String){val bottom get()=y+height}
internal fun takeoutText(boxes:List<OrderTextBox>)=boxes.sortedWith(compareBy<OrderTextBox>{it.y}.thenBy{it.x}).joinToString("\n"){it.text}
internal fun isTakeoutPage(boxes:List<OrderTextBox>):Boolean {
 val text=takeoutText(boxes).replace(" ","").replace("支付万式","支付方式")
 return (text.contains("订单已送到指定位置")||text.contains("订单已完成")||text.contains("订单详情")||text.contains("已送达"))&&
  (text.contains("闪购")||text.contains("蜂鸟")||text.contains("美团")||text.contains("配送"))
}
internal fun takeoutEnded(boxes:List<OrderTextBox>):Boolean {
 val text=takeoutText(boxes).replace(" ","").replace("支付万式","支付方式")
 return (text.contains("订单号")||text.contains("订单编号"))&&text.contains("下单时间")&&text.contains("支付方式")&&
  (text.contains("安心权益")||text.contains("常见问题")||text.contains("订单信息"))
}
/** Align by independent text anchors, not global string deduplication. Fixed toolbars have zero shift. */
internal fun takeoutScrollOffset(previous:List<OrderTextBox>,next:List<OrderTextBox>,screenHeight:Int):Int? {
 val candidates=previous.flatMap { a->if(a.text.length<3||Regex("^[\\d\\s¥￥.×x]+$").matches(a.text))emptyList() else next.filter{it.text==a.text&&abs(it.x-a.x)<20}.map{a to (a.y-it.y)} }
  .filter{it.second in (screenHeight/6)..(screenHeight*4/5)}
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
internal fun captureReadableText(text:String):String=if(text.startsWith("life.takeout.v1\n"))runCatching{val blocks=JSONObject(text.substringAfter('\n')).getJSONArray("blocks");(0 until blocks.length()).joinToString("\n"){blocks.getJSONArray(it).getString(4)}}.getOrDefault("订单材料") else text
