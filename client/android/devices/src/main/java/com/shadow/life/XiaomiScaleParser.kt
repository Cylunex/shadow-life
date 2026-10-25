package com.shadow.life

import java.time.LocalDateTime
import java.util.Locale
import org.bouncycastle.crypto.InvalidCipherTextException
import org.bouncycastle.crypto.engines.AESEngine
import org.bouncycastle.crypto.modes.CCMBlockCipher
import org.bouncycastle.crypto.params.AEADParameters
import org.bouncycastle.crypto.params.KeyParameter

data class XiaomiScaleFrame(
  val model:String,
  val weightKg:Double?,
  val impedanceLow:Double?=null,
  val impedanceHigh:Double?=null,
  val heartRate:Int?=null,
  val profileId:Int?=null,
  val measuredAt:LocalDateTime?=null,
  val reset:Boolean=false
)

sealed interface S400ParseResult {
  data class Measurement(val frame:XiaomiScaleFrame):S400ParseResult
  data object NotMeasurement:S400ParseResult
  data object MissingBindkey:S400ParseResult
  data object BindkeyMismatch:S400ParseResult
  data object InvalidFrame:S400ParseResult
}

/** Pure protocol parser ported from the verified Shadow Health device implementation. */
object XiaomiScaleParser {
  private val s400ProductIds=setOf(0x30D9,0x3BD5,0x48CF)

  fun parseScale2(data:ByteArray):XiaomiScaleFrame? {
    if(data.size!=13)return null
    val flags=u8(data[1])
    if(u8(data[0])!=0x02||(flags and 0x20)==0||(flags and 0x80)!=0)return null
    val weight=le16(data,11)*0.005
    if(weight !in 10.0..300.0)return null
    val impedance=if((flags and 0x02)!=0)le16(data,9).takeIf{it in 1..2999}?.toDouble() else null
    val measuredAt=runCatching{
      LocalDateTime.of(le16(data,2),u8(data[4]),u8(data[5]),u8(data[6]),u8(data[7]),u8(data[8]))
    }.getOrNull()
    return XiaomiScaleFrame("XMTZC05HM",kotlin.math.round(weight*100)/100,impedanceLow=impedance,measuredAt=measuredAt)
  }

  fun isS400(data:ByteArray?)=data!=null&&data.size>=5&&le16(data,2) in s400ProductIds

  fun parseS400(data:ByteArray,address:String?,bindkeyHex:String?):XiaomiScaleFrame?=
    (inspectS400(data,address,bindkeyHex) as? S400ParseResult.Measurement)?.frame

  fun inspectS400(data:ByteArray,address:String?,bindkeyHex:String?):S400ParseResult {
    if(!isS400(data)||data.size<8)return S400ParseResult.InvalidFrame
    val frameControl=le16(data,0)
    if((frameControl ushr 12)<2||(frameControl and 0x80)!=0||(frameControl and 0x40)==0)return S400ParseResult.InvalidFrame
    var offset=5
    val xiaomiMac=if((frameControl and 0x10)!=0){
      if(data.size<offset+6)return S400ParseResult.InvalidFrame
      data.copyOfRange(offset,offset+6).reversedArray().also{offset+=6}
    }else parseMac(address)?:return S400ParseResult.InvalidFrame
    if((frameControl and 0x20)!=0){
      if(data.size<=offset)return S400ParseResult.InvalidFrame
      val capability=u8(data[offset++])
      if((capability and 0x20)!=0){offset++;if(data.size<offset)return S400ParseResult.InvalidFrame}
    }
    val payload=if((frameControl and 0x08)!=0){
      val key=parseHexKey(bindkeyHex)?:return S400ParseResult.MissingBindkey
      if(data.size<offset+9)return S400ParseResult.InvalidFrame
      val nonce=concat(xiaomiMac.reversedArray(),data.copyOfRange(2,5),data.copyOfRange(data.size-7,data.size-4))
      val encrypted=concat(data.copyOfRange(offset,data.size-7),data.copyOfRange(data.size-4,data.size))
      decryptCcm(key,nonce,encrypted,byteArrayOf(0x11))?:return S400ParseResult.BindkeyMismatch
    }else data.copyOfRange(offset,data.size)
    var index=0
    while(index+3<=payload.size){
      val type=le16(payload,index);val length=u8(payload[index+2]);val end=index+3+length
      if(end>payload.size)return S400ParseResult.InvalidFrame
      if(type==0x6E16&&length==9){
        val p=index+3;val profile=u8(payload[p]);val packed=le32(payload,p+1)
        val mass=(packed and 0x7FF).toInt();val heart=((packed ushr 11) and 0x7F).toInt();val impedance=packed ushr 18
        if(mass==0&&heart==0&&impedance==0L)return S400ParseResult.Measurement(XiaomiScaleFrame("MJTZC01YM/S400",null,profileId=profile,reset=true))
        val heartRate=(heart+50).takeIf{heart in 1..126};val z=(impedance/10.0).takeIf{impedance>0}
        if(mass>0){val weight=mass/10.0;if(weight !in 10.0..300.0)return S400ParseResult.InvalidFrame;return S400ParseResult.Measurement(XiaomiScaleFrame("MJTZC01YM/S400",weight,impedanceLow=z,heartRate=heartRate,profileId=profile))}
        if(heart==0&&z!=null)return S400ParseResult.Measurement(XiaomiScaleFrame("MJTZC01YM/S400",null,impedanceHigh=z,profileId=profile))
        return S400ParseResult.NotMeasurement
      }
      index=end
    }
    return S400ParseResult.NotMeasurement
  }

  private fun decryptCcm(key:ByteArray,nonce:ByteArray,input:ByteArray,aad:ByteArray):ByteArray?=try{
    val cipher=CCMBlockCipher.newInstance(AESEngine.newInstance())
    cipher.init(false,AEADParameters(KeyParameter(key),32,nonce,aad))
    val output=ByteArray(cipher.getOutputSize(input.size));var length=cipher.processBytes(input,0,input.size,output,0);length+=cipher.doFinal(output,length);output.copyOf(length)
  }catch(_:InvalidCipherTextException){null}catch(_:RuntimeException){null}

  private fun parseHexKey(value:String?):ByteArray? {
    if(value==null||!Regex("(?i)[0-9a-f]{32}").matches(value))return null
    return ByteArray(16){value.substring(it*2,it*2+2).toInt(16).toByte()}
  }
  private fun parseMac(address:String?):ByteArray? {
    val hex=address?.replace(":","")?.uppercase(Locale.US)?:return null
    if(!Regex("[0-9A-F]{12}").matches(hex))return null
    return ByteArray(6){hex.substring(it*2,it*2+2).toInt(16).toByte()}
  }
  private fun u8(value:Byte)=value.toInt() and 0xFF
  private fun le16(data:ByteArray,offset:Int)=u8(data[offset]) or (u8(data[offset+1]) shl 8)
  private fun le32(data:ByteArray,offset:Int)=u8(data[offset]).toLong() or (u8(data[offset+1]).toLong() shl 8) or (u8(data[offset+2]).toLong() shl 16) or (u8(data[offset+3]).toLong() shl 24)
  private fun concat(vararg arrays:ByteArray)=ByteArray(arrays.sumOf(ByteArray::size)).also{out->var offset=0;arrays.forEach{it.copyInto(out,offset);offset+=it.size}}
}
