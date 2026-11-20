package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonPrimitive
import java.math.BigDecimal
import java.text.NumberFormat

private val mealNutrients=linkedMapOf(
    "energy_kcal" to ("热量" to "kcal"), "protein_g" to ("蛋白质" to "g"),
    "carb_g" to ("碳水" to "g"), "fat_g" to ("脂肪" to "g"), "fiber_g" to ("膳食纤维" to "g"),
    "sodium_mg" to ("钠" to "mg"), "calcium_mg" to ("钙" to "mg"), "iron_mg" to ("铁" to "mg")
)
private val mealFoodGroups=mapOf("vegetables" to "蔬菜","fruit" to "水果","dairy" to "奶类","soy" to "豆类","whole_grains" to "全谷物")
private fun shown(value:Number):String=NumberFormat.getNumberInstance().apply{maximumFractionDigits=2}.format(value)

internal data class MealDetailFood(
    val id:String,val name:String,val merchant:String?,val stall:String?,val quantity:String?,val grams:String?,
    val consumed:String?,val uneaten:Boolean,val estimated:Boolean,val basis:String?,val weightBasis:String?,
    val groups:List<String>,val staple:Boolean,val nutrients:Map<String,BigDecimal>
)
internal data class MealDetailTotal(val key:String,val amount:Number?,val known:Long,val estimated:Long)

internal fun rawMealFood(item:LifeRecordResultDtoMealItemsEntry):MealDetailFood {
    fun eaten(value:String?)=consumedAmount(value,item.consumedFraction)
    val fraction=item.consumedFraction?.toBigDecimalOrNull()
    return MealDetailFood(
        item.id,item.name,null,null,eaten(item.quantity)?.let{"$it ${item.unit.orEmpty()}".trim()},eaten(item.amountG),
        eaten("100").takeIf{fraction!=null&&fraction<BigDecimal.ONE},fraction?.signum()==0,
        item.estimate||item.provenance=="estimated"||item.weightBasis?.wireValue=="payment_derived",
        item.evidenceNote,item.weightBasis?.wireValue,emptyList(),false,
        listOf("energy_kcal" to item.energyKcal,"protein_g" to item.proteinG,"carb_g" to item.carbG,
            "fat_g" to item.fatG,"fiber_g" to item.fiberG,"sodium_mg" to item.sodiumMg)
            .mapNotNull{(key,value)->eaten(value)?.toBigDecimalOrNull()?.let{key to it}}.toMap()
    )
}

private fun reviewedMealFood(item:MealDietReviewResultDtoItemsEntry):MealDetailFood =
    MealDetailFood(
        item.id,item.name,item.merchant,item.stall,item.quantity?.let{"${shown(it)} ${item.unit.orEmpty()}".trim()},item.grams?.let(::shown),
        item.consumedFraction?.takeIf{it<1}?.let{shown(it*100)},item.consumedFraction==0.0,item.estimated,item.basis,item.weightBasis?.wireValue,
        item.groups.mapNotNull{mealFoodGroups[it.wireValue]},item.staple,
        item.nutrients.mapNotNull{(key,value)->(value as? JsonPrimitive)?.content?.toBigDecimalOrNull()?.let{key to it}}.toMap()
    )

internal fun rawMealTotals(foods:List<MealDetailFood>):List<MealDetailTotal> {
    val eaten=foods.filterNot{it.uneaten}
    return mealNutrients.keys.map{key->
        val known=eaten.filter{key in it.nutrients}
        MealDetailTotal(key,known.takeIf{it.isNotEmpty()}?.sumOf{it.nutrients.getValue(key)},known.size.toLong(),known.count{it.estimated}.toLong())
    }
}

internal data class MealDetailRead(val state:LoadState<MealDietReviewResultDto>,val refresh:()->Unit)

@Composable internal fun rememberMealDetailRead(accountId:String,meal:MealDetailInfo,revision:Int?,onReloadDetail:()->Unit):MealDetailRead {
    if(accountId.isBlank())return MealDetailRead(LoadState.Empty(""),{})
    val context=LocalContext.current
    val app=context.applicationContext as ShadowApp
    val repository=remember(accountId){NativeLifeRepository(context,app)}
    var state by remember(accountId,meal.id,revision){mutableStateOf<LoadState<MealDietReviewResultDto>>(LoadState.Loading)}
    var retry by remember(meal.id){mutableIntStateOf(0)}
    LaunchedEffect(accountId,meal.id,revision,retry){
        try{
            val result=repository.mealDietReview(meal.id)
            check(app.sessions.active()?.accountId==accountId){"账号已切换"}
            check(revision==null||result.revision==revision.toLong()){"餐次已更新，请重新读取"}
            state=LoadState.Ready(result)
        }catch(cancel:CancellationException){throw cancel}
        catch(failure:Exception){state=LoadState.Failed(failure.message?:"实吃依据暂时无法读取")}
    }
    return MealDetailRead(state,{state=LoadState.Loading;onReloadDetail();retry++})
}

internal fun LazyListScope.mealDetailItems(
    detail:RecordDetail,accountId:String,read:MealDetailRead,onDishCatalog:(String,String)->Unit
){
    val meal=checkNotNull(detail.meal)
    val review=(read.state as? LoadState.Ready)?.value
    val rows=review?.items?.map(::reviewedMealFood)?:detail.mealIntakes.map(::rawMealFood)
    val consumedCount=review?.consumedItems?:rows.count{!it.uneaten}.toLong()
    val totals=review?.totals?.map{MealDetailTotal(it.nutrient.wireValue,it.knownTotal,it.knownItems,it.estimatedItems)}?:rawMealTotals(rows)
    item("meal-header"){MealInfoCard(meal,review,rows)}
    item("meal-nutrition"){MealNutritionCard(totals,consumedCount)}
    item("meal-food-heading"){Text("本餐食物",style=MaterialTheme.typography.titleLarge)}
    if(rows.isEmpty())item("meal-empty"){EmptyState("这餐还没有记录食物明细")}
    items(rows,key={"meal-food/${it.id}"}){row->MealFoodCard(row,onDishCatalog)}
    if(detail.mealIntakes.isNotEmpty()&&accountId.isNotBlank()){
    }
    when(val state=read.state){
        LoadState.Loading->item("meal-evidence-loading"){LinearProgressIndicator(Modifier.fillMaxWidth())}
        is LoadState.Failed->item("meal-evidence-error"){
            LifeCard{
                Text("暂用餐次中已保存的份量和营养",style=MaterialTheme.typography.bodySmall)
                Text(state.message,style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                TextButton(onClick=read.refresh){Text("重试读取实吃依据")}
            }
        }
        else->Unit
    }
}

@Composable private fun MealInfoCard(meal:MealDetailInfo,review:MealDietReviewResultDto?,rows:List<MealDetailFood>){
    val shops=rows.filterNot{it.uneaten}.mapNotNull{it.merchant}.distinct()
    val count=rows.count{!it.uneaten}
    Surface(Modifier.fillMaxWidth(),shape=MaterialTheme.shapes.large,color=MaterialTheme.colorScheme.secondaryContainer){
        Column(Modifier.padding(18.dp),verticalArrangement=Arrangement.spacedBy(6.dp)){
            val timing=listOfNotNull(meal.date,meal.time).joinToString(" · ")
            if(timing.isNotBlank())Text(timing,style=MaterialTheme.typography.titleMedium)
            val subtitle=listOfNotNull(shops.takeIf{it.isNotEmpty()}?.joinToString("、"),"$count 项计入实吃".takeIf{rows.isNotEmpty()})
            if(subtitle.isNotEmpty())Text(subtitle.joinToString(" · "),style=MaterialTheme.typography.bodyMedium)
            if(review!=null&&review.staples>0){
                val known=review.knownStapleGrams?.let{"主食已记录 ${shown(it)} g"}?:"主食克重未知"
                Text("$known · ${review.staplesWithGrams}/${review.staples} 项有克重",style=MaterialTheme.typography.bodySmall)
            }
            meal.note?.takeIf(String::isNotBlank)?.let{Text(it,style=MaterialTheme.typography.bodyMedium)}
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun MealNutritionCard(totals:List<MealDetailTotal>,consumed:Long){
    var expanded by rememberSaveable{mutableStateOf(false)}
    LifeCard{
        Text("实吃营养",style=MaterialTheme.typography.titleMedium)
        if(consumed==0L){
            Text("还没有计入实吃的食物",color=MaterialTheme.colorScheme.onSurfaceVariant)
        }else{
            val energy=totals.firstOrNull{it.key=="energy_kcal"}
            if(energy?.amount==null)Text("热量未记录",style=MaterialTheme.typography.headlineSmall)
            else Text("${shown(energy.amount)} kcal",style=MaterialTheme.typography.headlineSmall)
            if(energy!=null)Text(mealCoverage(energy,consumed),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            val visible=totals.filter{it.key in setOf("protein_g","carb_g","fat_g")}
            FlowRow(horizontalArrangement=Arrangement.spacedBy(16.dp),verticalArrangement=Arrangement.spacedBy(10.dp)){
                visible.forEach{value->
                    val (label,unit)=mealNutrients.getValue(value.key)
                    Column(verticalArrangement=Arrangement.spacedBy(3.dp)){
                        Text(label,style=MaterialTheme.typography.labelMedium,color=MaterialTheme.colorScheme.onSurfaceVariant)
                        Text(value.amount?.let{"${shown(it)} $unit"}?:"未知",style=MaterialTheme.typography.titleMedium)
                        if(value.known>0)Text(mealCoverage(value,consumed),style=MaterialTheme.typography.bodySmall)
                    }
                }
            }
            val other=totals.filter{it.key!="energy_kcal"&&it !in visible}
            if(other.isNotEmpty())TextButton(onClick={expanded=!expanded}){Text(if(expanded)"收起其他营养" else "查看其他营养")}
            if(expanded)other.forEach{value->
                val (label,unit)=mealNutrients.getValue(value.key)
                val amount=value.amount?.let{"${shown(it)} $unit · ${mealCoverage(value,consumed)}"}?:"未知"
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(12.dp)){
                    Text(label,Modifier.weight(1f),color=MaterialTheme.colorScheme.onSurfaceVariant)
                    Text(amount,style=MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
}

internal fun mealCoverage(value:MealDetailTotal,consumed:Long):String {
    val prefix=when {
        value.known==0L -> "0/$consumed 项有记录"
        value.known<consumed -> "已知部分 · ${value.known}/$consumed 项"
        else -> "${value.known}/$consumed 项有记录"
    }
    return if(value.estimated>0)"$prefix · ${value.estimated} 项估算" else prefix
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun MealFoodCard(row:MealDetailFood,onDishCatalog:(String,String)->Unit){
    var expanded by rememberSaveable(row.id){mutableStateOf(false)}
    val portion=listOfNotNull(row.quantity,row.grams?.let{"$it g"}.takeUnless{it==row.quantity}).joinToString(" · ")
    LifeCard{
        Row(verticalAlignment=Alignment.Top,horizontalArrangement=Arrangement.spacedBy(10.dp)){
            Column(Modifier.weight(1f),verticalArrangement=Arrangement.spacedBy(4.dp)){
                Text(row.name,style=MaterialTheme.typography.titleMedium)
                val description=if(row.uneaten)"未食用" else portion.ifEmpty{"份量未记录"}
                val fraction=row.consumed?.takeUnless{row.uneaten}?.let{"吃了 $it%"}
                Text(listOfNotNull(description,fraction,"估算".takeIf{!row.uneaten&&row.estimated}).joinToString(" · "),
                    style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                row.stall?.takeIf(String::isNotBlank)?.let{Text(it,style=MaterialTheme.typography.bodySmall)}
            }
            if(!row.uneaten)row.nutrients["energy_kcal"]?.let{Text("${shown(it)} kcal",style=MaterialTheme.typography.labelLarge)}
        }
        val hasDetails=row.basis!=null||row.weightBasis!=null||row.merchant!=null||row.groups.isNotEmpty()||row.staple||
            !row.uneaten&&row.nutrients.keys.any{it!="energy_kcal"}
        if(hasDetails)TextButton(onClick={expanded=!expanded}){Text(if(expanded)"收起依据" else "营养与依据")}
        if(expanded){
            row.basis?.let{Text(it,style=MaterialTheme.typography.bodyMedium)}
            when(row.weightBasis){
                "payment_derived"->Text("按实付与档口单价估算克重",style=MaterialTheme.typography.bodySmall)
                "measured_net"->Text("依据实测净重",style=MaterialTheme.typography.bodySmall)
            }
            val labels=row.groups+listOfNotNull("主食".takeIf{row.staple})
            if(labels.isNotEmpty())Text(labels.joinToString(" · "),style=MaterialTheme.typography.bodySmall)
            if(!row.uneaten)FlowRow(horizontalArrangement=Arrangement.spacedBy(12.dp)){
                mealNutrients.filterKeys{it!="energy_kcal"}.forEach{(key,label)->
                    row.nutrients[key]?.let{Text("${label.first} ${shown(it)} ${label.second}",style=MaterialTheme.typography.bodySmall)}
                }
            }
            row.merchant?.let{merchant->TextButton(onClick={onDishCatalog(merchant,row.name)}){Text("查看门店菜品")}}
        }
    }
}
