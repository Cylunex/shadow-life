package com.shadow.life

internal val billPlatforms = mapOf("com.tencent.mm" to "wechat", "com.eg.android.AlipayGphone" to "alipay")
internal fun shakeKey(account: String, pkg: String) = "bill_shake:${account}:${pkg}"

// Two opposite peaks distinguish a deliberate wrist movement from a single bump.
// Accelerometer samples include gravity; compare the dominant axis rather than device orientation.
internal class BillShakeGesture {
    private var firstAt = -1L
    private var axis = 0
    private var sign = false
    private var quietUntil = 0L

    fun sample(ms: Long, x: Float, y: Float, z: Float): Boolean {
        if (ms < quietUntil) return false
        val ax = kotlin.math.abs(x); val ay = kotlin.math.abs(y); val az = kotlin.math.abs(z)
        val nextAxis = if (ax >= ay && ax >= az) 0 else if (ay >= az) 1 else 2
        val peak = when (nextAxis) { 0 -> x; 1 -> y; else -> z }
        if (kotlin.math.abs(peak) < 17f) return false
        val elapsed = ms - firstAt
        if (firstAt >= 0 && elapsed <= 550 && axis == nextAxis) {
            if (elapsed < 70 || sign == (peak > 0)) return false
            firstAt = -1; quietUntil = ms + 2500
            return true
        }
        firstAt = ms; axis = nextAxis; sign = peak > 0
        return false
    }
}

// A gesture in a chat, a wallet home page or a list is not a request to upload its text.
internal fun resemblesBillDetail(text: String): Boolean {
    val lines = text.lineSequence().map(String::trim).toList()
    fun hasLabel(vararg labels: String) = lines.any { line ->
        labels.any { line == it || line.startsWith("$it：") || line.startsWith("$it:") }
    }
    val detail = lines.any { it in setOf("账单详情","交易详情","订单详情","支付详情","账单明细") }
    return detail && hasLabel("交易号","交易单号","微信支付单号","支付宝交易号","订单号","订单编号") &&
        hasLabel("支付时间","付款时间","交易时间","实付金额","实际支付","实付款","退款金额","当前状态","交易状态")
}
