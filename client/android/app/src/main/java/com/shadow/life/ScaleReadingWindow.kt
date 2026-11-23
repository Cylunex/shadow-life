package com.shadow.life

import android.os.Handler

/** Collects additional fields until the deadline set by the first weight frame. */
internal class ScaleReadingWindow<T>(
  private val handler: Handler,
  private val waitMs: Long,
  private val onReady: (T, String) -> Unit
) {
  private data class Pending<T>(var reading: T, val deadline: Runnable)
  private val pending = linkedMapOf<String, Pending<T>>()
  val hasReading get() = pending.isNotEmpty()

  operator fun get(key: String): T? = pending[key]?.reading

  fun collect(key: String, reading: T): Boolean {
    pending[key]?.let {
      it.reading = reading
      return false
    }
    val deadline = Runnable { finish(key, "settle_timeout") }
    pending[key] = Pending(reading, deadline)
    handler.postDelayed(deadline, waitMs)
    return true
  }

  fun finish(key: String, reason: String, complete: (T) -> T = { it }): Boolean {
    val entry = pending.remove(key) ?: return false
    handler.removeCallbacks(entry.deadline)
    onReady(complete(entry.reading), reason)
    return true
  }

  fun finishFirst(reason: String): Boolean {
    val key = pending.keys.firstOrNull() ?: return false
    return finish(key, reason)
  }

  fun clear() {
    pending.values.forEach { handler.removeCallbacks(it.deadline) }
    pending.clear()
  }
}
