package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import org.json.JSONObject

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun MealIntakeEditor(accountId:String,items:List<LifeRecordResultDtoMealItemsEntry>,meal:EditSeed.Meal,onReload:()->Unit){
  val context=LocalContext.current
  val app=context.applicationContext as ShadowApp
  val repository=remember(accountId){NativeLifeRepository(context,app)}
  val store=remember(accountId){UiDraftStore(context,accountId)}
  val scope=rememberCoroutineScope()
  var selected by rememberSaveable(meal.detailId){mutableStateOf<String?>(null)}
  var pending by rememberSaveable(meal.detailId){mutableStateOf<String?>(null)}
  var message by rememberSaveable(meal.detailId){mutableStateOf<String?>(null)}
  var busy by remember{mutableStateOf(false)}
  val enabled=!busy&&pending==null
  fun write(operation:suspend()->OperationReceipt){
    if(!enabled)return
    busy=true
    message=null
    scope.launch{
      try{
        check(app.sessions.active()?.accountId==accountId){"账号已切换"}
        pending=operation().commandId
        message="食物更正已存本机，待同步"
      }catch(error:CancellationException){throw error}
      catch(error:Exception){message=error.message?:"无法保存食物更正"}
      finally{busy=false}
    }
  }
  LaunchedEffect(accountId,pending){
    val command=pending?:return@LaunchedEffect
    val session=app.sessions.active()?.takeIf{it.accountId==accountId}?:return@LaunchedEffect
    val status=app.database.commands().observeCommandState(accountId,session.subjectId,command)
      .first{it in setOf("committed","failed","blocked")}
    if(status=="committed"){
      selected?.let{store.clear("intake/${meal.detailId}/$it")}
      selected=null
      message="食物已同步"
    } else message="食物未同步，草稿已保留。请查看同步状态。"
    pending=null
    onReload()
  }
  LifeSection("本餐食物"){
    items.forEach{item->
      key(item.id,item.revision){
        OutlinedButton(enabled=enabled,onClick={selected=if(selected==item.id)null else item.id},modifier=Modifier.fillMaxWidth()){
          Text(item.name,Modifier.weight(1f))
          Text(listOfNotNull(consumedAmount(item.quantity,item.consumedFraction),item.unit).joinToString(" "))
        }
        if(selected==item.id){
          val draftKey="intake/${meal.detailId}/${item.id}"
          var draft by remember{mutableStateOf(decodeMealDraftRows(store.read(draftKey,"row"))?.firstOrNull()?:item.editableFood())}
          val initialPercent=item.consumedFraction?.let{consumedAmount("100",it)}.orEmpty()
          var percent by remember{mutableStateOf(store.read(draftKey,"percent")?:initialPercent)}
          fun change(value:MealDraftItem){draft=value;store.write(draftKey,"row",encodeMealDraftRows(listOf(value)))}
          fun changePercent(value:String){percent=value;store.write(draftKey,"percent",value)}
          FoodEditFields(draft,enabled,::change)
          OutlinedTextField(percent,::changePercent,Modifier.fillMaxWidth(),label={Text("实际吃了多少（%）")},enabled=enabled,
            keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal))
          FlowRow(horizontalArrangement=Arrangement.spacedBy(6.dp)){
            listOf("0" to "没吃","50" to "半份","100" to "全份").forEach{(value,label)->
              FilterChip(percent==value,{changePercent(value)},enabled=enabled,label={Text(label)})
            }
          }
          FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){
            Button(onClick={write{repository.correctIntake(item,draft,accountId,percent.takeIf{it!=initialPercent})}},
              enabled=enabled&&(draft!=item.editableFood()||percent!=initialPercent)&&draft.name.isNotBlank()){Text("保存此项")}
            TextButton(onClick={write{
              repository.captureWrite("life.remove_intake",JSONObject()
                .put("item_id",item.id).put("expected_revision",item.revision).put("reason","用户从本餐移除食物"),accountId)
            }},enabled=enabled){Text("移除此项")}
          }
        }
      }
    }
    TextButton(enabled=enabled,onClick={selected=if(selected=="new")null else "new"}){Text("＋ 添加食物")}
    if(selected=="new"){
      val draftKey="intake/${meal.detailId}/new"
      var draft by remember{mutableStateOf(decodeMealDraftRows(store.read(draftKey,"row"))?.firstOrNull()?:MealDraftItem())}
      FoodEditFields(draft,enabled){draft=it;store.write(draftKey,"row",encodeMealDraftRows(listOf(it)))}
      Button(onClick={write{
        repository.captureWrite("life.add_intake",JSONObject().put("meal_id",meal.detailId)
          .put("expected_meal_revision",meal.revision).put("item",repository.mealItems(listOf(draft),"").getJSONObject(0))
          .put("reason","用户在餐次详情补记食物"),accountId)
      }},enabled=enabled&&draft.name.isNotBlank()){Text("添加到这餐")}
    }
    message?.let{Text(it,style=MaterialTheme.typography.bodySmall)}
  }
}

@Composable private fun FoodEditFields(draft:MealDraftItem,enabled:Boolean,onChange:(MealDraftItem)->Unit){
  OutlinedTextField(draft.name,{onChange(draft.copy(name=it))},Modifier.fillMaxWidth(),label={Text("食物名")},enabled=enabled)
  Row(horizontalArrangement=Arrangement.spacedBy(8.dp),verticalAlignment=Alignment.CenterVertically){
    OutlinedTextField(draft.quantity,{onChange(draft.copy(quantity=it))},Modifier.weight(1f),label={Text("原份量")},enabled=enabled,
      keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal))
    OutlinedTextField(draft.unit,{onChange(draft.copy(unit=it))},Modifier.weight(1f),label={Text("单位")},enabled=enabled)
  }
  var nutrition by rememberSaveable{mutableStateOf(false)}
  TextButton(onClick={nutrition=!nutrition}){Text(if(nutrition)"收起营养" else "原份营养")}
  if(nutrition){
    OutlinedTextField(draft.energyKcal,{onChange(draft.copy(energyKcal=it))},label={Text("热量 kcal")},enabled=enabled)
    OutlinedTextField(draft.proteinG,{onChange(draft.copy(proteinG=it))},label={Text("蛋白质 g")},enabled=enabled)
    OutlinedTextField(draft.fatG,{onChange(draft.copy(fatG=it))},label={Text("脂肪 g")},enabled=enabled)
    OutlinedTextField(draft.carbG,{onChange(draft.copy(carbG=it))},label={Text("碳水 g")},enabled=enabled)
  }
}
