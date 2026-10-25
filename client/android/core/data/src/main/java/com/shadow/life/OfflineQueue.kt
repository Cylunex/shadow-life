package com.shadow.life

import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import org.json.JSONObject

class OfflineQueue(private val database:ShadowDatabase,private val crypto:QueueCrypto=QueueCrypto()) {
  private val receiptCache=linkedMapOf<String,CachedReceipt>()
  fun observeStatus(session:ProductSession):Flow<QueueSummary> {
    val status=database.commands().observeStatus(session.accountId,session.subjectId).distinctUntilChanged()
    val receipts=database.commands().observeRecentCommitted(session.accountId,session.subjectId,RECENT_RECEIPT_LIMIT).distinctUntilChanged().map(::verifiedReceipts)
    return combine(status,receipts){queue,committedReceipts->
    QueueSummary(
    waiting=queue.waiting,reconciling=queue.reconciling,failed=queue.failed,completed=queue.completed,
    attachments=queue.attachments,
    latestScaleState=queue.latestScaleState?.let(::sourceState),latestScaleAt=queue.latestScaleAt,
    latestSamsungState=queue.latestSamsungState?.let(::sourceState),latestSamsungAt=queue.latestSamsungAt,
    committedReceipts=committedReceipts
  )}.distinctUntilChanged().flowOn(Dispatchers.IO)
  }
  suspend fun enqueueCommand(session:ProductSession,commandId:String,capability:String,plainBody:String):Long{
    val encrypted=crypto.encryptCommand(session.accountId,session.subjectId,commandId,plainBody)
    return database.commands().enqueue(PendingCommand(commandId,session.accountId,session.subjectId,capability,encrypted,encryptionVersion=1))
  }

  suspend fun enqueueAttachment(session:ProductSession,id:String,commandId:String,mediaType:String,capturedOn:String,displayName:String,input:InputStream,file:File):Long{
    if(database.commands().attachment(id)!=null)return 0
    file.parentFile?.mkdirs()
    val temporary=File(file.parentFile,"${file.name}.encrypting")
    var moved=false
    try{
      crypto.encryptAttachment(session.accountId,session.subjectId,id,input,temporary.outputStream())
      Files.move(temporary.toPath(),file.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING)
      moved=true
      val inserted=database.commands().enqueueAttachment(PendingAttachment(id,session.accountId,session.subjectId,commandId,file.absolutePath,mediaType,encryptionVersion=1,capturedOn=capturedOn,displayName=displayName.take(300)))
      if(inserted<0)file.delete()
      return inserted
    }catch(error:Throwable){
      temporary.delete()
      if(moved)file.delete()
      throw error
    }
  }

  fun commandBody(command:PendingCommand)=crypto.decryptCommand(command)
  fun receiptBody(command:PendingCommand)=crypto.decryptReceipt(command)
  fun copyAttachment(attachment:PendingAttachment,input:InputStream,output:OutputStream)=crypto.decryptAttachment(attachment,input,output)
  suspend fun commit(command:PendingCommand,plainReceipt:String)=database.commands().commitWithHealthRound(command,crypto.encryptReceipt(command,plainReceipt))

  suspend fun retry(session:ProductSession):Int=database.commands().retryCommands(session.accountId,session.subjectId)+database.commands().retryAttachments(session.accountId,session.subjectId)

  suspend fun clearTerminal(session:ProductSession):Int{
    val dao=database.commands()
    val attachments=dao.terminalAttachments(session.accountId,session.subjectId)
    var cleared=dao.clearTerminalCommands(session.accountId,session.subjectId)
    for(attachment in attachments){
      val file=File(attachment.localPath)
      if((!file.exists()||file.delete()))cleared+=dao.clearTerminalAttachment(attachment.id)
    }
    return cleared
  }

  suspend fun secureLegacy(session:ProductSession):Int{
    var secured=0
    for(command in database.commands().legacyCommands(session.accountId,session.subjectId))try{val body=if(crypto.isEncryptedCommand(command.body))command.body else crypto.encryptCommand(session.accountId,session.subjectId,command.commandId,command.body);database.commands().secureCommand(command.commandId,body);secured++}catch(_:QueueKeyUnavailableException){database.commands().mark(command.commandId,"blocked")}
    for(attachment in database.commands().legacyAttachments(session.accountId,session.subjectId)){
      val file=File(attachment.localPath)
      val temporary=File(file.parentFile,"${file.name}.encrypting")
      try{
        if(!file.isFile){database.commands().markAttachment(attachment.id,"failed");continue}
        if(!crypto.isEncryptedAttachment(file)){
          file.inputStream().use{input->crypto.encryptAttachment(session.accountId,session.subjectId,attachment.id,input,temporary.outputStream())}
          Files.move(temporary.toPath(),file.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING)
        }
        database.commands().secureAttachment(attachment.id)
        secured++
      }catch(error:CancellationException){
        temporary.delete()
        throw error
      }catch(_:QueueKeyUnavailableException){
        temporary.delete()
        database.commands().markAttachment(attachment.id,"blocked")
      }catch(_:Exception){
        temporary.delete()
        database.commands().markAttachment(attachment.id,"failed")
      }
    }
    return secured
  }
  private fun verifiedReceipt(row:CommittedCommandRow):OperationReceipt?=runCatching{
    val command=PendingCommand(row.commandId,row.accountId,row.subjectId,row.capability,"",state=row.state,createdAt=row.createdAt,encryptionVersion=1,receiptBody=row.receiptBody)
    val value=JSONObject(receiptBody(command));if(value.optString("protocol")!="shadow.execution-result"||value.optString("status")!="committed"||value.optString("command_id")!=command.commandId)return@runCatching null
    val resources=value.optJSONArray("resources");val warnings=value.optJSONArray("warnings")
    OperationReceipt(command.capability,command.commandId,value.optString("execution_id").takeIf(String::isNotBlank),(0 until (resources?.length()?:0)).mapNotNull{index->resources?.optJSONObject(index)?.let{ResourceRef(it.optString("type"),it.optString("id"),it.optInt("revision",1))}},(0 until (warnings?.length()?:0)).mapNotNull{index->warnings?.optString(index)?.takeIf(String::isNotBlank)},queued=false)
  }.getOrNull()
  @Synchronized private fun verifiedReceipts(rows:List<CommittedCommandRow>):List<OperationReceipt>{
    val active=rows.mapTo(hashSetOf()){it.commandId};receiptCache.keys.retainAll(active)
    return rows.asReversed().mapNotNull{row->
      val cached=receiptCache[row.commandId]
      if(cached!=null&&cached.body==row.receiptBody)cached.receipt
      else verifiedReceipt(row).also{receiptCache[row.commandId]=CachedReceipt(row.receiptBody,it)}
    }
  }
  companion object { private const val RECENT_RECEIPT_LIMIT=100 }
}

private data class CachedReceipt(val body:String,val receipt:OperationReceipt?)

internal fun sourceState(state:String)=when(state){"blocked","failed"->"failed";"unknown"->"reconciling";"pending","uploading"->"pending";else->state}
internal fun latestSourceState(commands:List<PendingCommand>):String?=commands.maxWithOrNull(compareBy<PendingCommand>{it.createdAt}.thenBy{it.commandId})?.state?.let(::sourceState)
