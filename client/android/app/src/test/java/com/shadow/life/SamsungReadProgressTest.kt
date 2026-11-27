package com.shadow.life

import java.time.LocalDate
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=android.app.Application::class)
class SamsungReadProgressTest {
  private val from=LocalDate.parse("2026-11-01")
  private val initial=SamsungReadProgress("scope",from,from.plusDays(26),10L)

  @Test fun `interrupted page resumes after the last fully handled page`()=runBlocking {
    var progress=initial.complete("activity")
    val requests=mutableListOf<String?>()
    val handled=mutableListOf<Int>()
    var cancelled=false
    try {
      forEachSamsungPage("heart",{progress},{progress=it},{point:Int->
        if(point==3)throw CancellationException("worker stopped")
        handled+=point
      }){token->
        requests+=token
        if(token==null)listOf(1) to "second" else listOf(2,3) to null
      }
    }catch(_:CancellationException){
      cancelled=true
    }
    assertTrue(cancelled)
    assertEquals(listOf(null,"second"),requests)
    assertEquals(listOf(1,2),handled)
    progress=SamsungReadProgress.decode(progress.encode())!!
    assertEquals(setOf("activity"),progress.completedTypes)
    assertEquals("second",progress.pages["heart"])
    forEachSamsungPage("heart",{progress},{progress=it},{handled+=it}){token->
      assertEquals("second",token)
      listOf(2,3) to null
    }
    assertEquals(listOf(1,2,2,3),handled)
    forEachSamsungPage<Int>("heart",{progress},{progress=it},{fail("already read")}){
      error("a fully read type must skip its page request")
    }
    assertTrue(progress.pages.containsKey("heart"))
    assertNull(progress.pages["heart"])
  }

  @Test fun `a repeating token restarts only that data type`()=runBlocking {
    var progress=initial.complete("steps").page("sleep","repeated")
    try {
      forEachSamsungPage<Int>("sleep",{progress},{progress=it},{fail("invalid page")}){emptyList<Int>() to "repeated"}
      fail("a repeated token must fail the read")
    }catch(_:IllegalStateException){
      assertEquals(initial.complete("steps"),progress)
    }
  }
}
