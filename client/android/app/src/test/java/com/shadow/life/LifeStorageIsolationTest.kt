package com.shadow.life

import android.content.Context
import android.content.Intent
import androidx.compose.ui.test.junit4.createEmptyComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk=[34],application=ShadowApp::class)
class LifeStorageIsolationTest {
    @get:Rule val compose = createEmptyComposeRule()

    @Test fun inaccessibleKeysetAllowsRetryAndExitAndPreservesExistingData() {
        val app = ApplicationProvider.getApplicationContext<ShadowApp>()
        val prefs = app.getSharedPreferences("shadow_life_sessions", Context.MODE_PRIVATE)
        val keyset = "__androidx_security_crypto_encrypted_prefs_key_keyset__"
        prefs.edit().putString(keyset, "unreadable-test-keyset").commit()
        assertNull(app.activeCaptureSession())

        val intent = Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        ActivityScenario.launch<MainActivity>(intent).use { scenario ->
            compose.onNodeWithText("Life 的本地加密数据暂时无法读取").assertExists()
            compose.onNodeWithText("重试").performClick()
            compose.onNodeWithText("Life 的本地加密数据暂时无法读取").assertExists()
            scenario.recreate()
            lateinit var activity: MainActivity
            scenario.onActivity { activity = it }
            compose.onNodeWithText("返回").performClick()
            assertTrue(activity.isFinishing)
        }
        assertEquals("unreadable-test-keyset", prefs.getString(keyset, null))
    }
}
