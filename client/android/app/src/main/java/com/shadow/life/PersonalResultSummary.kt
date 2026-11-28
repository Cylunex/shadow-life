package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject

private val headingKeys = listOf("title","name","raw_name","dish","label","service_number","route","source_name","date","occurred_on","local_day","kind")
private val summaryKeys = listOf("value","unit","amount","currency","date","occurred_on","local_day","tested_on","origin","destination","started_at","ended_at","received","remaining","distance_km","duration_minutes","sleep_minutes","supporting")
private val resultLabels = mapOf(
  "origin" to "出发","destination" to "抵达","started_at" to "开始","ended_at" to "结束",
  "id" to "记录编号","record_id" to "消费记录编号","refund_entry_id" to "退款编号","asset_version_id" to "附件版本编号",
  "received" to "已到账","remaining" to "差额","distance_km" to "公里","duration_minutes" to "分钟","sleep_minutes" to "主睡眠分钟",
  "revision" to "修订","note" to "备注","source" to "来源","kind" to "类型","refs" to "关联资料",
  "amount" to "金额", "title" to "标题", "value" to "结果", "unit" to "单位", "date" to "日期", "query" to "筛选条件",
  "allocated" to "已分配", "available" to "可分配", "occurred_at" to "发生时间", "counterparty" to "交易对方",
  "payment_method" to "支付方式", "import_ids" to "导入单号", "order_ids" to "订单号", "source_name" to "来源名称",
  "at" to "时间", "severity" to "程度", "text" to "内容", "amount_g" to "重量（克）", "report_title" to "报告",
  "state" to "状态", "matched" to "已匹配预订", "start_ms" to "选段开始（秒）", "end_ms" to "选段结束（秒）",
  "line_amount" to "小计", "merchant" to "商家", "product" to "商品", "unit_price" to "单价", "base_unit" to "计价单位"
)
private val resultCodes = mapOf(
  "same_time_amount" to "同一时刻同额", "same_day_amount" to "同日同额", "linked" to "已关联",
  "suspected_duplicate" to "疑似重复", "order_conflict" to "订单冲突", "import_candidate" to "导入候选",
  "android_order" to "手机采集订单", "source" to "原始来源", "mail" to "邮件来源", "photo" to "照片",
  "audio" to "音频", "visit" to "到访", "true" to "是", "false" to "否"
)

private fun displayValue(key:String, value:Any, labels:Map<String,String>, zone:String?):String = when(value){
  is JSONObject -> value.keys().asSequence().mapNotNull{field->
    if(value.isNull(field))return@mapNotNull null
    val label=labels[field] ?: field.replace('_',' ')
    displayValue(field,value.get(field),labels,zone).takeIf(String::isNotBlank)?.let{"$label $it"}
  }.joinToString(" · ")
  is JSONArray -> (0 until value.length()).filterNot{value.isNull(it)}.map{displayValue(key,value.get(it),labels,zone)}
    .filter(String::isNotBlank).joinToString("\n")
  else -> {
    val text=value.toString()
    when {
      key in setOf("at","started_at","starts_at","ended_at","occurred_at") -> localDateTime(text,zone) ?: text
      key=="start_ms" || key=="end_ms" -> text.toBigDecimalOrNull()?.movePointLeft(3)?.stripTrailingZeros()?.toPlainString() ?: text
      key in setOf("basis","kind","relation","selected","is_rest") -> resultCodes[text] ?: text
      else -> text
    }
  }
}

@Composable internal fun PersonalResultSummary(row:JSONObject,formLabels:Map<String,String>,fallback:String,queryZone:String?=null){
  val labels=remember(formLabels){formLabels+resultLabels}
  val values=remember(row,labels,queryZone){
    val zone=row.optString("time_zone").takeUnless{it.isBlank() || it=="null"} ?: queryZone
    (headingKeys+summaryKeys+labels.keys).distinct().filter{key->
      !row.isNull(key)
    }.mapNotNull{key->displayValue(key,row.get(key),labels,zone).takeIf(String::isNotBlank)?.let{key to it}}.toMap()
  }
  val heading=headingKeys.firstOrNull{it in values}
  Text(values[heading] ?: fallback,style=MaterialTheme.typography.titleMedium)
  val summary=summaryKeys.filter{it!=heading && it in values}
  val facts=summary.mapNotNull{field->
    val value=values.getValue(field)
    when(field){
      "value" -> listOfNotNull(value,values["unit"]).joinToString(" ")
      "amount" -> listOfNotNull(values["currency"],value).joinToString(" ")
      "unit" -> value.takeUnless{"value" in summary}
      "currency" -> value.takeUnless{"amount" in summary}
      "started_at","ended_at","origin","destination","received","remaining","sleep_minutes" -> "${labels.getValue(field)} $value"
      "distance_km","duration_minutes" -> "$value ${labels.getValue(field)}"
      else -> value
    }
  }
  if(facts.isNotEmpty())Text(facts.joinToString(" · "),style=MaterialTheme.typography.bodyMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
  val details=values.filterKeys{it!=heading && it !in summary}
  if(details.isNotEmpty()){
    var expanded by rememberSaveable{mutableStateOf(false)}
    LifeTextAction(onClick={expanded=!expanded}){Text(if(expanded)"收起详情" else "查看详情")}
    if(expanded)Column(verticalArrangement=Arrangement.spacedBy(8.dp)){
      details.forEach{(key,value)->
        Column(Modifier.fillMaxWidth()){
          Text(labels[key] ?: key,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
          Text(value,style=MaterialTheme.typography.bodyMedium)
        }
      }
    }
  }
}
