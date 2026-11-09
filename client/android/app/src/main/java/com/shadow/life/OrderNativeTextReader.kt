package com.shadow.life

import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.coroutines.resume
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeoutOrNull

/** A stalled third-party Binder provider must never block the gesture/service thread. */
internal class OrderNativeTextReader(private val timeoutMs:Long=800):AutoCloseable {
 private val executor=Executors.newSingleThreadExecutor()
 private val reading=AtomicBoolean(false)
 suspend fun read(block:()->List<OrderTextBox>?):List<OrderTextBox>?=withTimeoutOrNull(timeoutMs){
  suspendCancellableCoroutine{continuation->
   if(!reading.compareAndSet(false,true)){continuation.resume(null);return@suspendCancellableCoroutine}
   try{executor.execute{
    val result=try{block()}catch(_:Exception){null}finally{reading.set(false)}
    if(continuation.isActive)continuation.resume(result)
   }}catch(_:java.util.concurrent.RejectedExecutionException){reading.set(false);continuation.resume(null)}
  }
 }
 override fun close(){executor.shutdownNow()}
}

internal fun attemptsNativeOrderText(pkg:String,activity:String):Boolean =
 pkg in setOf("com.sankuai.meituan","com.sankuai.meituan.takeoutnew")&&!activity.contains(".retail.")
