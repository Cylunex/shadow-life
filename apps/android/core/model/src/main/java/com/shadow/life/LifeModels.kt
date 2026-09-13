package com.shadow.life

import kotlinx.serialization.Serializable

enum class Appearance { Dark, Light, System }
enum class LifeDomain { Meals, Money, Health, Travel, Library }
data class ProductSession(
  val accountId:String,val subjectId:String,val apiBase:String,val authStateJson:String,
  val oidcSub:String=subjectId,val issuer:String="",val environmentId:String="default",
  val generation:Long=0,val tokenRevision:Long=1,val displayName:String?=null
)
data class AuthAttempt(val state:String,val nonce:String,val generation:Long,val createdAt:Long)

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
data class AssistantReply(val text:String,val threadId:String,val runId:String?,val state:String,val prompt:String?=null,val receipts:List<OperationReceipt> = emptyList())
data class AssistantThreadSummary(val id:String,val title:String,val updatedAt:String,val lastMessage:String?)
data class AssistantMessage(val id:String,val role:String,val content:String,val createdAt:String)
data class AssistantConversation(val threadId:String,val items:List<AssistantMessage>,val nextCursor:String?,val asOf:String)
data class SharePayload(val ingressId:String,val text:String?,val uris:List<String>)
data class ProjectLinkItem(val id:String,val title:String,val subtitle:String,val icon:String,val state:String,val launchMode:String?,val appLinkUrl:String?,val webFallbackUrl:String?,val androidPackage:String?,val authHint:String,val order:Int)
data class QueueSummary(
  val waiting:Int,val reconciling:Int,val failed:Int,val completed:Int,val attachments:Int,
  val latestScaleState:String?=null,val latestScaleAt:Long?=null,
  val latestSamsungState:String?=null,val latestSamsungAt:Long?=null,
  val committedReceipts:List<OperationReceipt> = emptyList()
){val terminal:Int get()=failed+completed}
data class NotificationItem(val id:String,val title:String,val body:String,val scheduledAt:String,val state:String,val readState:String,val deliveryState:String)
data class NotificationPreferences(val enabled:Boolean,val quietStart:String?,val quietEnd:String?,val timeZone:String,val revision:Int)
data class InboxSnapshot(val items:List<NotificationItem>,val nextCursor:String?,val preferences:NotificationPreferences,val asOf:String)

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
  val health:TodayHealthSummary=TodayHealthSummary(HealthSummaryState.NotAuthorized),
  val asOf:String
)
enum class HealthSummaryState { NotAuthorized, Empty, Ready, Failed }
data class TodayHealthSummary(
  val state:HealthSummaryState,
  val weight:String?=null,val weightUnit:String?=null,val weightOn:String?=null,
  val steps:Long?=null,val sleepMinutes:Long?=null,val updatedAt:String?=null
)
data class MoneyTotal(val currency:String,val netSpending:String,val income:String)
data class TimelineItem(val domain:LifeDomain,val kind:String,val id:String,val happenedAt:String,val title:String,val amount:String?=null,val currency:String?=null,val recordId:String?=null)
data class TimelinePage(val items:List<TimelineItem>,val nextCursor:String?,val asOf:String)
data class RecordSummary(val domain:LifeDomain,val kind:String,val id:String,val title:String,val supporting:String?,val trailing:String?,val revision:Int?,val detailId:String?=null,val subtype:String?=null)
data class RecordPage(val items:List<RecordSummary>,val nextCursor:String?,val asOf:String)
sealed interface WorkspaceOverview { val asOf:String
  data class Meals(val mealPlans:Int,val shoppingLists:Int,val openShoppingItems:Int,override val asOf:String):WorkspaceOverview
  data class Money(val period:String,val budgets:List<BudgetProgress>,val recurringPlans:Int,val openOccurrences:Int,val spendingIntents:Int,override val asOf:String):WorkspaceOverview
  data class Health(val sources:Int,val sourcesNeedingAttention:Int,val streams:Int,val summary:TodayHealthSummary,override val asOf:String):WorkspaceOverview
  data class Travel(val trips:Int,val places:Int,val maps:Int,val activeRun:Boolean,override val asOf:String):WorkspaceOverview
  data class Library(val visibleItems:Int,override val asOf:String):WorkspaceOverview
}
data class BudgetProgress(val title:String,val amount:String,val currency:String,val spent:String)
data class ProjectMilestone(val id:String,val title:String,val dueOn:String?,val state:String,val position:Int)
data class ProjectAction(val id:String,val title:String,val dueOn:String?,val state:String,val revision:Int,val sourceState:String?)
data class PlanningLink(val kind:String,val id:String,val revision:Int,val role:String,val title:String?=null)
data class PlanSummary(
  val id:String,val title:String,val goal:String?,val state:String,val dueOn:String?,val revision:Int,val actions:Int,
  val startsOn:String?=null,val updatedAt:String?=null,
  val milestones:List<ProjectMilestone> = emptyList(),val links:List<PlanningLink> = emptyList(),val actionItems:List<ProjectAction> = emptyList()
)
data class AgendaAction(val capability:String,val targetId:String,val expectedRevision:Int)
data class AgendaItem(val sourceKind:String,val sourceId:String,val sourceKey:String,val title:String,val state:String,val dueOn:String,val dueAt:String?,val targetKind:String,val targetId:String,val projectId:String?,val primaryAction:AgendaAction?)
data class OwnedItemPurchase(val purchaseItemId:String,val purchaseId:String,val recordId:String,val rawName:String,val quantity:String?,val unit:String?,val lineAmount:String?)
data class OwnedItemEvent(val id:String,val kind:String,val occurredOn:String,val note:String,val revision:Int,val cost:String?,val documentTitle:String?)
data class OwnedItemSummary(
  val id:String,val name:String,val state:String,val location:String?,val warrantyEndsOn:String?,val returnBy:String?,val revision:Int,val documents:Int,val events:Int,
  val startedOn:String?=null,val updatedAt:String?=null,val purchase:OwnedItemPurchase?=null,
  val documentItems:List<PlanningLink> = emptyList(),val eventItems:List<OwnedItemEvent> = emptyList()
)
data class ReviewEvidence(val kind:String,val id:String,val revision:Int)
data class ReviewMetric(val label:String,val value:String)
data class ReviewMetricGroup(val title:String,val values:List<ReviewMetric>)
data class ReviewSummary(
  val id:String,val fromOn:String,val toOn:String,val algorithmVersion:String,val revision:Int,val generatedAt:String,val metrics:Int,val limitations:Int,
  val timeZone:String="",val domains:List<String> = emptyList(),val metricGroups:List<ReviewMetricGroup> = emptyList(),val coverageGroups:List<ReviewMetricGroup> = emptyList(),
  val evidence:List<ReviewEvidence> = emptyList(),val limitationItems:List<String> = emptyList()
)
data class PlanningWorkspace(val agenda:List<AgendaItem>,val projects:List<PlanSummary>,val ownedItems:List<OwnedItemSummary>,val reviews:List<ReviewSummary>,val truncated:Boolean,val asOf:String,val partialFailures:List<String> = emptyList())
data class LibrarySummary(val id:String,val title:String,val itemType:String,val state:String?,val revision:Int?)
data class LibraryPage(val items:List<LibrarySummary>,val nextCursor:String?,val asOf:String)
data class DetailFact(val label:String,val value:String)
data class DetailLink(val kind:String,val id:String,val title:String,val supporting:String?=null)
data class CaptureSeed(
  val kind:CaptureKind,val primary:String="",val secondary:String="",val note:String="",
  val date:String,val option:String="",val category:String="",val paymentMethod:String="",
  val contextKind:String?=null,val contextId:String?=null,val contextLabel:String?=null
)
data class DetailAction(val label:String,val seed:CaptureSeed)
data class DetailSection(val title:String,val facts:List<DetailFact> = emptyList(),val itemCount:Int?=null,val links:List<DetailLink> = emptyList())
sealed interface EditSeed { val domain:LifeDomain;val detailId:String
  data class Meal(override val detailId:String,val revision:Int,val occurredOn:String,val timeZone:String,val mealType:String,val note:String?):EditSeed{override val domain=LifeDomain.Meals}
  data class Money(override val detailId:String,val revision:Int,val amount:String,val currency:String,val occurredOn:String,val timeZone:String,val category:String?,val counterparty:String?,val note:String?):EditSeed{override val domain=LifeDomain.Money}
  data class Health(override val detailId:String,val revision:Int,val metric:String,val value:String,val unit:String,val occurredOn:String,val timeZone:String,val label:String?,val note:String?):EditSeed{override val domain=LifeDomain.Health}
  data class Trip(override val detailId:String,val revision:Int,val title:String,val startsOn:String,val endsOn:String,val timeZone:String,val note:String?):EditSeed{override val domain=LifeDomain.Travel}
  data class Library(override val detailId:String,val revision:Int,val title:String,val text:String?,val url:String?,val tags:List<String>):EditSeed{override val domain=LifeDomain.Library}
}
data class CorrectionDraft(val primary:String,val secondary:String,val note:String,val date:String,val option:String,val reason:String)
data class RecordDetail(val title:String,val state:String?,val revision:Int?,val sections:List<DetailSection>,val editSeed:EditSeed?=null,val actions:List<DetailAction> = emptyList())

@Serializable data object TodayRoute
@Serializable data object RecordsRoute
@Serializable data object PlansRoute
@Serializable data object LibraryRoute
@Serializable data class WorkspaceRoute(val domain:String)
@Serializable data class DetailRoute(val domain:String,val id:String,val title:String="")
@Serializable data class PlanDetailRoute(val id:String)
@Serializable data class OwnedItemDetailRoute(val id:String)
@Serializable data class ReviewDetailRoute(val id:String)
@Serializable data object FeaturesRoute
@Serializable data object SettingsRoute
@Serializable data object ConnectionsRoute
@Serializable data object InboxRoute

enum class CaptureKind(val label:String,val capability:String) {
  Expense("消费","money.record_entry"),
  Purchase("购买","life.record_purchase"),
  Refund("退款","money.record_refund"),
  Meal("一餐","life.record_meal"),
  Health("健康","health.record_measurement"),
  Workout("训练","health.record_workout"),
  Visit("到访","travel.record_visit"),
  Trip("旅程","travel.create_trip"),
  OwnedItem("物品","life.save_owned_item"),
  Project("项目","life.save_project"),
  Library("资料","library.capture")
}

data class CaptureDraft(
  val kind:CaptureKind=CaptureKind.Expense,
  val primary:String="",
  val secondary:String="",
  val note:String="",
  val date:String,
  val option:String="",
  val category:String="",
  val paymentMethod:String="",
  val mealItems:List<MealDraftItem> = emptyList(),
  val contextKind:String?=null,
  val contextId:String?=null
)
data class MealDraftItem(val name:String="",val quantity:String="",val unit:String="")
