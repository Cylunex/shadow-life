package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import org.json.JSONObject

internal val LocalHealthReferences=staticCompositionLocalOf<Map<String,HealthReference>>{emptyMap()}
internal val LocalEditHealthReference=staticCompositionLocalOf<(String,String,String,Boolean)->Unit>{{_,_,_,_->}}
@Composable internal fun healthTone(tone:HealthTone):Color {
  val dark=MaterialTheme.colorScheme.background.luminance()<.5f
  return when(tone){HealthTone.Low->if(dark)Color(0xFF79BAFF) else Color(0xFF245F99);HealthTone.Good->if(dark)Color(0xFF9ADA96) else Color(0xFF2E6A35);HealthTone.High->if(dark)Color(0xFFFFB46B) else Color(0xFF965400);HealthTone.Neutral->MaterialTheme.colorScheme.onSurfaceVariant}
}
@Composable internal fun metricAssessment(key:String,value:Double?,unit:String,goal:Boolean=false)=assessHealth(value,unit,LocalHealthReferences.current[key]?:defaultHealthReference(key),goal)
@Composable internal fun AssessmentLabel(value:HealthAssessment,showBasis:Boolean=true){Column(verticalArrangement=Arrangement.spacedBy(3.dp)){Text(value.label,color=healthTone(value.tone),style=MaterialTheme.typography.labelLarge);if(showBasis)Text(value.basis,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)}}
@Composable internal fun ReferenceLegend(){Row(horizontalArrangement=Arrangement.spacedBy(16.dp)){listOf(HealthTone.Low to "偏低",HealthTone.Good to "合格",HealthTone.High to "偏高",HealthTone.Neutral to "未评级").forEach{(tone,label)->Text("● $label",style=MaterialTheme.typography.labelMedium,color=healthTone(tone))}}}
private data class ReferenceEditor(val key:String,val label:String,val unit:String,val goal:Boolean)
@Composable internal fun HealthReferenceProvider(accountId:String,profile:ScaleProfileSettings,content:@Composable ()->Unit){
  val context=LocalContext.current
  val prefs=remember(accountId){val hash=java.security.MessageDigest.getInstance("SHA-256").digest(accountId.toByteArray()).joinToString(""){"%02x".format(it)};context.getSharedPreferences("health-display-$hash",0)}
  var references by remember(accountId){mutableStateOf(runCatching{val json=JSONObject(prefs.getString("references","{}")?:"{}");json.keys().asSequence().associateWith{key->val item=json.getJSONObject(key);HealthReference(item.optString("low").toDoubleOrNull(),item.optString("high").toDoubleOrNull(),item.getString("unit"),item.optString("basis","自定参考"))}}.getOrDefault(emptyMap()))}
  val baseline=adultWeightReference(profile.heightCm,profile.birthDate)?.let{mapOf("weight" to it)}.orEmpty()
  var editor by remember(accountId){mutableStateOf<ReferenceEditor?>(null)}
  fun save(key:String,value:HealthReference?){references=references.toMutableMap().apply{if(value==null)remove(key) else put(key,value)};val json=JSONObject();references.forEach{(k,v)->json.put(k,JSONObject().put("low",v.low).put("high",v.high).put("unit",v.unit).put("basis",v.basis))};prefs.edit().putString("references",json.toString()).apply()}
  CompositionLocalProvider(LocalHealthReferences provides (baseline+references),LocalEditHealthReference provides {key,label,unit,goal->editor=ReferenceEditor(key,label,unit,goal)},content=content)
  editor?.let{item->
    val current=references[item.key]?:baseline[item.key]?:defaultHealthReference(item.key)
    var low by remember(item){mutableStateOf(current?.low?.toString().orEmpty())};var high by remember(item){mutableStateOf(current?.high?.toString().orEmpty())}
    val lower=low.toDoubleOrNull();val upper=high.toDoubleOrNull()
    val valid=(lower!=null||(!item.goal&&upper!=null))&&(low.isBlank()||lower?.isFinite()==true)&&(item.goal||high.isBlank()||upper?.isFinite()==true)&&(lower==null||lower>=0)&&(upper==null||upper>=0)&&(item.goal||lower==null||upper==null||lower<=upper)
    AlertDialog(onDismissRequest={editor=null},title={Text("${item.label}${if(item.goal)"目标" else "参考范围"}")},text={Column(verticalArrangement=Arrangement.spacedBy(10.dp)){Text("用于当前账号在这台设备上的颜色展示。${if(item.goal)"达到目标后显示绿色，不把更高活动量标成异常。" else "按你适用的参考范围填写，留空表示不设该边界。"}",style=MaterialTheme.typography.bodySmall);OutlinedTextField(low,{low=it},label={Text("${if(item.goal)"目标" else "下限"}（${item.unit}）")},singleLine=true);if(!item.goal)OutlinedTextField(high,{high=it},label={Text("上限（${item.unit}）")},singleLine=true);TextButton(onClick={save(item.key,null);editor=null}){Text("恢复默认")}}},dismissButton={TextButton(onClick={editor=null}){Text("取消")}},confirmButton={TextButton(enabled=valid,onClick={save(item.key,HealthReference(lower,if(item.goal)null else upper,item.unit,if(item.goal)"自定目标" else "自定参考"));editor=null}){Text("保存")}})
  }
}
