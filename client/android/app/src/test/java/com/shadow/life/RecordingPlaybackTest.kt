package com.shadow.life

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class RecordingPlaybackTest {
  @Test fun waveformUsesOriginalSignedPcmAndKeepsSilence(){
    val wave=captureWave(byteArrayOf(0,0,0,-128,0,64))
    assertEquals(listOf(0f,1f,.5f),pcmWavePeaks(wave))
    assertTrue(pcmWavePeaks(wave.copyOf(wave.size-1)).isEmpty())
  }

}
