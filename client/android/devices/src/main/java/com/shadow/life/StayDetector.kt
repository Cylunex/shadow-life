package com.shadow.life
import kotlin.math.*
data class StaySample(val at:Long,val latitude:Double,val longitude:Double,val accuracy:Double)
data class CapturedStay(val sourceId:String,val start:StaySample,val last:StaySample,val samples:Int)
class StayDetector(private val newId:()->String={"stay_${java.util.UUID.randomUUID().toString().replace("-","")}"}) {
 var current:CapturedStay?=null
 fun restore(stay:CapturedStay){current=stay}
 fun finish():CapturedStay? {val value=current;current=null;return value?.takeIf{it.samples>=3&&it.last.at-it.start.at>=300_000}}
 fun accept(sample:StaySample):CapturedStay?{
  if(!sample.accuracy.isFinite()||sample.accuracy !in 0.0..100.0||sample.latitude !in -90.0..90.0||sample.longitude !in -180.0..180.0)return null
  val old=current
  if(old==null){current=CapturedStay(newId(),sample,sample,1);return null}
  if(sample.at<=old.last.at)return null
  if(sample.at-old.last.at>300_000||distance(old.start,sample)>100){val result=finish();current=CapturedStay(newId(),sample,sample,1);return result}
  current=old.copy(last=sample,samples=old.samples+1)
  if(sample.at-old.start.at>=1_800_000){val result=finish();current=CapturedStay(newId(),sample,sample,1);return result}
  return null
 }
 private fun distance(a:StaySample,b:StaySample):Double {val lat=Math.toRadians(b.latitude-a.latitude);val lon=Math.toRadians(b.longitude-a.longitude);val h=sin(lat/2).pow(2)+cos(Math.toRadians(a.latitude))*cos(Math.toRadians(b.latitude))*sin(lon/2).pow(2);return 6371000*2*asin(sqrt(h.coerceIn(0.0,1.0)))}
}
