package com.shadow.life

/** Presentation of server calendar-day decisions; the phone never reinterprets a deadline. */
internal fun deadlineLabel(state:String?,days:Long?):String = when(state){
  "past" -> days?.let{"已过期 ${-it} 天"}?:"已过期"
  "today" -> "今天到期"
  "soon","later" -> days?.let{"剩余 $it 天"}?:"日期已记录"
  "empty" -> "已用完"
  "inactive" -> "当前不持有"
  "unknown" -> "未记录日期"
  else -> "期限状态未载入"
}
internal fun stockMatches(filter:String,state:String?):Boolean = when(filter){
  "soon" -> state in setOf("today","soon")
  "past","unknown","empty" -> state==filter
  else -> true
}
internal fun visibleOwnedItems(items:List<OwnedItemSummary>,query:String,filter:String):List<OwnedItemSummary> {
  val words=query.trim().split(Regex("\\s+")).filter(String::isNotBlank)
  return items.filter{item->
    val text=listOfNotNull(item.name,item.location,item.locationPath?.joinToString(" ")).joinToString(" ")
    words.all{text.contains(it,ignoreCase=true)} && when(filter){
      "owned" -> item.state=="owned"
      "return" -> item.attention?.returnWindow?.state?.wireValue in setOf("today","soon")
      "warranty" -> item.attention?.warranty?.state?.wireValue in setOf("today","soon")
      "past" -> item.attention?.let{it.returnWindow.state.wireValue=="past"||it.warranty.state.wireValue=="past"}==true
      else -> true
    }
  }
}
