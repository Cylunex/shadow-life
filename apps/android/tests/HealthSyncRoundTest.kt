package com.shadow.life

import java.io.File
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject

private var checks=0
private fun verify(value:Boolean,message:String){checks++;check(value){message}}
private val context=HealthBatchContext("account_test","subject_test","android-hc-device_test","fingerprint_test","device_test","body",1,null)
private fun rescan(generation:String)=JSONObject().put("generation",generation)
  .put("window_start","2026-08-12T00:00:00Z").put("window_end","2026-09-11T00:00:00Z").put("complete",true)
private fun record(id:String)=JSONObject().put("client_record_id",id).put("provider_record_id",id)
  .put("record_version",42L).put("change_kind","upsert")
  .put("payload",JSONObject().put("occurred_on","2026-09-10").put("observations",JSONArray().put(JSONObject().put("metric_key","weight").put("value","65.4").put("unit","kg"))))

// Injected queue/provider boundaries exercise the exact production runner and receipt transition.
private class FakeStore:HealthRoundStore {
  var saved:HealthRoundState?=null
  val commands=mutableMapOf<String,HealthQueuedCommand>()
  var rejectEnqueue=false
  override suspend fun current()=saved
  override suspend fun save(state:HealthRoundState){saved=state}
  override suspend fun enqueue(command:HealthQueuedCommand,state:HealthRoundState){
    if(rejectEnqueue)throw IllegalStateException("transaction rolled back")
    commands.putIfAbsent(command.commandId,command)
    saved=state
  }
  fun receipt(id:String){saved=saved?.confirmed(id)}
  fun restart()=FakeStore().also{it.saved=saved?.copy();it.commands.putAll(commands)}
}

fun main(args:Array<String>)=runBlocking {
  val fixtures=JSONArray()
  val cases=listOf(
    Triple("changes",context.copy(epoch=2,previousCursor="changes_previous"),HealthPage(listOf(record("provider_changes")),"changes_next")),
    Triple("bootstrap",context,HealthPage(listOf(record("provider_bootstrap")),"bootstrap_next",rescan=rescan("hcscan_bootstrap"))),
    Triple("expired_rescan",context.copy(epoch=3,previousCursor="expired_previous"),HealthPage(listOf(record("provider_rescan")),"rescan_next",rescan=rescan("hcscan_expired"))),
    Triple("empty_complete_scan",context.copy(epoch=4,previousCursor="old_empty_cursor"),HealthPage(emptyList(),"empty_next",rescan=rescan("hcscan_empty")))
  )
  for((name,batch,page) in cases){
    val command=healthBatchCommand(batch,page)
    val envelope=JSONObject(command.body);val input=envelope.getJSONObject("input")
    verify(envelope.keySet()==setOf("protocol","capability","command_id","input"),"$name envelope fields")
    verify(envelope.getString("protocol")=="shadow.command"&&envelope.getString("capability")=="health.ingest_batch"&&envelope.getString("command_id")==command.commandId,"$name protocol and identity")
    verify(input.keySet()==setOf("source_type","source_instance_key","source_fingerprint","device_id","record_type","permission_fingerprint","sync_epoch","previous_cursor","next_cursor","parse_version","records")+(if(page.rescan!=null)setOf("rescan") else emptySet()),"$name input fields")
    verify(input.getString("source_type")=="health_connect"&&input.getString("source_instance_key")==batch.instanceKey&&input.getString("device_id")==batch.deviceId&&input.getString("record_type")==batch.recordType,"$name source fields")
    verify(input.getString("source_fingerprint")==batch.fingerprint&&input.getString("permission_fingerprint")==batch.fingerprint&&input.getInt("sync_epoch")==batch.epoch,"$name epoch/fingerprints")
    verify(if(batch.previousCursor==null)input.isNull("previous_cursor")else input.getString("previous_cursor")==batch.previousCursor,"$name previous_cursor")
    verify(input.getString("next_cursor")==page.nextCursor&&input.getString("parse_version")=="health-connect-2","$name next cursor/parser")
    verify(input.getJSONArray("records").similar(JSONArray(page.records)),"$name provider records/versions/payloads")
    verify(if(page.rescan==null)!input.has("rescan") else input.getJSONObject("rescan").similar(page.rescan),"$name rescan belongs inside input")
    verify(healthBatchCommand(batch,page)==command,"$name retry identity and body remain stable")
    verify(healthBatchCommand(batch.copy(subjectId="other_subject"),page).commandId!=command.commandId,"$name account/subject isolation")
    fixtures.put(JSONObject().put("case",name).put("command",envelope))
  }

  // Every type returns no records, a different next token and hasMore=false on EVERY call.
  var store=FakeStore()
  val reads=mutableListOf<String>();val cursors=healthRecordTypes.associateWith{"old_$it"}.toMutableMap()
  suspend fun emptyProvider(type:String):HealthRoundRead {
    reads+=type
    return HealthRoundRead.Page(context.copy(recordType=type,previousCursor=cursors[type]),HealthPage(emptyList(),"next_${reads.size}_$type",hasMore=false))
  }
  repeat(4){index->
    val result=runHealthSyncRound(if(index==0)"round_empty" else null,store,::emptyProvider)
    verify(result==HealthRoundResult.QUEUED&&reads==healthRecordTypes.take(index+1),"empty tokens rotate after each receipt")
    val waiting=store.saved!!;val id=waiting.waitingCommandId!!;val command=store.commands.getValue(id)
    verify(runHealthSyncRound(null,store,::emptyProvider)==HealthRoundResult.WAITING_FOR_RECEIPT&&reads.size==index+1,"no page ahead of receipt")
    store.receipt("unrelated_command")
    verify(store.saved==waiting,"unrelated receipts cannot advance round")
    store=store.restart()
    verify(runHealthSyncRound(null,store,::emptyProvider)==HealthRoundResult.WAITING_FOR_RECEIPT&&store.commands.getValue(id)==command,"process restart reuses queued body and ID")
    cursors[healthRecordTypes[index]]=JSONObject(command.body).getJSONObject("input").getString("next_cursor")
    store.receipt(id);val confirmed=store.saved;store.receipt(id)
    verify(store.saved==confirmed,"replayed receipts advance exactly once")
  }
  verify(store.commands.size==4&&store.saved!!.complete&&!store.saved!!.ready,"four empty types finish finite round without another wake")
  repeat(8){verify(runHealthSyncRound(null,store,::emptyProvider)==HealthRoundResult.COMPLETE,"idle recovery cannot start a round")}
  verify(runHealthSyncRound("round_empty",store,::emptyProvider)==HealthRoundResult.COMPLETE&&reads.size==4,"repeated original Worker cannot restart completed round")
  verify(runHealthSyncRound("round_explicit_next",store,::emptyProvider)==HealthRoundResult.QUEUED&&reads.size==5,"explicit new sync starts next round")

  val initial=FakeStore();val initialTypes=mutableListOf<String>()
  repeat(4){index->
    verify(runHealthSyncRound(if(index==0)"round_initial"else null,initial){type->
      initialTypes+=type
      HealthRoundRead.Page(context.copy(recordType=type,previousCursor=if(type=="body")"old_body"else null),
        HealthPage(emptyList(),"first_$type",rescan=if(type=="body")null else rescan("hcscan_first_$type")))
    }==HealthRoundResult.QUEUED,"advancing empty body cannot starve first bootstrap of remaining types")
    val id=initial.saved!!.waitingCommandId!!
    val input=JSONObject(initial.commands.getValue(id).body).getJSONObject("input")
    verify(input.isNull("previous_cursor")==(index>0)&&input.has("rescan")==(index>0),"first bootstrap carries a null predecessor and complete scan")
    initial.receipt(id)
  }
  verify(initialTypes==healthRecordTypes&&initial.saved!!.complete&&!initial.saved!!.ready,"mixed incremental/bootstrap round stops after four receipts")

  val paged=FakeStore();val pageReads=mutableListOf<String>();var committedCursor="body_zero";var bodyPages=0
  suspend fun pagedProvider(type:String):HealthRoundRead {
    pageReads+=type
    if(type!="body")return HealthRoundRead.Skip
    bodyPages++
    return HealthRoundRead.Page(context.copy(previousCursor=committedCursor),HealthPage(if(bodyPages==1)listOf(record("provider_page"))else emptyList(),"body_$bodyPages",hasMore=bodyPages<3))
  }
  repeat(3){page->
    verify(runHealthSyncRound(if(page==0)"round_paged"else null,paged,::pagedProvider)==HealthRoundResult.QUEUED,"hasMore page queued")
    val state=paged.saved!!;val id=state.waitingCommandId!!;val command=paged.commands.getValue(id)
    verify(JSONObject(command.body).getJSONObject("input").getString("previous_cursor")==committedCursor,"page starts at committed predecessor")
    verify(runHealthSyncRound(null,paged,::pagedProvider)==HealthRoundResult.WAITING_FOR_RECEIPT&&bodyPages==page+1,"hasMore waits for real receipt")
    committedCursor="body_${page+1}";paged.receipt(id)
    verify(paged.saved!!.typeIndex==(if(page<2)0 else 1),"hasMore stays on type, terminal page advances")
  }
  verify(runHealthSyncRound(null,paged,::pagedProvider)==HealthRoundResult.COMPLETE&&pageReads==listOf("body","body","body","steps_interval","sleep","workout"),"pagination completes before fair type rotation")
  verify(paged.commands.keys.size==3,"each page has a distinct stable command")

  val recovery=FakeStore();recovery.saved=HealthRoundState("round_expiry",typeIndex=2)
  val reset=HealthQueuedCommand("cmd_reset_test","health.set_source_state","{}")
  verify(runHealthSyncRound(null,recovery){HealthRoundRead.Reset(reset)}==HealthRoundResult.QUEUED,"expired token first queues source reset")
  verify(recovery.saved!!.typeIndex==2,"reset must wait for receipt")
  recovery.receipt(reset.commandId)
  verify(recovery.saved!!.typeIndex==0,"source reset rescans earlier types as well")
  val rescanTypes=mutableListOf<String>()
  repeat(4){index->
    verify(runHealthSyncRound(null,recovery){type->rescanTypes+=type;HealthRoundRead.Page(context.copy(recordType=type,epoch=3,previousCursor="expired_$type"),HealthPage(emptyList(),"reset_$type",rescan=rescan("hcscan_$type")))}==HealthRoundResult.QUEUED,"empty rescan must be enqueued")
    val id=recovery.saved!!.waitingCommandId!!
    val input=JSONObject(recovery.commands.getValue(id).body).getJSONObject("input")
    verify(input.getJSONObject("rescan").getBoolean("complete")&&input.getInt("sync_epoch")==3,"rescan round carries complete window and epoch")
    recovery.receipt(id)
    verify(recovery.saved!!.typeIndex==index+1,"rescan receipt advances")
  }
  verify(rescanTypes==healthRecordTypes&&recovery.saved!!.complete,"expired token completes all four rescans")

  val failed=FakeStore();failed.rejectEnqueue=true
  var rejected=false
  try{runHealthSyncRound("round_rollback",failed,::emptyProvider)}catch(_:IllegalStateException){rejected=true}
  verify(rejected&&failed.saved!!.ready&&failed.commands.isEmpty(),"failed atomic enqueue leaves round retryable")
  failed.rejectEnqueue=false
  verify(runHealthSyncRound(null,failed,::emptyProvider)==HealthRoundResult.QUEUED,"restart retries page after rollback")
  val stationary=FakeStore();var noProgress=false
  try{runHealthSyncRound("round_stationary",stationary){HealthRoundRead.Page(context.copy(previousCursor="same"),HealthPage(emptyList(),"same",hasMore=true))}}catch(_:IllegalStateException){noProgress=true}
  verify(noProgress&&stationary.commands.isEmpty(),"hasMore cannot silently complete or spin on an unchanged cursor")

  File(args[0]).writeText(JSONObject().put("fixtures",fixtures).put("migration_sql",HEALTH_ROUND_TABLE_SQL).toString())
  println("HealthSyncRound: $checks production builder, receipt, rotation, pagination and restart assertions passed")
}
