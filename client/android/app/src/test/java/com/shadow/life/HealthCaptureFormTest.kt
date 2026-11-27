package com.shadow.life

import android.app.Application
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.hasSetTextAction
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], qualifiers = "w393dp-h852dp-mdpi", application = Application::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class HealthCaptureFormTest {
  @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

  @Test fun quickWeightSavesWithDefaultUnitAndUpdatesUnitWhenMetricChanges() {
    var submitted: CaptureDraft? = null
    compose.setContent {
      LifeTheme(Appearance.Light) {
        LifeComposerHost(
          open = true,
          initialSeed = null,
          submitState = SubmitState.Editing,
          assistantState = null,
          historyState = null,
          threadState = LoadState.Loading,
          selectedThreadId = null,
          refundCandidates = LoadState.Loading,
          onLoadOlder = {},
          onSelectThread = {},
          onNewThread = {},
          onLoadRefundCandidates = {},
          onDismiss = {},
          onSubmit = { submitted = it },
          onAsk = {},
          onReset = {}
        )
      }
    }

    compose.onNodeWithText("记体重").performClick()
    compose.onNode(hasSetTextAction() and hasText("数值")).performTextInput("71.35")
    compose.onNodeWithText("保存记录").assertIsDisplayed().assertIsEnabled().performClick()
    compose.runOnIdle {
      assertEquals("weight", submitted?.option)
      assertEquals("71.35", submitted?.primary)
      assertEquals("kg", submitted?.secondary)
    }

    compose.onNodeWithText("心率").performScrollTo().performClick()
    compose.onNodeWithText("保存记录").assertIsDisplayed().assertIsEnabled().performClick()
    compose.runOnIdle {
      assertEquals("heart_rate", submitted?.option)
      assertEquals("bpm", submitted?.secondary)
    }
  }
}
