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

@Composable internal fun NativeMealConsumptionLink(accountId:String,recordId:String,linkedMealIds:List<String>){
  val context=LocalContext.current
  val app=context.applicationContext as ShadowApp
  val repository=remember(accountId){NativeLifeRepository(context,app)}
  val scope=rememberCoroutineScope()
  var open by rememberSaveable(recordId){mutableStateOf(false)}
  var rows by remember(recordId){mutableStateOf<List<RecordSummary>>(emptyList())}
  var cursor by remember(recordId){mutableStateOf<String?>(null)}
  var loaded by remember(recordId){mutableStateOf(false)}
  var busy by remember{mutableStateOf(false)}
  var selected by remember(recordId){mutableStateOf<RecordSummary?>(null)}
  var message by remember(recordId){mutableStateOf<String?>(null)}
  var queued by rememberSaveable(recordId){mutableStateOf(listOf<String>())}
  fun checkAccount(){check(app.sessions.active()?.accountId==accountId){"账号已切换"}}
  fun load(more:Boolean=false){
    if(busy)return
    busy=true;message=null
    scope.launch{try{checkAccount();val page=repository.records(LifeDomain.Meals,"",if(more)cursor else null);checkAccount();rows=(if(more)rows+page.items else page.items).distinctBy{it.id};cursor=page.nextCursor;loaded=true}catch(e:CancellationException){throw e}catch(e:Exception){message=e.message?:"读取餐次失败"}finally{busy=false}}
  }
  Column(Modifier.fillMaxWidth().padding(vertical=12.dp),verticalArrangement=Arrangement.spacedBy(8.dp)){
    OutlinedButton(onClick={open=!open;if(open&&!loaded)load()},enabled=!busy){Text(if(open)"收起餐次选择" else "关联已有饮食记录")}
    if(open){
      Text("选择实际吃过的那一餐，只建立关联，不会重复记账或推断食用量。",color=MaterialTheme.colorScheme.onSurfaceVariant)
      rows.forEach{meal->
        val linked=meal.id in linkedMealIds||meal.id in queued
        OutlinedButton(onClick={selected=meal},enabled=!busy&&!linked,modifier=Modifier.fillMaxWidth()){
          Text("${if(linked)"已关联或待同步 · " else if(selected?.id==meal.id)"已选 · " else ""}${meal.title}\n${meal.supporting.orEmpty()}")
        }
      }
      if(!busy&&loaded&&rows.isEmpty())Text("还没有饮食记录。先记录实际吃过的食物，再回来关联。")
      if(cursor!=null)TextButton(onClick={load(true)},enabled=!busy){Text("加载更早餐次")}
      if(!loaded&&!busy)TextButton(onClick={load()}){Text("重新读取餐次")}
      selected?.let{meal->Button(enabled=!busy&&meal.id !in queued&&meal.id !in linkedMealIds,onClick={
        busy=true;message=null
        scope.launch{try{checkAccount();val receipt=repository.linkMealConsumption(meal.id,recordId);checkAccount();queued=queued+meal.id;selected=null;message=if(receipt.queued)"关联已保存到本机，待同步。同步完成后刷新详情查看实际关联。" else "已提交关联，刷新详情查看实际结果。"}catch(e:CancellationException){throw e}catch(e:Exception){message=e.message?:"关联失败"}finally{busy=false}}
      }){Text("关联这餐")}}
    }
    if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
    message?.let{Text(it,style=MaterialTheme.typography.bodyMedium)}
  }
}
