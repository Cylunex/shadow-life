package com.shadow.life

import org.junit.Assert.assertEquals
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
}
