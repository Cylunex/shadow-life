package com.shadow.life

import android.app.Application
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CompletableDeferred
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class ReadingStateTest {
  @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

  @Test fun switchingTabsKeepsCompletedDataAndRefreshKeepsTheSnapshotVisible() {
    var visible by mutableStateOf(true)
    var revision by mutableStateOf(0)
    val requests = AtomicInteger()
    val refresh = CompletableDeferred<String>()
    compose.setContent {
      val result = rememberLifeRead("month", enabled = visible, refreshKey = revision) {
        check(Thread.currentThread() != Looper.getMainLooper().thread)
        if (requests.incrementAndGet() == 1) "初始汇总" else refresh.await()
      }
      val ready = result.state as? LoadState.Ready
      Text(ready?.value ?: "正在加载")
      if (ready?.refreshing == true) Text("正在更新")
    }

    compose.waitUntil(5_000) { requests.get() == 1 }
    compose.waitUntil(5_000) {
      compose.onAllNodes(hasText("初始汇总")).fetchSemanticsNodes().isNotEmpty()
    }
    compose.runOnIdle { visible = false }
    compose.onNodeWithText("初始汇总").assertExists()
    compose.runOnIdle { visible = true }
    compose.onNodeWithText("初始汇总").assertExists()
    assertEquals(1, requests.get())

    compose.runOnIdle { revision++ }
    compose.onNodeWithText("正在更新").assertExists()
    compose.waitUntil(5_000) { requests.get() >= 2 }
    assertEquals(2, requests.get())
    compose.onNodeWithText("初始汇总").assertExists()
    refresh.complete("更新汇总")
    compose.waitUntil(5_000) {
      compose.onAllNodes(hasText("更新汇总")).fetchSemanticsNodes().isNotEmpty()
    }
  }
}
