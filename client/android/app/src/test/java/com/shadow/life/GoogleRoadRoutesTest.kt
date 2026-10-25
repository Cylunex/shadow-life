package com.shadow.life

import org.junit.Assert.assertEquals
import org.junit.Test

class GoogleRoadRoutesTest {
  @Test fun decodesGoogleRoadGeometry(){
    assertEquals(
      listOf(TravelMapPoint(38.5,-120.2),TravelMapPoint(40.7,-120.95),TravelMapPoint(43.252,-126.453)),
      decodeGooglePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@")
    )
  }
}
