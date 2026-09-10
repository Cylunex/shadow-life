package com.shadow.app
import java.time.Instant
import java.time.ZoneId

private var assertions=0
private fun verify(value:Boolean){assertions++;check(value)}
private fun rejects(block:()->Unit){var failed=false;try{block()}catch(_:Exception){failed=true};verify(failed)}
fun main(){
  val start=Instant.parse("2026-09-10T15:50:00Z"); val end=Instant.parse("2026-09-10T16:10:00Z")
  val steps=HealthSyncPolicy.steps(start,end,"example.provider",100,ZoneId.of("Asia/Shanghai"))
  verify(steps.date=="2026-09-10" && steps.start==start.toString() && steps.end==end.toString() && steps.count==100L && steps.origin=="example.provider")
  rejects{HealthSyncPolicy.steps(end,start,"example.provider",100,ZoneId.of("UTC"))}
  verify(HealthSyncPolicy.epoch(null,true,false)==1)
  verify(HealthSyncPolicy.epoch(2,true,false)==2) // multiple rescan types keep one source generation
  verify(HealthSyncPolicy.epoch(2,false,false)==3)
  verify(HealthSyncPolicy.epoch(2,true,true)==3)
  val scan=CompleteHealthScan<Int>(start,end,3)
  scan.page(listOf(1),true);rejects{scan.complete(true)} // interrupted/page failure cannot claim completion
  scan.page(listOf(2,3),false);verify(scan.complete(true)==listOf(1,2,3))
  rejects{scan.complete(false)} // permission change discards complete read before enqueue
  val oversized=CompleteHealthScan<Int>(start,end,1);rejects{oversized.page(listOf(1,2),false)};rejects{oversized.complete(true)}
  val empty=CompleteHealthScan<Int>(start,end);empty.page(emptyList(),false);verify(empty.complete(true).isEmpty())
  val restarted=CompleteHealthScan<Int>(start,end);rejects{restarted.complete(true)}
  println("HealthSyncPolicy: $assertions encoding, epoch, paging, permission and restart assertions passed")
}
