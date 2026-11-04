package com.shadow.life

internal val billPlatforms = mapOf("com.tencent.mm" to "wechat", "com.eg.android.AlipayGphone" to "alipay")
internal fun shakeKey(account: String, pkg: String) = "bill_shake:${account}:${pkg}"

// Remove gravity before comparing motion vectors, so the same wrist motion works
// with the phone upright, flat or tilted. Require a reversal, not a single bump.
internal class BillShakeGesture {
    private var gravity:FloatArray?=null
    private var first:FloatArray?=null
    private var firstAt = -1L
    private var quietUntil = 0L
    fun sample(ms: Long, x: Float, y: Float, z: Float): Boolean {
        val raw=floatArrayOf(x,y,z)
        val g=gravity?:run{gravity=raw;return false}
        val motion=FloatArray(3){i->g[i]=0.8f*g[i]+0.2f*raw[i];raw[i]-g[i]}
        if(ms<quietUntil)return false
        val size=kotlin.math.sqrt(motion.sumOf{(it*it).toDouble()}).toFloat()
        if(size<7f)return false
        val direction=FloatArray(3){motion[it]/size}
        val previous=first
        if(previous!=null && ms-firstAt in 70..700 && (0..2).sumOf{(previous[it]*direction[it]).toDouble()} < -0.3){
            first=null;firstAt=-1;quietUntil=ms+2500;return true
        }
        if(previous==null || ms-firstAt>700){first=direction;firstAt=ms}
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
