package com.shadow.life

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class LoginRecoveryTest {
  @Test fun silentSsoFailureFallsBackToInteractiveLogin(){
    assertEquals(LoginMode.Interactive,nextLoginModeAfterFailure(LoginMode.Silent))
  }

  @Test fun interactiveFailureStopsInsteadOfLooping(){
    assertEquals(LoginMode.None,nextLoginModeAfterFailure(LoginMode.Interactive))
  }

  @Test fun missingAttemptDoesNotStartAnUnexpectedLogin(){
    assertEquals(LoginMode.None,nextLoginModeAfterFailure(LoginMode.None))
  }

  @Test fun unchangedFreshTokenStateDoesNotRewriteTheEncryptedSession(){
    val saved=ProductSession("account","subject","https://life.example.com","state",tokenRevision=8)
    assertSame(saved,updatedSessionAfterRefresh(saved,"state"))
  }

  @Test fun refreshedTokenStateAdvancesTheStoredRevision(){
    val saved=ProductSession("account","subject","https://life.example.com","state",tokenRevision=8)
    val updated=updatedSessionAfterRefresh(saved,"refreshed-state")
    assertEquals("refreshed-state",updated.authStateJson)
    assertEquals(9,updated.tokenRevision)
  }
}
