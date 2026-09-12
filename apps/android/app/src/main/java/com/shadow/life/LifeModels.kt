package com.shadow.life

import kotlinx.serialization.Serializable

enum class Appearance { Dark, Light, System }
enum class LifeDomain { Meals, Money, Health, Travel, Library }

sealed interface LoadState<out T> {
  data object Loading : LoadState<Nothing>
  data class Ready<T>(val value:T,val asOf:String?=null) : LoadState<T>
  data class Empty(val reason:String) : LoadState<Nothing>
  data class Failed(val message:String,val retryable:Boolean=true) : LoadState<Nothing>
}

sealed interface SubmitState {
  data object Editing : SubmitState
  data class Sending(val commandId:String) : SubmitState
  data class Reconciling(val commandId:String) : SubmitState
  data class Saved(val receipt:OperationReceipt) : SubmitState
  data class Rejected(val message:String,val fields:List<String> = emptyList()) : SubmitState
}

data class ResourceRef(val type:String,val id:String,val revision:Int)
data class OperationReceipt(
  val capability:String,
  val commandId:String,
  val executionId:String?=null,
  val resources:List<ResourceRef> = emptyList(),
  val warnings:List<String> = emptyList(),
  val queued:Boolean=false
)

data class DueItem(val id:String,val title:String,val dueOn:String,val amount:String?=null,val currency:String?=null)
data class CurrentTrip(val id:String,val title:String,val startsOn:String,val endsOn:String)
data class TodaySnapshot(
  val date:String,
  val mealCount:Int?=null,
  val healthFacts:Int?=null,
  val moneyTotals:List<MoneyTotal> = emptyList(),
  val dueItems:List<DueItem> = emptyList(),
  val currentTrips:List<CurrentTrip> = emptyList(),
  val libraryCaptured:Int?=null,
  val syncIssueCount:Int=0,
  val asOf:String
)
data class MoneyTotal(val currency:String,val netSpending:String,val income:String)
data class TimelineItem(val domain:LifeDomain,val kind:String,val id:String,val happenedAt:String,val title:String,val amount:String?=null,val currency:String?=null,val recordId:String?=null)
data class TimelinePage(val items:List<TimelineItem>,val nextCursor:String?,val asOf:String)
data class RecordSummary(val domain:LifeDomain,val kind:String,val id:String,val title:String,val supporting:String?,val trailing:String?,val revision:Int?)
data class RecordPage(val items:List<RecordSummary>,val nextCursor:String?,val asOf:String)
data class PlanSummary(val id:String,val title:String,val goal:String?,val state:String,val dueOn:String?,val revision:Int,val actions:Int)
data class LibrarySummary(val id:String,val title:String,val itemType:String,val state:String?,val revision:Int?)
data class DetailFact(val label:String,val value:String)
data class DetailSection(val title:String,val facts:List<DetailFact> = emptyList(),val itemCount:Int?=null)
data class RecordDetail(val title:String,val state:String?,val revision:Int?,val sections:List<DetailSection>)

@Serializable data object TodayRoute
@Serializable data object RecordsRoute
@Serializable data object PlansRoute
@Serializable data object LibraryRoute
@Serializable data class WorkspaceRoute(val domain:String)
@Serializable data class DetailRoute(val domain:String,val id:String,val title:String="")
@Serializable data class PlanDetailRoute(val id:String)
@Serializable data object SettingsRoute
@Serializable data object ConnectionsRoute

enum class CaptureKind(val label:String,val capability:String) {
  Expense("消费","money.record_entry"),
  Meal("一餐","life.record_meal"),
  Health("健康","health.record_measurement"),
  Visit("到访","travel.record_visit"),
  Library("资料","library.capture")
}

data class CaptureDraft(
  val kind:CaptureKind=CaptureKind.Expense,
  val primary:String="",
  val secondary:String="",
  val note:String="",
  val date:String,
  val option:String=""
)
