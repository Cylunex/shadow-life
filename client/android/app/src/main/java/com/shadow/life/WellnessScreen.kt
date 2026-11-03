package com.shadow.life

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import java.time.LocalDate

@OptIn(ExperimentalMaterial3Api::class)
@Composable internal fun WellnessScreen(accountId:String,onBack:()->Unit,onMeals:(String)->Unit,onHealth:(String)->Unit) {
  val context=LocalContext.current
  val repository=remember(accountId){NativeLifeRepository(context,context.applicationContext as ShadowApp)}
  var to by rememberSaveable{mutableStateOf(LocalDate.now().toString())}
  var days by rememberSaveable{mutableIntStateOf(7)}
  var selected by rememberSaveable{mutableStateOf(LocalDate.now().toString())}
  var retry by remember{mutableIntStateOf(0)}
  var state by remember(accountId){mutableStateOf<LoadState<JSONObject>>(LoadState.Loading)}
  LaunchedEffect(accountId,to,days,retry){
    state=LoadState.Loading
    try{state=LoadState.Ready(repository.wellness(to,days))}
    catch(error:CancellationException){throw error}
    catch(error:Exception){state=LoadState.Failed(error.message?:"复盘暂时无法读取")}
  }
  Scaffold(topBar={TopAppBar(title={Text("健康与饮食复盘")},navigationIcon={LifeBackButton(onBack)})}){padding->
    LazyColumn(Modifier.fillMaxSize().padding(padding),contentPadding=PaddingValues(20.dp),verticalArrangement=Arrangement.spacedBy(14.dp)){
      item{LifeDateField(to,{to=it;selected=it},"截至日期")}
      item{LifeTabs(days.toString(),{days=it.toInt()},listOf("7" to "7 天","30" to "30 天","90" to "90 天"))}
      item{StateContent(state,{retry++}){}}
      val data=(state as? LoadState.Ready)?.value
      if(data!=null){
        val current=data.getJSONObject("current")
        item{LifeCard{
          Text("${current.getString("from")} — ${current.getString("to")}",style=MaterialTheme.typography.titleMedium)
          Text("${current.getInt("meal_days")} 天有饮食 · ${current.getInt("weight_days")} 天有称重")
          Text("主睡眠 ${current.getInt("sleep_days")} 天 · 实际训练 ${current.getInt("workout_sessions")} 次")
        }}
        val dates=data.getJSONArray("days").let{array->(0 until array.length()).map{array.getJSONObject(it)}}
        item{LifeDateField(selected,{selected=it},"查看某一天")}
        val day=dates.firstOrNull{it.getString("date")==selected}
        if(day==null)item{Text("请选择本次范围内的日期")}
        else{
          item{LifeCard{
            Text(selected,style=MaterialTheme.typography.titleLarge)
            val weight=day.optJSONObject("weight")
            if(weight!=null)TextButton(onClick={onHealth(weight.getString("id"))}){Text("体重 ${weight.getString("value")} kg · 查看测量")} else Text("当天没有已记录体重")
            val sleep=day.optJSONObject("sleep")
            if(sleep!=null)TextButton(onClick={onHealth(sleep.getString("id"))}){Text("主睡眠 ${sleep.getInt("minutes")} 分钟 · 查看睡眠")} else Text("当天没有已记录睡眠")
            val energy=day.getJSONObject("nutrients").getJSONObject("energy_kcal")
            TextButton(onClick={onMeals(selected)}){Text("${day.getInt("meals")} 餐 · 查看这天的饮食")}
            Text(if(energy.isNull("known_total"))"热量尚未记录" else "已知 ${energy.getString("known_total")} kcal · ${energy.getInt("known_items")}/${day.getInt("items")} 项有热量")
            val workout=day.getJSONObject("workouts")
            Text("实际训练 ${workout.getInt("sessions")} 次 · "+if(workout.isNull("minutes"))"时长未知" else "已知 ${workout.getInt("minutes")} 分钟")
          }}
        }
        item{Text("营养覆盖与前期对照",style=MaterialTheme.typography.titleLarge)}
        val previous=data.getJSONObject("previous")
        item{Text("前期 ${previous.getString("from")} — ${previous.getString("to")}")}
        for((key,label) in listOf("energy_kcal" to "热量 kcal","protein_g" to "蛋白质 g","fat_g" to "脂肪 g","carb_g" to "碳水 g","fiber_g" to "纤维 g","sodium_mg" to "钠 mg")){
          val nutrient=current.getJSONObject("nutrients").getJSONObject(key)
          val before=previous.getJSONObject("nutrients").getJSONObject(key)
          fun value(obj:JSONObject,field:String)=if(obj.isNull(field))"—" else obj.getString(field)
          item{LifeCard{
            Text(label,style=MaterialTheme.typography.titleMedium)
            Text("已知合计 ${value(nutrient,"known_total")} · ${nutrient.getInt("known_items")}/${current.getInt("items")} 项")
            Text("齐全日期均值 ${value(nutrient,"average_on_complete_days")} · ${nutrient.getInt("complete_days")} 天")
            Text("前期均值 ${value(before,"average_on_complete_days")} · ${before.getInt("complete_days")} 天")
          }}
        }
        item{Text("统计口径",style=MaterialTheme.typography.titleMedium);val notes=data.getJSONArray("limitations");for(i in 0 until notes.length())Text(notes.getString(i),style=MaterialTheme.typography.bodySmall)}
      }
    }
  }
}
