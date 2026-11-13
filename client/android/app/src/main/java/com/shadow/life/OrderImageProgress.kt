package com.shadow.life

/** Each offset is relative to the beginning of its independently renderable segment. */
internal class OrderImageProgress(private val width: Int, private val screenHeight: Int) {
    private val groups = mutableListOf(mutableListOf(0))
    val segments: List<List<Int>> get() = groups
    var pages = 1
        private set
    val canReadNext get() = pages < 32
    val height get() = screenHeight + groups.last().last()

    fun add(delta: Int?): Boolean {
        if (!canReadNext || delta != null && delta < 16) return false
        if (delta == null || height + delta > 18_000 || width.toLong() * (height + delta) > 24_000_000) {
            groups.add(mutableListOf(0))
        } else {
            groups.last().add(groups.last().last() + delta)
        }
        pages++
        return true
    }
}
