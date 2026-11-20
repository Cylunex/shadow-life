package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import org.json.JSONObject

private val extraIntakeFields=setOf(
  "food_ref_id","amount_g","weight_basis","fiber_g","sodium_mg","calcium_mg","iron_mg",
  "provenance","estimate","evidence_note","consumed_fraction"
)

internal fun ListMealsResultDtoItemsEntryItemsEntry.captureFood():MealDraftItem{
  val source=Json.encodeToJsonElement(ListMealsResultDtoItemsEntryItemsEntry.serializer(),this).jsonObject
  val retained=source.filter{(key,value)->key in extraIntakeFields&&value!=JsonNull}.toMutableMap().apply {
    // A previous meal's measurement or estimate is a reference for this meal.
    remove("weight_basis")
    if(estimate||provenance=="estimated"||weightBasis!=null){
      put("estimate",JsonPrimitive(true))
      val note=evidenceNote?.takeIf(String::isNotBlank)
      val basis=if(note==null)"沿用上一餐记录的份量或营养估算" else "沿用上一餐记录。原依据：$note".take(500)
      put("evidence_note",JsonPrimitive(basis))
    }
  }
  return MealDraftItem(name,quantity.orEmpty(),unit.orEmpty(),energyKcal.orEmpty(),proteinG.orEmpty(),fatG.orEmpty(),carbG.orEmpty(),JsonObject(retained).toString())
}

internal fun MerchantMenuResultDtoItemsEntry.portionFood(grams:String="",usePortion:Boolean=true):MealDraftItem{
  val extras=JSONObject().put("food_ref_id",id)
  val portion=profile?.portion?.takeIf{usePortion&&grams.isBlank()}
  val nutrients=portion?.nutrients?.let{JSONObject(Json.encodeToString(MerchantMenuResultDtoItemsEntryProfilePortionNutrients.serializer(),it))}
  if(grams.isNotBlank()){
    extras.put("amount_g",grams).put("estimate",true).put("evidence_note","本人填写本次估重")
  } else if(portion!=null){
    extras.put("amount_g",portion.grams).put("estimate",portion.estimated).put("provenance","reference_snapshot")
      .put("evidence_note","按菜品档案第${revision}版的常用份量。依据：${portion.basis}".take(500))
    listOf("fiber_g","sodium_mg","calcium_mg","iron_mg").forEach{key->
      if(nutrients?.isNull(key)==false)extras.put(key,nutrients.getString(key))
    }
  }
  fun nutrient(key:String)=nutrients?.takeUnless{it.isNull(key)}?.optString(key).orEmpty()
  return MealDraftItem(dish,portion?.quantity.orEmpty(),portion?.unit.orEmpty(),nutrient("energy_kcal"),
    nutrient("protein_g"),nutrient("fat_g"),nutrient("carb_g"),extras.toString())
}

internal fun MealDraftItem.rename(value:String):MealDraftItem =
  if(value.trim()==name.trim()||sourceJson.isBlank())copy(name=value) else MealDraftItem(name=value)

internal fun MealDraftItem.extraIntake():JSONObject=JSONObject(sourceJson.ifBlank{"{}"}).apply{
  keys().asSequence().toList().filterNot{it in extraIntakeFields}.forEach{remove(it)}
}

@Composable internal fun MealCaptureFoodPicker(accountId:String,capacity:Int,onDismiss:()->Unit,onAdd:(List<MealDraftItem>)->Unit){
  val context=LocalContext.current
  val repo=remember(accountId){NativeLifeRepository(context,context.applicationContext as ShadowApp)}
  var query by rememberSaveable{mutableStateOf("")}
  var search by rememberSaveable{mutableStateOf<String?>(null)}
  var revision by remember{mutableIntStateOf(0)}
  var menu by remember(search,revision){mutableStateOf<LoadState<MerchantMenuResultDto>>(LoadState.Loading)}
  var frequent by remember(revision){mutableStateOf<LoadState<MerchantMenuResultDtoDirectory>>(LoadState.Loading)}
  val selected=remember{mutableStateMapOf<String,MealDraftItem>()}
  LaunchedEffect(accountId,search,revision){
    val term=search
    try{
      if(term==null)frequent=LoadState.Ready(repo.diningDirectory())
      else menu=LoadState.Ready(repo.canteenProfiles("",term,null))
    } catch(error:CancellationException){throw error}
    catch(error:Exception){
      val failure=LoadState.Failed(error.message?:"暂时读不到菜品")
      if(term==null)frequent=failure else menu=failure
    }
  }
  LifeFullScreen("选择菜品",onDismiss){
    Column(Modifier.fillMaxSize(),verticalArrangement=Arrangement.spacedBy(8.dp)){
      OutlinedTextField(query,{query=it},Modifier.fillMaxWidth(),label={Text("搜索门店菜品")},singleLine=true,
        trailingIcon={TextButton(onClick={search=query.trim().takeIf(String::isNotEmpty);revision++}){Text("搜索")}})
      if(search!=null)TextButton(onClick={query="";search=null}){Text("查看常吃菜品")}
      LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){
        val suggestions=(frequent as? LoadState.Ready)?.value?.dishes.orEmpty()
        val results=(menu as? LoadState.Ready)?.value?.items.orEmpty()
        if(search==null){
          item{StateContent(frequent,{revision++}){if(suggestions.isEmpty())Text("还没有常吃菜品，可搜索门店或手动填写。")}}
          items(suggestions,key={it.foodId?:it.name+it.merchant}){suggestion->
            var loading by remember{mutableStateOf(false)}
            var failure by remember{mutableStateOf<String?>(null)}
            val scope=rememberCoroutineScope()
            val id=suggestion.foodId?:suggestion.name+suggestion.merchant
            val checked=id in selected
            TextButton(enabled=!loading&&(checked||selected.size<capacity),onClick={
              if(checked){selected.remove(id)}
              else if(suggestion.foodId==null){selected[id]=MealDraftItem(name=suggestion.name)}
              else{
                loading=true;failure=null
                scope.launch{
                  try{
                    val row=repo.canteenProfiles(suggestion.merchant.orEmpty(),suggestion.name,null).items.firstOrNull{it.id==id}
                    if(selected.size<capacity)selected[id]=row?.portionFood()?:MealDraftItem(name=suggestion.name)
                  }catch(error:CancellationException){throw error}
                  catch(error:Exception){failure=error.message?:"读取菜品失败"}
                  finally{loading=false}
                }
              }
            }){Text(if(loading)"正在读取" else (if(checked)"✓ " else "＋ ")+suggestion.name)}
            failure?.let{Text(it,color=MaterialTheme.colorScheme.error)}
          }
        } else {
          item{StateContent(menu,{revision++}){if(results.isEmpty())Text("没有匹配的菜品")}}
          items(results,key={it.id}){row->
            val checked=row.id in selected
            TextButton(enabled=checked||selected.size<capacity,onClick={
              if(checked)selected.remove(row.id) else selected[row.id]=row.portionFood()
            }){Text((if(checked)"✓ " else "＋ ")+row.name)}
          }
        }
      }
      Button(onClick={onAdd(selected.values.toList())},enabled=selected.isNotEmpty(),modifier=Modifier.fillMaxWidth()){
        Text("加入 ${selected.size} 项")
      }
    }
  }
}
