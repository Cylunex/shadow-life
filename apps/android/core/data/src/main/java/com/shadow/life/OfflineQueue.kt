package com.shadow.life

import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.combine
import org.json.JSONObject

class OfflineQueue(private val database:ShadowDatabase,private val crypto:QueueCrypto=QueueCrypto()) {
  fun observeStatus(session:ProductSession):Flow<QueueSummary> = combine(
    database.commands().observe(session.accountId,session.subjectId),
    database.commands().observeAttachments(session.accountId,session.subjectId)
  ){commands,attachments->
    val scale=commands.filter{it.commandId.startsWith("cmd_scale_")}
    val samsung=commands.filter{it.commandId.startsWith("cmd_samsung_")}
    val committedReceipts=commands.asSequence().filter{it.state=="committed"}.sortedBy{it.createdAt}.mapNotNull(::verifiedReceipt).toList()
    QueueSummary(
    waiting=commands.count{it.state in setOf("pending","uploading")},
    reconciling=commands.count{it.state=="unknown"}+attachments.count{it.state=="unknown"},
    failed=commands.count{it.state in setOf("blocked","failed")}+attachments.count{it.state in setOf("blocked","failed")},
    completed=commands.count{it.state=="committed"}+attachments.count{it.state=="committed"},
    attachments=attachments.count{it.state in setOf("pending","uploading","unknown")},
    latestScaleState=sourceState(scale),
    latestScaleAt=scale.maxOfOrNull{it.createdAt},
    latestSamsungState=sourceState(samsung),
    latestSamsungAt=samsung.maxOfOrNull{it.createdAt},
    committedReceipts=committedReceipts
  )}
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
  private fun sourceState(commands:List<PendingCommand>):String?=when{
    commands.isEmpty()->null
    commands.any{it.state in setOf("blocked","failed")}->"failed"
    commands.any{it.state=="unknown"}->"reconciling"
    commands.any{it.state in setOf("pending","uploading")}->"pending"
    commands.all{it.state=="committed"}->"committed"
    else->commands.first().state
  }
  private fun verifiedReceipt(command:PendingCommand):OperationReceipt?=runCatching{
    val value=JSONObject(receiptBody(command));if(value.optString("protocol")!="shadow.execution-result"||value.optString("status")!="committed"||value.optString("command_id")!=command.commandId)return@runCatching null
    val resources=value.optJSONArray("resources");val warnings=value.optJSONArray("warnings")
    OperationReceipt(command.capability,command.commandId,value.optString("execution_id").takeIf(String::isNotBlank),(0 until (resources?.length()?:0)).mapNotNull{index->resources?.optJSONObject(index)?.let{ResourceRef(it.optString("type"),it.optString("id"),it.optInt("revision",1))}},(0 until (warnings?.length()?:0)).mapNotNull{index->warnings?.optString(index)?.takeIf(String::isNotBlank)},queued=false)
  }.getOrNull()
}
