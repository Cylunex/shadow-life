package com.shadow.life

import org.junit.Assert.*
import org.junit.Test

class BillShakeMonitorTest {
    @Test fun noFirstSampleTriggersRecoveryAfterGracePeriod() {
        val monitor = BillShakeMonitor()
        assertFalse(monitor.needsRestart(50_000))
        monitor.start(100)
        assertFalse(monitor.needsRestart(10_099))
        assertTrue(monitor.needsRestart(10_100))
    }

    @Test fun previouslyHealthyStreamCanStallAndRecover() {
        val monitor = BillShakeMonitor()
        monitor.start(0)
        for (ms in 0L..20_000L step 500) {
            assertEquals(false, monitor.sample(ms, ms, 0f, 9.8f, 0f))
            assertFalse(monitor.needsRestart(ms))
        }
        assertTrue(monitor.needsRestart(30_000))
        monitor.start(30_000)
        assertFalse(monitor.needsRestart(35_000))
        assertEquals(false, monitor.sample(35_000, 35_000, 0f, 9.8f, 0f))
        assertFalse(monitor.needsRestart(40_000))
    }

    @Test fun lockOrDisableStopsRecoveryAndRejectsCallbacks() {
        val monitor = BillShakeMonitor()
        monitor.start(0)
        monitor.sample(0, 0, 0f, 9.8f, 0f)
        monitor.stop()
        assertFalse(monitor.needsRestart(60_000))
        assertNull(monitor.sample(60_000, 60_000, 12f, 9.8f, 0f))
        monitor.start(60_000)
        assertFalse(monitor.needsRestart(60_001))
    }

    @Test fun frozenBacklogDoesNotTriggerOrConcealStalledStream() {
        val monitor = BillShakeMonitor()
        monitor.start(0)
        monitor.sample(0, 0, 0f, 9.8f, 0f)
        assertNull(monitor.sample(100, 20_000, 12f, 9.8f, 0f))
        assertNull(monitor.sample(240, 20_000, -13f, 9.8f, 0f))
        assertTrue(monitor.needsRestart(20_000))
    }

    @Test fun restartRejectsOldCallbacksAndClearsPartialGesture() {
        val monitor = BillShakeMonitor()
        monitor.start(0)
        monitor.sample(0, 0, 0f, 9.8f, 0f)
        assertEquals(false, monitor.sample(100, 100, 12f, 9.8f, 0f))
        monitor.start(150)
        assertNull(monitor.sample(140, 200, -13f, 9.8f, 0f))
        assertEquals(false, monitor.sample(240, 240, -13f, 9.8f, 0f))
    }

    @Test fun sampleGapResetsGravityBeforeEvaluatingNewMotion() {
        val monitor = BillShakeMonitor()
        monitor.start(0)
        monitor.sample(0, 0, 0f, 9.8f, 0f)
        monitor.sample(100, 100, 12f, 9.8f, 0f)
        assertEquals(false, monitor.sample(2_000, 2_000, -13f, 9.8f, 0f))
        // Reset baseline, then a normal deliberate gesture still works.
        monitor.start(3_000)
        assertEquals(false, monitor.sample(3_000, 3_000, 0f, 9.8f, 0f))
        assertEquals(false, monitor.sample(3_100, 3_100, 12f, 9.8f, 0f))
        assertEquals(true, monitor.sample(3_240, 3_240, -13f, 9.8f, 0f))
        assertEquals(false, monitor.sample(3_400, 3_400, 14f, 9.8f, 0f))
    }

    @Test fun futureAndOutOfOrderSamplesDoNotRefreshHealth() {
        val monitor = BillShakeMonitor()
        monitor.start(0)
        monitor.sample(100, 100, 0f, 9.8f, 0f)
        assertNull(monitor.sample(100, 200, 12f, 9.8f, 0f))
        assertNull(monitor.sample(99, 200, -13f, 9.8f, 0f))
        assertNull(monitor.sample(10_000, 9_999, 0f, 9.8f, 0f))
        assertTrue(monitor.needsRestart(10_100))
    }
}
