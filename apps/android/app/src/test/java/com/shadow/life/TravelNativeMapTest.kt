package com.shadow.life

import com.amap.api.maps.AMap
import org.junit.Assert.assertEquals
import org.junit.Test

class TravelNativeMapTest {
  @Test fun nativeAmapUsesReadableNormalBaseMap(){
    assertEquals(AMap.MAP_TYPE_NORMAL,preferredAmapMapType())
  }
}
