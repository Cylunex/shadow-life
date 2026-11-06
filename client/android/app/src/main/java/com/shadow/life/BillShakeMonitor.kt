package com.shadow.life

/** All times use elapsed realtime, including the sensor's event timestamp. */
internal class BillShakeMonitor {
    private var startedAt: Long? = null
    private var sampledAt: Long? = null
    private var gesture = BillShakeGesture()

    fun start(now: Long) {
        startedAt = now
        sampledAt = null
        gesture = BillShakeGesture()
    }

    fun stop() {
        startedAt = null
        sampledAt = null
        gesture = BillShakeGesture()
    }

    fun needsRestart(now: Long): Boolean {
        val since = sampledAt ?: startedAt ?: return false
        return now - since >= 10_000
    }

    // null means ignored: queued motion from before a restart/freeze must not capture a new page.
    fun sample(ms: Long, now: Long, x: Float, y: Float, z: Float): Boolean? {
        val start = startedAt ?: return null
        if (ms < start || now - ms !in 0..1_000 || sampledAt?.let { ms <= it } == true) return null
        if (sampledAt?.let { ms - it > 1_000 } == true) gesture = BillShakeGesture()
        sampledAt = ms
        return gesture.sample(ms, x, y, z)
    }
}
