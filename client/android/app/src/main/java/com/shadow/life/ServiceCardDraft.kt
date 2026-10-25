package com.shadow.life

import org.json.JSONObject
import java.time.LocalDate
import java.time.ZoneId

data class NativeServiceCardDraft(
  val name:String,val merchantName:String,val purchaseRecordId:String?,val totalUnits:String,
  val unitLabel:String,val startedOn:String,val expiresOn:String,val note:String,
  val existing:ServiceCardsResultDtoItemsEntry?=null,val state:String="active"
)

data class NativeServiceCardUseDraft(
  val card:ServiceCardsResultDtoItemsEntry,val occurredOn:String,val units:String,
  val note:String,val existing:ServiceCardsResultDtoItemsEntryUsesEntry?=null,val state:String="active"
)

internal fun serviceCardPayload(draft:NativeServiceCardDraft,zone:ZoneId):JSONObject{
  val name=draft.name.trim();require(name.isNotEmpty()&&name.length<=200){"请填写卡名（最多 200 字）"}
  val units=draft.totalUnits.trim().toLongOrNull();require(units!=null&&units in 1..1_000_000){"总次数需为 1 至 1000000 的整数"}
  val label=draft.unitLabel.trim();require(label.isNotEmpty()&&label.length<=8){"请填写单位（最多 8 字）"}
  val start=runCatching{LocalDate.parse(draft.startedOn)}.getOrElse{throw IllegalArgumentException("请输入有效的开始日期")}
  val expiry=draft.expiresOn.trim().takeIf{it.isNotEmpty()}?.let{runCatching{LocalDate.parse(it)}.getOrElse{throw IllegalArgumentException("请输入有效的到期日期")}}
  require(expiry==null||!expiry.isBefore(start)){"到期日期不能早于开始日期"}
  require(draft.state in setOf("active","closed")){"不支持的次卡状态"}
  val note=draft.note.trim();require(note.length<=2000){"备注不能超过 2000 字"}
  return JSONObject().put("name",name).put("total_units",units).put("unit_label",label)
    .put("started_on",start.toString()).put("time_zone",draft.existing?.timeZone?:zone.id)
    .put("state",draft.state).apply{
      draft.existing?.let{put("card_id",it.id);put("expected_revision",it.revision);put("reason","更新次卡资料")}
      draft.merchantName.trim().takeIf{it.isNotEmpty()}?.let{put("merchant_name",it)}
      draft.purchaseRecordId?.takeIf{it.isNotBlank()}?.let{put("purchase_record_id",it)}
      expiry?.let{put("expires_on",it.toString())}
      note.takeIf{it.isNotEmpty()}?.let{put("note",it)}
    }
}

internal fun serviceCardUsePayload(draft:NativeServiceCardUseDraft):JSONObject{
  val date=runCatching{LocalDate.parse(draft.occurredOn)}.getOrElse{throw IllegalArgumentException("请输入有效的使用日期")}
  val units=draft.units.trim().toLongOrNull();require(units!=null&&units in 1..1_000_000){"使用次数需为正整数"}
  require(draft.state in setOf("active","voided")){"不支持的使用状态"}
  require(draft.state!="voided"||draft.existing!=null){"只能撤销已有使用记录"}
  val note=draft.note.trim();require(note.length<=2000){"备注不能超过 2000 字"}
  return JSONObject().put("card_id",draft.card.id).put("expected_revision",draft.card.revision)
    .put("occurred_on",date.toString()).put("units",units).put("state",draft.state).apply{
      draft.existing?.let{put("use_id",it.id);put("reason",if(draft.state=="voided")"撤销误记的用卡" else "更正实际用卡记录")}
      note.takeIf{it.isNotEmpty()}?.let{put("note",it)}
    }
}
