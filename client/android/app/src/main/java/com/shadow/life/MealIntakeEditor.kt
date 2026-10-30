package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

@Composable internal fun MealIntakeEditor(accountId:String,items:List<LifeRecordResultDtoMealItemsEntry>){
  var open by remember{mutableStateOf(false)}
  var message by remember{mutableStateOf<String?>(null)}
  TextButton(onClick={open=true}){Text("编辑食物与份量")}
  message?.let{Text(it,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.primary)}
  if(!open)return
  val context=LocalContext.current
  val app=context.applicationContext as ShadowApp
  val repository=remember(accountId){NativeLifeRepository(context,app)}
  val store=remember(accountId){UiDraftStore(context,accountId)}
  val scope=rememberCoroutineScope()
  val initial=remember(items){items.map{MealDraftItem(it.name,it.quantity.orEmpty(),it.unit.orEmpty(),it.energyKcal.orEmpty(),it.proteinG.orEmpty(),it.fatG.orEmpty(),it.carbG.orEmpty())}}
  val drafts=remember(items){items.mapIndexed{index,item->decodeMealDraftRows(store.read("intake/${item.id}/${item.revision}","row"))?.firstOrNull()?:initial[index]}.toMutableStateList()}
  val queued=remember{mutableStateListOf<String>()}
  var busy by remember{mutableStateOf(false)}
  var error by remember{mutableStateOf<String?>(null)}
  fun update(index:Int,row:MealDraftItem){drafts[index]=row;val item=items[index];store.write("intake/${item.id}/${item.revision}","row",encodeMealDraftRows(listOf(row)))}
  LifeFullScreen("编辑本餐食物",{if(!busy)open=false}){
    Column(Modifier.fillMaxSize(),verticalArrangement=Arrangement.spacedBy(12.dp)){
      Text("可在这里修改本餐各行食物。未知营养可留空；更换食物名称后请核对已有营养值。输入会保存在本机草稿中。",style=MaterialTheme.typography.bodySmall)
      LazyColumn(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(12.dp)){
        items(items.size,key={items[it].id}){index->val original=items[index];val row=drafts[index]
          LifeCard{
            if(original.id in queued)Text("已加入同步队列",color=MaterialTheme.colorScheme.primary)
            OutlinedTextField(row.name,{update(index,row.copy(name=it))},Modifier.fillMaxWidth(),enabled=!busy&&original.id !in queued,label={Text("食物 ${index+1}")})
            OutlinedTextField(row.quantity,{update(index,row.copy(quantity=it))},Modifier.fillMaxWidth(),enabled=!busy&&original.id !in queued,label={Text("份量")},keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal))
            OutlinedTextField(row.unit,{update(index,row.copy(unit=it))},Modifier.fillMaxWidth(),enabled=!busy&&original.id !in queued,label={Text("单位")})
            var nutrition by remember{mutableStateOf(false)}
            TextButton(onClick={nutrition=!nutrition}){Text(if(nutrition)"收起营养" else "营养信息（可选）")}
            if(nutrition)listOf("热量 kcal" to row.energyKcal,"蛋白质 g" to row.proteinG,"脂肪 g" to row.fatG,"碳水 g" to row.carbG).forEachIndexed{field,(label,value)->OutlinedTextField(value,{text->update(index,when(field){0->row.copy(energyKcal=text);1->row.copy(proteinG=text);2->row.copy(fatG=text);else->row.copy(carbG=text)})},Modifier.fillMaxWidth(),enabled=!busy&&original.id !in queued,label={Text(label)},keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Decimal))}
          }
        }
      }
      error?.let{Text(it,color=MaterialTheme.colorScheme.error)}
      Button(enabled=!busy&&drafts.indices.any{drafts[it]!=initial[it]&&items[it].id !in queued},onClick={scope.launch{
        busy=true;error=null
        try{
          check(app.sessions.active()?.accountId==accountId){"账号已切换"}
          drafts.indices.filter{drafts[it]!=initial[it]&&items[it].id !in queued}.forEach{index->val original=items[index];repository.correctIntake(original,drafts[index],accountId);queued+=original.id;store.clear("intake/${original.id}/${original.revision}")}
          message="食物更正已保存到本机，待同步";open=false
        }catch(e:CancellationException){throw e}catch(e:Exception){error=e.message?:"保存失败，已保留输入"}finally{busy=false}
      }},modifier=Modifier.fillMaxWidth()){Text(if(busy)"正在保存" else "保存本餐更正")}
    }
  }
}
