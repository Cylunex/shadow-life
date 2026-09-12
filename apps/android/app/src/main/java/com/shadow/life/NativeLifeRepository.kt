package com.shadow.life

import android.content.Context
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.json.Json
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
  private val wireJson=Json { ignoreUnknownKeys=false }
  fun queueStatus(session:ProductSession)=app.queue.observeStatus(session)
  suspend fun retryQueue(session:ProductSession):Int=app.queue.retry(session).also{SyncScheduler.schedule(context,session.accountId,true)}
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
    return TodaySnapshot(
      date=result.date,mealCount=domains.meals?.count?.toInt(),healthFacts=domains.health?.facts?.toInt(),
      moneyTotals=domains.money?.totals?.map{MoneyTotal(it.currency,it.netSpending,it.income)}.orEmpty(),
      dueItems=domains.money?.dueItems?.map{DueItem(it.id,it.title,it.dueOn,it.amount,it.currency)}.orEmpty(),
      currentTrips=domains.travel?.currentTrips?.map{CurrentTrip(it.id,it.title,it.startsOn,it.endsOn)}.orEmpty(),
      libraryCaptured=domains.library?.captured?.toInt(),syncIssueCount=domains.health?.syncIssues?.size?:0,asOf=result.asOf
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
    val result=wireJson.decodeFromString<LifeSearchResultDto>(getText("/api/search?q=${encode(query)}&limit=50${cursor?.let{"&cursor=${encode(it)}"}.orEmpty()}"))
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
      val json=get("/api/meals?limit=50")
      return RecordPage(json.getJSONArray("items").objects().map{item->
        val names=item.optJSONArray("items").objects().map{it.optString("name")}.filter(String::isNotBlank)
        RecordSummary(domain,"meal",item.getString("id"),names.joinToString("、").ifBlank{mealTypeLabel(item.optString("meal_type"))},item.optString("occurred_on"),item.optJSONArray("payments").objects().joinToString(" + "){"${it.optString("currency")} ${it.optString("amount")}"}.ifBlank{null},item.optInt("revision").takeIf{it>0})
      },null,java.time.Instant.now().toString())
    }
    val params=buildList{add("limit=50");if(query.isNotBlank())add("q=${encode(query)}");if(cursor!=null)add("cursor=${encode(cursor)}")}.joinToString("&")
    val result=wireJson.decodeFromString<DomainRecordsResultDto>(getText("/api/$apiDomain?$params"))
    return RecordPage(result.items.map{item->
      val trailing=item.amount?.let{value->listOfNotNull(item.currency,value).joinToString(" ")}
      RecordSummary(domain,item.kind,item.id,item.title,item.supporting,trailing,item.revision?.toInt(),item.recordId)
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
        asOf=result.asOf
      )
    }
    LifeDomain.Health->{
      val result=wireJson.decodeFromString<HealthSourcesResultDto>(getText("/api/health/sources"))
      val items=result.items
      WorkspaceOverview.Health(
        sources=items.size,
        sourcesNeedingAttention=items.count{it.permissionState!="granted"||it.cursors.any{cursor->cursor.state!="active"}},
        streams=items.sumOf{it.cursors.size},
        asOf=result.asOf
      )
    }
    LifeDomain.Travel->{
      val json=get("/api/travel/workspace")
      WorkspaceOverview.Travel(
        trips=json.optJSONArray("trips")?.length()?:0,
        places=json.optJSONArray("places")?.length()?:0,
        maps=json.optJSONArray("maps")?.length()?:0,
        activeRun=json.has("active_run")&&!json.isNull("active_run"),
        asOf=json.optString("as_of")
      )
    }
    LifeDomain.Library->{
      val json=get("/api/library?limit=30")
      WorkspaceOverview.Library(json.optJSONArray("items")?.length()?:0,json.optString("as_of"))
    }
  }

  suspend fun planning():PlanningWorkspace=coroutineScope{
    val today=LocalDate.now();val zone=ZoneId.systemDefault().id
    val agendaRequest=async{wireJson.decodeFromString<PlanningAgendaResultDto>(getText("/api/planning/agenda?from_on=$today&to_on_exclusive=${today.plusDays(7)}&time_zone=${encode(zone)}&limit=100"))}
    val projectsRequest=async{runCatching{wireJson.decodeFromString<LifeProjectsResultDto>(getText("/api/life/projects?limit=50"))}.getOrNull()};val itemsRequest=async{runCatching{wireJson.decodeFromString<OwnedItemsResultDto>(getText("/api/life/owned-items?limit=50"))}.getOrNull()};val reviewsRequest=async{runCatching{wireJson.decodeFromString<LifeReviewsResultDto>(getText("/api/life/reviews?limit=20"))}.getOrNull()}
    val agenda=agendaRequest.await();val projects=projectsRequest.await();val items=itemsRequest.await();val reviews=reviewsRequest.await()
    PlanningWorkspace(
      agenda=agenda.items.map{item->AgendaItem(item.sourceKind.wireValue,item.sourceId,item.sourceKey,item.title,item.state.wireValue,item.dueOn,item.dueAt,item.target.kind.wireValue,item.target.id,item.target.projectId,item.primaryAction?.let{AgendaAction(it.capability.wireValue,it.targetId,it.expectedRevision.toInt())})},
      projects=projects?.items?.map{item->PlanSummary(item.id,item.title,item.goal,item.state.wireValue,item.endsOn,item.revision.toInt(),item.actions.size)}.orEmpty(),
      ownedItems=items?.items?.map{item->OwnedItemSummary(item.id,item.name,item.ownershipState.wireValue,item.location,item.warrantyEndsOn,item.returnBy,item.revision.toInt(),item.documents.size,item.events.size)}.orEmpty(),
      reviews=reviews?.items?.map{item->ReviewSummary(item.id,item.fromOn,item.toOn,item.algorithmVersion,item.revision.toInt(),item.generatedAt,item.metrics.size,item.limitations.size)}.orEmpty(),
      truncated=agenda.truncated,asOf=agenda.asOf
    )
  }

  suspend fun projectLinks():List<ProjectLinkItem>{
    val json=get("/api/project-links")
    return json.getJSONArray("items").objects().map{item->val target=item.optJSONObject("target");ProjectLinkItem(item.getString("id"),item.getString("title"),item.getString("subtitle"),item.getString("icon"),item.getString("state"),target?.optNullableString("kind"),target?.optNullableString("url"),target?.optNullableString("web_fallback_url")?:target?.optNullableString("url"),target?.optNullableString("package_name"),item.getString("auth_hint"),item.getInt("order"))}.sortedBy(ProjectLinkItem::order)
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

  suspend fun library(query:String=""):List<LibrarySummary> = records(LifeDomain.Library,query).items.map{LibrarySummary(it.id,it.title,it.kind,it.supporting,it.revision)}

  suspend fun detail(domain:LifeDomain,id:String):RecordDetail {
    val path=when(domain){LifeDomain.Meals->"/api/life/records/$id";LifeDomain.Health->"/api/health/records/$id";LifeDomain.Travel->"/api/travel/trips/$id";LifeDomain.Library->"/api/library/items/$id";LifeDomain.Money->"/api/life/records/$id?sections=money"}
    return detailFrom(domain,get(path))
  }

  suspend fun enqueue(draft:CaptureDraft):OperationReceipt=withContext(Dispatchers.IO){
    val input=when(draft.kind){
      CaptureKind.Expense->JSONObject().put("entry_type",if(draft.option=="income")"income" else "expense").put("amount",money(draft.primary)).put("currency","CNY").put("occurred_on",draft.date).put("time_zone",ZoneId.systemDefault().id).apply{draft.secondary.trim().takeIf(String::isNotBlank)?.let{put("counterparty",it)};draft.category.trim().takeIf(String::isNotBlank)?.let{put("category",it)};draft.paymentMethod.takeIf(String::isNotBlank)?.let{put("payment_method",it)};draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      CaptureKind.Purchase->JSONObject().put("occurred_on",draft.date).put("time_zone",ZoneId.systemDefault().id).put("scene",draft.option.ifBlank{"other"}).put("merchant_name_raw",draft.primary.trim()).put("items",JSONArray().put(JSONObject().put("raw_name",draft.primary.trim()).apply{draft.secondary.trim().takeIf(String::isNotBlank)?.let{put("line_amount",money(it))}})).apply{draft.category.trim().takeIf(String::isNotBlank)?.let{put("channel_name_raw",it)};draft.secondary.trim().takeIf(String::isNotBlank)?.let{put("payment",JSONObject().put("amount",money(it)).put("currency","CNY").put("occurred_on",draft.date).put("time_zone",ZoneId.systemDefault().id).apply{draft.paymentMethod.takeIf(String::isNotBlank)?.let{method->put("payment_method",method)}})};draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      CaptureKind.Refund->JSONObject().put("original_entry_id",draft.secondary.trim()).put("amount",money(draft.primary)).put("currency","CNY").put("occurred_on",draft.date).put("time_zone",ZoneId.systemDefault().id).apply{draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      CaptureKind.Meal->JSONObject().put("occurred_on",draft.date).put("time_zone",ZoneId.systemDefault().id).put("meal_type",draft.option.ifBlank{"other"}).put("items",JSONArray().put(JSONObject().put("name",draft.primary.trim()).put("free_text",draft.primary.trim()).put("estimate",false))).apply{draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      CaptureKind.Health->JSONObject().put("metric",draft.option.ifBlank{"weight"}).put("value",decimal(draft.primary)).put("unit",draft.secondary.trim()).put("occurred_on",draft.date).put("time_zone",ZoneId.systemDefault().id).apply{draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      CaptureKind.Workout->JSONObject().put("session_type",draft.primary.trim()).put("occurred_on",draft.date).put("time_zone",ZoneId.systemDefault().id).apply{draft.secondary.trim().takeIf(String::isNotBlank)?.let{put("duration_minutes",it.toIntOrNull()?:error("训练时长必须是整数分钟"))};draft.note.trim().takeIf(String::isNotBlank)?.let{put("detail",JSONObject().put("note",it))}}
      CaptureKind.Visit->JSONObject().put("place_name",draft.primary.trim()).put("occurred_on",draft.date).put("time_zone",ZoneId.systemDefault().id).put("visibility","private").apply{draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      CaptureKind.Trip->JSONObject().put("title",draft.primary.trim()).put("starts_on",draft.date).put("ends_on",draft.secondary.trim()).put("time_zone",ZoneId.systemDefault().id).apply{draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      CaptureKind.OwnedItem->JSONObject().put("name",draft.primary.trim()).put("ownership_state",draft.option.ifBlank{"owned"}).put("started_on",draft.date).put("documents",JSONArray()).apply{draft.secondary.trim().takeIf(String::isNotBlank)?.let{put("location",it)}}
      CaptureKind.Project->JSONObject().put("title",draft.primary.trim()).put("goal",draft.secondary.trim()).put("starts_on",draft.date).put("state",draft.option.ifBlank{"active"}).put("milestones",JSONArray()).put("links",JSONArray())
      CaptureKind.Library->{val content=draft.secondary.ifBlank{draft.note}.trim();val title=draft.primary.trim().ifBlank{content.lineSequence().firstOrNull()?.trim().orEmpty()}.take(300).ifBlank{"未命名资料"};JSONObject().put("title",title).put("item_type",draft.option.ifBlank{"note"}).put(if(content.startsWith("https://")||content.startsWith("http://"))"url" else "text",content).put("tags",JSONArray())}
    }
    enqueueCommand(draft.kind.capability,input)
  }

  suspend fun enqueueCorrection(seed:EditSeed,draft:CorrectionDraft):OperationReceipt=withContext(Dispatchers.IO){
    val input=when(seed){
      is EditSeed.Meal->JSONObject().put("meal_id",seed.detailId).put("expected_revision",seed.revision).put("occurred_on",draft.date).put("time_zone",seed.timeZone).put("meal_type",draft.option).put("reason",draft.reason.trim()).apply{draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      is EditSeed.Money->JSONObject().put("record_id",seed.detailId).put("expected_revision",seed.revision).put("amount",decimal(draft.primary)).put("currency",seed.currency).put("occurred_on",draft.date).put("time_zone",seed.timeZone).put("reason",draft.reason.trim()).apply{draft.secondary.trim().takeIf(String::isNotBlank)?.let{put("category",it)};draft.option.trim().takeIf(String::isNotBlank)?.let{put("counterparty",it)};draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      is EditSeed.Health->JSONObject().put("measurement_id",seed.detailId).put("expected_revision",seed.revision).put("metric",seed.metric).put("value",decimal(draft.primary)).put("unit",draft.secondary.trim()).put("occurred_on",draft.date).put("time_zone",seed.timeZone).put("reason",draft.reason.trim()).apply{draft.option.trim().takeIf(String::isNotBlank)?.let{put("label",it)};draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      is EditSeed.Trip->JSONObject().put("trip_id",seed.detailId).put("expected_revision",seed.revision).put("title",draft.primary.trim()).put("starts_on",draft.date).put("ends_on",draft.secondary.trim()).put("time_zone",seed.timeZone).put("reason",draft.reason.trim()).apply{draft.note.trim().takeIf(String::isNotBlank)?.let{put("note",it)}}
      is EditSeed.Library->JSONObject().put("item_id",seed.detailId).put("expected_revision",seed.revision).put("title",draft.primary.trim()).put("tags",JSONArray(seed.tags)).put("reason",draft.reason.trim()).apply{val content=draft.secondary.trim();if(content.startsWith("http://")||content.startsWith("https://"))put("url",content) else put("text",content)}
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

  private suspend fun get(path:String):JSONObject=JSONObject(getText(path))

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

  private fun request(fresh:FreshSession,path:String,method:String,body:String?,accept:String):String{
    val connection=(URL(fresh.session.apiBase+path).openConnection() as HttpURLConnection).apply{requestMethod=method;connectTimeout=10_000;readTimeout=30_000;setRequestProperty("Authorization","Bearer ${fresh.accessToken}");setRequestProperty("Accept",accept);if(body!=null){doOutput=true;setRequestProperty("Content-Type","application/json");outputStream.bufferedWriter().use{it.write(body)}}}
    try{val code=connection.responseCode;val text=(if(code in 200..299)connection.inputStream else connection.errorStream)?.bufferedReader()?.use{it.readText()}.orEmpty();if(code !in 200..299)error(runCatching{JSONObject(text).optString("message")}.getOrNull().orEmpty().ifBlank{"请求失败（HTTP $code）"});return text}finally{connection.disconnect()}
  }

  private fun detailFrom(domain:LifeDomain,json:JSONObject):RecordDetail {
    val root=when(domain){LifeDomain.Health->json.optJSONObject("fact")?:json;LifeDomain.Travel->json.optJSONObject("trip")?:json;LifeDomain.Library->json.optJSONObject("item")?:json;else->json}
    val title=when(domain){
      LifeDomain.Meals->root.optJSONArray("items").objects().mapNotNull{it.optNullableString("name")}.joinToString("、").ifBlank{mealTypeLabel(root.optString("meal_type"))}
      LifeDomain.Money->root.optJSONObject("money_entry")?.let{listOfNotNull(it.optNullableString("counterparty"),it.optNullableString("category")).firstOrNull()}?:"收支详情"
      LifeDomain.Health->root.optNullableString("label")?:root.optNullableString("metric")?.let(::kindLabel)?:"健康详情"
      LifeDomain.Travel->root.optNullableString("title")?:"旅程详情"
      LifeDomain.Library->root.optNullableString("title")?:"资料详情"
    }
    val mainKeys=when(domain){
      LifeDomain.Meals->listOf("meal_type" to "餐次","occurred_on" to "日期","time_zone" to "时区","note" to "备注")
      LifeDomain.Money->listOf("state" to "状态","occurred_on" to "日期","time_zone" to "时区","note" to "备注")
      LifeDomain.Health->listOf("metric" to "指标","value" to "数值","unit" to "单位","occurred_on" to "日期","label" to "标签","note" to "备注")
      LifeDomain.Travel->listOf("starts_on" to "开始日期","ends_on" to "结束日期","time_zone" to "时区","note" to "备注")
      LifeDomain.Library->listOf("item_type" to "类型","state" to "状态","created_at" to "收存时间","updated_at" to "更新时间","text" to "正文")
    }
    val sections=mutableListOf(DetailSection("概要",mainKeys.mapNotNull{(key,label)->root.optNullableString(key)?.let{DetailFact(label,it)}}))
    if(domain==LifeDomain.Library)json.optJSONArray("revisions")?.optJSONObject(0)?.let{revision->sections+=DetailSection("当前内容",listOfNotNull(revision.optNullableString("text")?.let{DetailFact("正文",it)},revision.optNullableString("url")?.let{DetailFact("链接",it)},revision.optJSONArray("tags")?.let{tags->(0 until tags.length()).mapNotNull{index->tags.optString(index).takeIf(String::isNotBlank)}.takeIf{it.isNotEmpty()}?.joinToString("、")?.let{DetailFact("标签",it)}}))}
    if(domain==LifeDomain.Money)json.optJSONObject("money_entry")?.let{entry->sections+=DetailSection("金额",listOfNotNull(entry.optNullableString("amount")?.let{DetailFact("金额",listOfNotNull(entry.optNullableString("currency"),it).joinToString(" "))},entry.optNullableString("counterparty")?.let{DetailFact("交易方",it)},entry.optNullableString("category")?.let{DetailFact("分类",it)},entry.optNullableString("payment_method")?.let{DetailFact("支付方式",it)}))}
    val collectionLabels=when(domain){
      LifeDomain.Meals->listOf("items" to "食物","payments" to "关联付款","sources" to "来源")
      LifeDomain.Money->listOf("meals" to "关联餐次","purchase_items" to "购买明细","sources" to "来源")
      LifeDomain.Health->listOf("source" to "来源")
      LifeDomain.Travel->listOf("reservations" to "预订","segments" to "行程段","visits" to "到访","day_plans" to "日程","members" to "成员","tracks" to "轨迹")
      LifeDomain.Library->listOf("sources" to "原件","annotations" to "批注","derivations" to "派生内容","processing_jobs" to "处理任务","snippets" to "可检索片段")
    }
    collectionLabels.forEach{(key,label)->when(val value=json.opt(key)){is JSONArray->if(value.length()>0)sections+=DetailSection(label,itemCount=value.length());is JSONObject->sections+=DetailSection(label,listOfNotNull(value.optNullableString("kind")?.let{DetailFact("类型",it)},value.optNullableString("state")?.let{DetailFact("状态",it)}));}}
    val editSeed=when(domain){
      LifeDomain.Meals->root.optNullableString("meal_id")?.let{id->root.optInt("revision").takeIf{it>0}?.let{EditSeed.Meal(id,it,root.optString("occurred_on"),root.optString("time_zone"),root.optString("meal_type","other"),root.optNullableString("note"))}}
      LifeDomain.Money->json.optJSONObject("money_entry")?.let{entry->root.optInt("revision").takeIf{it>0}?.let{revision->EditSeed.Money(root.optString("record_id"),revision,entry.optString("amount"),entry.optString("currency","CNY"),entry.optString("occurred_on",root.optString("occurred_on")),entry.optString("time_zone",root.optString("time_zone")),entry.optNullableString("category"),entry.optNullableString("counterparty"),entry.optNullableString("note")?:root.optNullableString("note"))}}
      LifeDomain.Health->root.optNullableString("id")?.let{id->root.optInt("revision").takeIf{it>0}?.let{EditSeed.Health(id,it,root.optString("metric"),root.optString("value"),root.optString("unit"),root.optString("occurred_on"),root.optString("time_zone"),root.optNullableString("label"),root.optNullableString("note"))}}
      LifeDomain.Travel->root.optNullableString("id")?.let{id->root.optInt("revision").takeIf{it>0}?.let{EditSeed.Trip(id,it,root.optString("title"),root.optString("starts_on"),root.optString("ends_on"),root.optString("time_zone"),root.optNullableString("note"))}}
      LifeDomain.Library->{val latest=json.optJSONArray("revisions")?.optJSONObject(0);root.optNullableString("id")?.let{id->root.optInt("current_revision").takeIf{it>0}?.let{EditSeed.Library(id,it,root.optString("title"),latest?.optNullableString("text"),latest?.optNullableString("url"),latest?.optJSONArray("tags")?.let{tags->(0 until tags.length()).mapNotNull{index->tags.optString(index).takeIf(String::isNotBlank)}}?:emptyList())}}}
    }
    return RecordDetail(title,root.optNullableString("state"),root.optInt("revision").takeIf{it>0}?:root.optInt("current_revision").takeIf{it>0},sections.filter{it.facts.isNotEmpty()||it.itemCount!=null},editSeed)
  }

  private suspend fun enqueueCommand(capability:String,input:JSONObject,stableCommandId:String?=null):OperationReceipt{
    val session=app.sessions.active()?:error("请先登录 Shadow Life");val commandId=stableCommandId?:"cmd_android_${UUID.randomUUID().toString().replace("-","")}";val body=JSONObject().put("protocol","shadow.command").put("capability",capability).put("command_id",commandId).put("input",input).toString();app.queue.enqueueCommand(session,commandId,capability,body);SyncScheduler.schedule(context,session.accountId);return OperationReceipt(capability,commandId,queued=true)
  }
}

private fun JSONArray?.objects():List<JSONObject>{if(this==null)return emptyList();return (0 until length()).mapNotNull{optJSONObject(it)}}
private fun JSONObject.optNullableString(key:String):String?=if(!has(key)||isNull(key))null else optString(key).takeIf(String::isNotBlank)
private fun encode(value:String)=java.net.URLEncoder.encode(value,Charsets.UTF_8.name())
private fun decimal(value:String):String { val normalized=value.trim().removePrefix("+");require(Regex("^(?:0|[1-9]\\d*)(?:\\.\\d{1,6})?$").matches(normalized)){"请输入有效数值，最多 6 位小数"};return normalized }
private fun money(value:String):String { val normalized=value.trim();require(Regex("^(?:0|[1-9]\\d*)(?:\\.\\d{1,2})?$").matches(normalized)){"请输入有效金额，最多 2 位小数"};return normalized.toBigDecimal().setScale(2).toPlainString().also{require(it!="0.00"){"金额必须大于 0"}} }
private fun mealTypeLabel(value:String)=mapOf("breakfast" to "早餐","lunch" to "午餐","dinner" to "晚餐","snack" to "加餐","other" to "一餐")[value]?:"一餐"
private fun domainFromWire(value:String)=LifeDomain.entries.first{it.name.equals(value,true)}
internal fun kindLabel(value:String)=mapOf("money_entry" to "收支记录","health_measurement" to "健康记录","trip" to "旅程","visit" to "到访","library_item" to "资料","meal" to "餐次","purchase" to "购买")[value]?:value.replace('_',' ')
