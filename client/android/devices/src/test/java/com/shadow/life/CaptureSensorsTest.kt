package com.shadow.life
import org.junit.Assert.*
import org.junit.Test
import java.nio.ByteBuffer
import java.nio.ByteOrder
class CaptureSensorsTest {
 @Test fun wavHasExactPcmLengthAndFormat(){val pcm=ByteArray(32000){1};val wave=captureWave(pcm);assertEquals("RIFF",String(wave.sliceArray(0..3)));assertEquals(32000,ByteBuffer.wrap(wave,40,4).order(ByteOrder.LITTLE_ENDIAN).int);assertEquals(32044,wave.size)}
 @Test fun staysNeedStableAccurateSamplesAndNeverBridgeUnobservedGaps(){val detector=StayDetector{"stay_test"};assertNull(detector.accept(StaySample(0,31.0,121.0,200.0)));assertNull(detector.current);detector.accept(StaySample(0,31.0,121.0,10.0));detector.accept(StaySample(180000,31.0,121.0,10.0));detector.accept(StaySample(300000,31.0,121.0,10.0));val stay=detector.accept(StaySample(900000,31.0,121.0,10.0));assertEquals(300000L,stay!!.last.at);assertEquals(0L,stay.start.at);assertNull(detector.finish())}
 @Test fun continuousStayCheckpointsShareTheActualBoundary(){val d=StayDetector();for(i in 0 until 30)d.accept(StaySample(i*60000L,31.0,121.0,10.0));val closed=d.accept(StaySample(1800000L,31.0,121.0,10.0))!!;assertEquals(1800000L,closed.last.at);assertEquals(closed.last.at,d.current!!.start.at)}
 @Test fun movementEndsOnlyThePreviouslyObservedStay(){val d=StayDetector();d.accept(StaySample(0,31.0,121.0,10.0));d.accept(StaySample(180000,31.0,121.0,10.0));d.accept(StaySample(300000,31.0,121.0,10.0));val old=d.accept(StaySample(360000,32.0,122.0,10.0));assertNotNull(old);assertEquals(31.0,old!!.start.latitude,0.0);assertEquals(32.0,d.current!!.start.latitude,0.0)}
}
