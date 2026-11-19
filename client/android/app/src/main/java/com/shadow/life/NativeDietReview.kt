package com.shadow.life

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.text.NumberFormat
import java.time.LocalDate

private val foodLabels=mapOf("vegetables" to "蔬菜","fruit" to "水果","dairy" to "奶类","soy" to "豆类","whole_grains" to "全谷物")
private val nutrientLabels=mapOf("energy_kcal" to "热量","protein_g" to "蛋白质","fat_g" to "脂肪","carb_g" to "碳水",
    "fiber_g" to "膳食纤维","sodium_mg" to "钠","calcium_mg" to "钙","iron_mg" to "铁")
private val bodyLabels=mapOf("body_fat" to "体脂率","muscle_mass" to "肌肉量","body_water_rate" to "体水分率","visceral_fat" to "内脏脂肪")
private val trendLabels=mapOf("up" to "晨重持续上行","down" to "晨重持续下行","steady" to "晨重近期平稳","uncertain" to "继续观察晨重")
private fun number(value:Double?):String = value?.let { NumberFormat.getNumberInstance().apply{maximumFractionDigits=2}.format(it) } ?: "未知"

@Composable private fun ReviewCard(title:String,content:@Composable ColumnScope.()->Unit) {
    OutlinedCard(Modifier.fillMaxWidth()){
        Column(Modifier.padding(16.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
            Text(title,style=MaterialTheme.typography.titleMedium)
            content()
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun NativeDietReview(
    accountId:String,date:String,showMeals:Boolean,refreshKey:Any,onDetail:(LifeDomain,String,String)->Unit
) {
    val context=LocalContext.current
    val repository=remember(accountId){NativeLifeRepository(context,context.applicationContext as ShadowApp)}
    var open by rememberSaveable{mutableStateOf(false)}
    var days by rememberSaveable{mutableIntStateOf(7)}
    var reload by remember{mutableIntStateOf(0)}
    var state by remember(accountId,date,days,open,reload,refreshKey){mutableStateOf<LoadState<DietReviewResultDto>>(LoadState.Loading)}
    val scope=rememberCoroutineScope()
    var writing by remember(accountId,date){mutableStateOf(false)}
    var message by remember(accountId,date){mutableStateOf("")}
    var bodyComparison by rememberSaveable{mutableStateOf(false)}
    LaunchedEffect(accountId,date,days,open,reload,refreshKey){
        if(open){
            try { state=LoadState.Ready(repository.dietReview(date,days)) }
            catch(cancel:CancellationException){throw cancel}
            catch(error:Exception){state=LoadState.Failed(error.message?:"饮食复盘暂时不可用")}
        }
    }
    ReviewCard("饮食与体重复盘"){
        if(!open){ TextButton(onClick={open=true}){Text("查看下一餐建议与晨重")} }
        else {
            FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                listOf(1,7,30).forEach{ value -> FilterChip(days==value,{days=value},label={Text(if(value==1)"当天" else "$value 天")}) }
            }
            when(val loaded=state) {
                LoadState.Loading -> LinearProgressIndicator(Modifier.fillMaxWidth())
                is LoadState.Empty -> Text(loaded.reason)
                is LoadState.Failed -> { Text(loaded.message);TextButton(onClick={reload++}){Text("重新读取")} }
                is LoadState.Ready -> {
                    val review=loaded.value
                    review.nextMeal?.let{ next ->
                        Text(next.text,style=MaterialTheme.typography.titleSmall)
                        next.meal?.let{TextButton(onClick={onDetail(LifeDomain.Meals,it.id,"参考午餐")}){Text("查看参考午餐")}}
                    }
                    Text("${review.recordedCompleteDays} / $days 天基本记全 · ${review.completeEnergyDays} 天热量可比")
                    Text("${review.unclassifiedDays} 天有未分类条目或空餐",style=MaterialTheme.typography.bodySmall)
                    if(showMeals){
                        review.foodGroups.forEach{item->Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween){
                            Text(foodLabels[item.group.wireValue].orEmpty())
                            Text("${item.days} 天")
                        }}
                        review.lunches.lastOrNull()?.let{lunch->
                            TextButton(onClick={onDetail(LifeDomain.Meals,lunch.id,"午餐复盘")}){
                                Text("最近午餐 · ${lunch.date.takeLast(5)} · 查看份量和依据")
                            }
                        }
                        val diary=review.diary.find{it.date==date}
                        val status=diary?.state?.wireValue
                        Text(mapOf("complete" to "当天已吃完并记全","partial" to "当天还有漏记","recheck" to "餐次有变动，请重新核对")[status]?:"当天完整性待确认")
                        FlowRow(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                            listOf("complete" to "已吃完并记全","partial" to "还有漏记").forEach{ (value,label) ->
                                OutlinedButton(enabled=!writing&&status!=value,onClick={
                                    writing=true;message=""
                                    scope.launch{
                                        try{
                                            val input=JSONObject().put("scope","health").put("kind","preference").put("category","dietary")
                                                .put("assertion","explicit").put("key","wellness.diary.$date.${review.timeZone}")
                                                .put("valid_from",date).put("valid_to_exclusive",LocalDate.parse(date).plusDays(1).toString())
                                                .put("statement",if(value=="complete")"当天进食已结束，饮食已基本记全" else "当天饮食还有漏记")
                                            diary?.declaration?.let{input.put("id",it.id).put("expected_revision",it.revision).put("reason","本人更新当天饮食完整性")}
                                            val receipt=repository.savePersonalFoundation("agent.set_intention",input,accountId)
                                            if(receipt.queued)message="已保存到本机，待同步"
                                            reload++
                                        } catch(cancel:CancellationException){throw cancel}
                                        catch(error:Exception){message=error.message?:"保存失败"}
                                        finally{writing=false}
                                    }
                                }){Text(label)}
                            }
                        }
                        if(message.isNotBlank())Text(message)
                    }
                    review.weightFollowup?.let { Text(it.text,style=MaterialTheme.typography.bodyMedium) }
                    review.weight?.let{weight->
                        val current=weight.weeks.lastOrNull()
                        Text(trendLabels[weight.trend.wireValue].orEmpty(),style=MaterialTheme.typography.titleSmall)
                        Text(if(current?.meanKg==null)"最近一周没有同秤晨重" else "最近 7 天晨均 ${number(current.meanKg)} kg · ${current.days} 天")
                        weight.weeklyChangeKg?.let{Text("比前一周 ${if(it>0)"+" else ""}${number(it)} kg")}
                        if(weight.morning.isNotEmpty()||weight.evening.isNotEmpty())WeightPlot(weight)
                        if(!weight.composition.isNullOrEmpty()){
                            TextButton(onClick={bodyComparison=!bodyComparison}){Text(if(bodyComparison)"收起体成分对照" else "查看体成分前后周对照")}
                            if(bodyComparison)weight.composition.orEmpty().forEach{row->
                                val unit=if(row.unit=="level")"级" else row.unit
                                Text("${bodyLabels[row.metric.wireValue]} · ${if(row.band.wireValue=="morning")"晨间" else "晚间"} · ${row.method?:"方法未知"}",
                                    style=MaterialTheme.typography.labelMedium)
                                Text("前一周 ${number(row.previous.mean)} $unit（${row.previous.days} 天） · 最近 ${number(row.current.mean)} $unit（${row.current.days} 天）",
                                    style=MaterialTheme.typography.bodySmall)
                            }
                        }
                        weight.waist.lastOrNull()?.let{Text("最近腰围 ${number(it.cm)} cm")}
                        review.background?.let{bg->
                            bg.medianSteps?.let{Text("步数中位 ${number(it)} 步 · ${bg.stepDays} 天")}
                            bg.medianActiveMinutes?.let{Text("活动分钟中位 ${number(it)} · ${bg.activeDays} 天")}
                            if(bg.latest?.state?.wireValue=="pending")Text("截至日的活动记录尚未同步。")
                            bg.meanSleepMinutes?.let{Text("主睡眠均值 ${number(it)} 分钟 · ${bg.sleepDays} 晚")}
                        }
                    }
                }
            }
        }
    }
}

private data class ScalePoint(val day:Long,val kg:Double,val smooth:Double)
@Composable private fun WeightPlot(weight:DietReviewResultDtoWeight) {
    val morning=weight.morning.map{ScalePoint(LocalDate.parse(it.date).toEpochDay(),it.kg,it.smoothedKg)}
    val evening=weight.evening.map{ScalePoint(LocalDate.parse(it.date).toEpochDay(),it.kg,it.smoothedKg)}
    val points=morning+evening
    val left=points.minOf{it.day};val days=(points.maxOf{it.day}-left).coerceAtLeast(1)
    val low=points.minOf{minOf(it.kg,it.smooth)}-.25;val high=points.maxOf{maxOf(it.kg,it.smooth)}+.25
    val morningColor=MaterialTheme.colorScheme.primary;val eveningColor=MaterialTheme.colorScheme.tertiary
    val grid=MaterialTheme.colorScheme.outlineVariant
    Text("晨重及平滑线 · 晚重",style=MaterialTheme.typography.labelMedium)
    Canvas(Modifier.fillMaxWidth().height(105.dp).semantics{
        contentDescription="最近晨重 ${number(morning.lastOrNull()?.kg)} 公斤，晚重 ${number(evening.lastOrNull()?.kg)} 公斤"
    }){
        val pad=7.dp.toPx()
        fun offset(point:ScalePoint,value:Double)=Offset(
            pad+((point.day-left).toDouble()/days).toFloat()*(size.width-2*pad),
            pad+((high-value)/(high-low)).toFloat()*(size.height-2*pad)
        )
        (1..3).forEach{ tick -> val y=size.height*tick/4
            drawLine(grid,Offset(0f,y),Offset(size.width,y))
        }
        morning.zipWithNext().forEach{ (a,b)->drawLine(morningColor,offset(a,a.smooth),offset(b,b.smooth),strokeWidth=2.dp.toPx()) }
        evening.forEach{drawCircle(eveningColor,3.dp.toPx(),offset(it,it.kg))}
        morning.forEach{drawCircle(morningColor,3.dp.toPx(),offset(it,it.kg))}
    }
    Text("最近晨重 ${number(morning.lastOrNull()?.kg)} kg · 晚重 ${number(evening.lastOrNull()?.kg)} kg",style=MaterialTheme.typography.bodySmall)
}

@Composable internal fun NativeMealDietDetail(accountId:String,id:String,revision:Int?) {
    val context=LocalContext.current
    val repository=remember(accountId){NativeLifeRepository(context,context.applicationContext as ShadowApp)}
    var open by rememberSaveable(id){mutableStateOf(false)}
    var state by remember(accountId,id,revision){mutableStateOf<LoadState<MealDietReviewResultDto>>(LoadState.Loading)}
    var retry by remember{mutableIntStateOf(0)}
    LaunchedEffect(accountId,id,revision,open,retry){
        if(open)try{state=LoadState.Ready(repository.mealDietReview(id))}
        catch(cancel:CancellationException){throw cancel}
        catch(error:Exception){state=LoadState.Failed(error.message?:"暂时无法读取这顿的复盘")}
    }
    ReviewCard("本餐实吃份量与依据"){
        if(!open)TextButton(onClick={open=true}){Text("展开本餐复盘")}
        else when(val loaded=state){
            LoadState.Loading->LinearProgressIndicator(Modifier.fillMaxWidth())
            is LoadState.Empty->Text(loaded.reason)
            is LoadState.Failed->{Text(loaded.message);TextButton(onClick={retry++}){Text("重新读取")}}
            is LoadState.Ready->{
                val meal=loaded.value
                Text("${meal.consumedItems} 项计入实吃 · 主食已知 ${number(meal.knownStapleGrams)} g（${meal.staplesWithGrams}/${meal.staples} 项）")
                meal.items.forEach{item->
                    val portions=listOfNotNull(item.quantity?.let{number(it)+" "+item.unit.orEmpty()},item.grams?.let{number(it)+" g"})
                    Text(item.name,style=MaterialTheme.typography.titleSmall)
                    Text(if(item.consumedFraction==0.0)"未食用" else (portions.takeIf{it.isNotEmpty()}?.joinToString(" · ") ?: "实吃份量未知")+(if(item.estimated)" · 估算" else ""))
                    item.basis?.let{Text(it,style=MaterialTheme.typography.bodySmall)}
                }
                meal.totals.forEach{item->
                    val key=item.nutrient.wireValue
                    val unit=if(item.knownTotal==null)"" else if(key=="energy_kcal")" kcal" else if(key.endsWith("_mg"))" mg" else " g"
                    Text("${nutrientLabels[key]} ${number(item.knownTotal)}$unit · ${item.knownItems}/${meal.consumedItems} 项有记录，${item.estimatedItems} 项估算")
                }
            }
        }
    }
}
