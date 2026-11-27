package com.shadow.life

import android.app.Application
import android.content.Context
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = Application::class)
class HealthPermissionsActivityTest {
    @get:Rule val compose = createAndroidComposeRule<HealthPermissionsActivity>()

    @Test fun explainsHealthDataAccessWithoutAnAccountOrPermissionPrompt() {
        val activity = compose.activity
        val sessions = activity.getSharedPreferences("shadow_life_sessions", Context.MODE_PRIVATE)
        assertFalse(sessions.contains("active_account"))
        compose.onNodeWithText("健康数据权限说明").assertIsDisplayed()
        compose.onNodeWithText("体重、步数、睡眠和锻炼", substring = true).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("当前登录的 Life 账号", substring = true).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("逐项授权或撤回", substring = true).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("完成").performScrollTo().performClick()
        assertTrue(activity.isFinishing)
    }
}
