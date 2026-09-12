package com.shadow.life

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.LocalDate

class NativeLifeViewModel(application:Application):AndroidViewModel(application){
  private val repository=NativeLifeRepository(application,application as ShadowApp)
  var today:LoadState<TodaySnapshot> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var timeline:LoadState<TimelinePage> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var plans:LoadState<List<PlanSummary>> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var library:LoadState<List<LibrarySummary>> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var workspace:LoadState<RecordPage> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var detail:LoadState<RecordDetail> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var workspaceDomain:LifeDomain?=null;private set
  var submit:SubmitState by androidx.compose.runtime.mutableStateOf(SubmitState.Editing);private set

  fun refreshAll(){
    refreshToday();refreshTimeline();refreshPlans();refreshLibrary()
  }
  fun refreshToday(date:LocalDate=LocalDate.now()){today=LoadState.Loading;viewModelScope.launch{today=load("今天还没有记录"){repository.today(date)}}}
  fun refreshTimeline(){timeline=LoadState.Loading;viewModelScope.launch{timeline=load("还没有生活记录"){repository.timeline()}}}
  fun refreshPlans(){plans=LoadState.Loading;viewModelScope.launch{plans=loadList("还没有计划"){repository.projects()}}}
  fun refreshLibrary(){library=LoadState.Loading;viewModelScope.launch{library=loadList("资料库还是空的"){repository.library()}}}
  fun loadWorkspace(domain:LifeDomain,query:String=""){workspaceDomain=domain;workspace=LoadState.Loading;viewModelScope.launch{workspace=load("没有符合条件的记录"){repository.records(domain,query=query)}}}
  fun loadDetail(domain:LifeDomain,id:String){detail=LoadState.Loading;viewModelScope.launch{detail=load("对象不可用"){repository.detail(domain,id)}}}
  fun submit(draft:CaptureDraft,onSaved:(OperationReceipt)->Unit={}){
    if(submit is SubmitState.Sending)return
    val temporary="cmd_pending";submit=SubmitState.Sending(temporary)
    viewModelScope.launch{try{val receipt=repository.enqueue(draft);submit=SubmitState.Saved(receipt);refreshAll();onSaved(receipt)}catch(error:CancellationException){throw error}catch(error:Exception){submit=SubmitState.Rejected(error.message?:"无法保存")}}
  }
  fun editAgain(){submit=SubmitState.Editing}

  private suspend fun <T> load(emptyMessage:String,block:suspend()->T):LoadState<T> = try{val value=block();when(value){is Collection<*>->if(value.isEmpty())LoadState.Empty(emptyMessage) else LoadState.Ready(value);else->LoadState.Ready(value)}}catch(error:CancellationException){throw error}catch(error:Exception){LoadState.Failed(error.message?:"读取失败")}
  private suspend fun <T> loadList(emptyMessage:String,block:suspend()->List<T>):LoadState<List<T>> = try{block().let{if(it.isEmpty())LoadState.Empty(emptyMessage) else LoadState.Ready(it)}}catch(error:CancellationException){throw error}catch(error:Exception){LoadState.Failed(error.message?:"读取失败")}
}
