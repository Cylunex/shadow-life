package com.shadow.life

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.CipherInputStream
import javax.crypto.CipherOutputStream
import javax.crypto.AEADBadTagException
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class QueueKeyUnavailableException(cause:Throwable):Exception(cause)

class QueueCrypto {
  private val keyCache=mutableMapOf<String,SecretKey>()
  fun encryptCommand(accountId:String,subjectId:String,commandId:String,plainText:String)=
    encryptText(accountId,subjectId,"command",commandId,plainText)

  fun decryptCommand(command:PendingCommand)=decryptText(command.accountId,command.subjectId,"command",command.commandId,command.body)
  fun encryptReceipt(command:PendingCommand,plainText:String)=encryptText(command.accountId,command.subjectId,"receipt",command.commandId,plainText)
  fun decryptReceipt(command:PendingCommand)=decryptText(command.accountId,command.subjectId,"receipt",command.commandId,command.receiptBody)

  fun encryptAttachment(accountId:String,subjectId:String,attachmentId:String,input:InputStream,output:OutputStream){
    val cipher=protect{encryptCipher(accountId,aad(accountId,subjectId,"attachment",attachmentId))}
    val data=DataOutputStream(output)
    data.write(MAGIC)
    data.writeByte(cipher.iv.size)
    data.write(cipher.iv)
    CipherOutputStream(data,cipher).use{encrypted->input.use{it.copyTo(encrypted)}}
  }

  fun decryptAttachment(attachment:PendingAttachment,input:InputStream,output:OutputStream){
    val data=DataInputStream(input)
    val iv=protect{
      check(attachment.encryptionVersion==1){"unsupported attachment encryption"}
      val magic=ByteArray(MAGIC.size)
      data.readFully(magic)
      check(magic.contentEquals(MAGIC)){"invalid attachment envelope"}
      val ivSize=data.readUnsignedByte()
      check(ivSize in 12..32){"invalid attachment IV"}
      ByteArray(ivSize).also{data.readFully(it)}
    }
    val cipher=protect{decryptCipher(attachment.accountId,iv,aad(attachment.accountId,attachment.subjectId,"attachment",attachment.id))}
    try{CipherInputStream(data,cipher).use{plain->output.use{plain.copyTo(it)}}}catch(error:IOException){
      if(generateSequence<Throwable>(error){it.cause}.any{it is AEADBadTagException})throw QueueKeyUnavailableException(error)
      throw error
    }
  }

  fun isEncryptedCommand(body:String)=body.startsWith("slq1.")
  fun isEncryptedAttachment(file:File):Boolean=runCatching{file.inputStream().use{input->val value=ByteArray(MAGIC.size);input.read(value)==MAGIC.size&&value.contentEquals(MAGIC)}}.getOrDefault(false)

  private fun encryptCipher(accountId:String,aad:ByteArray)=Cipher.getInstance(TRANSFORMATION).also{it.init(Cipher.ENCRYPT_MODE,key(accountId));it.updateAAD(aad)}
  private fun decryptCipher(accountId:String,iv:ByteArray,aad:ByteArray)=Cipher.getInstance(TRANSFORMATION).also{it.init(Cipher.DECRYPT_MODE,key(accountId),GCMParameterSpec(128,iv));it.updateAAD(aad)}
  @Synchronized private fun key(accountId:String):SecretKey{
    val alias="shadow_queue_${digest(accountId).take(32)}"
    keyCache[alias]?.let{return it}
    val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
    val key=(store.getKey(alias,null) as? SecretKey)?:KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply{init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setRandomizedEncryptionRequired(true).build())}.generateKey()
    keyCache[alias]=key
    return key
  }
  private fun aad(accountId:String,subjectId:String,kind:String,id:String)="$accountId\u0000$subjectId\u0000$kind\u0000$id".toByteArray(Charsets.UTF_8)
  private fun encryptText(accountId:String,subjectId:String,kind:String,id:String,plainText:String):String=protect{val cipher=encryptCipher(accountId,aad(accountId,subjectId,kind,id));"slq1.${encode(cipher.iv)}.${encode(cipher.doFinal(plainText.toByteArray(Charsets.UTF_8)))}"}
  private fun decryptText(accountId:String,subjectId:String,kind:String,id:String,envelope:String):String=protect{check(envelope.startsWith("slq1.")){"unsupported encrypted text"};val parts=envelope.split('.',limit=3);check(parts.size==3){"invalid encrypted text"};val cipher=decryptCipher(accountId,decode(parts[1]),aad(accountId,subjectId,kind,id));String(cipher.doFinal(decode(parts[2])),Charsets.UTF_8)}
  private fun digest(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString(""){(it.toInt() and 0xff).toString(16).padStart(2,'0')}
  private fun encode(value:ByteArray)=Base64.encodeToString(value,Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
  private fun decode(value:String)=Base64.decode(value,Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
  private fun <T> protect(work:()->T):T=try{work()}catch(error:QueueKeyUnavailableException){throw error}catch(error:Exception){throw QueueKeyUnavailableException(error)}
  companion object { private const val TRANSFORMATION="AES/GCM/NoPadding";private val MAGIC=byteArrayOf(0x53,0x4c,0x51,0x31) }
}
