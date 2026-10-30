package com.shadow.life

/** Only completed observed intervals; no invented end time or inferred all-day coverage. */
data class AppUsageEvent(val at:Long,val packageName:String,val resumed:Boolean=false,val screenOff:Boolean=false)
data class AppUsageInterval(val packageName:String,val start:Long,val end:Long)
fun appUsageIntervals(events:List<AppUsageEvent>,from:Long,to:Long):List<AppUsageInterval>{
  val open=mutableMapOf<String,Long>();val result=mutableListOf<AppUsageInterval>()
  for(event in events.sortedBy{it.at}){
    if(event.at>to)break
    if(event.screenOff){for((name,start) in open)if(event.at>maxOf(start,from))result+=AppUsageInterval(name,maxOf(start,from),event.at);open.clear()}
    else if(event.resumed)open.putIfAbsent(event.packageName,event.at)
    else {val start=open.remove(event.packageName);if(start!=null&&event.at>maxOf(start,from))result+=AppUsageInterval(event.packageName,maxOf(start,from),event.at)}
  }
  return result.distinct().filter{it.start>=from&&it.end<=to&&it.end-it.start<=86_400_000}
}
