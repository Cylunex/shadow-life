package com.shadow.life

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class XiaomiScaleParserTest {
  @Test fun parsesEncryptedS400WeightAndImpedance(){
    val frame=XiaomiScaleParser.parseS400(hex("4859d53b0a1993e27d5504ae40a2356a77000000eda9f477"),"AA:BB:CC:DD:EE:FF","000102030405060708090a0b0c0d0e0f")
    assertNotNull(frame);assertEquals(69.9,frame!!.weightKg!!,.001);assertEquals(543.2,frame.impedanceLow!!,.001);assertEquals(92,frame.heartRate)
  }
  @Test fun parsesEncryptedS400HighFrequencyImpedance(){
    val frame=XiaomiScaleParser.parseS400(hex("4859d53b0bb2379319971fee32b3504a25000000bace36ee"),"AA:BB:CC:DD:EE:FF","000102030405060708090a0b0c0d0e0f")
    assertNotNull(frame);assertNull(frame!!.weightKg);assertEquals(497.6,frame.impedanceHigh!!,.001)
  }
  @Test fun rejectsMissingOrWrongS400Key(){val raw=hex("4859d53b0a1993e27d5504ae40a2356a77000000eda9f477");assertNull(XiaomiScaleParser.parseS400(raw,"AA:BB:CC:DD:EE:FF",null));assertNull(XiaomiScaleParser.parseS400(raw,"AA:BB:CC:DD:EE:FF","ffffffffffffffffffffffffffffffff"))}
  @Test fun parsesStableScale2Frame(){
    val raw=byteArrayOf(0x02,0x22,0xEA.toByte(),0x07,9,13,8,30,0,0x20,0x03,0x9C.toByte(),0x36)
    val frame=XiaomiScaleParser.parseScale2(raw)!!;assertEquals(69.9,frame.weightKg!!,.001);assertEquals(800.0,frame.impedanceLow!!,.001);assertEquals(LocalDate.of(2026,9,13),frame.measuredAt!!.toLocalDate())
  }
  @Test fun bodyCompositionMatchesLegacyFormulaShape(){val value=xiaomiBodyComposition(69.9,543.2,XiaomiProfile("male",LocalDate.of(1990,1,1),175.0),LocalDate.of(2026,9,13))!!;assertEquals(true,value.bodyFatPct in 5.0..75.0);assertEquals(true,value.muscleMassKg>10);assertEquals(true,value.bmrKcal>=500);assertEquals(69.9,value.fatMassKg+value.leanMassKg,.02);assertEquals(value.bodyWaterKg/69.9*100,value.bodyWaterPct,.1);assertEquals(value.muscleMassKg/69.9*100,value.musclePct,.1);assertEquals(value.boneMassKg/69.9*100,value.bonePct,.1)}
  private fun hex(value:String)=ByteArray(value.length/2){value.substring(it*2,it*2+2).toInt(16).toByte()}
}
