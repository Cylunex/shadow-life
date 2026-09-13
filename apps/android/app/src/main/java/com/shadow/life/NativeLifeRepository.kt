package com.shadow.life

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.LocalDate
import java.time.ZoneId
import java.util.UUID
import android.net.Uri
import android.provider.OpenableColumns

class NativeLifeRepository(private val context:Context,private val app:ShadowApp) {
  private val wireJson=Json { ignoreUnknownKeys=true }
  fun queueStatus(session:ProductSession)=app.queue.observeStatus(session)
  suspend fun retryQueue(session:ProductSession):Int=app.queue.retry(session).also{SyncScheduler.retryNow(context,session.accountId)}
  suspend fun clearTerminalQueue(session:ProductSession):Int=app.queue.clearTerminal(session)
  suspend fun notifications(cursor:String?=null):InboxSnapshot{
    val result=wireJson.decodeFromString<NotificationsResultDto>(getText("/api/notifications?limit=50${cursor?.let{"&cursor=${encode(it)}"}.orEmpty()}"))
    val preferences=result.preferences
    return InboxSnapshot(
      items=result.items.map{NotificationItem(it.id,it.title,it.body,it.scheduledAt,it.state.wireValue,it.readState.wireValue,it.deliveryState.wireValue)},
      nextCursor=result.nextCursor,
      preferences=NotificationPreferences(preferences.enabled,preferences.quietStart,preferences.quietEnd,preferences.timeZone,preferences.revision.toInt()),
      asOf=result.asOf
    )
  }
  suspend fun updateNotification(id:String,action:String,snoozedUntil:String?=null):OperationReceipt=withContext(Dispatchers.IO){enqueueCommand("notifications.update",JSONObject().put("notification_id",id).put("action",action).apply{snoozedUntil?.let{put("snoozed_until",it)}})}
  suspend fun setNotificationPreferences(enabled:Boolean,quietStart:String?,quietEnd:String?):OperationReceipt=withContext(Dispatchers.IO){enqueueCommand("notifications.set_preferences",JSONObject().put("enabled",enabled).put("time_zone",ZoneId.systemDefault().id).apply{if(quietStart!=null&&quietEnd!=null){put("quiet_start",quietStart);put("quiet_end",quietEnd)}})}
  suspend fun registerNotificationDevice(authorizationState:String):OperationReceipt=withContext(Dispatchers.IO){val installationId=app.sessions.installationId();val receipt=enqueueCommand("notifications.register_device",JSONObject().put("installation_id",installationId).put("platform","android").put("authorization_state",authorizationState),"cmd_android_notification_installation_${installationId.removePrefix("installation_").take(48)}_${System.currentTimeMillis()}");if(authorizationState=="enabled")app.sessions.active()?.accountId?.let{NotificationSyncScheduler.schedule(context,it)};receipt}
  suspend fun today(date:LocalDate=LocalDate.now()):TodaySnapshot {
    val zone=ZoneId.systemDefault().id
    val result=wireJson.decodeFromString<LifeTodayResultDto>(getText("/api/today?date=$date&time_zone=${encode(zone)}"))
    val domains=result.domains
    val health=if(domains.health==null)TodayHealthSummary(HealthSummaryState.NotAuthorized) else healthSummary(date)
    return TodaySnapshot(
      date=result.date,mealCount=domains.meals?.count?.toInt(),healthFacts=domains.health?.facts?.toInt(),
      moneyTotals=domains.money?.totals?.map{MoneyTotal(it.currency,it.netSpending,it.income)}.orEmpty(),
      dueItems=domains.money?.dueItems?.map{DueItem(it.id,it.title,it.dueOn,it.amount,it.currency)}.orEmpty(),
      currentTrips=domains.travel?.currentTrips?.map{CurrentTrip(it.id,it.title,it.startsOn,it.endsOn)}.orEmpty(),
      libraryCaptured=domains.library?.captured?.toInt(),syncIssueCount=domains.health?.syncIssues?.size?:0,health=health,asOf=result.asOf
    )
  }

  suspend fun timeline(cursor:String?=null,domains:Set<LifeDomain> = LifeDomain.entries.toSet()):TimelinePage {
    val query=buildList { add("limit=30");add("domains="+domains.joinToString(","){it.name.lowercase()});if(cursor!=null)add("cursor=${encode(cursor)}") }.joinToString("&")
    val result=wireJson.decodeFromString<LifeTimelineResultDto>(getText("/api/timeline?$query"))
    return TimelinePage(result.items.map{
      TimelineItem(domainFromWire(it.domain.wireValue),it.kind,it.id,it.happenedAt,it.title,it.amount,it.currency,it.recordId)
    },result.nextCursor,result.asOf)
  }

  suspend fun search(query:String,cursor:String?=null):RecordPage {
    return search(query,cursor,null)
  }

  private suspend fun search(query:String,cursor:String?,domains:Set<LifeDomain>?):RecordPage {
    val filters=domains?.takeIf{it.isNotEmpty()}?.joinToString(",",prefix="&types="){it.name.lowercase()}.orEmpty()
    val result=wireJson.decodeFromString<LifeSearchResultDto>(getText("/api/search?q=${encode(query)}&limit=50$filters${cursor?.let{"&cursor=${encode(it)}"}.orEmpty()}"))
    return RecordPage(result.items.map{item->
      RecordSummary(domainFromWire(item.domain.wireValue),item.kind,item.id,item.title,item.supporting?:item.happenedOn,item.amount?.let{listOfNotNull(item.currency,it).joinToString(" ")},null,item.recordId)
    },result.nextCursor,result.asOf)
  }

  suspend fun recentThreads():List<AssistantThreadSummary>{
    val result=wireJson.decodeFromString<AgentThreadsResultDto>(getText("/api/threads"))
    return result.items.map{AssistantThreadSummary(it.id,it.title,it.updatedAt,it.lastMessage)}
  }

  suspend fun assistantMessages(threadId:String,cursor:String?=null):AssistantConversation{
    val result=wireJson.decodeFromString<AgentThreadMessagesResultDto>(getText("/api/threads/${encode(threadId)}/messages?limit=50${cursor?.let{"&cursor=${encode(it)}"}.orEmpty()}"))
    return AssistantConversation(threadId,result.items.map{AssistantMessage(it.id,it.role.wireValue,it.content,it.createdAt)},result.nextCursor,result.asOf)
  }

  suspend fun assist(message:String,existingThreadId:String?=null):AssistantReply=withContext(Dispatchers.IO){
    val session=app.sessions.active()?:error("请先登录 Shadow Life")
    val fresh=when(val value=app.sessions.fresh(session.accountId,context)){SessionRefresh.ReauthRequired->error("会话已失效，请重新登录");SessionRefresh.Retryable->error("暂时无法刷新会话，请稍后重试");is SessionRefresh.Ready->value.value}
    val threadId=existingThreadId?:JSONObject(request(fresh,"/api/threads","POST",JSONObject().put("title",message.trim().take(60)).toString(),"application/json")).getString("id")
    val connection=(URL(fresh.session.apiBase+"/api/threads/${encode(threadId)}/runs").openConnection() as HttpURLConnection).apply{requestMethod="POST";connectTimeout=10_000;readTimeout=150_000;doOutput=true;setRequestProperty("Authorization","Bearer ${fresh.accessToken}");setRequestProperty("Accept","text/event-stream");setRequestProperty("Content-Type","application/json");outputStream.bufferedWriter().use{it.write(JSONObject().put("text",message.trim()).toString())}}
    var runId:String?=null;var state="started";var prompt:String?=null;var lastSequence=0;val answer=StringBuilder();val receipts=mutableListOf<OperationReceipt>();val receiptKeys=mutableSetOf<String>()
    fun applyEvent(event:JSONObject){runId=event.optNullableString("run_id")?:runId;when(event.optString("type")){"message.delta"->answer.append(event.optString("text"));"run.state"->{state=event.optString("state",state);prompt=event.optNullableString("prompt")?:prompt};"operation.committed"->{val result=event.optJSONObject("result");val key=event.optNullableString("execution_id")?:event.optString("command_id");if(receiptKeys.add(key))receipts+=OperationReceipt(event.optString("capability"),event.optString("command_id"),event.optNullableString("execution_id"),result?.optJSONArray("resources").objects().map{ResourceRef(it.optString("type"),it.optString("id"),it.optInt("revision",1))})}}}
    var streamFailure:Throwable?=null
    try{
      val code=connection.responseCode;if(code !in 200..299){val body=connection.errorStream?.bufferedReader()?.use{it.readText()}.orEmpty();error(runCatching{JSONObject(body).optString("message")}.getOrNull().orEmpty().ifBlank{"Life 请求失败（HTTP $code）"})}
      var eventSequence=0;connection.inputStream.bufferedReader().useLines{lines->lines.forEach{line->when{line.startsWith("id:")->eventSequence=line.removePrefix("id:").trim().toIntOrNull()?.takeIf{it>=0}?:eventSequence;line.startsWith("data:")->runCatching{JSONObject(line.removePrefix("data:").trim())}.getOrNull()?.let{applyEvent(it);lastSequence=maxOf(lastSequence,eventSequence)}}}}
    }catch(error:CancellationException){throw error
    }catch(error:Throwable){streamFailure=error
    }finally{connection.disconnect()}
    val durableRunId=runId
    if(durableRunId!=null&&state !in setOf("awaiting_input","completed","interrupted")){
      var failures=0
      repeat(125){
        val recovered=runCatching{JSONObject(request(fresh,"/api/runs/${encode(durableRunId)}?after=$lastSequence","GET",null,"application/json"))}.getOrElse{error->if(error is CancellationException||++failures>=4)throw error;delay(1_000);return@repeat}
        failures=0;recovered.optJSONArray("events").objects().forEach{stored->stored.optJSONObject("payload")?.let(::applyEvent);lastSequence=maxOf(lastSequence,stored.optInt("sequence",lastSequence))}
        when(recovered.getJSONObject("run").getString("status")){"completed"->{state="completed";return@withContext AssistantReply(answer.toString(),threadId,durableRunId,state,prompt,receipts)};"awaiting_input"->{state="awaiting_input";return@withContext AssistantReply(answer.toString(),threadId,durableRunId,state,prompt,receipts)};"interrupted","failed"->{state="interrupted";return@withContext AssistantReply(answer.toString(),threadId,durableRunId,state,prompt,receipts)}}
        delay(1_000)
      }
      error("Life 运行仍在后台处理中，请稍后重试")
    }
    if(durableRunId==null)streamFailure?.let{throw it}
    AssistantReply(answer.toString(),threadId,runId,state,prompt,receipts)
  }

  suspend fun records(domain:LifeDomain,query:String="",cursor:String?=null):RecordPage {
    val apiDomain=when(domain){LifeDomain.Meals->"life";else->domain.name.lowercase()}
    if(domain==LifeDomain.Meals){
      if(query.isNotBlank())return search(query,cursor,setOf(LifeDomain.Meals))
      val result=wireJson.decodeFromString<ListMealsResultDto>(getText("/api/meals?limit=50${cursor?.let{"&cursor=${encode(it)}"}.orEmpty()}"))
      return RecordPage(result.items.map{item->
        val foods=item.items.map{food->MealFoodSummary(food.name,food.quantity,food.unit,food.energyKcal,food.proteinG,food.fatG,food.carbG,food.estimate)}
        val photo=item.sources.orEmpty().firstOrNull{source->source.assetVersionId!=null&&(source.role.wireValue=="meal_photo"||source.kind=="image"||source.kind.contains("meal_photo"))}?.assetVersionId
        RecordSummary(
          domain,"meal",item.id,foods.map{it.name}.filter(String::isNotBlank).joinToString("、").ifBlank{mealTypeLabel(item.mealType.wireValue)},item.occurredOn,
          item.payments.joinToString(" + "){"${it.currency} ${it.amount}"}.ifBlank{null},item.revision.toInt(),
          meal=MealCardSummary(item.mealType.wireValue,item.occurredOn,item.occurredAt,item.note,foods,photo)
        )
      },result.nextCursor,result.asOf)
    }
    val params=buildList{add("limit=50");if(query.isNotBlank())add("q=${encode(query)}");if(cursor!=null)add("cursor=${encode(cursor)}")}.joinToString("&")
    val result=wireJson.decodeFromString<DomainRecordsResultDto>(getText("/api/$apiDomain?$params"))
    return RecordPage(result.items.map{item->
      val trailing=item.amount?.let{value->listOfNotNull(item.currency,value).joinToString(" ")}
      RecordSummary(domain,item.kind,item.id,item.title,item.supporting,trailing,item.revision?.toInt(),item.recordId,item.entryType?.wireValue)
    },result.nextCursor,result.asOf)
  }

  suspend fun workspaceOverview(domain:LifeDomain):WorkspaceOverview=when(domain){
    LifeDomain.Meals->{
      val result=wireJson.decodeFromString<MealPlanningResultDto>(getText("/api/life/meal-planning?limit=20"))
      WorkspaceOverview.Meals(
        mealPlans=result.mealPlans.size,
        shoppingLists=result.shoppingLists.size,
        openShoppingItems=result.shoppingLists.sumOf{list->list.items.count{it.state.wireValue=="needed"}},
        asOf=result.asOf
      )
    }
    LifeDomain.Money->{
      val period=LocalDate.now().toString().take(7)
      val result=wireJson.decodeFromString<MoneyPlanningResultDto>(getText("/api/money/planning?period=$period"))
      WorkspaceOverview.Money(
        period=period,
        budgets=result.budgets.map{BudgetProgress(it.category?:"全部消费",it.amount,it.currency,it.spent)},
        recurringPlans=result.recurringPlans.size,
        openOccurrences=result.occurrences.count{it.state.wireValue in setOf("pending","reminded","snoozed")},
        spendingIntents=result.spendingIntents.count{it.state.wireValue=="planned"},
        recurring=result.recurringPlans.map{MoneyRecurringSummary(it.id,it.title,it.amount,it.currency,it.cadence.wireValue,it.nextDueOn,it.state.wireValue)},
        occurrences=result.occurrences.map{occurrence->val plan=result.recurringPlans.firstOrNull{it.id==occurrence.planId};MoneyOccurrenceSummary(occurrence.id,plan?.title?:"周期事项",occurrence.effectiveDueOn,occurrence.state.wireValue,plan?.amount,plan?.currency)},
        intents=result.spendingIntents.map{MoneyIntentSummary(it.id,it.title,it.expectedAmount,it.currency,it.intendedOn,it.state.wireValue)},
        asOf=result.asOf
      )
    }
    LifeDomain.Health->healthOverview()
    LifeDomain.Travel->{
      val result=wireJson.decodeFromString<TravelWorkspaceResultDto>(getText("/api/travel/workspace"))
      WorkspaceOverview.Travel(
        trips=result.trips.size,
        places=result.places.size,
        maps=result.maps.size,
        activeRun=result.activeRun!=null,
        tripItems=result.trips.map{trip->TravelTripSummary(trip.id,trip.title,trip.startsOn,trip.endsOn,trip.timeZone,trip.visibility?.wireValue,result.activeRun?.tripId==trip.id)},
        placeItems=result.places.map{place->TravelPlaceSummary(place.id,place.name,place.address,place.latitude?.toDoubleOrNull(),place.longitude?.toDoubleOrNull(),place.tags,place.favorite)},
        mapItems=result.maps.map{map->TravelMapSummary(map.id,map.title,map.description,map.state.wireValue,map.items.map{TravelMapItemSummary(it.placeId,it.status.wireValue,it.note)})},
        days=result.dayPlans.map{day->TravelDaySummary(day.id,day.tripId,day.planDate,day.items.map{TravelStopSummary(it.stopId,it.title,it.startsAt,it.placeId,it.note)})},
        tracks=result.tracks.map{track->TravelTrackSummary(track.id,track.tripId,track.name,track.points.map{TravelTrackPoint(it.latitude,it.longitude)})},
        segments=result.segments.map{segment->TravelSegmentSummary(segment.id,segment.tripId,segment.mode.wireValue,segment.origin,segment.destination,segment.startsAt,segment.distanceKm)},
        selectedTripId=result.selectedTripId,
        asOf=result.asOf
      )
    }
    LifeDomain.Library->{
      val result=wireJson.decodeFromString<DomainRecordsResultDto>(getText("/api/library?limit=30"))
      WorkspaceOverview.Library(result.items.size,result.asOf)
    }
  }

  suspend fun planning():PlanningWorkspace=coroutineScope{
    val today=LocalDate.now();val zone=ZoneId.systemDefault().id
    val agendaRequest=async{wireJson.decodeFromString<PlanningAgendaResultDto>(getText("/api/planning/agenda?from_on=$today&to_on_exclusive=${today.plusDays(7)}&time_zone=${encode(zone)}&limit=100"))}
    val projectsRequest=async{partialRequest{wireJson.decodeFromString<LifeProjectsResultDto>(getText("/api/life/projects?limit=50"))}};val itemsRequest=async{partialRequest{wireJson.decodeFromString<OwnedItemsResultDto>(getText("/api/life/owned-items?limit=50"))}};val reviewsRequest=async{partialRequest{wireJson.decodeFromString<LifeReviewsResultDto>(getText("/api/life/reviews?limit=20"))}}
    val agenda=agendaRequest.await();val projectsResult=projectsRequest.await();val itemsResult=itemsRequest.await();val reviewsResult=reviewsRequest.await();val projects=projectsResult.getOrNull();val items=itemsResult.getOrNull();val reviews=reviewsResult.getOrNull()
    PlanningWorkspace(
      agenda=agenda.items.map{item->AgendaItem(item.sourceKind.wireValue,item.sourceId,item.sourceKey,item.title,item.state.wireValue,item.dueOn,item.dueAt,item.target.kind.wireValue,item.target.id,item.target.projectId,item.primaryAction?.let{AgendaAction(it.capability.wireValue,it.targetId,it.expectedRevision.toInt())})},
      projects=projects?.items?.map(::projectSummary).orEmpty(),
      ownedItems=items?.items?.map(::ownedItemSummary).orEmpty(),
      reviews=reviews?.items?.map(::reviewSummary).orEmpty(),
      truncated=agenda.truncated,asOf=agenda.asOf,
      partialFailures=listOfNotNull(
        projectsResult.exceptionOrNull()?.let{"生活项目读取失败，可重试后恢复"},
        itemsResult.exceptionOrNull()?.let{"物品读取失败，可重试后恢复"},
        reviewsResult.exceptionOrNull()?.let{"生活回顾读取失败，可重试后恢复"}
      )
    )
  }

  suspend fun project(id:String):PlanSummary{
    val result=wireJson.decodeFromString<LifeProjectsResultDto>(getText("/api/life/projects?id=${encode(id)}&limit=1"))
    return result.items.singleOrNull()?.let(::projectSummary)?:error("项目不存在或当前无权查看")
  }

  suspend fun ownedItem(id:String):OwnedItemSummary{
    val result=wireJson.decodeFromString<OwnedItemsResultDto>(getText("/api/life/owned-items?id=${encode(id)}&limit=1"))
    return result.items.singleOrNull()?.let(::ownedItemSummary)?:error("物品不存在或当前无权查看")
  }

  suspend fun review(id:String):ReviewSummary{
    val result=wireJson.decodeFromString<LifeReviewsResultDto>(getText("/api/life/reviews?id=${encode(id)}&limit=1"))
    return result.items.singleOrNull()?.let(::reviewSummary)?:error("回顾不存在或当前无权查看")
  }

  private fun projectSummary(item:LifeProjectsResultDtoItemsEntry)=PlanSummary(
    id=item.id,title=item.title,goal=item.goal,state=item.state.wireValue,dueOn=item.endsOn,revision=item.revision.toInt(),actions=item.actions.size,
    startsOn=item.startsOn,updatedAt=item.updatedAt,
    milestones=item.milestones.sortedBy{it.position}.map{milestone->ProjectMilestone(milestone.id,milestone.title,milestone.dueOn,milestone.state.wireValue,milestone.position.toInt())},
    links=item.links.map{link->PlanningLink(link.refKind.wireValue,link.refId,link.refRevision.toInt(),link.role)},
    actionItems=item.actions.map{action->ProjectAction(action.id,action.title,action.dueOn,action.state.wireValue,action.revision.toInt(),action.sourceState)}
  )

  private fun ownedItemSummary(item:OwnedItemsResultDtoItemsEntry)=OwnedItemSummary(
    id=item.id,name=item.name,state=item.ownershipState.wireValue,location=item.location,warrantyEndsOn=item.warrantyEndsOn,returnBy=item.returnBy,
    revision=item.revision.toInt(),documents=item.documents.size,events=item.events.size,startedOn=item.startedOn,updatedAt=item.updatedAt,
    purchase=item.purchase?.let{purchase->OwnedItemPurchase(purchase.purchaseItemId,purchase.purchaseId,purchase.recordId,purchase.rawName,purchase.quantity,purchase.unit,purchase.lineAmount)},
    documentItems=item.documents.map{document->PlanningLink("library_item",document.libraryItemId,document.libraryRevision.toInt(),document.role.wireValue,document.title)},
    eventItems=item.events.map{event->OwnedItemEvent(event.id,event.eventKind.wireValue,event.occurredOn,event.note,event.revision.toInt(),event.costAmount?.let{amount->listOfNotNull(event.costCurrency,amount).joinToString(" ")},event.documentTitle)}
  )

  private fun reviewSummary(item:LifeReviewsResultDtoItemsEntry)=ReviewSummary(
    id=item.id,fromOn=item.fromOn,toOn=item.toOn,algorithmVersion=item.algorithmVersion,revision=item.revision.toInt(),generatedAt=item.generatedAt,
    metrics=item.metrics.size,limitations=item.limitations.size,timeZone=item.timeZone,domains=item.domains.map{it.wireValue},
    metricGroups=reviewGroups(item.metrics),coverageGroups=reviewGroups(item.coverage),
    evidence=item.evidence.map{evidence->ReviewEvidence(evidence.type,evidence.id,evidence.revision.toInt())},limitationItems=item.limitations
  )

  suspend fun projectLinks():List<ProjectLinkItem>{
    val result=wireJson.decodeFromString<ProjectDirectoryResultDto>(getText("/api/project-links"))
    return result.items.map{item->
      val target=item.target
      ProjectLinkItem(
        item.id,item.title,item.subtitle,item.icon.wireValue,item.state.wireValue,
        when(target){is ProjectDirectoryResultDtoItemsEntryTargetBrowser->"browser";is ProjectDirectoryResultDtoItemsEntryTargetAppLink->"app_link";null->null},
        when(target){is ProjectDirectoryResultDtoItemsEntryTargetBrowser->target.url;is ProjectDirectoryResultDtoItemsEntryTargetAppLink->target.url;null->null},
        when(target){is ProjectDirectoryResultDtoItemsEntryTargetBrowser->target.url;is ProjectDirectoryResultDtoItemsEntryTargetAppLink->target.webFallbackUrl;null->null},
        (target as? ProjectDirectoryResultDtoItemsEntryTargetAppLink)?.packageName,item.authHint.wireValue,item.order.toInt()
      )
    }.sortedBy(ProjectLinkItem::order)
  }

  suspend fun enqueueAgendaAction(item:AgendaItem,action:String):OperationReceipt=withContext(Dispatchers.IO){
    val primary=item.primaryAction?:error("这项安排暂不支持直接操作")
    val input=when(primary.capability){
      "life.save_action_item"->JSONObject()
        .put("action_item_id",primary.targetId)
        .put("expected_revision",primary.expectedRevision)
        .put("project_id",item.projectId?:item.targetId)
        .put("title",item.title)
        .put("due_on",item.dueOn)
        .put("state",when(action){"complete"->"completed";"cancel"->"cancelled";else->"open"})
        .apply{if(item.sourceKind=="health_habit")put("health_habit_id",item.sourceId)}
      "money.set_occurrence_state"->JSONObject()
        .put("occurrence_id",primary.targetId)
        .put("expected_revision",primary.expectedRevision)
        .put("state",when(action){"complete"->"handled";"dismiss"->"dismissed";"snooze"->"snoozed";else->error("不支持的周期操作")})
        .apply{if(action=="snooze")put("snoozed_until",java.time.Instant.now().plusSeconds(3_600).toString())}
      else->error("不支持的计划操作")
    }
    enqueueCommand(primary.capability,input)
  }

  suspend fun library(query:String="",cursor:String?=null):LibraryPage {
    val page=records(LifeDomain.Library,query,cursor)
    return LibraryPage(page.items.map{LibrarySummary(it.id,it.title,it.kind,it.supporting,it.revision)},page.nextCursor,page.asOf)
  }

  suspend fun detail(domain:LifeDomain,id:String):RecordDetail {
    val path=when(domain){LifeDomain.Meals->"/api/life/records/$id";LifeDomain.Health->"/api/health/records/$id";LifeDomain.Travel->"/api/travel/trips/$id";LifeDomain.Library->"/api/library/items/$id";LifeDomain.Money->"/api/life/records/$id?sections=money"}
    if(domain==LifeDomain.Library)return libraryDetail(wireJson.decodeFromString(getText(path)))
    if(domain==LifeDomain.Travel)return travelDetail(wireJson.decodeFromString(getText(path)))
    if(domain==LifeDomain.Meals||domain==LifeDomain.Money)return lifeRecordDetail(domain,wireJson.decodeFromString(getText(path)))
    return healthDetail(wireJson.decodeFromString(getText(path)))
  }

  suspend fun enqueue(draft:CaptureDraft):OperationReceipt=withContext(Dispatchers.IO){
    val input=when(draft.kind){
      CaptureKind.Expense->JSONObject().put("entry_type",if(draft.option=="income")"income" else "expense").put("amount",money(draft.primary)).put("currency","CNY").put("occurred_on",draft.date).put("time_zone",ZoneId.systemDefault().id).apply{draft.secondary.trim().takeIf(String::isNotBlank)?.let{put("counterparty",it)};draft.category.trim().takeIf(String::isNotBlank)?.let{put("category",it)};draft.paymentMethod.takeIf(String::isNotBlank)?.let{put("payment_method",it)};draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      CaptureKind.Purchase->JSONObject().put("occurred_on",draft.date).put("time_zone",ZoneId.systemDefault().id).put("scene",draft.option.ifBlank{"other"}).put("merchant_name_raw",draft.primary.trim()).put("items",JSONArray().put(JSONObject().put("raw_name",draft.primary.trim()).apply{draft.secondary.trim().takeIf(String::isNotBlank)?.let{put("line_amount",money(it))}})).apply{draft.category.trim().takeIf(String::isNotBlank)?.let{put("channel_name_raw",it)};draft.secondary.trim().takeIf(String::isNotBlank)?.let{put("payment",JSONObject().put("amount",money(it)).put("currency","CNY").put("occurred_on",draft.date).put("time_zone",ZoneId.systemDefault().id).apply{draft.paymentMethod.takeIf(String::isNotBlank)?.let{method->put("payment_method",method)}})};draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      CaptureKind.Refund->JSONObject().put("original_entry_id",draft.secondary.trim()).put("amount",money(draft.primary)).put("currency","CNY").put("occurred_on",draft.date).put("time_zone",ZoneId.systemDefault().id).apply{draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      CaptureKind.Meal->JSONObject().put("occurred_on",draft.date).put("time_zone",ZoneId.systemDefault().id).put("meal_type",draft.option.ifBlank{"other"}).put("items",mealItems(draft.mealItems,draft.primary)).apply{draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      CaptureKind.Health->JSONObject().put("metric",draft.option.ifBlank{"weight"}).put("value",decimal(draft.primary)).put("unit",draft.secondary.trim()).put("occurred_on",draft.date).put("time_zone",ZoneId.systemDefault().id).apply{draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      CaptureKind.Workout->JSONObject().put("session_type",draft.primary.trim()).put("occurred_on",draft.date).put("time_zone",ZoneId.systemDefault().id).apply{draft.secondary.trim().takeIf(String::isNotBlank)?.let{put("duration_minutes",it.toIntOrNull()?:error("训练时长必须是整数分钟"))};draft.note.trim().takeIf(String::isNotBlank)?.let{put("detail",JSONObject().put("note",it))}}
      CaptureKind.Visit->JSONObject().put("place_name",draft.primary.trim()).put("occurred_on",draft.date).put("time_zone",ZoneId.systemDefault().id).put("visibility","private").apply{draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      CaptureKind.Trip->JSONObject().put("title",draft.primary.trim()).put("starts_on",draft.date).put("ends_on",draft.secondary.trim()).put("time_zone",ZoneId.systemDefault().id).apply{draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      CaptureKind.OwnedItem->JSONObject().put("name",draft.primary.trim()).put("ownership_state",draft.option.ifBlank{"owned"}).put("started_on",draft.date).put("documents",JSONArray()).apply{draft.secondary.trim().takeIf(String::isNotBlank)?.let{put("location",it)};if(draft.contextKind=="purchase_item")draft.contextId?.let{put("purchase_item_id",it)}}
      CaptureKind.Project->JSONObject().put("title",draft.primary.trim()).put("goal",draft.secondary.trim()).put("starts_on",draft.date).put("state",draft.option.ifBlank{"active"}).put("milestones",JSONArray()).put("links",JSONArray())
      CaptureKind.Library->{val content=draft.secondary.ifBlank{draft.note}.trim();val title=draft.primary.trim().ifBlank{content.lineSequence().firstOrNull()?.trim().orEmpty()}.take(300).ifBlank{"未命名资料"};JSONObject().put("title",title).put("item_type",draft.option.ifBlank{"note"}).put(if(content.startsWith("https://")||content.startsWith("http://"))"url" else "text",content).put("tags",JSONArray())}
    }
    enqueueCommand(draft.kind.capability,input)
  }

  suspend fun enqueueCorrection(seed:EditSeed,draft:CorrectionDraft):OperationReceipt=withContext(Dispatchers.IO){
    val input=when(seed){
      is EditSeed.Meal->JSONObject().put("meal_id",seed.detailId).put("expected_revision",seed.revision).put("occurred_on",draft.date).put("time_zone",seed.timeZone).put("meal_type",draft.option).put("reason",correctionReason(draft.reason)).apply{draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      is EditSeed.Money->JSONObject().put("record_id",seed.detailId).put("expected_revision",seed.revision).put("amount",decimal(draft.primary)).put("currency",seed.currency).put("occurred_on",draft.date).put("time_zone",seed.timeZone).put("reason",correctionReason(draft.reason)).apply{draft.secondary.trim().takeIf(String::isNotBlank)?.let{put("category",it)};draft.option.trim().takeIf(String::isNotBlank)?.let{put("counterparty",it)};draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      is EditSeed.Health->JSONObject().put("measurement_id",seed.detailId).put("expected_revision",seed.revision).put("metric",seed.metric).put("value",decimal(draft.primary)).put("unit",draft.secondary.trim()).put("occurred_on",draft.date).put("time_zone",seed.timeZone).put("reason",correctionReason(draft.reason)).apply{draft.option.trim().takeIf(String::isNotBlank)?.let{put("label",it)};draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      is EditSeed.Trip->JSONObject().put("trip_id",seed.detailId).put("expected_revision",seed.revision).put("title",draft.primary.trim()).put("starts_on",draft.date).put("ends_on",draft.secondary.trim()).put("time_zone",seed.timeZone).put("reason",correctionReason(draft.reason)).apply{draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      is EditSeed.Library->JSONObject().put("item_id",seed.detailId).put("expected_revision",seed.revision).put("title",draft.primary.trim()).put("tags",JSONArray(seed.tags)).put("reason",correctionReason(draft.reason)).apply{val content=draft.secondary.trim();if(content.startsWith("http://")||content.startsWith("https://"))put("url",content) else put("text",content)}
    }
    val capability=when(seed){is EditSeed.Meal->"life.correct_meal";is EditSeed.Money->"money.correct_entry";is EditSeed.Health->"health.correct_measurement";is EditSeed.Trip->"travel.correct_trip";is EditSeed.Library->"library.revise"}
    enqueueCommand(capability,input)
  }

  suspend fun enqueueShare(payload:SharePayload):Int=withContext(Dispatchers.IO){
    val session=app.sessions.active()?:error("请先登录 Shadow Life");var accepted=0
    payload.text?.trim()?.takeIf(String::isNotBlank)?.let{text->val title=text.lineSequence().firstOrNull()?.take(120)?.ifBlank{"分享的文字"}?:"分享的文字";enqueueCommand("library.capture",JSONObject().put("title",title).put("item_type",if(text.startsWith("http://")||text.startsWith("https://"))"link" else "note").put(if(text.startsWith("http://")||text.startsWith("https://"))"url" else "text",text).put("tags",JSONArray()),"cmd_android_share_${payload.ingressId.take(48)}_text");accepted++}
    for((index,uriText) in payload.uris.withIndex()){val uri=Uri.parse(uriText);val mediaType=context.contentResolver.getType(uri)?:"application/octet-stream";val input=context.contentResolver.openInputStream(uri)?:error("无法读取分享附件");val attachmentId="attachment_${payload.ingressId.take(48)}_${index}";val commandId="cmd_android_share_${payload.ingressId.take(48)}_$index";val target=java.io.File(context.filesDir,"pending-attachments/$attachmentId.bin");input.use{app.queue.enqueueAttachment(session,attachmentId,commandId,mediaType,LocalDate.now().toString(),displayName(uri),it,target)};accepted++}
    if(accepted==0)error("分享内容为空");SyncScheduler.schedule(context,session.accountId);accepted
  }

  private fun displayName(uri:Uri):String=runCatching{context.contentResolver.query(uri,arrayOf(OpenableColumns.DISPLAY_NAME),null,null,null)?.use{cursor->if(cursor.moveToFirst())cursor.getString(0) else null}}.getOrNull()?.trim()?.take(300)?.takeIf(String::isNotBlank)?:""

  private fun mealItems(value:String):JSONArray{
    val result=JSONArray()
    value.lineSequence().map(String::trim).filter(String::isNotBlank).forEachIndexed{index,line->
      val parts=line.replace('｜','|').split('|').map(String::trim)
      if(parts.size !in setOf(1,3)||parts.first().isBlank())error("第 ${index+1} 行请填写名称，或使用 名称 | 份量 | 单位")
      val item=JSONObject().put("name",parts[0]).put("free_text",line).put("estimate",false)
      if(parts.size==3){val quantity=runCatching{java.math.BigDecimal(parts[1]).stripTrailingZeros()}.getOrNull()?.takeIf{it>java.math.BigDecimal.ZERO}?:error("第 ${index+1} 行份量必须是正数");if(parts[2].isBlank())error("第 ${index+1} 行缺少单位");item.put("quantity",quantity.toPlainString()).put("unit",parts[2])}
      result.put(item)
    }
    if(result.length()==0)error("请至少填写一种食物")
    return result
  }

  private fun mealItems(rows:List<MealDraftItem>,advanced:String):JSONArray{
    if(rows.isEmpty())return mealItems(advanced)
    val result=JSONArray()
    rows.forEachIndexed{index,row->
      val name=row.name.trim();if(name.isBlank())error("第 ${index+1} 种食物缺少名称")
      val quantity=row.quantity.trim();val unit=row.unit.trim()
      if(quantity.isBlank()!=unit.isBlank())error("第 ${index+1} 种食物的份量和单位需要同时填写")
      val item=JSONObject().put("name",name).put("free_text",name).put("estimate",false)
      if(quantity.isNotBlank()){val normalized=runCatching{java.math.BigDecimal(quantity).stripTrailingZeros()}.getOrNull()?.takeIf{it>java.math.BigDecimal.ZERO}?:error("第 ${index+1} 种食物份量必须是正数");item.put("quantity",normalized.toPlainString()).put("unit",unit)}
      result.put(item)
    }
    return result
  }

  private suspend fun getText(path:String):String=withContext(Dispatchers.IO){
    val session=app.sessions.active()?:error("请先登录 Shadow Life")
    when(val fresh=app.sessions.fresh(session.accountId,context)){
      SessionRefresh.ReauthRequired->error("会话已失效，请重新登录")
      SessionRefresh.Retryable->error("暂时无法刷新会话，请稍后重试")
      is SessionRefresh.Ready->{
        val connection=(URL(fresh.value.session.apiBase+path).openConnection() as HttpURLConnection).apply{requestMethod="GET";connectTimeout=10_000;readTimeout=20_000;setRequestProperty("Authorization","Bearer ${fresh.value.accessToken}");setRequestProperty("Accept","application/json")}
        try{val code=connection.responseCode;val text=(if(code in 200..299)connection.inputStream else connection.errorStream)?.bufferedReader()?.use{it.readText()}.orEmpty();if(code !in 200..299){val message=runCatching{JSONObject(text).optString("message")}.getOrNull().orEmpty();error(message.ifBlank{"请求失败（HTTP $code）"})};text}finally{connection.disconnect()}
      }
    }
  }

  suspend fun assetPreview(versionId:String):ByteArray=withContext(Dispatchers.IO){
    val session=app.sessions.active()?:error("请先登录 Shadow Life")
    val fresh=when(val value=app.sessions.fresh(session.accountId,context)){
      SessionRefresh.ReauthRequired->error("会话已失效，请重新登录")
      SessionRefresh.Retryable->error("暂时无法刷新会话，请稍后重试")
      is SessionRefresh.Ready->value.value
    }
    val connection=(URL("${fresh.session.apiBase}/api/assets/${encode(versionId)}/preview").openConnection() as HttpURLConnection).apply{
      requestMethod="GET";connectTimeout=10_000;readTimeout=20_000
      setRequestProperty("Authorization","Bearer ${fresh.accessToken}");setRequestProperty("Accept","image/*")
    }
    try{
      val code=connection.responseCode
      if(code !in 200..299){val message=connection.errorStream?.bufferedReader()?.use{it.readText()}.orEmpty();error(runCatching{JSONObject(message).optString("message")}.getOrNull().orEmpty().ifBlank{"餐照读取失败（HTTP $code）"})}
      val declared=connection.contentLengthLong
      if(declared>12L*1024*1024)error("餐照尺寸过大")
      connection.inputStream.use{input->input.readBytes().also{require(it.size<=12*1024*1024){"餐照尺寸过大"}}}
    }finally{connection.disconnect()}
  }

  private suspend fun healthOverview():WorkspaceOverview.Health=coroutineScope{
    val today=LocalDate.now();val from=today.minusDays(89)
    val sourcesRequest=async{wireJson.decodeFromString<HealthSourcesResultDto>(getText("/api/health/sources"))}
    val dailyRequest=async{partialRequest{wireJson.decodeFromString<HealthDailyResultDto>(getText("/api/health/daily/$today"))}}
    val metricKeys=listOf("weight" to "体重","body_fat" to "体脂","muscle_mass" to "肌肉量","body_water" to "身体水分","visceral_fat" to "内脏脂肪","bmr" to "基础代谢")
    val trendRequests=metricKeys.map{(key,label)->async{
      partialRequest{
        val value=JSONObject(getText("/api/health/trend?metric_key=${encode(key)}&from=$from&to=$today&limit=1000"))
        val points=value.optJSONArray("points").objects().mapNotNull{point->
          val text=point.optString("value").takeIf(String::isNotBlank)?:return@mapNotNull null
          val number=text.toDoubleOrNull()?:return@mapNotNull null
          HealthTrendPoint(point.optString("id"),point.optString("occurred_on"),number,text,point.optString("unit"),point.optString("source_kind"),point.optInt("revision",1))
        }
        val coverage=value.optJSONObject("coverage")
        HealthMetricTrend(key,label,points,coverage?.optInt("points",points.size)?:points.size,coverage?.optBoolean("truncated",false)?:false)
      }.getOrElse{HealthMetricTrend(key,label,emptyList(),0,false,unavailable=true)}
    }}
    val sources=sourcesRequest.await();val daily=dailyRequest.await().getOrNull();val metrics=trendRequests.map{it.await()}
    val weight=metrics.first().points.lastOrNull()
    val summary=TodayHealthSummary(
      state=when{daily!=null||weight!=null->HealthSummaryState.Ready;metrics.all{it.unavailable}->HealthSummaryState.Failed;else->HealthSummaryState.Empty},
      weight=weight?.valueText,weightUnit=weight?.unit,weightOn=weight?.occurredOn,
      steps=daily?.result?.activity?.steps,sleepMinutes=daily?.result?.sleep?.totalMinutes,
      updatedAt=daily?.updatedAt?:sources.asOf
    )
    val dailyOverview=daily?.let{value->HealthDailyOverview(
      value.occurredOn,value.result.activity?.steps,value.result.activity?.activeMinutes,value.result.activity?.caloriesKcal,
      value.result.sleep?.totalMinutes,value.result.sleep?.deepMinutes,value.result.sleep?.remMinutes,
      value.result.workouts.size,value.result.habits.sumOf{it.doneCount.toInt()},value.updatedAt
    )}
    WorkspaceOverview.Health(
      sources=sources.items.size,
      sourcesNeedingAttention=sources.items.count{it.permissionState!="granted"||it.cursors.any{cursor->cursor.state!="active"}},
      streams=sources.items.sumOf{it.cursors.size},summary=summary,metrics=metrics,daily=dailyOverview,asOf=sources.asOf
    )
  }

  private suspend fun healthSummary(date:LocalDate):TodayHealthSummary=coroutineScope{
    val dailyRequest=async{runCatching{wireJson.decodeFromString<HealthDailyResultDto>(getText("/api/health/daily/$date"))}}
    val trendRequest=async{runCatching{JSONObject(getText("/api/health/trend?metric_key=weight&limit=2"))}}
    val dailyResult=dailyRequest.await();val trendResult=trendRequest.await();val daily=dailyResult.getOrNull();val trend=trendResult.getOrNull()
    val points=trend?.optJSONArray("points");val latest=points?.takeIf{it.length()>0}?.optJSONObject(points.length()-1)
    val weight=latest?.optString("value")?.takeIf(String::isNotBlank)
    val hasDaily=daily!=null
    val dailyMissing=dailyResult.exceptionOrNull().toString().contains("not found",ignoreCase=true)
    val failed=(dailyResult.isFailure&&!dailyMissing)||(trendResult.isFailure&&!hasDaily)
    TodayHealthSummary(
      state=when{failed->HealthSummaryState.Failed;hasDaily||weight!=null->HealthSummaryState.Ready;else->HealthSummaryState.Empty},
      weight=weight,weightUnit=latest?.optString("unit")?.takeIf(String::isNotBlank),weightOn=latest?.optString("occurred_on")?.takeIf(String::isNotBlank),
      steps=daily?.result?.activity?.steps,sleepMinutes=daily?.result?.sleep?.totalMinutes,
      updatedAt=daily?.updatedAt?:trend?.optString("as_of")?.takeIf(String::isNotBlank)
    )
  }

  private fun reviewGroups(value:JsonObject):List<ReviewMetricGroup> = value.entries.sortedBy{it.key}.map{(key,item)->
    ReviewMetricGroup(reviewLabel(key),flattenReview(item).ifEmpty{listOf(ReviewMetric("状态","暂无可显示数值"))})
  }

  private fun flattenReview(value:JsonElement,path:List<String> = emptyList(),currency:String?=null):List<ReviewMetric> = when(value){
    is JsonObject->{
      val localCurrency=(value["currency"] as? JsonPrimitive)?.content?:currency
      value.entries.sortedBy{it.key}.flatMap{(key,item)->flattenReview(item,path+key,localCurrency)}
    }
    is JsonArray->value.flatMapIndexed{index,item->flattenReview(item,path+(index+1).toString(),currency)}
    JsonNull->listOf(ReviewMetric(path.joinToString(" · "){reviewLabel(it)},"未记录"))
    is JsonPrimitive->{
      val key=path.lastOrNull().orEmpty();val raw=value.content;val shown=if(currency!=null&&key in setOf("amount","gross_expense","refund","net_spending","income","net_cashflow","spent"))"$currency $raw" else raw
      listOf(ReviewMetric(path.joinToString(" · "){reviewLabel(it)},shown))
    }
  }

  private fun reviewLabel(key:String)=mapOf(
    "money" to "消费","meals" to "饮食","health" to "健康","items" to "物品","library" to "资料",
    "totals" to "金额汇总","currency" to "币种","gross_expense" to "支出","refund" to "退款","net_spending" to "净支出","income" to "收入","net_cashflow" to "净现金流","entries" to "记录数",
    "records" to "记录数","recorded_days" to "记录天数","day_coverage" to "天数覆盖率","measurements" to "测量数","workouts" to "训练数","active_days" to "活跃天数",
    "by_state" to "状态分布","idle_owned" to "闲置持有","captured" to "收存数","reading_activity" to "阅读活动",
    "source_records" to "源记录数","covered_days" to "覆盖天数","evidence_included" to "证据数","evidence_truncated" to "证据已截断"
  )[key]?:key.replace('_',' ')

  private fun request(fresh:FreshSession,path:String,method:String,body:String?,accept:String):String{
    val connection=(URL(fresh.session.apiBase+path).openConnection() as HttpURLConnection).apply{requestMethod=method;connectTimeout=10_000;readTimeout=30_000;setRequestProperty("Authorization","Bearer ${fresh.accessToken}");setRequestProperty("Accept",accept);if(body!=null){doOutput=true;setRequestProperty("Content-Type","application/json");outputStream.bufferedWriter().use{it.write(body)}}}
    try{val code=connection.responseCode;val text=(if(code in 200..299)connection.inputStream else connection.errorStream)?.bufferedReader()?.use{it.readText()}.orEmpty();if(code !in 200..299)error(runCatching{JSONObject(text).optString("message")}.getOrNull().orEmpty().ifBlank{"请求失败（HTTP $code）"});return text}finally{connection.disconnect()}
  }

  private fun libraryDetail(value:LibraryItemResultDto):RecordDetail{
    val item=value.item;val latest=value.revisions.firstOrNull()
    val sections=mutableListOf(
      DetailSection("概要",listOf(DetailFact("类型",item.itemType),DetailFact("状态",item.state.wireValue),DetailFact("收存时间",item.createdAt))),
      DetailSection("当前内容",listOfNotNull(latest?.text?.let{DetailFact("正文",it)},latest?.url?.let{DetailFact("链接",it)},latest?.tags?.takeIf{it.isNotEmpty()}?.let{DetailFact("标签",it.joinToString("、"))}))
    )
    if(value.sources.isNotEmpty())sections+=DetailSection("固定原件",value.sources.flatMap{entry->listOfNotNull(DetailFact("来源",entry.source.kind),entry.source.capturedOn?.let{DetailFact("收存日期",it)},entry.asset?.let{DetailFact("文件","${it.mediaType} · ${it.byteSize} 字节 · SHA-256 ${it.sha256.take(12)}…")})})
    value.readingState?.let{reading->sections+=DetailSection("阅读进度",listOf(DetailFact("状态",reading.state.wireValue),DetailFact("进度","${(reading.progress*100).toInt()}%"),DetailFact("最近阅读",reading.updatedAt)))}
    if(value.annotations.isNotEmpty())sections+=DetailSection("批注",value.annotations.take(20).flatMap{annotation->listOf(DetailFact("批注",annotation.note),DetailFact("时间",annotation.createdAt))},value.annotations.size)
    if(value.snippets.isNotEmpty())sections+=DetailSection("可检索内容",value.snippets.take(10).mapIndexed{index,snippet->DetailFact("片段 ${index+1}",snippet.text)},value.snippets.size)
    if(value.processingJobs.isNotEmpty())sections+=DetailSection("处理任务",value.processingJobs.take(20).flatMap{job->listOfNotNull(DetailFact(job.kind.wireValue,"${job.state.wireValue} · 尝试 ${job.attempts}"),job.lastError?.let{DetailFact("失败原因",it)})},value.processingJobs.size)
    if(value.derivations.isNotEmpty()||value.proofs.isNotEmpty()||value.legacyLinks.isNotEmpty())sections+=DetailSection("来源与完整性",listOf(DetailFact("派生产物","${value.derivations.size} 项"),DetailFact("内容证明","${value.proofs.size} 项"),DetailFact("旧链接","${value.legacyLinks.size} 项")))
    return RecordDetail(item.title,item.state.wireValue,item.currentRevision.toInt(),sections,latest?.let{EditSeed.Library(item.id,item.currentRevision.toInt(),item.title,it.text,it.url,it.tags)})
  }

  private fun travelDetail(value:TravelTripResultDto):RecordDetail{
    val trip=value.trip
    val sections=mutableListOf(
      DetailSection("概要",listOfNotNull(DetailFact("开始日期",trip.startsOn),DetailFact("结束日期",trip.endsOn),DetailFact("时区",trip.timeZone),trip.note?.let{DetailFact("备注",it)},DetailFact("创建时间",trip.createdAt)))
    )
    if(value.reservations.isNotEmpty())sections+=DetailSection("预订",value.reservations.take(30).flatMap{reservation->listOfNotNull(
      DetailFact(reservation.title,"${reservation.reservationType.wireValue} · ${reservation.state.wireValue}"),
      reservation.startsAt?.let{DetailFact("开始",it)},reservation.endsAt?.let{DetailFact("结束",it)},
      listOfNotNull(reservation.origin,reservation.destination).takeIf{it.isNotEmpty()}?.let{DetailFact("路线",it.joinToString(" → "))},
      reservation.serviceNumber?.let{DetailFact("班次",it)},reservation.seat?.let{DetailFact("座位",it)}
    )},value.reservations.size)
    if(value.segments.isNotEmpty())sections+=DetailSection("行程段",value.segments.take(30).flatMap{segment->listOfNotNull(
      DetailFact("${segment.origin} → ${segment.destination}",segment.mode.wireValue),segment.startsAt?.let{DetailFact("出发",it)},segment.endsAt?.let{DetailFact("到达",it)},segment.distanceKm?.let{DetailFact("距离","$it km")},segment.note?.let{DetailFact("备注",it)}
    )},value.segments.size)
    if(value.visits.isNotEmpty())sections+=DetailSection("到访",value.visits.take(30).flatMap{visit->listOfNotNull(
      DetailFact(visit.placeName,visit.occurredAt?:visit.occurredOn),visit.latitude?.let{latitude->visit.longitude?.let{longitude->DetailFact("坐标","$latitude, $longitude")}},visit.note?.let{DetailFact("备注",it)}
    )},value.visits.size)
    if(value.dayPlans.isNotEmpty())sections+=DetailSection("日程",value.dayPlans.take(30).flatMap{plan->listOf(DetailFact(plan.planDate,"${plan.items.size} 个停靠点"))+plan.items.take(20).map{item->DetailFact(item.startsAt?:"停靠",item.title)}},value.dayPlans.size)
    if(value.planVersions.isNotEmpty())sections+=DetailSection("已发布计划",value.planVersions.take(20).map{version->DetailFact("版本 ${version.version}",listOfNotNull(version.label,"${version.snapshot.stopCount} 个停靠点",version.createdAt).joinToString(" · "))},value.planVersions.size)
    if(value.myRuns.isNotEmpty())sections+=DetailSection("我的执行",value.myRuns.take(20).flatMap{run->listOf(DetailFact(run.state.wireValue,"${run.outcomes.size} 个结果 · ${run.startedAt}"))+run.outcomes.take(30).map{outcome->DetailFact(outcome.state.wireValue,outcome.note?:outcome.occurredAt?:outcome.stopId)}},value.myRuns.size)
    if(value.members.isNotEmpty())sections+=DetailSection("成员",value.members.take(30).map{member->DetailFact(member.role.wireValue,member.visibility.wireValue)},value.members.size)
    if(value.revisions.isNotEmpty())sections+=DetailSection("更正历史",value.revisions.take(20).map{revision->DetailFact("版本 ${revision.revision}","${revision.reason} · ${revision.createdAt}")},value.revisions.size)
    return RecordDetail(
      trip.title,value.myRuns.firstOrNull()?.state?.wireValue,trip.revision.toInt(),sections,
      EditSeed.Trip(trip.id,trip.revision.toInt(),trip.title,trip.startsOn,trip.endsOn,trip.timeZone,trip.note)
    )
  }

  private fun lifeRecordDetail(domain:LifeDomain,value:LifeRecordResultDto):RecordDetail=when(value){
    is LifeRecordResultDtoMeal->{
      val items=value.items.orEmpty();val payments=value.payments.orEmpty();val sources=value.sources.orEmpty()
      val title=items.map{it.name}.filter(String::isNotBlank).joinToString("、").ifBlank{mealTypeLabel(value.mealType?.wireValue?:"other")}
      val sections=mutableListOf(
        DetailSection("概要",listOfNotNull(value.mealType?.let{DetailFact("餐次",mealTypeLabel(it.wireValue))},value.occurredOn?.let{DetailFact("日期",it)},value.timeZone?.let{DetailFact("时区",it)},value.note?.let{DetailFact("备注",it)}))
      )
      if(items.isNotEmpty())sections+=DetailSection("食物",items.take(50).flatMap{item->listOfNotNull(DetailFact(item.name,listOfNotNull(item.quantity?.let{amount->listOfNotNull(amount,item.unit).joinToString(" ")},item.energyKcal?.let{"$it kcal"}).joinToString(" · ").ifBlank{"已记录"}),item.evidenceNote?.let{DetailFact("依据",it)})},items.size)
      if(payments.isNotEmpty())sections+=DetailSection("关联付款",itemCount=payments.size,links=payments.take(20).map{payment->DetailLink("money_entry",payment.recordId,payment.counterparty?:payment.category?:"交易","${payment.currency} ${payment.amount}")})
      if(sources.isNotEmpty())sections+=DetailSection("来源",sources.take(20).map{source->DetailFact(source.kind,source.capturedAt?:source.capturedOn?:source.externalId?:"已收存")},sources.size)
      val revision=value.revision;val occurredOn=value.occurredOn;val timeZone=value.timeZone;val mealType=value.mealType
      val seed=if(revision!=null&&occurredOn!=null&&timeZone!=null&&mealType!=null)EditSeed.Meal(value.mealId,revision.toInt(),occurredOn,timeZone,mealType.wireValue,value.note) else null
      RecordDetail(title,null,value.revision?.toInt(),sections,seed)
    }
    is LifeRecordResultDtoRecord->{
      val entry=value.moneyEntry;val purchase=value.purchase;val meals=value.meals.orEmpty();val items=value.purchaseItems.orEmpty();val sources=value.sources.orEmpty()
      val title=when(domain){LifeDomain.Money->entry?.counterparty?:entry?.category?:"收支详情";else->purchase?.merchant?:meals.firstOrNull()?.items?.joinToString("、"){it.name}?.takeIf(String::isNotBlank)?:"消费详情"}
      val sections=mutableListOf(DetailSection("概要",listOfNotNull(DetailFact("状态",value.state.wireValue),DetailFact("日期",value.occurredOn),DetailFact("时区",value.timeZone),value.note?.let{DetailFact("备注",it)})))
      entry?.let{sections+=DetailSection("金额",listOfNotNull(DetailFact("金额","${it.currency} ${it.amount}"),DetailFact("类型",it.entryType.wireValue),it.counterparty?.let{item->DetailFact("交易方",item)},it.category?.let{item->DetailFact("分类",item)},it.paymentMethod?.let{item->DetailFact("支付方式",item.wireValue)}))}
      purchase?.let{sections+=DetailSection("消费",listOfNotNull(it.merchant?.let{item->DetailFact("商家",item)},it.amount?.let{amount->DetailFact("金额","${it.currency} $amount")},it.scene?.let{item->DetailFact("场景",item)},it.channelNameRaw?.let{item->DetailFact("渠道",item)},it.rating?.let{item->DetailFact("评分","$item/5")}))}
      if(items.isNotEmpty())sections+=DetailSection("购买明细",items.take(50).map{item->DetailFact(item.rawName,listOfNotNull(item.quantity?.let{amount->listOfNotNull(amount,item.unit).joinToString(" ")},item.lineAmount?.let{"金额 $it"}).joinToString(" · ").ifBlank{"已记录"})},items.size)
      if(meals.isNotEmpty())sections+=DetailSection("关联餐次",itemCount=meals.size,links=meals.take(20).map{meal->DetailLink("meal",meal.id,mealTypeLabel(meal.mealType.wireValue),"${meal.occurredOn} · ${meal.items.joinToString("、"){it.name}}")})
      if(sources.isNotEmpty())sections+=DetailSection("来源",sources.take(20).map{source->DetailFact(source.kind,source.capturedAt?:source.capturedOn?:source.externalId?:"已收存")},sources.size)
      val seed=entry?.let{EditSeed.Money(value.recordId,value.revision.toInt(),it.amount,it.currency,it.occurredOn,it.timeZone,it.category,it.counterparty,it.note?:value.note)}
      val actions=buildList{
        if(entry?.entryType?.wireValue=="expense"&&entry.currency=="CNY")add(DetailAction("记录这笔交易的退款",CaptureSeed(CaptureKind.Refund,date=LocalDate.now().toString(),secondary=entry.id,contextKind="money_entry",contextId=entry.id,contextLabel=listOfNotNull(entry.counterparty,entry.category,"CNY ${entry.amount}").joinToString(" · "))))
        items.take(10).forEach{item->add(DetailAction("将“${item.rawName}”加入我的物品",CaptureSeed(CaptureKind.OwnedItem,primary=item.rawName,date=value.occurredOn,option="owned",contextKind="purchase_item",contextId=item.id,contextLabel="来自本次购买")))}
      }
      RecordDetail(title,value.state.wireValue,value.revision.toInt(),sections,seed,actions)
    }
  }

  private fun healthDetail(value:HealthRecordResultDto):RecordDetail{
    fun build(title:String,revision:Long,overview:List<DetailFact>,sourceKind:String?,sourceAt:String?,rawType:String?,rawState:String?,seed:EditSeed?=null):RecordDetail{
      val sections=mutableListOf(DetailSection("概要",overview))
      if(sourceKind!=null)sections+=DetailSection("来源",listOfNotNull(DetailFact("类型",sourceKind),sourceAt?.let{DetailFact("采集时间",it)}))
      if(rawType!=null)sections+=DetailSection("原始记录",listOfNotNull(DetailFact("类型",rawType),rawState?.let{DetailFact("状态",it)}))
      return RecordDetail(title,null,revision.toInt(),sections,seed)
    }
    return when(value){
      is HealthRecordResultDtoMeasurement->{val fact=value.fact;build(fact.label?:kindLabel(fact.metric.wireValue),fact.revision,listOfNotNull(DetailFact("指标",fact.metric.wireValue),DetailFact("数值","${fact.value} ${fact.unit}"),DetailFact("日期",fact.occurredOn),DetailFact("时区",fact.timeZone),fact.note?.let{DetailFact("备注",it)}),value.source?.kind,value.source?.capturedAt?:value.source?.capturedOn,value.raw?.recordType?.wireValue,value.raw?.state?.wireValue,if(value.raw==null)EditSeed.Health(fact.id,fact.revision.toInt(),fact.metric.wireValue,fact.value,fact.unit,fact.occurredOn,fact.timeZone,fact.label,fact.note) else null)}
      is HealthRecordResultDtoObservation->{val fact=value.fact;build(kindLabel(fact.metricKey.wireValue),fact.revision,listOfNotNull(DetailFact("指标",fact.metricKey.wireValue),DetailFact("数值","${fact.value} ${fact.unit}"),DetailFact("日期",fact.occurredOn),DetailFact("分组",fact.groupKind.wireValue),fact.originalField?.let{DetailFact("原字段",it)}),value.source?.kind,value.source?.capturedAt?:value.source?.capturedOn,value.raw?.recordType?.wireValue,value.raw?.state?.wireValue)}
      is HealthRecordResultDtoDailyWellbeing->{val fact=value.fact;build("每日感受",fact.revision,listOfNotNull(DetailFact("日期",fact.occurredOn),fact.moodScore?.let{DetailFact("心情","$it/10")},fact.energyLevel?.let{DetailFact("精力","$it/10")},fact.sleepQuality?.let{DetailFact("睡眠质量","$it/10")},fact.morningErection?.let{DetailFact("晨间状态",if(it)"是" else "否")},fact.notes?.let{DetailFact("备注",it)}),value.source?.kind,value.source?.capturedAt?:value.source?.capturedOn,value.raw?.recordType?.wireValue,value.raw?.state?.wireValue)}
      is HealthRecordResultDtoSleepSession->{val fact=value.fact;build("睡眠",fact.revision,listOfNotNull(DetailFact("醒来日期",fact.wakeDate),DetailFact("总时长","${fact.totalMinutes} 分钟"),fact.deepMinutes?.let{DetailFact("深睡","$it 分钟")},fact.lightMinutes?.let{DetailFact("浅睡","$it 分钟")},fact.remMinutes?.let{DetailFact("REM","$it 分钟")},fact.awakeMinutes?.let{DetailFact("清醒","$it 分钟")},fact.startedAt?.let{DetailFact("开始",it)},fact.endedAt?.let{DetailFact("结束",it)}),value.source?.kind,value.source?.capturedAt?:value.source?.capturedOn,value.raw?.recordType?.wireValue,value.raw?.state?.wireValue)}
      is HealthRecordResultDtoWorkoutSession->{val fact=value.fact;build(fact.sessionType,fact.revision,listOfNotNull(DetailFact("日期",fact.occurredOn),fact.startedAt?.let{DetailFact("开始",it)},fact.durationMinutes?.let{DetailFact("时长","$it 分钟")},fact.distanceKm?.let{DetailFact("距离","$it km")},fact.caloriesKcal?.let{DetailFact("热量","$it kcal")},fact.rpe?.let{DetailFact("RPE","$it/10")},fact.heartRateAvg?.let{DetailFact("平均心率","$it bpm")}),value.source?.kind,value.source?.capturedAt?:value.source?.capturedOn,value.raw?.recordType?.wireValue,value.raw?.state?.wireValue)}
      is HealthRecordResultDtoDailyActivity->{val fact=value.fact;build("每日活动",fact.revision,listOfNotNull(DetailFact("日期",fact.occurredOn),fact.steps?.let{DetailFact("步数","$it")},fact.activeMinutes?.let{DetailFact("活跃时长","$it 分钟")},fact.effectiveCaloriesKcal?.let{DetailFact("活动热量","$it kcal")},fact.stepsOrigin?.let{DetailFact("步数来源",it)},fact.stepsStartedAt?.let{DetailFact("区间开始",it)},fact.stepsEndedAt?.let{DetailFact("区间结束",it)}),value.source?.kind,value.source?.capturedAt?:value.source?.capturedOn,value.raw?.recordType?.wireValue,value.raw?.state?.wireValue)}
      is HealthRecordResultDtoHabitLog->{val fact=value.fact;build(kindLabel(fact.habitKey),fact.revision,listOfNotNull(DetailFact("日期",fact.occurredOn),DetailFact("完成次数","${fact.doneCount}"),DetailFact("明确未完成",if(fact.explicitDenial)"是" else "否"),fact.note?.let{DetailFact("备注",it)}),value.source?.kind,value.source?.capturedAt?:value.source?.capturedOn,value.raw?.recordType?.wireValue,value.raw?.state?.wireValue)}
    }
  }

  private suspend fun enqueueCommand(capability:String,input:JSONObject,stableCommandId:String?=null):OperationReceipt{
    val session=app.sessions.active()?:error("请先登录 Shadow Life");val commandId=stableCommandId?:"cmd_android_${UUID.randomUUID().toString().replace("-","")}";val body=JSONObject().put("protocol","shadow.command").put("capability",capability).put("command_id",commandId).put("input",input).toString();app.queue.enqueueCommand(session,commandId,capability,body);SyncScheduler.schedule(context,session.accountId);return OperationReceipt(capability,commandId,queued=true)
  }

  private suspend fun <T> partialRequest(block:suspend()->T):Result<T> = try{Result.success(block())}catch(error:CancellationException){throw error}catch(error:Exception){Result.failure(error)}
}

private fun JSONArray?.objects():List<JSONObject>{if(this==null)return emptyList();return (0 until length()).mapNotNull{optJSONObject(it)}}
private fun JSONObject.optNullableString(key:String):String?=if(!has(key)||isNull(key))null else optString(key).takeIf(String::isNotBlank)
private fun encode(value:String)=java.net.URLEncoder.encode(value,Charsets.UTF_8.name())
private fun decimal(value:String):String { val normalized=value.trim().removePrefix("+");require(Regex("^(?:0|[1-9]\\d*)(?:\\.\\d{1,6})?$").matches(normalized)){"请输入有效数值，最多 6 位小数"};return normalized }
private fun money(value:String):String { val normalized=value.trim();require(Regex("^(?:0|[1-9]\\d*)(?:\\.\\d{1,2})?$").matches(normalized)){"请输入有效金额，最多 2 位小数"};return normalized.toBigDecimal().setScale(2).toPlainString().also{require(it!="0.00"){"金额必须大于 0"}} }
private fun correctionReason(value:String)=value.trim().ifBlank{"用户在详情中更正"}
private fun mealTypeLabel(value:String)=mapOf("breakfast" to "早餐","lunch" to "午餐","dinner" to "晚餐","snack" to "加餐","other" to "一餐")[value]?:"一餐"
private fun domainFromWire(value:String)=LifeDomain.entries.first{it.name.equals(value,true)}
internal fun kindLabel(value:String)=mapOf("money_entry" to "收支记录","health_measurement" to "健康记录","trip" to "旅程","visit" to "到访","library_item" to "资料","meal" to "餐次","purchase" to "购买")[value]?:value.replace('_',' ')
