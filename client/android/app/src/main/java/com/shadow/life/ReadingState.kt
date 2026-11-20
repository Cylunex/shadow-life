package com.shadow.life

import androidx.compose.runtime.*
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

internal data class Reading<T>(val state:LoadState<T>,val retry:()->Unit)
internal data class RecordPages(val state:LoadState<RecordPage>,val retry:()->Unit,val more:()->Unit)
internal data class MonthlyMoneyTotal(val currency:String,val net:String,val expense:String,val refund:String,val income:String,val entries:Int)

internal data class MonthlyMoneyDay(val currency:String,val on:String,val net:String,val entries:Int)
internal data class MonthlyMoneyCategory(val currency:String,val category:String?,val expense:String)
internal data class MonthlyMoneyRead(val totals:List<MonthlyMoneyTotal>,val days:List<MonthlyMoneyDay>,val categories:List<MonthlyMoneyCategory>)

@Composable internal fun <T> rememberLifeRead(
  vararg keys:Any?,enabled:Boolean=true,refreshKey:Any?=null,read:suspend ()->T
):Reading<T>{
  var retry by remember(*keys){mutableIntStateOf(0)}
  var state by remember(*keys){mutableStateOf<LoadState<T>>(LoadState.Loading)}
  var completed by remember(*keys){mutableStateOf<Pair<Int,Any?>?>(null)}
  val request=retry to refreshKey
  LaunchedEffect(*keys,request,enabled){
    if(enabled&&request!=completed){
      state=state.beginRefresh()
      state=state.finishRefresh(readLife(read))
      completed=request
    }
  }
  return Reading(state,{retry++})
}

@Composable internal fun rememberRecordPages(
  accountId:String,filters:Any?,enabled:Boolean=true,refreshKey:Any?=null,read:suspend (String?)->RecordPage
):RecordPages{
  val scope=rememberCoroutineScope()
  var pages by remember(accountId,filters){mutableStateOf<LoadState<RecordPage>>(LoadState.Loading)}
  var retry by remember(accountId,filters){mutableIntStateOf(0)}
  var generation by remember(accountId,filters){mutableIntStateOf(0)}
  var completed by remember(accountId,filters){mutableStateOf<Pair<Int,Any?>?>(null)}
  val request=retry to refreshKey
  LaunchedEffect(accountId,filters,request,enabled){
    if(enabled&&request!=completed){
      val token=++generation
      pages=pages.beginRefresh()
      val result=readLife{read(null)}
      if(token==generation){
        pages=pages.finishRefresh(result)
        completed=request
      }
    }
  }
  return RecordPages(pages,{generation++;retry++},{
    val current=pages as? LoadState.Ready
    val cursor=current?.value?.nextCursor
    if(enabled&&current!=null&&cursor!=null&&!current.refreshing){
      val token=++generation
      pages=current.copy(refreshing=true,refreshError=null)
      scope.launch{
        val result=readLife{
          val next=read(cursor)
          next.copy(items=(current.value.items+next.items).distinctBy{Triple(it.domain,it.kind,it.id)})
        }
        if(token==generation)pages=pages.finishRefresh(result)
      }
    }
  })
}

private suspend fun <T> readLife(read:suspend ()->T):LoadState<T> = withContext(Dispatchers.Default){
  try{LoadState.Ready(read())}
  catch(error:CancellationException){throw error}
  catch(error:Exception){LoadState.Failed(error.message?:"暂时无法读取，请重试")}
}
