package com.shadow.life

import java.math.BigDecimal
import java.security.MessageDigest

internal fun paymentAutoKey(account:String,pkg:String)="payment_auto:$account:$pkg"
internal data class PaymentAutoRule(val platform:String,val sourceAccount:String)
internal data class PaymentPageResult(val identity:String,val hasTransaction:Boolean,val complete:Boolean)

/** A prefilter for collection. The server remains responsible for interpreting and booking money. */
internal fun paymentResultPage(pkg:String,activity:String,text:String,rule:PaymentAutoRule):PaymentPageResult? {
    if(rule.platform !in setOf("wechat","alipay"))return null
    val lines=text.lineSequence().map(String::trim).filter(String::isNotBlank).toList()
    if(lines.any{it in setOf("账单详情","交易详情","账单列表","全部账单","订单详情","聊天","收款成功","退款成功")})return null
    if(listOf("支付密码","验证码","确认付款","确认支付","待付款","支付失败","交易关闭","退款处理中").any(text::contains))return null
    if(lines.none{it.removePrefix("当前状态：").removePrefix("交易状态：") in setOf("支付成功","付款成功","交易成功")})return null
    val native=billPlatforms[pkg]==rule.platform
    val nativeActivity=when(rule.platform){
        "wechat"->activity.startsWith("com.tencent.mm.")&&listOf("wallet","wxpay","remittance","UIPageFragmentActivity","WxaLiteApp").any{activity.contains(it,true)}
        else->activity.startsWith("com.alipay.")||activity.startsWith("com.eg.android.AlipayGphone.")
    }
    val completed=lines.any{it in setOf("完成","返回商家","返回商户","返回应用","完成付款","继续购物")}
    if(native){if(!nativeActivity||!completed)return null}
    else if(!completed||!(if(rule.platform=="wechat")text.contains("微信支付") else text.contains("支付宝")))return null
    if(activity.contains("detail",true)||activity.contains("history",true))return null
    fun values(labels:Set<String>):List<String> = lines.flatMapIndexed { i,line ->
        labels.flatMap{label->when{line==label||line=="$label："||line=="$label:"->listOfNotNull(lines.getOrNull(i+1));line.startsWith("$label：")||line.startsWith("$label:")->listOf(line.substring(label.length+1).trim());else->emptyList()}}
    }
    val amounts=values(setOf("实付金额","实付款","实际支付","实际付款","支付金额","付款金额"))
        .mapNotNull{Regex("^(?:[¥￥]\\s*)?(\\d{1,12}(?:\\.\\d{1,2})?)(?:\\s*元)?$").matchEntire(it)?.groupValues?.get(1)?.toBigDecimalOrNull()}.distinctBy{it.stripTrailingZeros()}
    // A native result may show only a single prominent currency amount. Merchant pages need a labelled paid amount.
    val heading=if(native&&amounts.isEmpty())lines.filter{Regex("^[¥￥]\\s*\\d{1,12}(?:\\.\\d{1,2})?(?:\\s*元)?$").matches(it)}.map{it.replace(Regex("[¥￥元\\s]"),"").toBigDecimal()}.distinctBy{it.stripTrailingZeros()} else emptyList()
    val selected=if(amounts.isNotEmpty())amounts else heading
    if(selected.size!=1||selected.single()<=BigDecimal.ZERO)return null
    val ids=values(setOf("交易单号","交易号","微信支付单号","支付宝交易号")+(if(rule.platform=="alipay")setOf("订单号") else emptySet()))
        .filter{Regex("^[A-Za-z0-9_-]{8,120}$").matches(it)}.distinct()
    if(ids.size>1)return null
    val identity=ids.singleOrNull()?.let{"trade:$it"}?:"page:${lines.filterNot{it.matches(Regex("\\d{1,2}:\\d{2}(?::\\d{2})?"))}.sorted().joinToString("|")}"
    val time=values(setOf("支付时间","付款时间","交易时间")).any{Regex("^\\d{4}[-年]\\d{1,2}[-月]\\d{1,2}日? [0-9:]+$").matches(it)}
    return PaymentPageResult(paymentCaptureHash("${rule.platform}:${rule.sourceAccount}:$identity"),ids.isNotEmpty(),ids.isNotEmpty()&&time)
}
internal fun paymentCaptureHash(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString(""){"%02x".format(it)}

/** New content events extend one finite pass rather than cancelling it before it can read. */
internal class PaymentReadCycle {
    private var generation=0L
    private var target:String?=null
    fun select(key:String):Long {if(key!=target){target=key;generation++};return generation}
    fun current(key:String,token:Long)=target==key&&generation==token
    fun invalidate(){target=null;generation++}
}

internal interface CaptureTextNode {
    val visible:Boolean;val editable:Boolean;val secret:Boolean
    val text:String?;val description:String?;val childCount:Int
    fun child(index:Int):CaptureTextNode?
    fun release(){}
}
/** Reject partial trees: an unread child may contain an authentication input. */
internal fun readCompleteCaptureText(root:CaptureTextNode,strict:Boolean):String? {
    val queue=java.util.ArrayDeque<Pair<CaptureTextNode,Int>>();queue.add(root to 0)
    val lines=linkedSetOf<String>();var count=0;var length=0
    try{
        while(queue.isNotEmpty()){
            val (node,depth)=queue.removeFirst()
            try{
                if(++count>600||depth>64||node.childCount>100)return null
                if(node.secret||strict&&node.visible&&node.editable)return null
                if(node.visible&&!node.editable){
                    for(value in listOfNotNull(node.text,node.description).map(String::trim).filter(String::isNotEmpty).distinct()){
                        length+=value.length;if(value.length>2048||length>12000)return null
                        lines.add(value)
                    }
                }
                for(i in 0 until node.childCount){val child=node.child(i)?:return null;queue.add(child to depth+1)}
            }finally{node.release()}
        }
        return lines.takeIf{it.isNotEmpty()}?.joinToString("\n")
    }finally{queue.forEach{it.first.release()}}
}
