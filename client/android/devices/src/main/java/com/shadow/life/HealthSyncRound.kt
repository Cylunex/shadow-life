package com.shadow.life

val healthRecordTypes=listOf("body","steps_interval","sleep","workout")
const val HEALTH_ROUND_TABLE_SQL="CREATE TABLE IF NOT EXISTS health_sync_rounds (accountId TEXT NOT NULL, subjectId TEXT NOT NULL, requestId TEXT NOT NULL, typeIndex INTEGER NOT NULL, waitingCommandId TEXT, afterReceiptType INTEGER NOT NULL, PRIMARY KEY(accountId,subjectId))"

interface HealthRoundStore {
  suspend fun current():HealthRoundState?
  suspend fun save(state:HealthRoundState)
  // Implementations atomically persist both the encrypted command and its receipt continuation.
  suspend fun enqueue(command:HealthQueuedCommand,state:HealthRoundState)
}

sealed interface HealthRoundRead {
  data object Skip:HealthRoundRead
  data class Page(val context:HealthBatchContext,val page:HealthPage):HealthRoundRead
  data class Reset(val command:HealthQueuedCommand):HealthRoundRead
}

enum class HealthRoundResult { QUEUED,WAITING_FOR_RECEIPT,COMPLETE }

// requestId is present only on an explicit sync. Receipt/recovery wakes never start another round.
suspend fun prepareHealthSyncRound(requestId:String?,store:HealthRoundStore):HealthRoundState? {
  val previous=store.current()
  return if(previous==null||previous.complete){
    if(requestId==null||requestId==previous?.requestId)return null
    HealthRoundState(requestId).also{store.save(it)}
  }else previous
}

suspend fun runHealthSyncRound(
  requestId:String?,store:HealthRoundStore,read:suspend (String)->HealthRoundRead
):HealthRoundResult {
  var state=prepareHealthSyncRound(requestId,store)?:return HealthRoundResult.COMPLETE
  if(state.waitingCommandId!=null)return HealthRoundResult.WAITING_FOR_RECEIPT
  while(!state.complete){
    when(val response=read(healthRecordTypes[state.typeIndex])){
      HealthRoundRead.Skip->{state=state.copy(typeIndex=state.typeIndex+1);store.save(state)}
      is HealthRoundRead.Reset->{
        // Source epoch reset invalidates earlier types too; rescan the complete type set after receipt.
        store.enqueue(response.command,state.copy(waitingCommandId=response.command.commandId,afterReceiptType=0))
        return HealthRoundResult.QUEUED
      }
      is HealthRoundRead.Page->{
        val page=response.page
        check(!page.expired)
        check(!page.hasMore||page.nextCursor!=response.context.previousCursor){"Health Connect pagination did not advance"}
        if(page.rescan==null&&page.records.isEmpty()&&page.nextCursor==response.context.previousCursor){
          state=state.copy(typeIndex=state.typeIndex+1);store.save(state)
        }else{
          val command=healthBatchCommand(response.context,page)
          val next=if(page.hasMore)state.typeIndex else state.typeIndex+1
          store.enqueue(command,state.copy(waitingCommandId=command.commandId,afterReceiptType=next))
          return HealthRoundResult.QUEUED
        }
      }
    }
  }
  return HealthRoundResult.COMPLETE
}
