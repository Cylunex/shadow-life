package com.shadow.life

import android.content.ContentResolver
import android.net.Uri
import android.provider.OpenableColumns
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.nio.charset.CharacterCodingException
import org.json.JSONObject

private const val MONEY_COMMAND_BYTES=1024*1024
private const val MONEY_STATEMENT_CHARACTERS=900_000
internal fun moneyStatementPayload(resolver:ContentResolver,uri:Uri,zone:String):JSONObject{
  val name=resolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use{cursor->
    if(cursor.moveToFirst())cursor.getString(0) else null
  }?.trim()?.takeIf(String::isNotEmpty)?:error("无法读取账单文件名")
  val format=when(name.substringAfterLast('.').lowercase(java.util.Locale.ROOT)){
    "csv"->"csv"
    "json"->"json"
    "md","markdown"->"markdown"
    else->error("请选择 CSV、JSON 或 Markdown 账单")
  }
  val bytes=resolver.openInputStream(uri)?.use{stream->
    val output=ByteArrayOutputStream()
    val buffer=ByteArray(8192)
    while(true){
      val count=stream.read(buffer)
      if(count<0)break
      require(output.size()+count<=MONEY_COMMAND_BYTES){"账单超过单次提交大小，请拆分后导入"}
      output.write(buffer,0,count)
    }
    output.toByteArray()
  }?:error("无法读取账单文件")
  val content=try{Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString().removePrefix("\uFEFF")}
  catch(_:CharacterCodingException){error("账单需要使用 UTF-8 文本编码")}
  require(content.isNotBlank()){"文件没有可读取的账单内容"}
  require(content.length<=MONEY_STATEMENT_CHARACTERS){"账单超过单次提交大小，请拆分后导入"}
  return JSONObject().put("source_name",name.take(200)).put("content",content).put("format",format).put("time_zone",zone)
}

internal fun MoneyImportCandidateSummary.canConfirmWithoutEdit() =
  status=="pending"&&duplicateOf==null&&duplicateOfCandidate==null&&issues.isEmpty()&&currency=="CNY"&&
    entryType in setOf("expense","income")&&runCatching{
      normalizeCnyAmount(amount)
      java.time.LocalDate.parse(occurredOn)
    }.isSuccess
