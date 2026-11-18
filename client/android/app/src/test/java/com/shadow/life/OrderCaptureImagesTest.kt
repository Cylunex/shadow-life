package com.shadow.life

import org.junit.Assert.assertEquals
import org.junit.Assert.assertSame
import org.junit.Test

class OrderCaptureImagesTest {
    @Test fun retriesJpegQualityBeforeSplitting() {
        val oversized = ByteArray(ORDER_IMAGE_UPLOAD_BYTES + 1)
        val acceptable = ByteArray(16)
        val qualities = mutableListOf<Int>()
        val actual = fitOrderImage { quality ->
            qualities.add(quality)
            if (quality > 60) oversized else acceptable
        }
        assertSame(acceptable, actual)
        assertEquals(listOf(90, 75, 60), qualities)
    }
}
