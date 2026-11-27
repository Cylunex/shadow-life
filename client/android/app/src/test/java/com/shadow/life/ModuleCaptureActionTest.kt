package com.shadow.life

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class ModuleCaptureActionTest {
  @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

  @Test fun eachCaptureButtonAnnouncesItsAction() {
    val labels = listOf("记体重", "记一餐", "记消费")
    val tapped = mutableListOf<String>()
    compose.setContent {
      LifeTheme(Appearance.Light) {
        Column {
          labels.forEach { label -> ModuleCaptureAction(label) { tapped.add(label) } }
        }
      }
    }
    labels.forEach { label -> compose.onNodeWithContentDescription(label).performClick() }
    compose.runOnIdle { assertEquals(labels, tapped) }
  }

  @Test fun detailMenuKeepsAllThreeCaptureTypesReachable() {
    val selected = mutableListOf<CaptureKind>()
    compose.setContent { LifeTheme(Appearance.Dark) { MoneyCaptureMenu { selected.add(it) } } }
    listOf("记收支", "记购买", "登记退款").forEach { label ->
      compose.onNodeWithContentDescription("记消费").performClick()
      compose.onNodeWithText(label).performClick()
    }
    compose.runOnIdle { assertEquals(listOf(CaptureKind.Expense, CaptureKind.Purchase, CaptureKind.Refund), selected) }
  }
}
