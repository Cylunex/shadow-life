package com.shadow.life

import android.content.Context
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId

internal object OrderCaptureSettings {
 fun modeKey(account:String)="order_image_mode:$account"
 fun modelKey(account:String)="order_image_model:$account"
 fun mode(context:Context,account:String)=context.getSharedPreferences("activity_capture",0).getString(modeKey(account),"losna").takeIf{it in setOf("losna","llm","save")}?:"losna"
 fun model(context:Context,account:String)=context.getSharedPreferences("activity_capture",0).getString(modelKey(account),"default")?.takeIf{Regex("^[a-z][a-z0-9_-]{0,39}$").matches(it)}?:"default"
 fun apply(context:Context,account:String,input:JSONObject):JSONObject {
  val mode=mode(context,account);input.put("recognition",mode)
  if(mode=="llm")input.put("vision_model_id",model(context,account))
  return input
 }
}

/** Shared originals are routed without trying to OCR/classify the image on the phone. */
internal fun sharedImageMetadata(context:Context,account:String,batch:String?=null):String {
 val input=JSONObject().put("title","分享图片").put("captured_at",Instant.now().toString()).put("time_zone",ZoneId.systemDefault().id)
 if(batch!=null)input.put("batch_id","share_"+batch.take(48).replace(Regex("[^a-z0-9_]"),"_"))
 return JSONObject().put("capability","life.capture_screenshot").put("input",OrderCaptureSettings.apply(context,account,input)).toString()
}
