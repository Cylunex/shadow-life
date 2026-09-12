package com.shadow.life

/** Account-bound local continuation only; no health payload or opaque provider cursor is stored here. */
data class HealthRoundState(
  val requestId:String,
  val typeIndex:Int=0,
  val waitingCommandId:String?=null,
  val afterReceiptType:Int=0
) {
  val complete:Boolean get()=typeIndex>=HEALTH_SYNC_TYPE_COUNT
  val ready:Boolean get()=!complete&&waitingCommandId==null
  fun confirmed(commandId:String):HealthRoundState=if(waitingCommandId==commandId)copy(typeIndex=afterReceiptType,waitingCommandId=null)else this

  private companion object { const val HEALTH_SYNC_TYPE_COUNT=4 }
}
