package com.shadow.app

import java.time.Instant
import java.time.ZoneId

// Pure protocol decisions are shared by Android encoding and JVM regression checks.
object HealthSyncPolicy {
  data class Steps(val date:String,val zone:String,val start:String,val end:String,val origin:String,val count:Long)
  fun steps(start:Instant,end:Instant,origin:String,count:Long,zone:ZoneId):Steps {
    require(end>start && count>=0 && origin.isNotBlank())
    return Steps(start.atZone(zone).toLocalDate().toString(),zone.id,start.toString(),end.toString(),origin,count)
  }
  fun epoch(current:Int?,sameFingerprint:Boolean,revoked:Boolean)=when {
    current==null -> 1
    !sameFingerprint || revoked -> current+1
    else -> current
  }
}

class CompleteHealthScan<T>(val start:Instant,val end:Instant,private val maximum:Int=1_000) {
  private val records=mutableListOf<T>()
  private var terminal=false
  init { require(end>start) }
  fun page(values:List<T>,hasMore:Boolean){
    check(!terminal)
    if(records.size+values.size>maximum)throw HealthScanTooLargeException()
    records.addAll(values);terminal=!hasMore
  }
  fun complete(permissionUnchanged:Boolean):List<T>{
    if(!permissionUnchanged)throw SecurityException("Health Connect permission changed during scan")
    check(terminal) { "Health Connect scan has unread pages" }
    return records.toList()
  }
}
class HealthScanTooLargeException:IllegalStateException("Health Connect bootstrap exceeded one safe batch")
