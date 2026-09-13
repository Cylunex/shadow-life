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
  var plans:LoadState<PlanningWorkspace> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var library:LoadState<LibraryPage> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var workspace:LoadState<RecordPage> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var workspaceOverview:LoadState<WorkspaceOverview> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var refundCandidates:LoadState<RecordPage> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var detail:LoadState<RecordDetail> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var planDetail:LoadState<PlanSummary> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var ownedItemDetail:LoadState<OwnedItemSummary> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var reviewDetail:LoadState<ReviewSummary> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var workspaceDomain:LifeDomain?=null;private set
  private var activeDetail:Pair<LifeDomain,String>?=null
  var submit:SubmitState by androidx.compose.runtime.mutableStateOf(SubmitState.Editing);private set
  var assistant:LoadState<AssistantReply>? by androidx.compose.runtime.mutableStateOf(null);private set
  var assistantHistory:LoadState<AssistantConversation>? by androidx.compose.runtime.mutableStateOf(null);private set
  var shareImport:LoadState<Int>? by androidx.compose.runtime.mutableStateOf(null);private set
  var projectLinks:LoadState<List<ProjectLinkItem>> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var queueStatus:LoadState<QueueSummary> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var deviceSyncStatus:DeviceSyncStatus by androidx.compose.runtime.mutableStateOf(DeviceSyncStatus());private set
  val assetPreviews=androidx.compose.runtime.mutableStateMapOf<String,LoadState<ByteArray>>()
  var inbox:LoadState<InboxSnapshot> by androidx.compose.runtime.mutableStateOf(LoadState.Loading);private set
  var planningMessage:String? by androidx.compose.runtime.mutableStateOf(null);private set
  private var assistantThreadId:String?=null
  private var activeAccountId:String?=null
  private var activeSearchQuery:String=""
  private var activeLibraryQuery:String=""
  private var workspaceQuery:String=""
  private var queueJob:Job?=null
  private var deviceSyncJob:Job?=null
  private var workspaceJob:Job?=null
  private var workspaceOverviewJob:Job?=null
  private var readSequence=0L
  private val latestReads=mutableMapOf<String,Long>()

  private fun beginRead(key:String):Long=(++readSequence).also{latestReads[key]=it}
  private fun isCurrentRead(key:String,token:Long)=activeAccountId!=null&&latestReads[key]==token
  private fun invalidateReads(){readSequence++;latestReads.clear()}

  fun refreshAll(){
    refreshToday();refreshTimeline();refreshPlans();refreshLibrary()
  }
  fun activateAccount(accountId:String){if(activeAccountId==accountId)return;invalidateReads();assetPreviews.clear();activeAccountId=accountId;assistantThreadId=null;assistant=null;assistantHistory=null;searchResults=null;workspaceDomain=null;activeDetail=null;workspace=LoadState.Loading;workspaceOverview=LoadState.Loading;detail=LoadState.Loading;planDetail=LoadState.Loading;ownedItemDetail=LoadState.Loading;reviewDetail=LoadState.Loading;submit=SubmitState.Editing;observeQueue();observeDeviceSync(accountId);refreshAll();refreshProjectLinks();refreshInbox()}
  fun deactivateAccount(){invalidateReads();assetPreviews.clear();queueJob?.cancel();deviceSyncJob?.cancel();workspaceJob?.cancel();workspaceOverviewJob?.cancel();queueJob=null;deviceSyncJob=null;workspaceJob=null;workspaceOverviewJob=null;activeAccountId=null;assistantThreadId=null;assistant=null;assistantHistory=null;searchResults=null;workspaceDomain=null;activeDetail=null;today=LoadState.Loading;timeline=LoadState.Loading;plans=LoadState.Loading;library=LoadState.Loading;workspace=LoadState.Loading;workspaceOverview=LoadState.Loading;refundCandidates=LoadState.Loading;detail=LoadState.Loading;planDetail=LoadState.Loading;ownedItemDetail=LoadState.Loading;reviewDetail=LoadState.Loading;projectLinks=LoadState.Loading;queueStatus=LoadState.Loading;deviceSyncStatus=DeviceSyncStatus();inbox=LoadState.Loading;submit=SubmitState.Editing}
  fun refreshToday(date:LocalDate=LocalDate.now()){val token=beginRead("today");today=LoadState.Loading;viewModelScope.launch{val result=load("今天还没有记录"){repository.today(date)};if(isCurrentRead("today",token))today=result}}
  fun refreshTimeline(){val token=beginRead("timeline");timeline=LoadState.Loading;viewModelScope.launch{val result=load("还没有生活记录"){repository.timeline()};if(isCurrentRead("timeline",token))timeline=result}}
  fun loadMoreTimeline(){val current=(timeline as? LoadState.Ready)?.value?:return;val cursor=current.nextCursor?:return;val token=beginRead("timeline");viewModelScope.launch{when(val next=load("没有更多记录"){repository.timeline(cursor)}){is LoadState.Ready->if(isCurrentRead("timeline",token))timeline=LoadState.Ready(current.copy(items=(current.items+next.value.items).distinctBy{"${it.domain}:${it.id}"},nextCursor=next.value.nextCursor,asOf=current.asOf));is LoadState.Failed->if(isCurrentRead("timeline",token))timeline=LoadState.Ready(current);else->Unit}}}
  fun refreshPlans(){val token=beginRead("plans");planningMessage=null;plans=LoadState.Loading;viewModelScope.launch{val result=load("还没有计划"){repository.planning()};if(isCurrentRead("plans",token))plans=result}}
  fun refreshLibrary(query:String=""){activeLibraryQuery=query.trim();val requestedQuery=activeLibraryQuery;val token=beginRead("library");library=LoadState.Loading;viewModelScope.launch{val result=load(if(query.isBlank())"资料库还是空的" else "没有符合条件的资料"){repository.library(requestedQuery)};if(isCurrentRead("library",token)&&activeLibraryQuery==requestedQuery)library=when(result){is LoadState.Ready->if(result.value.items.isEmpty())LoadState.Empty(if(requestedQuery.isBlank())"资料库还是空的" else "没有符合条件的资料") else result;else->result}}}
  fun loadMoreLibrary(){val current=(library as? LoadState.Ready)?.value?:return;val cursor=current.nextCursor?:return;val requestedQuery=activeLibraryQuery;val token=beginRead("library");viewModelScope.launch{when(val next=load("没有更多资料"){repository.library(requestedQuery,cursor)}){is LoadState.Ready->if(isCurrentRead("library",token)&&activeLibraryQuery==requestedQuery)library=LoadState.Ready(current.copy(items=(current.items+next.value.items).distinctBy{it.id},nextCursor=next.value.nextCursor,asOf=current.asOf));is LoadState.Failed->if(isCurrentRead("library",token))library=LoadState.Ready(current);else->Unit}}}
  fun refreshProjectLinks(){val token=beginRead("projects");projectLinks=LoadState.Loading;viewModelScope.launch{val result=loadList("还没有配置其他项目"){repository.projectLinks()};if(isCurrentRead("projects",token))projectLinks=result}}
  fun refreshInbox(){val token=beginRead("inbox");inbox=LoadState.Loading;viewModelScope.launch{val result=try{repository.notifications().let{if(it.items.isEmpty())LoadState.Empty("没有待处理提醒") else LoadState.Ready(it)}}catch(error:CancellationException){throw error}catch(error:Exception){LoadState.Failed(error.message?:"无法读取提醒")};if(isCurrentRead("inbox",token))inbox=result}}
  fun loadMoreInbox(){val current=(inbox as? LoadState.Ready)?.value?:return;val cursor=current.nextCursor?:return;val token=beginRead("inbox");viewModelScope.launch{try{val next=repository.notifications(cursor);if(isCurrentRead("inbox",token))inbox=LoadState.Ready(current.copy(items=(current.items+next.items).distinctBy{it.id},nextCursor=next.nextCursor))}catch(error:CancellationException){throw error}catch(_:Exception){if(isCurrentRead("inbox",token))inbox=LoadState.Ready(current)}}}
  fun search(query:String){if(query.isBlank()){clearSearch();return};activeSearchQuery=query.trim();val requestedQuery=activeSearchQuery;val token=beginRead("search");searchResults=LoadState.Loading;viewModelScope.launch{val result=load("没有符合条件的生活记录"){repository.search(requestedQuery)};if(isCurrentRead("search",token))searchResults=result}}
  fun loadMoreSearch(){val current=(searchResults as? LoadState.Ready)?.value?:return;val cursor=current.nextCursor?:return;val requestedQuery=activeSearchQuery;val token=beginRead("search");viewModelScope.launch{when(val next=load("没有更多搜索结果"){repository.search(requestedQuery,cursor)}){is LoadState.Ready->if(isCurrentRead("search",token))searchResults=LoadState.Ready(current.copy(items=(current.items+next.value.items).distinctBy{"${it.domain}:${it.kind}:${it.id}"},nextCursor=next.value.nextCursor,asOf=current.asOf));is LoadState.Failed->if(isCurrentRead("search",token))searchResults=LoadState.Ready(current);else->Unit}}}
  fun clearSearch(){beginRead("search");activeSearchQuery="";searchResults=null}
  fun openAssistant(){if(assistantHistory is LoadState.Loading||assistantHistory is LoadState.Ready)return;val token=beginRead("assistant-history");assistantHistory=LoadState.Loading;viewModelScope.launch{val result=try{val threadId=assistantThreadId?:repository.recentThreads().firstOrNull()?.id;if(isCurrentRead("assistant-history",token))assistantThreadId=threadId;if(threadId==null)LoadState.Empty("开始一段新对话") else LoadState.Ready(repository.assistantMessages(threadId))}catch(error:CancellationException){throw error}catch(error:Exception){LoadState.Failed(error.message?:"无法读取对话")};if(isCurrentRead("assistant-history",token))assistantHistory=result}}
  fun loadOlderAssistantMessages(){val current=(assistantHistory as? LoadState.Ready)?.value?:return;val cursor=current.nextCursor?:return;val token=beginRead("assistant-history");viewModelScope.launch{try{val older=repository.assistantMessages(current.threadId,cursor);if(isCurrentRead("assistant-history",token))assistantHistory=LoadState.Ready(current.copy(items=(older.items+current.items).distinctBy{it.id},nextCursor=older.nextCursor))}catch(error:CancellationException){throw error}catch(_:Exception){if(isCurrentRead("assistant-history",token))assistantHistory=LoadState.Ready(current)}}}
  fun askLife(message:String){if(message.isBlank())return;val token=beginRead("assistant-run");val threadId=assistantThreadId;assistant=LoadState.Loading;viewModelScope.launch{val result=try{val reply=repository.assist(message,threadId);val history=repository.assistantMessages(reply.threadId);if(isCurrentRead("assistant-run",token)){assistantThreadId=reply.threadId;assistantHistory=LoadState.Ready(history);if(reply.receipts.isNotEmpty())refreshForCapabilities(reply.receipts.map{it.capability}.toSet())};LoadState.Ready(reply)}catch(error:CancellationException){throw error}catch(error:Exception){LoadState.Failed(error.message?:"Life 请求失败")};if(isCurrentRead("assistant-run",token))assistant=result}}
  fun clearAssistant(){assistant=null}
  fun importShare(payload:SharePayload,onAccepted:()->Unit){if(shareImport is LoadState.Loading)return;shareImport=LoadState.Loading;viewModelScope.launch{try{val count=repository.enqueueShare(payload);shareImport=LoadState.Ready(count);onAccepted();refreshLibrary()}catch(error:CancellationException){throw error}catch(error:Exception){shareImport=LoadState.Failed(error.message?:"无法收存分享")}}}
  fun loadWorkspace(domain:LifeDomain,query:String=""){workspaceDomain=domain;workspaceQuery=query.trim();val requestedQuery=workspaceQuery;val token=beginRead("workspace");workspace=LoadState.Loading;workspaceJob?.cancel();workspaceJob=viewModelScope.launch{val result=load("没有符合条件的记录"){repository.records(domain,query=requestedQuery)};if(isCurrentRead("workspace",token)&&workspaceDomain==domain&&workspaceQuery==requestedQuery)workspace=result};if(query.isBlank()){val overviewToken=beginRead("workspace-overview");workspaceOverview=LoadState.Loading;workspaceOverviewJob?.cancel();workspaceOverviewJob=viewModelScope.launch{val result=load("暂无工作台摘要"){repository.workspaceOverview(domain)};if(isCurrentRead("workspace-overview",overviewToken)&&workspaceDomain==domain)workspaceOverview=result}}}
  fun loadMoreWorkspace(){val domain=workspaceDomain?:return;val current=(workspace as? LoadState.Ready)?.value?:return;val cursor=current.nextCursor?:return;val requestedQuery=workspaceQuery;val token=beginRead("workspace");viewModelScope.launch{when(val next=load("没有更多记录"){repository.records(domain,requestedQuery,cursor)}){is LoadState.Ready->if(isCurrentRead("workspace",token)&&workspaceDomain==domain&&workspaceQuery==requestedQuery)workspace=LoadState.Ready(current.copy(items=(current.items+next.value.items).distinctBy{"${it.kind}:${it.id}"},nextCursor=next.value.nextCursor,asOf=current.asOf));is LoadState.Failed->if(isCurrentRead("workspace",token))workspace=LoadState.Ready(current);else->Unit}}}
  fun loadAssetPreview(versionId:String){if(assetPreviews[versionId] is LoadState.Loading||assetPreviews[versionId] is LoadState.Ready)return;assetPreviews[versionId]=LoadState.Loading;viewModelScope.launch{assetPreviews[versionId]=try{LoadState.Ready(repository.assetPreview(versionId))}catch(error:CancellationException){assetPreviews.remove(versionId);throw error}catch(error:Exception){LoadState.Failed(error.message?:"无法读取餐照")}}}
  fun loadRefundCandidates(query:String=""){val token=beginRead("refund-candidates");refundCandidates=LoadState.Loading;viewModelScope.launch{val result=load("没有可退款的交易"){repository.records(LifeDomain.Money,query.trim())};if(isCurrentRead("refund-candidates",token))refundCandidates=when(result){is LoadState.Ready->result.value.copy(items=result.value.items.filter{it.kind=="money_entry"&&it.subtype=="expense"}).let{if(it.items.isEmpty())LoadState.Empty("没有可退款的支出") else LoadState.Ready(it)};else->result}}}
  fun loadDetail(domain:LifeDomain,id:String){activeDetail=domain to id;val token=beginRead("detail");detail=LoadState.Loading;viewModelScope.launch{val result=load("对象不可用"){repository.detail(domain,id)};if(isCurrentRead("detail",token)&&activeDetail==(domain to id))detail=result}}
  fun loadPlanDetail(id:String){val token=beginRead("plan-detail");planDetail=LoadState.Loading;viewModelScope.launch{val result=load("项目不存在或当前无权查看"){repository.project(id)};if(isCurrentRead("plan-detail",token))planDetail=result}}
  fun loadOwnedItemDetail(id:String){val token=beginRead("owned-detail");ownedItemDetail=LoadState.Loading;viewModelScope.launch{val result=load("物品不存在或当前无权查看"){repository.ownedItem(id)};if(isCurrentRead("owned-detail",token))ownedItemDetail=result}}
  fun loadReviewDetail(id:String){val token=beginRead("review-detail");reviewDetail=LoadState.Loading;viewModelScope.launch{val result=load("回顾不存在或当前无权查看"){repository.review(id)};if(isCurrentRead("review-detail",token))reviewDetail=result}}
  fun submit(draft:CaptureDraft,onSaved:(OperationReceipt)->Unit={}){
    if(submit is SubmitState.Sending)return
    val temporary="cmd_pending";submit=SubmitState.Sending(temporary)
    viewModelScope.launch{try{val receipt=repository.enqueue(draft);submit=SubmitState.Saved(receipt);onSaved(receipt)}catch(error:CancellationException){throw error}catch(error:Exception){submit=SubmitState.Rejected(error.message?:"无法保存")}}
  }
  fun correct(seed:EditSeed,draft:CorrectionDraft){if(submit is SubmitState.Sending)return;submit=SubmitState.Sending("cmd_pending");viewModelScope.launch{try{val receipt=repository.enqueueCorrection(seed,draft);submit=SubmitState.Saved(receipt)}catch(error:CancellationException){throw error}catch(error:Exception){submit=SubmitState.Rejected(error.message?:"无法保存更正")}}}
  fun editAgain(){submit=SubmitState.Editing}
  fun retryQueue(){val session=getApplication<ShadowApp>().sessions.active()?:return;viewModelScope.launch{try{repository.retryQueue(session)}catch(error:CancellationException){throw error}catch(error:Exception){queueStatus=LoadState.Failed(error.message?:"无法重试离线队列")}}}
  fun clearTerminalQueue(){val session=getApplication<ShadowApp>().sessions.active()?:return;viewModelScope.launch{try{repository.clearTerminalQueue(session)}catch(error:CancellationException){throw error}catch(error:Exception){queueStatus=LoadState.Failed(error.message?:"无法清理离线队列")}}}
  fun updateNotification(id:String,action:String){viewModelScope.launch{try{repository.updateNotification(id,action,if(action=="snooze")java.time.Instant.now().plusSeconds(3_600).toString() else null);if(action in setOf("dismiss","mark_read","snooze"))getApplication<Application>().getSystemService(android.app.NotificationManager::class.java).cancel(id.hashCode());val current=(inbox as? LoadState.Ready)?.value?:return@launch;val items=when(action){"dismiss"->current.items.filterNot{it.id==id};"mark_read","mark_unread"->current.items.map{if(it.id==id)it.copy(readState=if(action=="mark_read")"read" else "unread") else it};"snooze"->current.items.map{if(it.id==id)it.copy(state="snoozed",deliveryState="snoozed") else it};else->current.items};inbox=if(items.isEmpty())LoadState.Empty("没有待处理提醒") else LoadState.Ready(current.copy(items=items))}catch(error:CancellationException){throw error}catch(error:Exception){inbox=LoadState.Failed(error.message?:"无法更新提醒")}}}
  fun updateAgenda(item:AgendaItem,action:String){viewModelScope.launch{try{repository.enqueueAgendaAction(item,action);val current=(plans as? LoadState.Ready)?.value?:return@launch;val nextState=when(action){"complete"->if(item.sourceKind=="recurring_occurrence")"handled" else "completed";"dismiss"->"dismissed";"cancel"->"cancelled";"snooze"->"snoozed";else->item.state};plans=LoadState.Ready(current.copy(agenda=current.agenda.map{agenda->if(agenda.sourceKey==item.sourceKey)agenda.copy(state=nextState,primaryAction=agenda.primaryAction?.let{it.copy(expectedRevision=it.expectedRevision+1)}) else agenda}));planningMessage="操作已安全保存，等待同步"}catch(error:CancellationException){throw error}catch(error:Exception){planningMessage=error.message?:"无法更新安排"}}}
  fun setNotificationPreferences(enabled:Boolean){viewModelScope.launch{try{repository.setNotificationPreferences(enabled,null,null);val current=(inbox as? LoadState.Ready)?.value?:return@launch;inbox=LoadState.Ready(current.copy(preferences=current.preferences.copy(enabled=enabled)))}catch(error:CancellationException){throw error}catch(error:Exception){inbox=LoadState.Failed(error.message?:"无法更新提醒设置")}}}
  fun registerNotificationDevice(authorizationState:String){viewModelScope.launch{try{repository.registerNotificationDevice(authorizationState)}catch(error:CancellationException){throw error}catch(error:Exception){queueStatus=LoadState.Failed(error.message?:"无法登记通知权限")}}}
  private fun observeQueue(){
    queueJob?.cancel();val session=getApplication<ShadowApp>().sessions.active()?:return
    queueJob=viewModelScope.launch{
      var previousScale:String?=null;var previousSamsung:String?=null;var knownCommitted:Set<String>?=null
      repository.queueStatus(session).collect{next->
        queueStatus=LoadState.Ready(next)
        val deviceUploadCompleted=(previousScale!=null&&previousScale!="committed"&&next.latestScaleState=="committed")||(previousSamsung!=null&&previousSamsung!="committed"&&next.latestSamsungState=="committed")
        previousScale=next.latestScaleState;previousSamsung=next.latestSamsungState
        val currentCommitted=next.committedReceipts.mapTo(linkedSetOf()){it.commandId}
        val newlyCommitted=knownCommitted?.let{known->next.committedReceipts.filterNot{it.commandId in known}}.orEmpty()
        knownCommitted=currentCommitted
        if(deviceUploadCompleted){refreshToday();if(workspaceDomain==LifeDomain.Health)loadWorkspace(LifeDomain.Health,workspaceQuery)}
        if(newlyCommitted.isNotEmpty()){val current=submit as? SubmitState.Saved;newlyCommitted.firstOrNull{it.commandId==current?.receipt?.commandId}?.let{submit=SubmitState.Saved(it)};refreshForCapabilities(newlyCommitted.mapTo(linkedSetOf()){it.capability})}
      }
    }
  }
  private fun observeDeviceSync(accountId:String){deviceSyncJob?.cancel();deviceSyncJob=viewModelScope.launch{getApplication<ShadowApp>().deviceSync.observe(accountId).collect{deviceSyncStatus=it}}}

  private fun refreshForCapabilities(capabilities:Set<String>){
    if(capabilities.isEmpty())return
    val domains=capabilities.mapNotNull{capability->when{
      capability.startsWith("money.")->LifeDomain.Money
      capability.startsWith("health.")->LifeDomain.Health
      capability.startsWith("travel.")->LifeDomain.Travel
      capability.startsWith("library.")->LifeDomain.Library
      capability.startsWith("life.record_meal")||capability.startsWith("life.add_meal")||capability.startsWith("life.attach_meal")||capability.startsWith("life.link_meal")||capability.startsWith("life.save_food")||capability.startsWith("life.save_recipe")||capability.startsWith("life.save_meal")||capability.startsWith("life.build_shopping")||capability.startsWith("life.update_shopping")->LifeDomain.Meals
      else->null
    }}.toSet()
    refreshToday();refreshTimeline()
    if(domains.contains(LifeDomain.Library))refreshLibrary(activeLibraryQuery)
    if(capabilities.any{it.startsWith("life.save_project")||it.startsWith("life.save_action")||it.startsWith("life.save_owned")||it.startsWith("life.record_owned")||it.startsWith("life.generate_review")||it.startsWith("life.save_meal")||it.startsWith("life.build_shopping")||it.startsWith("life.update_shopping")||it.startsWith("money.set_")||it.startsWith("health.set_plan")})refreshPlans()
    workspaceDomain?.let{loadWorkspace(it,workspaceQuery)}
    activeDetail?.let{(domain,id)->loadDetail(domain,id)}
  }

  private suspend fun <T> load(emptyMessage:String,block:suspend()->T):LoadState<T> = try{val value=block();when(value){is Collection<*>->if(value.isEmpty())LoadState.Empty(emptyMessage) else LoadState.Ready(value);else->LoadState.Ready(value)}}catch(error:CancellationException){throw error}catch(error:Exception){LoadState.Failed(error.message?:"读取失败")}
  private suspend fun <T> loadList(emptyMessage:String,block:suspend()->List<T>):LoadState<List<T>> = try{block().let{if(it.isEmpty())LoadState.Empty(emptyMessage) else LoadState.Ready(it)}}catch(error:CancellationException){throw error}catch(error:Exception){LoadState.Failed(error.message?:"读取失败")}
}
