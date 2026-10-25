package com.shadow.life

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

data class HealthPage(
  val records:List<JSONObject>,val nextCursor:String,val expired:Boolean=false,
  val rescan:JSONObject?=null,val hasMore:Boolean=false
)

data class HealthBatchContext(
  val accountId:String,val subjectId:String,val instanceKey:String,val fingerprint:String,
  val deviceId:String,val recordType:String,val epoch:Int,val previousCursor:String?
)

data class HealthQueuedCommand(val commandId:String,val capability:String,val body:String)

fun healthDeviceRecordCommand(
  accountId:String,subjectId:String,sourceType:String,instanceKey:String,fingerprint:String,
  recordType:String,clientRecordId:String,recordVersion:Long,payload:JSONObject,parseVersion:String
):HealthQueuedCommand {
  require(sourceType in setOf("scale","samsung"))
  require(recordVersion in 0..9_007_199_254_740_991L)
  val input=JSONObject().put("source_type",sourceType).put("source_instance_key",instanceKey)
    .put("source_fingerprint",fingerprint).put("record_type",recordType)
    .put("client_record_id",clientRecordId).put("provider_record_id",clientRecordId)
    .put("record_version",recordVersion).put("sync_epoch",1).put("change_kind","upsert")
    .put("payload",payload).put("parse_version",parseVersion)
  val identity=JSONArray(listOf(accountId,subjectId,sourceType,instanceKey,recordType,clientRecordId,recordVersion)).toString()
  val commandId="cmd_${sourceType}_${MessageDigest.getInstance("SHA-256").digest(identity.toByteArray()).joinToString(""){"%02x".format(it)}.take(32)}"
  val capability="health.ingest_raw"
  return HealthQueuedCommand(commandId,capability,JSONObject().put("protocol","shadow.command").put("capability",capability).put("command_id",commandId).put("input",input).toString())
}

// This is the request builder used by the Android Worker and the JVM contract checks.
fun healthBatchCommand(context:HealthBatchContext,page:HealthPage):HealthQueuedCommand {
  require(!page.expired)
  val input=JSONObject()
    .put("source_type","health_connect").put("source_instance_key",context.instanceKey)
    .put("source_fingerprint",context.fingerprint).put("device_id",context.deviceId)
    .put("record_type",context.recordType).put("permission_fingerprint",context.fingerprint)
    .put("sync_epoch",context.epoch).put("previous_cursor",context.previousCursor?:JSONObject.NULL)
    .put("next_cursor",page.nextCursor).put("parse_version","health-connect-2")
    .put("records",JSONArray(page.records))
  page.rescan?.let{input.put("rescan",it)}
  // JSON array framing prevents ambiguous identities; the encrypted queue keeps the exact body on retry.
  val identity=JSONArray(listOf(context.accountId,context.subjectId,context.deviceId,context.instanceKey,
    context.recordType,context.epoch,context.previousCursor?:JSONObject.NULL,page.nextCursor)).toString()
  val commandId="cmd_hc_${MessageDigest.getInstance("SHA-256").digest(identity.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it)}.take(32)}"
  val capability="health.ingest_batch"
  val body=JSONObject().put("protocol","shadow.command").put("capability",capability)
    .put("command_id",commandId).put("input",input).toString()
  return HealthQueuedCommand(commandId,capability,body)
}
