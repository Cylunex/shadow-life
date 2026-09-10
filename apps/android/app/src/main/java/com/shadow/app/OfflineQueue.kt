package com.shadow.app

import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import kotlinx.coroutines.CancellationException

class OfflineQueue(private val database:ShadowDatabase,private val crypto:QueueCrypto=QueueCrypto()) {
  suspend fun enqueueCommand(session:ProductSession,commandId:String,capability:String,plainBody:String):Long{
    val encrypted=crypto.encryptCommand(session.accountId,session.subjectId,commandId,plainBody)
    return database.commands().enqueue(PendingCommand(commandId,session.accountId,session.subjectId,capability,encrypted,encryptionVersion=1))
  }

  suspend fun enqueueAttachment(session:ProductSession,id:String,commandId:String,mediaType:String,capturedOn:String,input:InputStream,file:File):Long{
    file.parentFile?.mkdirs()
    val temporary=File(file.parentFile,"${file.name}.encrypting")
    var moved=false
    try{
      crypto.encryptAttachment(session.accountId,session.subjectId,id,input,temporary.outputStream())
      Files.move(temporary.toPath(),file.toPath(),StandardCopyOption.ATOMIC_MOVE,StandardCopyOption.REPLACE_EXISTING)
      moved=true
      val inserted=database.commands().enqueueAttachment(PendingAttachment(id,session.accountId,session.subjectId,commandId,file.absolutePath,mediaType,encryptionVersion=1,capturedOn=capturedOn))
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
  suspend fun commit(command:PendingCommand,plainReceipt:String)=database.commands().commitCommand(command.commandId,crypto.encryptReceipt(command,plainReceipt))

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
}
