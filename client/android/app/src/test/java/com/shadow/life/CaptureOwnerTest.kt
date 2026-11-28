package com.shadow.life

import android.content.Intent
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], application = android.app.Application::class)
class CaptureOwnerTest {
    @Test fun refreshedTokenKeepsCaptureWhileSubjectGenerationOrServiceChangesEndIt() {
        val owner = ProductSession("login", "person-a", "https://life.example.com", "test", generation = 5)
        assertTrue(owner.copy(tokenRevision = 8, authStateJson = "refreshed").sameCaptureOwner(owner))
        assertFalse(owner.copy(subjectId = "person-b").sameCaptureOwner(owner))
        assertFalse(owner.copy(generation = 6).sameCaptureOwner(owner))
        assertFalse(owner.copy(apiBase = "https://another.example.com").sameCaptureOwner(owner))
        assertFalse((null as ProductSession?).sameCaptureOwner(owner))
        val action = Intent().bindCaptureOwner(owner)
        assertEquals("login", action.getStringExtra("account_id"))
        assertEquals("person-a", action.getStringExtra("account_subject"))
        assertEquals(5L, action.getLongExtra("account_generation", -1))
    }
}
