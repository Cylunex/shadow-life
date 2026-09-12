package com.shadow.life

import android.app.Application
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import java.time.LocalDate

class NativeLifeViewModel(application:Application):AndroidViewModel(application){
  private val repository=NativeLifeRepository(application,application as ShadowApp)
  var today:LoadState<TodaySnapshot> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var timeline:LoadState<TimelinePage> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var searchResults:LoadState<RecordPage>? by androidx.compose.runtime.mutableStateOf(null);private set
  var plans:LoadState<List<PlanSummary>> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var library:LoadState<List<LibrarySummary>> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var workspace:LoadState<RecordPage> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var workspaceOverview:LoadState<WorkspaceOverview> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var detail:LoadState<RecordDetail> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var workspaceDomain:LifeDomain?=null;private set
  var submit:SubmitState by androidx.compose.runtime.mutableStateOf(SubmitState.Editing);private set
  var assistant:LoadState<AssistantReply>? by androidx.compose.runtime.mutableStateOf(null);private set
  var shareImport:LoadState<Int>? by androidx.compose.runtime.mutableStateOf(null);private set
  var projectLinks:LoadState<List<ProjectLinkItem>> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var queueStatus:LoadState<QueueSummary> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  private var assistantThreadId:String?=null
  private var activeAccountId:String?=null
  private var activeSearchQuery:String=""
  private var workspaceQuery:String=""
  private var queueJob:Job?=null
  private var workspaceJob:Job?=null
  private var workspaceOverviewJob:Job?=null

  fun refreshAll(){
    refreshToday();refreshTimeline();refreshPlans();refreshLibrary()
  }
  fun activateAccount(accountId:String){if(activeAccountId==accountId)return;activeAccountId=accountId;assistantThreadId=null;assistant=null;searchResults=null;workspaceDomain=null;workspace=LoadState.Loading;workspaceOverview=LoadState.Loading;detail=LoadState.Loading;submit=SubmitState.Editing;observeQueue();refreshAll();refreshProjectLinks()}
  fun deactivateAccount(){queueJob?.cancel();workspaceJob?.cancel();workspaceOverviewJob?.cancel();queueJob=null;workspaceJob=null;workspaceOverviewJob=null;activeAccountId=null;assistantThreadId=null;assistant=null;searchResults=null;workspaceDomain=null;today=LoadState.Loading;timeline=LoadState.Loading;plans=LoadState.Loading;library=LoadState.Loading;workspace=LoadState.Loading;workspaceOverview=LoadState.Loading;detail=LoadState.Loading;projectLinks=LoadState.Loading;queueStatus=LoadState.Loading;submit=SubmitState.Editing}
  fun refreshToday(date:LocalDate=LocalDate.now()){today=LoadState.Loading;viewModelScope.launch{today=load("今天还没有记录"){repository.today(date)}}}
  fun refreshTimeline(){timeline=LoadState.Loading;viewModelScope.launch{timeline=load("还没有生活记录"){repository.timeline()}}}
  fun loadMoreTimeline(){val current=(timeline as? LoadState.Ready)?.value?:return;val cursor=current.nextCursor?:return;viewModelScope.launch{when(val next=load("没有更多记录"){repository.timeline(cursor)}){is LoadState.Ready->timeline=LoadState.Ready(current.copy(items=current.items+next.value.items,nextCursor=next.value.nextCursor,asOf=current.asOf));is LoadState.Failed->timeline=next;else->Unit}}}
  fun refreshPlans(){plans=LoadState.Loading;viewModelScope.launch{plans=loadList("还没有计划"){repository.projects()}}}
  fun refreshLibrary(query:String=""){library=LoadState.Loading;viewModelScope.launch{library=loadList(if(query.isBlank())"资料库还是空的" else "没有符合条件的资料"){repository.library(query)}}}
  fun refreshProjectLinks(){projectLinks=LoadState.Loading;viewModelScope.launch{projectLinks=loadList("还没有配置其他项目"){repository.projectLinks()}}}
  fun search(query:String){if(query.isBlank()){clearSearch();return};activeSearchQuery=query.trim();searchResults=LoadState.Loading;viewModelScope.launch{searchResults=load("没有符合条件的生活记录"){repository.search(activeSearchQuery)}}}
  fun loadMoreSearch(){val current=(searchResults as? LoadState.Ready)?.value?:return;val cursor=current.nextCursor?:return;viewModelScope.launch{when(val next=load("没有更多搜索结果"){repository.search(activeSearchQuery,cursor)}){is LoadState.Ready->searchResults=LoadState.Ready(current.copy(items=current.items+next.value.items,nextCursor=next.value.nextCursor,asOf=current.asOf));is LoadState.Failed->searchResults=next;else->Unit}}}
  fun clearSearch(){activeSearchQuery="";searchResults=null}
  fun askLife(message:String){if(message.isBlank())return;assistant=LoadState.Loading;viewModelScope.launch{assistant=load("Life 没有返回内容"){repository.assist(message,assistantThreadId).also{assistantThreadId=it.threadId}}}}
  fun clearAssistant(){assistant=null}
  fun importShare(payload:SharePayload,onAccepted:()->Unit){if(shareImport is LoadState.Loading)return;shareImport=LoadState.Loading;viewModelScope.launch{try{val count=repository.enqueueShare(payload);shareImport=LoadState.Ready(count);onAccepted();refreshLibrary()}catch(error:CancellationException){throw error}catch(error:Exception){shareImport=LoadState.Failed(error.message?:"无法收存分享")}}}
  fun loadWorkspace(domain:LifeDomain,query:String=""){workspaceDomain=domain;workspaceQuery=query.trim();workspace=LoadState.Loading;workspaceJob?.cancel();workspaceJob=viewModelScope.launch{val result=load("没有符合条件的记录"){repository.records(domain,query=workspaceQuery)};if(workspaceDomain==domain)workspace=result};if(query.isBlank()){workspaceOverview=LoadState.Loading;workspaceOverviewJob?.cancel();workspaceOverviewJob=viewModelScope.launch{val result=load("暂无工作台摘要"){repository.workspaceOverview(domain)};if(workspaceDomain==domain)workspaceOverview=result}}}
  fun loadMoreWorkspace(){val domain=workspaceDomain?:return;val current=(workspace as? LoadState.Ready)?.value?:return;val cursor=current.nextCursor?:return;viewModelScope.launch{when(val next=load("没有更多记录"){repository.records(domain,workspaceQuery,cursor)}){is LoadState.Ready->workspace=LoadState.Ready(current.copy(items=current.items+next.value.items,nextCursor=next.value.nextCursor,asOf=current.asOf));is LoadState.Failed->workspace=next;else->Unit}}}
  fun loadDetail(domain:LifeDomain,id:String){detail=LoadState.Loading;viewModelScope.launch{detail=load("对象不可用"){repository.detail(domain,id)}}}
  fun submit(draft:CaptureDraft,onSaved:(OperationReceipt)->Unit={}){
    if(submit is SubmitState.Sending)return
    val temporary="cmd_pending";submit=SubmitState.Sending(temporary)
    viewModelScope.launch{try{val receipt=repository.enqueue(draft);submit=SubmitState.Saved(receipt);refreshAll();onSaved(receipt)}catch(error:CancellationException){throw error}catch(error:Exception){submit=SubmitState.Rejected(error.message?:"无法保存")}}
  }
  fun correct(seed:EditSeed,draft:CorrectionDraft){if(submit is SubmitState.Sending)return;submit=SubmitState.Sending("cmd_pending");viewModelScope.launch{try{val receipt=repository.enqueueCorrection(seed,draft);submit=SubmitState.Saved(receipt);loadDetail(seed.domain,seed.detailId);refreshToday();refreshTimeline();refreshLibrary()}catch(error:CancellationException){throw error}catch(error:Exception){submit=SubmitState.Rejected(error.message?:"无法保存更正")}}}
  fun editAgain(){submit=SubmitState.Editing}
  fun retryQueue(){val session=getApplication<ShadowApp>().sessions.active()?:return;viewModelScope.launch{try{repository.retryQueue(session)}catch(error:CancellationException){throw error}catch(error:Exception){queueStatus=LoadState.Failed(error.message?:"无法重试离线队列")}}}
  fun clearTerminalQueue(){val session=getApplication<ShadowApp>().sessions.active()?:return;viewModelScope.launch{try{repository.clearTerminalQueue(session)}catch(error:CancellationException){throw error}catch(error:Exception){queueStatus=LoadState.Failed(error.message?:"无法清理离线队列")}}}
  private fun observeQueue(){queueJob?.cancel();val session=getApplication<ShadowApp>().sessions.active()?:return;queueJob=viewModelScope.launch{repository.queueStatus(session).collect{queueStatus=LoadState.Ready(it)}}}

  private suspend fun <T> load(emptyMessage:String,block:suspend()->T):LoadState<T> = try{val value=block();when(value){is Collection<*>->if(value.isEmpty())LoadState.Empty(emptyMessage) else LoadState.Ready(value);else->LoadState.Ready(value)}}catch(error:CancellationException){throw error}catch(error:Exception){LoadState.Failed(error.message?:"读取失败")}
  private suspend fun <T> loadList(emptyMessage:String,block:suspend()->List<T>):LoadState<List<T>> = try{block().let{if(it.isEmpty())LoadState.Empty(emptyMessage) else LoadState.Ready(it)}}catch(error:CancellationException){throw error}catch(error:Exception){LoadState.Failed(error.message?:"读取失败")}
}
