package com.shadow.life

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

data class DeviceSyncStatus(
  val samsungState:String="idle",val samsungMessage:String="尚未连接",val samsungUpdatedAt:Long=0,val samsungRecords:Int=0,
  val scaleState:String="idle",val scaleMessage:String="尚未开始称重",val scaleUpdatedAt:Long=0,
  val scaleLastWeight:String?=null,val scaleLastModel:String?=null,val scaleMeasuredAt:Long=0
)

class DeviceSyncStatusStore(context:Context){
  private val values=EncryptedSharedPreferences.create(
    context,"shadow-life-device-sync",
    MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
    EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
  )
  fun current(accountId:String)=DeviceSyncStatus(
    samsungState=values.getString(key(accountId,"samsung_state"),"idle").orEmpty(),
    samsungMessage=values.getString(key(accountId,"samsung_message"),"尚未连接").orEmpty(),
    samsungUpdatedAt=values.getLong(key(accountId,"samsung_updated_at"),0),
    samsungRecords=values.getInt(key(accountId,"samsung_records"),0),
    scaleState=values.getString(key(accountId,"scale_state"),"idle").orEmpty(),
    scaleMessage=values.getString(key(accountId,"scale_message"),"尚未开始称重").orEmpty(),
    scaleUpdatedAt=values.getLong(key(accountId,"scale_updated_at"),0),
    scaleLastWeight=values.getString(key(accountId,"scale_weight"),null),
    scaleLastModel=values.getString(key(accountId,"scale_model"),null),
    scaleMeasuredAt=values.getLong(key(accountId,"scale_measured_at"),0)
  )
  fun observe(accountId:String):Flow<DeviceSyncStatus> = callbackFlow{
    trySend(current(accountId));val prefix="$accountId:"
    val listener=SharedPreferences.OnSharedPreferenceChangeListener{_,changed->if(changed?.startsWith(prefix)==true)trySend(current(accountId))}
    values.registerOnSharedPreferenceChangeListener(listener);awaitClose{values.unregisterOnSharedPreferenceChangeListener(listener)}
  }
  fun updateSamsung(accountId:String,state:String,message:String,records:Int?=null){values.edit().putString(key(accountId,"samsung_state"),state).putString(key(accountId,"samsung_message"),message).putLong(key(accountId,"samsung_updated_at"),System.currentTimeMillis()).apply{records?.let{putInt(key(accountId,"samsung_records"),it)}}.apply()}
  fun updateScale(accountId:String,state:String,message:String){values.edit().putString(key(accountId,"scale_state"),state).putString(key(accountId,"scale_message"),message).putLong(key(accountId,"scale_updated_at"),System.currentTimeMillis()).apply()}
  fun recordScale(accountId:String,weight:String,model:String,measuredAt:Long){values.edit().putString(key(accountId,"scale_state"),"queued").putString(key(accountId,"scale_message"),"已收到稳定读数，等待上传").putLong(key(accountId,"scale_updated_at"),System.currentTimeMillis()).putString(key(accountId,"scale_weight"),weight).putString(key(accountId,"scale_model"),model).putLong(key(accountId,"scale_measured_at"),measuredAt).apply()}
  private fun key(accountId:String,name:String)="$accountId:$name"
}
