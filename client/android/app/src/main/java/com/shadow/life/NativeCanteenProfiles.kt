package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import org.json.JSONArray
import org.json.JSONObject

private val groups=mapOf("vegetables" to "蔬菜","fruit" to "水果","dairy" to "奶类","soy" to "豆类","whole_grains" to "全谷物")
private val nutrients=mapOf("energy_kcal" to "热量（kcal）","protein_g" to "蛋白质（g）","fat_g" to "脂肪（g）","carb_g" to "碳水（g）",
    "fiber_g" to "纤维（g）","sodium_mg" to "钠（mg）","calcium_mg" to "钙（mg）","iron_mg" to "铁（mg）")
private val decimal=Regex("(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,6})?")
private val menuJson=Json { explicitNulls=false }

@Composable internal fun NativeCanteenProfiles(accountId:String) {
    val context=LocalContext.current
    val repository=remember(accountId){NativeLifeRepository(context,context.applicationContext as ShadowApp)}
    var open by rememberSaveable{mutableStateOf(false)}
    var shop by rememberSaveable{mutableStateOf("")}
    var query by rememberSaveable{mutableStateOf("")}
    var filters by remember(accountId){mutableStateOf("" to "")}
    var menu by remember(accountId){mutableStateOf<MerchantMenuResultDto?>(null)}
    var loading by remember(accountId){mutableStateOf(false)}
    var message by remember(accountId){mutableStateOf("")}
    var selected by remember(accountId){mutableStateOf<MerchantMenuResultDtoItemsEntry?>(null)}
    var editing by remember(accountId){mutableStateOf(false)}
    var revision by remember{mutableIntStateOf(0)}
    val scope=rememberCoroutineScope()
    suspend fun load(after:String?=null){
        loading=true;message=""
        try {
            val page=repository.canteenProfiles(filters.first,filters.second,after)
            val items=if(after==null)page.items else (menu?.items.orEmpty()+page.items).distinctBy{it.id}
            menu=page.copy(items=items)
        } catch(cancel:CancellationException){throw cancel}
        catch(error:Exception){message=error.message?:"门店资料暂不可读"}
        finally{loading=false}
    }
    LaunchedEffect(accountId,open,revision){if(open)load()}
    OutlinedCard(Modifier.fillMaxWidth()){
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
            Text("门店菜品档案",style=MaterialTheme.typography.titleMedium)
            if(!open)TextButton(onClick={open=true}){Text("查菜名与常用份量")}
            else{
                OutlinedTextField(shop,{shop=it},label={Text("门店（留空查常去食堂）")},singleLine=true,modifier=Modifier.fillMaxWidth())
                OutlinedTextField(query,{query=it},label={Text("菜名或别名")},singleLine=true,modifier=Modifier.fillMaxWidth())
                OutlinedButton(onClick={filters=shop.trim() to query.trim();menu=null;revision++},enabled=!loading){Text("查询")}
                if(loading)LinearProgressIndicator(Modifier.fillMaxWidth())
                if(message.isNotBlank())Text(message)
                menu?.let{page->
                    Text(page.merchant,style=MaterialTheme.typography.titleSmall)
                    TextButton(onClick={selected=null;editing=true}){Text("收录菜品")}
                    page.items.forEach{item->
                        Column(verticalArrangement=Arrangement.spacedBy(3.dp)){
                            Text(item.dish,style=MaterialTheme.typography.titleSmall)
                            val profile=item.profile
                            val metadata=listOfNotNull(profile?.stall,profile?.cooking,profile?.groups?.mapNotNull{groups[it.wireValue]}?.joinToString("、"))
                                .filter{it.isNotBlank()}
                            if(metadata.isNotEmpty())Text(metadata.joinToString(" · "),style=MaterialTheme.typography.bodySmall)
                            profile?.portion?.let{
                                Text("${it.quantity} ${it.unit}"+(it.grams?.let{grams->" · "+(if(it.estimated)"约" else "")+"$grams g"}?:""),style=MaterialTheme.typography.bodySmall)
                                Text(it.basis,style=MaterialTheme.typography.bodySmall)
                            }
                            TextButton(onClick={selected=item;editing=true}){Text("补充 ${item.dish}")}
                        }
                    }
                    page.next?.let{next->TextButton(onClick={scope.launch{load(next)}},enabled=!loading){Text("加载更多菜品")}}
                    if(editing){
                        CanteenProfileEditor(selected,loading,onCancel={editing=false}){dish,stall,profile,note->
                            scope.launch{
                                loading=true;message=""
                                try{
                                    val body=JSONObject().put("merchant",page.merchant).put("dish",dish)
                                        .put("profile",profile).put("evidence",JSONObject().put("kind","note").put("note",note))
                                    if(stall.isNotBlank())body.put("stall",stall)
                                    selected?.let{body.put("food_id",it.id).put("expected_revision",it.revision)}
                                    val receipt=repository.captureWrite("life.remember_merchant_dish",body,accountId)
                                    editing=false
                                    if(receipt.queued)message="菜品已保存到本机，待同步"
                                    else revision++
                                }catch(cancel:CancellationException){throw cancel}
                                catch(error:Exception){message=error.message?:"菜品保存失败"}
                                finally{loading=false}
                            }
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun CanteenProfileEditor(row:MerchantMenuResultDtoItemsEntry?,busy:Boolean,onCancel:()->Unit,
    onSave:(String,String,JSONObject,String)->Unit) {
    val profile=row?.profile
    val portion=profile?.portion
    var dish by remember(row){mutableStateOf(row?.dish.orEmpty())}
    var stall by remember(row){mutableStateOf(profile?.stall.orEmpty())}
    var aliases by remember(row){mutableStateOf(profile?.aliases?.joinToString("、").orEmpty())}
    var cooking by remember(row){mutableStateOf(profile?.cooking.orEmpty())}
    var selected by remember(row){mutableStateOf(profile?.groups?.map{it.wireValue}?.toSet().orEmpty())}
    var classify by remember(row){mutableStateOf(profile?.groups!=null)}
    var staple by remember(row){mutableStateOf(profile?.staple)}
    var quantity by remember(row){mutableStateOf(portion?.quantity.orEmpty())}
    var unit by remember(row){mutableStateOf(portion?.unit.orEmpty())}
    var grams by remember(row){mutableStateOf(portion?.grams.orEmpty())}
    var estimated by remember(row){mutableStateOf(portion?.estimated?:false)}
    var basis by remember(row){mutableStateOf(portion?.basis.orEmpty())}
    var note by remember(row){mutableStateOf("")}
    var editNutrients by remember(row){mutableStateOf(false)}
    var numeric by remember(row){mutableStateOf(portion?.nutrients?.let { values ->
        val saved=JSONObject(menuJson.encodeToString(MerchantMenuResultDtoItemsEntryProfilePortionNutrients.serializer(),values))
        nutrients.keys.associateWith{saved.optString(it)}
    }.orEmpty())}
    var error by remember(row){mutableStateOf("")}
    fun submit(){
        val hasPortion=listOf(quantity,unit,grams,basis).any{it.isNotBlank()}||numeric.values.any{it.isNotBlank()}
        if(dish.isBlank()||note.isBlank()||hasPortion&&(!decimal.matches(quantity)||quantity.toDoubleOrNull()?.let{it>0}!=true||
            unit.isBlank()||basis.isBlank()||grams.isNotBlank()&&(!decimal.matches(grams)||grams.toDoubleOrNull()?.let{it>0}!=true)||
            numeric.values.any{it.isNotBlank()&&!decimal.matches(it)})){
            error="请核对菜名、出处及份量的数值、单位和依据"
            return
        }
        val data=JSONObject().put("aliases",JSONArray(aliases.split(Regex("[、,，]")).map{it.trim()}.filter{it.isNotEmpty()}.distinct()))
        if(cooking.isNotBlank())data.put("cooking",cooking.trim())
        if(classify)data.put("groups",JSONArray(selected.toList()))
        staple?.let{data.put("staple",it)}
        if(hasPortion){
            val value=JSONObject().put("quantity",quantity).put("unit",unit.trim()).put("estimated",estimated).put("basis",basis.trim())
            if(grams.isNotBlank())value.put("grams",grams)
            value.put("nutrients",JSONObject(numeric.filterValues{it.isNotBlank()}))
            data.put("portion",value)
        }
        error=""
        onSave(dish.trim(),stall.trim(),data,note.trim())
    }
    Text(if(row==null)"收录常吃菜品" else "补充 ${row.dish}",style=MaterialTheme.typography.titleSmall)
    OutlinedTextField(dish,{dish=it},label={Text("菜名")},readOnly=row!=null,singleLine=true,modifier=Modifier.fillMaxWidth())
    OutlinedTextField(stall,{stall=it},label={Text("档口")},singleLine=true,modifier=Modifier.fillMaxWidth())
    OutlinedTextField(aliases,{aliases=it},label={Text("别名（顿号分隔）")},singleLine=true,modifier=Modifier.fillMaxWidth())
    OutlinedTextField(cooking,{cooking=it},label={Text("做法")},singleLine=true,modifier=Modifier.fillMaxWidth())
    FlowRow(horizontalArrangement=Arrangement.spacedBy(6.dp)){
        FilterChip(classify,{classify=!classify},label={Text("手工分类")})
        if(classify)groups.forEach{(key,label)->FilterChip(key in selected,{selected=if(key in selected)selected-key else selected+key},label={Text(label)})}
    }
    FlowRow(horizontalArrangement=Arrangement.spacedBy(6.dp)){
        FilterChip(staple==null,{staple=null},label={Text("按名称认主食")})
        FilterChip(staple==true,{staple=true},label={Text("主食")})
        FilterChip(staple==false,{staple=false},label={Text("其他")})
    }
    OutlinedTextField(quantity,{quantity=it},label={Text("常用数量")},singleLine=true,modifier=Modifier.fillMaxWidth())
    OutlinedTextField(unit,{unit=it},label={Text("常用单位，如平勺")},singleLine=true,modifier=Modifier.fillMaxWidth())
    OutlinedTextField(grams,{grams=it},label={Text("对应克重")},singleLine=true,modifier=Modifier.fillMaxWidth())
    OutlinedTextField(basis,{basis=it},label={Text("份量与营养依据")},modifier=Modifier.fillMaxWidth())
    FilterChip(estimated,{estimated=!estimated},label={Text("份量或营养是估算")})
    TextButton(onClick={editNutrients=!editNutrients}){Text("填写这份的营养")}
    if(editNutrients)nutrients.forEach{(key,label)->
        OutlinedTextField(numeric[key].orEmpty(),{numeric=numeric+(key to it)},label={Text(label)},singleLine=true,modifier=Modifier.fillMaxWidth())
    }
    OutlinedTextField(note,{note=it},label={Text("这次补充的出处")},modifier=Modifier.fillMaxWidth())
    if(error.isNotBlank())Text(error,color=MaterialTheme.colorScheme.error)
    Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
        Button(onClick={submit()},enabled=!busy){Text("保存菜品")}
        TextButton(onClick=onCancel){Text("取消")}
    }
}
