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
data class TodayMealNutrition(
  val energyKcal:String?,val proteinG:String?,val carbG:String?,val fatG:String?,
  val totalItems:Int,val knownEnergyItems:Int,val completeMacros:Boolean
)
data class TodaySnapshot(
  val date:String,
  val mealCount:Int?=null,
  val mealNutrition:TodayMealNutrition?=null,
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
data class MealFoodSummary(
  val name:String,val quantity:String?=null,val unit:String?=null,
  val energyKcal:String?=null,val proteinG:String?=null,val fatG:String?=null,val carbG:String?=null,
  val estimated:Boolean=false
)
data class MealCardSummary(
  val mealType:String,val occurredOn:String,val occurredAt:String?,val timeZone:String,val note:String?,
  val foods:List<MealFoodSummary>,val photoAssetVersionId:String?=null
)
data class RecordSummary(val domain:LifeDomain,val kind:String,val id:String,val title:String,val supporting:String?,val trailing:String?,val revision:Int?,val detailId:String?=null,val subtype:String?=null,val meal:MealCardSummary?=null,val recordState:String?=null)
data class RecordPage(val items:List<RecordSummary>,val nextCursor:String?,val asOf:String)
data class HealthTrendPoint(val id:String,val occurredOn:String,val value:Double,val valueText:String,val unit:String,val sourceKind:String,val revision:Int,val occurredAt:String?=null,val originalField:String?=null)
data class HealthMetricTrend(val key:String,val label:String,val points:List<HealthTrendPoint>,val coveragePoints:Int,val truncated:Boolean,val unavailable:Boolean=false)
data class HealthWorkoutSummary(
  val id:String,val occurredOn:String,val sessionType:String,val startedAt:String?,val timeZone:String?,
  val durationMinutes:Long?,val distanceKm:String?,val caloriesKcal:String?,val rpe:Long?,val heartRateAvg:Long?,val sourceKind:String?,val autoDetected:Boolean?=null
)
data class HealthDailyOverview(
  val occurredOn:String,val steps:Long?,val activeMinutes:Long?,val caloriesKcal:String?,
  val sleepMinutes:Long?,val deepMinutes:Long?,val remMinutes:Long?,
  val workouts:Int,val habitsDone:Int,val updatedAt:String,
  val lightMinutes:Long?=null,val awakeMinutes:Long?=null,val sleepSource:String?=null,
  val sleepTotalDayMinutes:Long?=null,val napMinutes:List<Long> = emptyList(),val caloriesSource:String?=null,
  val workoutItems:List<HealthWorkoutSummary> = emptyList()
)
data class MoneyRecurringSummary(val id:String,val title:String,val amount:String?,val currency:String,val cadence:String,val nextDueOn:String,val state:String)
data class MoneyOccurrenceSummary(val id:String,val title:String,val dueOn:String,val state:String,val amount:String?,val currency:String?)
data class MoneyIntentSummary(val id:String,val title:String,val expectedAmount:String?,val currency:String?,val intendedOn:String?,val state:String)
data class MoneyUseCycleSummary(val id:String,val title:String,val remaining:String?,val unit:String?,val balanceStatus:String,val projectedDepletionOn:String?,val matchedIntakes:Int,val usageState:String="in_use",val estimatedRemaining:String?=null,val consumed:String?=null,val matchMode:String="none")
data class TravelPlaceSummary(val id:String,val name:String,val address:String?,val latitude:Double?,val longitude:Double?,val tags:List<String>,val favorite:Boolean)
data class TravelVisitSummary(val id:String,val tripId:String?,val placeName:String,val latitude:Double?,val longitude:Double?,val occurredOn:String,val occurredAt:String?)
data class TravelMapItemSummary(val placeId:String,val status:String,val note:String?)
data class TravelMapSummary(val id:String,val title:String,val description:String?,val state:String,val items:List<TravelMapItemSummary>)
data class TravelTripSummary(val id:String,val title:String,val startsOn:String,val endsOn:String,val timeZone:String,val visibility:String?,val active:Boolean)
data class TravelStopSummary(val id:String,val title:String,val startsAt:String?,val placeId:String?,val note:String?)
data class TravelDaySummary(val id:String,val tripId:String,val date:String,val stops:List<TravelStopSummary>,val revision:Int?=null)
data class TravelTrackPoint(val latitude:Double,val longitude:Double)
data class TravelTrackSummary(val id:String,val tripId:String,val name:String,val points:List<TravelTrackPoint>)
data class TravelSegmentSummary(val id:String,val tripId:String,val mode:String,val origin:String,val destination:String,val startsAt:String?,val distanceKm:String?)
sealed interface WorkspaceOverview { val asOf:String
  data class Meals(val mealPlans:Int,val shoppingLists:Int,val openShoppingItems:Int,override val asOf:String,
    val plans:List<MealPlanningResultDtoMealPlansEntry> = emptyList(),val lists:List<MealPlanningResultDtoShoppingListsEntry> = emptyList()):WorkspaceOverview
  data class Money(
    val period:String,val budgets:List<BudgetProgress>,val recurringPlans:Int,val openOccurrences:Int,val spendingIntents:Int,
    val recurring:List<MoneyRecurringSummary> = emptyList(),val occurrences:List<MoneyOccurrenceSummary> = emptyList(),val intents:List<MoneyIntentSummary> = emptyList(),val useCycles:List<MoneyUseCycleSummary> = emptyList(),
    override val asOf:String,val budgetDetails:List<MoneyPlanningResultDtoBudgetsEntry> = emptyList(),
    val recurringDetails:List<MoneyPlanningResultDtoRecurringPlansEntry> = emptyList(),val occurrenceDetails:List<MoneyPlanningResultDtoOccurrencesEntry> = emptyList(),
    val intentDetails:List<MoneyPlanningResultDtoSpendingIntentsEntry> = emptyList()
  ):WorkspaceOverview
  data class Health(
    val sources:Int,val sourcesNeedingAttention:Int,val streams:Int,val summary:TodayHealthSummary,
    val metrics:List<HealthMetricTrend> = emptyList(),val daily:HealthDailyOverview?=null,
    val history:List<HealthDailyOverview> = emptyList(),val sleepInsights:HealthSleepInsightsResultDto?=null,override val asOf:String
  ):WorkspaceOverview
  data class Travel(
    val trips:Int,val places:Int,val maps:Int,val activeRun:Boolean,
    val tripItems:List<TravelTripSummary> = emptyList(),val placeItems:List<TravelPlaceSummary> = emptyList(),val visitItems:List<TravelVisitSummary> = emptyList(),val mapItems:List<TravelMapSummary> = emptyList(),
    val days:List<TravelDaySummary> = emptyList(),val tracks:List<TravelTrackSummary> = emptyList(),val segments:List<TravelSegmentSummary> = emptyList(),
    val selectedTripId:String?=null,override val asOf:String
  ):WorkspaceOverview
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
data class OwnedItemEvent(val id:String,val kind:String,val occurredOn:String,val note:String,val revision:Int,val cost:String?,val documentTitle:String?,val costEntryId:String?=null,val documentId:String?=null)
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
data class DetailGroup(val id:String,val title:String,val facts:List<DetailFact>,val links:List<DetailLink> = emptyList())
data class DetailSection(val title:String,val facts:List<DetailFact> = emptyList(),val itemCount:Int?=null,val links:List<DetailLink> = emptyList(),val groups:List<DetailGroup> = emptyList())
data class TravelDetailSchedule(val trip:TravelTripSummary,val days:List<TravelDaySummary>)
sealed interface EditSeed { val domain:LifeDomain;val detailId:String
  data class Meal(override val detailId:String,val revision:Int,val occurredOn:String,val timeZone:String,val mealType:String,val note:String?):EditSeed{override val domain=LifeDomain.Meals}
  data class Money(override val detailId:String,val revision:Int,val amount:String,val currency:String,val occurredOn:String,val timeZone:String,val category:String?,val counterparty:String?,val note:String?):EditSeed{override val domain=LifeDomain.Money}
  data class Health(override val detailId:String,val revision:Int,val metric:String,val value:String,val unit:String,val occurredOn:String,val timeZone:String,val label:String?,val note:String?):EditSeed{override val domain=LifeDomain.Health}
  data class Trip(override val detailId:String,val revision:Int,val title:String,val startsOn:String,val endsOn:String,val timeZone:String,val note:String?):EditSeed{override val domain=LifeDomain.Travel}
  data class Library(override val detailId:String,val revision:Int,val title:String,val text:String?,val url:String?,val tags:List<String>):EditSeed{override val domain=LifeDomain.Library}
}
data class CorrectionDraft(val primary:String,val secondary:String,val note:String,val date:String,val option:String,val reason:String)
enum class DetailPresentation { Generic, Meal, Money, HealthMetric, Workout, Sleep, Activity, Habit, Travel, Library }
data class RecordDetail(
  val title:String,val state:String?,val revision:Int?,val sections:List<DetailSection>,val editSeed:EditSeed?=null,val actions:List<DetailAction> = emptyList(),
  val presentation:DetailPresentation=DetailPresentation.Generic,val heroValue:String?=null,val heroSupporting:String?=null,val travelSchedule:TravelDetailSchedule?=null
)

@Serializable data object TodayRoute
@Serializable data object RecordsRoute
@Serializable data object PlansRoute
@Serializable data object LibraryRoute
@Serializable data class WorkspaceRoute(val domain:String,val tab:String="")
@Serializable data class DetailRoute(val domain:String,val id:String,val title:String="")
@Serializable data class PlanDetailRoute(val id:String)
@Serializable data class OwnedItemDetailRoute(val id:String)
@Serializable data class ReviewDetailRoute(val id:String)
@Serializable data object FeaturesRoute
@Serializable data object SettingsRoute
@Serializable data object ConnectionsRoute
@Serializable data object InboxRoute
@Serializable data object ItemsRoute
@Serializable data object ConsumptionStatsRoute

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
data class MealDraftItem(val name:String="",val quantity:String="",val unit:String="",val energyKcal:String="",val proteinG:String="",val fatG:String="",val carbG:String="")
