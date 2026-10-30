package com.shadow.life

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import android.content.Context
import androidx.compose.runtime.*
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

/** Local UI drafts are encrypted and isolated by account and object; never business facts. */
internal class UiDraftStore(context:Context,accountId:String){
  private val account=java.security.MessageDigest.getInstance("SHA-256").digest(accountId.toByteArray()).joinToString(""){"%02x".format(it)}
  private val preferences=EncryptedSharedPreferences.create(context,"shadow-life-ui-drafts",
    MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build(),
    EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM)
  fun read(scope:String,field:String):String?=preferences.getString("$account/$scope/$field",null)
  fun write(scope:String,field:String,value:String){preferences.edit().putString("$account/$scope/$field",value).apply()}
  fun clear(scope:String){val prefix="$account/$scope/";preferences.edit().apply{preferences.all.keys.filter{it.startsWith(prefix)}.forEach{remove(it)}}.apply()}
}
internal data class UiDraftScope(val store:UiDraftStore,val name:String)
internal val LocalUiDraftScope=staticCompositionLocalOf<UiDraftScope?>{null}

@Composable internal fun rememberDraftText(fieldKey:String,initial:()->String):MutableState<String>{
  val scope=LocalUiDraftScope.current
  val state=remember(scope,fieldKey){mutableStateOf(scope?.store?.read(scope.name,fieldKey)?:initial())}
  return remember(scope,fieldKey){object:MutableState<String>{
    override var value:String
      get()=state.value
      set(value){scope?.store?.write(scope.name,fieldKey,value);state.value=value}
    override fun component1()=value
    override fun component2():(String)->Unit={value=it}
  }}
}

internal fun encodeMealDraftRows(rows:List<MealDraftItem>):String=Json.encodeToString(rows.map{listOf(it.name,it.quantity,it.unit,it.energyKcal,it.proteinG,it.fatG,it.carbG)})
internal fun decodeMealDraftRows(raw:String?):List<MealDraftItem>? = runCatching{
  val rows=Json.decodeFromString<List<List<String>>>(requireNotNull(raw));require(rows.size in 1..100)
  rows.map{row->require(row.size==7);MealDraftItem(row[0],row[1],row[2],row[3],row[4],row[5],row[6])}
}.getOrNull()
internal fun readMealDraftRows(raw:String?,initialName:String):List<MealDraftItem> = decodeMealDraftRows(raw)?:listOf(MealDraftItem(name=initialName))

/** Preserve object identity and expected revision together with form fields during recreation. */
@Composable internal fun <T> rememberJsonState(serializer:kotlinx.serialization.KSerializer<T>):MutableState<T?>{
  val raw=androidx.compose.runtime.saveable.rememberSaveable{mutableStateOf<String?>(null)}
  val decoded=remember{derivedStateOf{raw.value?.let{runCatching{Json.decodeFromString(serializer,it)}.getOrNull()}}}
  return remember{object:MutableState<T?>{
    override var value:T?
      get()=decoded.value
      set(value){raw.value=value?.let{Json.encodeToString(serializer,it)}}
    override fun component1()=value
    override fun component2():(T?)->Unit={value=it}
  }}
}

@Composable internal fun <T> rememberJsonList(serializer:kotlinx.serialization.KSerializer<T>):androidx.compose.runtime.snapshots.SnapshotStateList<T> =
  androidx.compose.runtime.saveable.rememberSaveable(saver=androidx.compose.runtime.saveable.listSaver<androidx.compose.runtime.snapshots.SnapshotStateList<T>,String>(
    save={rows->rows.map{Json.encodeToString(serializer,it)}},restore={rows->rows.map{Json.decodeFromString(serializer,it)}.toMutableStateList()}
  )){mutableStateListOf()}
