package com.shadow.life

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Rect
import java.io.ByteArrayOutputStream

internal fun Bitmap.orderImageBytes(quality: Int = 95): ByteArray =
    ByteArrayOutputStream().use {
        check(compress(Bitmap.CompressFormat.JPEG, quality, it)) { "截图编码失败" }
        it.toByteArray()
    }

/** Decode one viewport at a time. An oversized segment splits at a known viewport boundary. */
internal fun encodeOrderSegments(frames: List<ByteArray>, segments: List<List<Int>>, width: Int, height: Int): List<ByteArray> {
    val result = mutableListOf<ByteArray>()
    fun encode(first: Int, offsets: List<Int>) {
        val base = offsets.first()
        val bytes = if (offsets.size == 1 && frames[first].size <= 10_000_000) frames[first] else {
            val image = Bitmap.createBitmap(width, height + offsets.last() - base, Bitmap.Config.ARGB_8888)
            try {
                val canvas = Canvas(image)
                for ((index, offset) in offsets.withIndex()) {
                    val encoded = frames[first + index]
                    val frame = BitmapFactory.decodeByteArray(encoded, 0, encoded.size)
                    try {
                        val top = if (index == 0) offset else (offset + offsets[index - 1] + height) / 2
                        val bottom = if (index == offsets.lastIndex) offset + height else (offset + offsets[index + 1] + height) / 2
                        canvas.drawBitmap(frame, Rect(0, top - offset, width, bottom - offset), Rect(0, top - base, width, bottom - base), null)
                    } finally { frame.recycle() }
                }
                var quality = 90
                var output = image.orderImageBytes(quality)
                while (offsets.size == 1 && output.size > 10_000_000 && quality > 30) {
                    quality -= 15
                    output = image.orderImageBytes(quality)
                }
                output
            } finally { image.recycle() }
        }
        if (bytes.size <= 10_000_000) result.add(bytes) else {
            check(offsets.size > 1) { "单屏截图超过上传限制" }
            val middle = offsets.size / 2
            encode(first, offsets.subList(0, middle))
            encode(first + middle, offsets.subList(middle, offsets.size))
        }
    }
    var first = 0
    for (segment in segments) {
        encode(first, segment)
        first += segment.size
    }
    return result
}
