package com.shadow.life
import java.nio.ByteBuffer
import java.nio.ByteOrder
fun captureWave(pcm:ByteArray,sampleRate:Int=16000):ByteArray{
 require(pcm.size%2==0&&pcm.size<=sampleRate*2*300)
 val header=ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
 header.put("RIFF".toByteArray()).putInt(pcm.size+36).put("WAVEfmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(sampleRate).putInt(sampleRate*2).putShort(2).putShort(16).put("data".toByteArray()).putInt(pcm.size)
 return header.array()+pcm
}
