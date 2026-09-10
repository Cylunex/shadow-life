package com.shadow.app

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
