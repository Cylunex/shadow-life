package com.shadow.life

import androidx.compose.runtime.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

internal data class Reading<T>(val state:LoadState<T>,val retry:()->Unit)
internal data class RecordPages(val state:LoadState<RecordPage>,val retry:()->Unit,val more:()->Unit)
internal data class MonthlyMoneyTotal(val currency:String,val net:String,val expense:String,val refund:String,val income:String,val entries:Int)

internal data class MonthlyMoneyDay(val currency:String,val on:String,val net:String,val entries:Int)
internal data class MonthlyMoneyCategory(val currency:String,val category:String?,val expense:String)
internal data class MonthlyMoneyRead(val totals:List<MonthlyMoneyTotal>,val days:List<MonthlyMoneyDay>,val categories:List<MonthlyMoneyCategory>)

@Composable internal fun <T> rememberLifeRead(vararg keys:Any?,read:suspend ()->T):Reading<T>{
  var retry by remember(*keys){mutableIntStateOf(0)}
  var state by remember(*keys){mutableStateOf<LoadState<T>>(LoadState.Loading)}
  LaunchedEffect(*keys,retry){state=readLife(read)}
  return Reading(state,{retry++})
}

@Composable internal fun rememberRecordPages(accountId:String,filters:Any?,read:suspend (String?)->RecordPage):RecordPages{
  val scope=rememberCoroutineScope()
  var pages by remember(accountId,filters){mutableStateOf<LoadState<RecordPage>>(LoadState.Loading)}
  var retry by remember(accountId,filters){mutableIntStateOf(0)}
  var generation by remember(accountId,filters){mutableIntStateOf(0)}
  LaunchedEffect(accountId,filters,retry){
    val request=++generation
    val result=readLife{read(null)}
    if(request==generation)pages=result
  }
  return RecordPages(pages,{generation++;retry++},{
    val current=pages as? LoadState.Ready
    val cursor=current?.value?.nextCursor
    if(current!=null&&cursor!=null&&!current.refreshing){
      val request=++generation
      pages=current.copy(refreshing=true,refreshError=null)
      scope.launch{
        val result=readLife{read(cursor)}
        if(request==generation)pages=when(result){
          is LoadState.Ready->LoadState.Ready(result.value.copy(items=(current.value.items+result.value.items).distinctBy{Triple(it.domain,it.kind,it.id)}))
          is LoadState.Failed->current.copy(refreshing=false,refreshError=result.message)
          else->current
        }
      }
    }
  })
}

private suspend fun <T> readLife(read:suspend ()->T):LoadState<T> = try{
  LoadState.Ready(read())
}catch(error:CancellationException){throw error}
catch(error:Exception){LoadState.Failed(error.message?:"暂时无法读取，请重试")}
