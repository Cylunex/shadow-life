package com.shadow.life

import com.amap.api.maps.AMap
import android.view.MotionEvent
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TravelNativeMapTest {
  @Test fun nativeAmapUsesReadableNormalBaseMap(){
    assertEquals(AMap.MAP_TYPE_NORMAL,preferredAmapMapType())
  }

  @Test fun nativeAmapUsesTextureSurfaceInsideComposeScrollingContent(){
    assertEquals(AmapSurfaceKind.Texture,preferredAmapSurface())
  }

  @Test fun nativeMapStartsAtOneKilometerScale(){
    assertEquals(15.5f,defaultTravelMapZoom())
  }

  @Test fun nativeMapDoesNotForwardNestedScrollToTheOuterList(){
    assertFalse(nativeMapNestedScrollingEnabled())
  }

  @Test fun mapGestureRequestsParentIsolationUntilTheGestureEnds(){
    assertTrue(shouldDisallowMapParentIntercept(MotionEvent.ACTION_DOWN))
    assertTrue(shouldDisallowMapParentIntercept(MotionEvent.ACTION_MOVE))
    assertTrue(shouldDisallowMapParentIntercept(MotionEvent.ACTION_POINTER_DOWN))
    assertFalse(shouldDisallowMapParentIntercept(MotionEvent.ACTION_UP))
    assertFalse(shouldDisallowMapParentIntercept(MotionEvent.ACTION_CANCEL))
  }
}
