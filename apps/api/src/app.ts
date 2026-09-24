import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { createHash } from "node:crypto";
import { agentThreadMessagesInputSchema, agentThreadMessagesResultSchema, agentThreadsResultSchema, capabilityRegistry, consumptionStatsInputSchema, dailyRecordCheckInputSchema, executionResultSchema, findOperationInputSchema, healthReleaseHistoryInputSchema, healthTrendInputSchema, lifeMeResultSchema, lifeRecordInputSchema, lifeSearchInputSchema, lifeTimelineInputSchema, lifeTodayInputSchema, planningAgendaInputSchema, projectDirectoryResultSchema, writeCapabilityNameSchema, type ProjectDirectoryResult } from "@shadow/contracts";
import { AssetService, type PostgresUnitOfWork } from "@shadow/database";
import { healthSleepInsightsInputSchema } from "@shadow/contracts";
import type { AgentRepository } from "@shadow/database";
import { hostRunEventSchema, runtimeEventSchema, type AgentRuntimeAdapter, type HostRunEvent, type RuntimeEvent, type RunState } from "@shadow/agent-adapter";
import { CommandExecutor, KernelError, QueryService } from "@shadow/kernel";
import { authMiddleware } from "./auth.js";
import { installWebSessionRoutes, type WebSessionOptions } from "./web-session.js";

export function createApp(dependencies: { unitOfWork: PostgresUnitOfWork; executor: CommandExecutor; queries: QueryService; developmentAuth: boolean; projectLinks?:ProjectDirectoryResult; auth?:{issuer?:string;audience?:string;jwksUrl?:string;webOrigin?:string;proxyAuth?:{secret:string;subjectId:string}}; webSession?:WebSessionOptions; agent?: { repository: AgentRepository; runtime: AgentRuntimeAdapter; nextId(type: "thread"|"message"|"run"): string } }) {
  const app = new Hono();
  app.use("*",async(context,next)=>{const started=Date.now(),requestId=safeRequestId(context.req.header("x-request-id"));try{await next();}finally{context.header("X-Request-Id",requestId);const path=new URL(context.req.url).pathname;if(path.startsWith("/api/")||path.startsWith("/auth/"))console.log(JSON.stringify({event:"http.request",request_id:requestId,method:context.req.method,route:requestLogRoute(path),status:context.res.status,duration_ms:Date.now()-started}));}});
  const assets=new AssetService(dependencies.unitOfWork.pool);
  const activeRuns=new Map<string,{subjectId:string;controller:AbortController}>();
  const visibleCapabilities=(effects:ReadonlySet<string>)=>Object.values(capabilityRegistry).filter(item=>item.possibleEffects.some(effect=>effects.has(effect)));
  app.get("/healthz", (context) => context.json({ status: "ok" }));
  if(dependencies.webSession)installWebSessionRoutes(app,dependencies.webSession);
  app.get("/readyz", async (context) => {
    try { await dependencies.unitOfWork.pool.query("select 1"); return context.json({ status: "ready" }); }
    catch { return context.json({ status: "not_ready" }, 503); }
  });

  app.use("/api/*", authMiddleware({ development: dependencies.developmentAuth,...dependencies.auth }));
  app.use("/api/commands/*", bodyLimit({ maxSize: 1024 * 1024, onError: (context) => context.json({ protocol: "shadow.error", code: "validation", message: "Command body is too large." }, 413) }));
  app.use("/api/travel/portable/preview",bodyLimit({maxSize:1024*1024,onError:context=>context.json({protocol:"shadow.error",code:"validation",message:"Portable travel input is too large."},413)}));
  app.use("/api/life/daily-record-check",bodyLimit({maxSize:64*1024,onError:context=>context.json({protocol:"shadow.error",code:"validation",message:"Daily record check input is too large."},413)}));
  app.use("/api/assets",bodyLimit({maxSize:20*1024*1024,onError:context=>context.json({protocol:"shadow.error",code:"validation",message:"Asset is too large."},413)}));
  app.get("/api/me",context=>{const value=context.get("requestContext");context.header("Cache-Control","no-store");return context.json(lifeMeResultSchema.parse({issuer:value.issuer??"shadow:unknown",oidc_sub:value.oidcSubject??value.actorId,life_subject_id:value.subjectId,environment_id:value.environmentId??"default",display_name:value.displayName??null,effects:[...value.effects].sort(),authorization_revision:value.authorizationRevision??1}));});
  app.get("/api/project-links",context=>{context.header("Cache-Control","private, max-age=300");return context.json(projectDirectoryResultSchema.parse(dependencies.projectLinks??{schema_version:1,catalog_revision:"empty",items:[]}));});
  app.get("/api/search",async context=>context.json(await dependencies.queries.lifeSearch(context.get("requestContext"),lifeSearchInputSchema.parse({q:context.req.query("q"),...(context.req.query("types")?{types:context.req.query("types")!.split(",").filter(Boolean)}:{}),...(context.req.query("from_on")?{from_on:context.req.query("from_on")} :{}),...(context.req.query("to_on_exclusive")?{to_on_exclusive:context.req.query("to_on_exclusive")} :{}),limit:Number(context.req.query("limit")??"30"),...(context.req.query("cursor")?{cursor:context.req.query("cursor")} :{})}))));
  app.get("/api/life/consumption-stats",async context=>context.json(await dependencies.queries.consumptionStats(context.get("requestContext"),consumptionStatsInputSchema.parse({from_on:context.req.query("from_on"),to_on_exclusive:context.req.query("to_on_exclusive"),time_zone:context.req.query("time_zone"),...(context.req.query("scopes")?{scopes:context.req.query("scopes")!.split(",").filter(Boolean)}:{}),...(context.req.query("categories")?{categories:context.req.query("categories")!.split(",").filter(Boolean)}:{}),...(context.req.query("merchant_rank_by")?{merchant_rank_by:context.req.query("merchant_rank_by")}:{}),...(context.req.query("item_rank_by")?{item_rank_by:context.req.query("item_rank_by")}:{}),...(context.req.query("currency")?{currency:context.req.query("currency")}:{}),limit:Number(context.req.query("limit")??"20")}))));
  app.get("/api/capabilities", (context) => {
    const requestContext=context.get("requestContext");
    return context.json({
      subject_id:requestContext.subjectId,
      client_id:requestContext.clientId,
      issuer:requestContext.issuer,
      capabilities:visibleCapabilities(requestContext.effects).map((item)=>({name:item.name,description:item.description,possible_effects:item.possibleEffects,...(context.req.query("include_schemas")==="true"?{input_schema:z.toJSONSchema(item.inputSchema)}:{})}))
    });
  });
  app.get("/api/write-epochs",async context=>context.json({items:(await dependencies.unitOfWork.pool.query("select domain,epoch,stage,target_schema from write_epochs order by domain")).rows}));
  app.get("/api/capabilities/:name", (context) => {
    const capability = capabilityRegistry[context.req.param("name") as keyof typeof capabilityRegistry];
    return capability === undefined||!capability.possibleEffects.some(effect=>context.get("requestContext").effects.has(effect)) ? context.json({ protocol: "shadow.error", code: "not_found", message: "Capability not found." }, 404) : context.json({ name: capability.name, description: capability.description, possible_effects: capability.possibleEffects, input_schema: z.toJSONSchema(capability.inputSchema), result_schema: z.toJSONSchema(capability.resultSchema) });
  });
  app.post("/api/commands/batch", async (context) => {
    const requestContext=context.get("requestContext");
    await dependencies.unitOfWork.ensurePrincipal(requestContext.subjectId);
    const body=z.object({commands:z.array(z.record(z.string(),z.unknown())).min(1).max(50)}).strict().parse(await context.req.json());
    const ids=new Set<string>();
    for(const command of body.commands){const id=command.command_id;if(typeof id!=="string"||ids.has(id))return context.json({protocol:"shadow.error",code:"validation",message:"Batch command IDs must be present and unique.",fields:["commands.command_id"]},422);ids.add(id);}
    const items:Array<{command_id:string;http_status:number;result?:unknown;error?:unknown}>=[];
    for(const command of body.commands){
      const commandId=command.command_id as string;
      try{
        const result=await dependencies.executor.execute(requestContext,command);
        items.push({command_id:commandId,http_status:result.replayed?200:201,result});
      }catch(error){
        if(error instanceof KernelError){items.push({command_id:commandId,http_status:error.status,error:error.detail});continue;}
        if(error instanceof z.ZodError){items.push({command_id:commandId,http_status:422,error:{protocol:"shadow.error",code:"validation",message:"Command validation failed.",fields:error.issues.map(issue=>issue.path.join("."))}});continue;}
        throw error;
      }
    }
    const statusCounts=Object.fromEntries([...new Set(items.map(item=>item.http_status))].sort((left,right)=>left-right).map(status=>[String(status),items.filter(item=>item.http_status===status).length]));
    const capabilities=[...new Set(body.commands.map(command=>writeCapabilityNameSchema.safeParse(command.capability).data??"invalid"))].sort();
    console.log(JSON.stringify({event:"command.batch.completed",commands:items.length,status_counts:statusCounts,capabilities}));
    return context.json({protocol:"shadow.command-batch-result",items});
  });
  app.post("/api/assets",async context=>{const requestContext=context.get("requestContext");if(!requestContext.effects.has("library.item.write")&&!requestContext.effects.has("library.processor.write"))return context.json({protocol:"shadow.error",code:"permission_denied",message:"Missing asset upload permission."},403);const mediaType=context.req.header("content-type")?.split(";")[0]?.trim();if(!mediaType||!mediaType.includes("/"))return context.json({protocol:"shadow.error",code:"validation",message:"A media Content-Type is required."},422);const bytes=Buffer.from(await context.req.arrayBuffer());if(bytes.length===0)return context.json({protocol:"shadow.error",code:"validation",message:"Asset bytes are empty."},422);await dependencies.unitOfWork.ensurePrincipal(requestContext.subjectId);return context.json(await assets.store(requestContext.subjectId,mediaType,bytes),201);});
  const readAsset=async(subjectId:string,versionId:string)=>{const result=await dependencies.unitOfWork.pool.query<{bytes:Buffer;media_type:string;sha256:string}>("select blob.bytes,asset.media_type,version.sha256 from asset_blobs blob join asset_versions version on version.id=blob.asset_version_id join assets asset on asset.id=version.asset_id where version.id=$1 and (asset.subject_id=$2 or exists(select 1 from asset_access_grants grant_row where grant_row.asset_id=asset.id and grant_row.grantee_subject_id=$2 and grant_row.permission='read' and (grant_row.expires_at is null or grant_row.expires_at>now())))",[versionId,subjectId]);return result.rows[0];};
  app.get("/api/assets/:versionId/preview",async context=>{const requestContext=context.get("requestContext");if(!requestContext.effects.has("library.asset.read"))return context.json({protocol:"shadow.error",code:"permission_denied",message:"Missing permission: library.asset.read"},403);const versionId=context.req.param("versionId"),row=await readAsset(requestContext.subjectId,versionId);if(!row)return context.json({protocol:"shadow.error",code:"not_found",message:"Asset version not found."},404);if(!safePreviewMediaTypes.has(row.media_type))return context.json({protocol:"shadow.error",code:"validation",message:"This media type has no inline preview; download the protected original instead."},415,secureAssetHeaders());const headers=secureAssetHeaders({"content-type":row.media_type,"content-length":String(row.bytes.length),etag:`\"${row.sha256}\"`,"content-disposition":`inline; filename=\"${assetFileName(versionId,row.media_type)}\"`});if(context.req.header("if-none-match")===`\"${row.sha256}\"`)return context.body(null,304,headers);return new Response(Uint8Array.from(row.bytes),{headers});});
  app.get("/api/assets/:versionId",async context=>{const requestContext=context.get("requestContext");if(!requestContext.effects.has("library.asset.read"))return context.json({protocol:"shadow.error",code:"permission_denied",message:"Missing permission: library.asset.read"},403);const versionId=context.req.param("versionId"),row=await readAsset(requestContext.subjectId,versionId);if(!row)return context.json({protocol:"shadow.error",code:"not_found",message:"Asset version not found."},404);const headers=secureAssetHeaders({"content-type":"application/octet-stream","content-length":String(row.bytes.length),etag:`\"${row.sha256}\"`,"content-disposition":`attachment; filename=\"${assetFileName(versionId,row.media_type)}\"`,"x-shadow-original-media-type":row.media_type});if(context.req.header("if-none-match")===`\"${row.sha256}\"`)return context.body(null,304,headers);return new Response(Uint8Array.from(row.bytes),{headers});});
  app.post("/api/commands/:capability", async (context) => {
    const requestContext = context.get("requestContext");
    await dependencies.unitOfWork.ensurePrincipal(requestContext.subjectId);
    const capability = writeCapabilityNameSchema.parse(context.req.param("capability"));
    const body = await context.req.json<Record<string, unknown>>();
    if (body.capability !== capability) return context.json({ protocol: "shadow.error", code: "validation", message: "Route capability and command capability differ.", fields: ["capability"] }, 422);
    const result = await dependencies.executor.execute(requestContext, body);
    return context.json(result, result.replayed ? 200 : 201);
  });
  app.get("/api/operations/by-command/:commandId",async context=>context.json(await dependencies.executor.findOperationByCommand(context.get("requestContext"),findOperationInputSchema.parse({command_id:context.req.param("commandId")}).command_id)));
  app.get("/api/operations/:executionId", async (context) => context.json(await dependencies.executor.getOperation(context.get("requestContext"), context.req.param("executionId"))));
  app.get("/api/meals",async context=>context.json(await dependencies.queries.listMeals(context.get("requestContext"),{limit:Number(context.req.query("limit")??"20"),...(context.req.query("cursor")?{cursor:context.req.query("cursor")}:{})})));
  app.get("/api/life/foods",async context=>context.json(await dependencies.queries.foodCatalog(context.get("requestContext"),{...(context.req.query("q")?{query:context.req.query("q")} :{}),limit:Number(context.req.query("limit")??"50")})));
  app.get("/api/today",async context=>{const domains=context.req.query("domains")?.split(",").filter(Boolean);return context.json(await dependencies.queries.lifeToday(context.get("requestContext"),lifeTodayInputSchema.parse({date:context.req.query("date")??new Date().toISOString().slice(0,10),time_zone:context.req.query("time_zone")??"UTC",...(domains?.length?{domains}:{})})));});
  app.post("/api/life/daily-record-check",async context=>context.json(await dependencies.queries.dailyRecordCheck(context.get("requestContext"),dailyRecordCheckInputSchema.parse(await context.req.json()))));
  app.get("/api/timeline",async context=>{const domains=context.req.query("domains")?.split(",").filter(Boolean),cursor=context.req.query("cursor");return context.json(await dependencies.queries.lifeTimeline(context.get("requestContext"),lifeTimelineInputSchema.parse({...(domains?.length?{domains}:{}),limit:Number(context.req.query("limit")??"30"),...(cursor?{cursor}:{})})));});
  app.get("/api/money/summary", async (context) => context.json(await dependencies.queries.summarizeMoney(context.get("requestContext"))));
  app.get("/api/health/releases",async context=>context.json(await dependencies.queries.healthReleaseHistory(context.get("requestContext"),healthReleaseHistoryInputSchema.parse({from:context.req.query("from"),to:context.req.query("to"),limit:Number(context.req.query("limit")??"1000")}))));
  app.get("/api/health/trend",async context=>context.json(await dependencies.queries.healthTrend(context.get("requestContext"),healthTrendInputSchema.parse({metric_key:context.req.query("metric_key"),...(context.req.query("from")?{from:context.req.query("from")} :{}),...(context.req.query("to")?{to:context.req.query("to")} :{}),limit:Number(context.req.query("limit")??"100")}))));
  app.get("/api/health/sources",async context=>context.json(await dependencies.queries.healthSources(context.get("requestContext"))));
  app.get("/api/life/records/:id",async context=>{const sections=context.req.query("sections")?.split(",").filter(Boolean);const input=lifeRecordInputSchema.parse({id:context.req.param("id"),...(sections?.length?{sections}:{})});return context.json(await dependencies.queries.lifeRecord(context.get("requestContext"),input.id,input.sections));});
  app.get("/api/money/service-cards",async context=>context.json(await dependencies.queries.serviceCards(context.get("requestContext"),{...context.req.query(),...(context.req.query("limit")?{limit:Number(context.req.query("limit"))}:{})})));
  app.get("/api/money/planning",async context=>context.json(await dependencies.queries.moneyPlanning(context.get("requestContext"),context.req.query("period")??new Date().toISOString().slice(0,7))));
  app.get("/api/money/imports/:batchId",async context=>context.json(await dependencies.queries.moneyImportReview(context.get("requestContext"),context.req.param("batchId"))));
  app.get("/api/health/daily/:date",async context=>context.json(await dependencies.queries.healthDaily(context.get("requestContext"),context.req.param("date"))));
  app.get("/api/health/sleep-insights",async context=>context.json(await dependencies.queries.healthSleepInsights(context.get("requestContext"),healthSleepInsightsInputSchema.parse({to:context.req.query("to"),days:Number(context.req.query("days")??"30")}))));
  app.get("/api/health/records/:id",async context=>context.json(await dependencies.queries.healthRecord(context.get("requestContext"),context.req.param("id"))));
  app.get("/api/travel/trips/:id",async context=>context.json(await dependencies.queries.travelTrip(context.get("requestContext"),context.req.param("id"))));
  app.get("/api/travel/workspace",async context=>context.json(await dependencies.queries.travelWorkspace(context.get("requestContext"),context.req.query("trip_id")?{trip_id:context.req.query("trip_id")} :{})));
  app.get("/api/travel/trips/:id/export",async context=>context.json(await dependencies.queries.travelExport(context.get("requestContext"),{trip_id:context.req.param("id"),format:context.req.query("format")})));
  app.post("/api/travel/portable/preview",async context=>context.json(await dependencies.queries.previewTravelPortable(context.get("requestContext"),await context.req.json())));
  app.get("/api/library/items/:id",async context=>context.json(await dependencies.queries.libraryItem(context.get("requestContext"),context.req.param("id"))));
  app.get("/api/library/processing",async context=>context.json(await dependencies.queries.libraryProcessingQueue(context.get("requestContext"),{...(context.req.query("kind")?{kind:context.req.query("kind")}:{}),limit:Number(context.req.query("limit")??"20")})));
  app.get("/api/agent/context-packs/:id",async context=>context.json(await dependencies.queries.agentContextPack(context.get("requestContext"),{context_pack_id:context.req.param("id")},context.req.query("thread_id"))));
  app.get("/api/agent/memories",async context=>context.json(await dependencies.queries.agentMemories(context.get("requestContext"),{...(context.req.query("category")?{category:context.req.query("category")}:{}),limit:Number(context.req.query("limit")??"50")})));
  app.get("/api/notifications",async context=>context.json(await dependencies.queries.notifications(context.get("requestContext"),{limit:Number(context.req.query("limit")??"50"),...(context.req.query("cursor")?{cursor:context.req.query("cursor")}:{})})));
  app.get("/api/life/owned-items",async context=>context.json(await dependencies.queries.ownedItems(context.get("requestContext"),{...(context.req.query("id")?{id:context.req.query("id")}:{}),...(context.req.query("state")?{state:context.req.query("state")}:{}),limit:Number(context.req.query("limit")??"50")})));
  app.get("/api/life/reviews",async context=>context.json(await dependencies.queries.lifeReviews(context.get("requestContext"),{...(context.req.query("id")?{id:context.req.query("id")}:{}),limit:Number(context.req.query("limit")??"20")})));
  app.get("/api/life/projects",async context=>context.json(await dependencies.queries.lifeProjects(context.get("requestContext"),{...(context.req.query("id")?{id:context.req.query("id")}:{}),...(context.req.query("state")?{state:context.req.query("state")}:{}),limit:Number(context.req.query("limit")??"20")})));
  app.get("/api/planning/agenda",async context=>context.json(await dependencies.queries.planningAgenda(context.get("requestContext"),planningAgendaInputSchema.parse({from_on:context.req.query("from_on"),to_on_exclusive:context.req.query("to_on_exclusive"),time_zone:context.req.query("time_zone"),limit:Number(context.req.query("limit")??"100")}))));
  app.get("/api/life/meal-planning",async context=>context.json(await dependencies.queries.mealPlanning(context.get("requestContext"),{limit:Number(context.req.query("limit")??"20")})));
  app.get("/api/life/purchase-items",async context=>context.json(await dependencies.queries.purchaseItems(context.get("requestContext"),context.req.query("q"),Number(context.req.query("limit")??"50"))));
  app.get("/api/money/foreign",async context=>context.json(await dependencies.queries.foreignEntries(context.get("requestContext"),{...(context.req.query("trip_id")?{trip_id:context.req.query("trip_id")}:{}),limit:Number(context.req.query("limit")??"50")})));
  app.get("/api/:domain{money|health|travel|library}", async (context) => {const query=context.req.query("q"),cursor=context.req.query("cursor");return context.json(await dependencies.queries.listDomain(context.get("requestContext"), context.req.param("domain") as "money" | "health" | "travel" | "library", {limit:Number(context.req.query("limit")??"50"),...(query?{query}:{}),...(cursor?{cursor}:{})}));});
  app.get("/api/threads", async (context) => context.json(agentThreadsResultSchema.parse({ items: dependencies.agent ? await dependencies.agent.repository.listThreads(context.get("requestContext").subjectId) : [] })));
  app.get("/api/threads/:threadId/messages",async context=>{
    const input=agentThreadMessagesInputSchema.parse({limit:Number(context.req.query("limit")??"50"),...(context.req.query("cursor")?{cursor:context.req.query("cursor")}:{})});
    if(!dependencies.agent)return context.json(agentThreadMessagesResultSchema.parse({items:[],next_cursor:null,as_of:new Date().toISOString()}));
    const requestContext=context.get("requestContext"),threadId=context.req.param("threadId");await dependencies.agent.repository.assertThread(requestContext.subjectId,threadId);
    const before=input.cursor?decodeMessageCursor(input.cursor):undefined,page=await dependencies.agent.repository.conversationPage(requestContext.subjectId,threadId,{limit:input.limit,...(before?{asOf:before.as_of,before:{at:before.at,id:before.id}}:{})});
    const first=page.items[0],next=page.hasMore&&first?Buffer.from(JSON.stringify({at:first.created_at,id:first.id,as_of:page.asOf} satisfies MessageCursor)).toString("base64url"):null;
    return context.json(agentThreadMessagesResultSchema.parse({items:page.items,next_cursor:next,as_of:page.asOf}));
  });
  app.post("/api/threads", async (context) => {
    if (!dependencies.agent) return context.json({ protocol:"shadow.error",code:"retryable_not_applied",message:"Agent runtime is unavailable." },503);
    const requestContext=context.get("requestContext"); await dependencies.unitOfWork.ensurePrincipal(requestContext.subjectId); const body=z.object({title:z.string().trim().min(1).max(500).optional()}).strict().parse(await context.req.json()); const id=dependencies.agent.nextId("thread"); await dependencies.agent.repository.createThread(requestContext.subjectId,id,body.title??"新对话"); return context.json({id},201);
  });
  app.post("/api/threads/:threadId/runs", async (context) => {
    if (!dependencies.agent) return context.json({ protocol:"shadow.error",code:"retryable_not_applied",message:"Agent runtime is unavailable." },503);
    const requestContext=context.get("requestContext"); if(!requestContext.effects.has("agent.run")) throw new KernelError(403,{protocol:"shadow.error",code:"permission_denied",message:"Missing effect: agent.run"});
    const body=await context.req.json<{text:string;context_pack_id?:string}>(); if(typeof body.text!=="string"||!body.text.trim()) return context.json({protocol:"shadow.error",code:"validation",message:"text is required",fields:["text"]},422);
    const {repository,runtime,nextId}=dependencies.agent;
    const threadId=context.req.param("threadId");await repository.assertThread(requestContext.subjectId,threadId);
    const contextPack=body.context_pack_id?await dependencies.queries.agentContextPack(requestContext,{context_pack_id:body.context_pack_id},threadId):undefined;
    const [baseContext,memoryContext]=await Promise.all([dependencies.queries.agentPersonalContext(requestContext),dependencies.queries.agentMemories?.(requestContext)??Promise.resolve({items:[]})]);
    const personalContext={...baseContext,memories:(memoryContext as {items:unknown[]}).items},messageId=nextId("message"),runId=nextId("run");
    await repository.createRun(threadId,runId,{id:messageId,content:body.text.trim()});
    const history=await repository.conversation(requestContext.subjectId,threadId);

    const capabilityProfile=visibleCapabilities(requestContext.effects).map(item=>item.name);
    return streamSSE(context,async(stream)=>{
      const controller=new AbortController(),startedAt=Date.now(),seenRuntimeEvents=new Set<string>();
      let assistant="",terminal:"awaiting_input"|"completed"|"interrupted"|undefined,runtimeEventCount=0,toolCallCount=0,hostEventCount=0,currentState:RunState="started";
      const deadline=setTimeout(()=>controller.abort("deadline_exceeded"),120_000);
      const heartbeat=setInterval(()=>{void repository.heartbeat(runId).then(valid=>{if(!valid&&!controller.signal.aborted)controller.abort("lease_lost_or_stop_requested");}).catch(()=>controller.abort("lease_heartbeat_failed"));},5_000);
      heartbeat.unref();
      activeRuns.set(runId,{subjectId:requestContext.subjectId,controller});
      // The HTTP stream is only a subscription. A dropped mobile connection must not cancel
      // the durable run; clients resume from the persisted sequence through /api/runs/:id.
      stream.onAbort(()=>{/* keep the leased run alive */});
      const emit=async(event:HostRunEvent):Promise<number>=>{const parsed=hostRunEventSchema.parse(event),sequence=await repository.appendEvent(runId,parsed.type,parsed);try{await stream.writeSSE({id:String(sequence),event:parsed.type,data:JSON.stringify(parsed)});}catch{/* persistence remains authoritative when the client disconnects */}return sequence;};
      const hostId=()=>`${runId}:host:${++hostEventCount}`;
      const state=async(next:RunState,detail?:{reason?:string;fields?:string[];prompt?:string})=>{currentState=next;await emit({id:hostId(),run_id:runId,type:"run.state",state:next,...detail});};
      const dispatchTool=async(capabilityName:string,input:unknown,callId:string):Promise<unknown>=>{
        const capability=capabilityRegistry[capabilityName as keyof typeof capabilityRegistry];
        if(!capability||!capability.possibleEffects.some(effect=>requestContext.effects.has(effect)))throw new KernelError(403,{protocol:"shadow.error",code:"permission_denied",message:"Runtime requested a capability that is not visible."});
        if(capability.idempotency==="required"){const callKey=createHash("sha256").update(`${runId}:${callId}`).digest("hex");return dependencies.executor.execute({...requestContext,agentRun:{runId,ownerId:repository.ownerId,toolCallId:callId}},{protocol:"shadow.command",capability:capabilityName,command_id:`cmd_agent_${callKey}`,input});}
        const parsed=capability.inputSchema.parse(input);
        if(capabilityName==="life.list_meals")return dependencies.queries.listMeals(requestContext,parsed);
        if(capabilityName==="life.food_catalog")return dependencies.queries.foodCatalog(requestContext,parsed);
        if(capabilityName==="life.today")return dependencies.queries.lifeToday(requestContext,parsed);
        if(capabilityName==="life.daily_record_check")return dependencies.queries.dailyRecordCheck(requestContext,parsed);
        if(capabilityName==="life.timeline")return dependencies.queries.lifeTimeline(requestContext,parsed);
        if(capabilityName==="life.search")return dependencies.queries.lifeSearch(requestContext,parsed);
        if(capabilityName==="life.consumption_stats")return dependencies.queries.consumptionStats(requestContext,parsed);
        if(capabilityName==="money.summarize")return dependencies.queries.summarizeMoney(requestContext);
        if(capabilityName==="money.records"||capabilityName==="health.records"||capabilityName==="travel.records"||capabilityName==="library.records")return dependencies.queries.listDomain(requestContext,capabilityName.split(".")[0] as "money"|"health"|"travel"|"library",parsed as {query?:string|undefined;limit?:number|undefined;cursor?:string|undefined});
        if(capabilityName==="health.release_history")return dependencies.queries.healthReleaseHistory(requestContext,parsed);
        if(capabilityName==="health.trend")return dependencies.queries.healthTrend(requestContext,parsed as {metric_key:string;from?:string|undefined;to?:string|undefined;limit:number});
        if(capabilityName==="health.sources")return dependencies.queries.healthSources(requestContext);
        if(capabilityName==="life.get_record"){const value=parsed as {id:string;sections?:readonly ("meal"|"purchase"|"money"|"sources")[]};return dependencies.queries.lifeRecord(requestContext,value.id,value.sections);}
        if(capabilityName==="money.service_cards")return dependencies.queries.serviceCards(requestContext,parsed);
        if(capabilityName==="money.planning")return dependencies.queries.moneyPlanning(requestContext,(parsed as {period:string}).period);
        if(capabilityName==="money.import_review")return dependencies.queries.moneyImportReview(requestContext,(parsed as {batch_id:string}).batch_id);
        if(capabilityName==="health.daily")return dependencies.queries.healthDaily(requestContext,(parsed as {date:string}).date);
        if(capabilityName==="health.sleep_insights")return dependencies.queries.healthSleepInsights(requestContext,parsed);
        if(capabilityName==="health.get_record")return dependencies.queries.healthRecord(requestContext,(parsed as {id:string}).id);
        if(capabilityName==="travel.get_trip")return dependencies.queries.travelTrip(requestContext,(parsed as {id:string}).id);
        if(capabilityName==="travel.workspace")return dependencies.queries.travelWorkspace(requestContext,parsed);
        if(capabilityName==="travel.export")return dependencies.queries.travelExport(requestContext,parsed);
        if(capabilityName==="travel.preview_portable")return dependencies.queries.previewTravelPortable(requestContext,parsed);
        if(capabilityName==="library.get_item")return dependencies.queries.libraryItem(requestContext,(parsed as {id:string}).id);
        if(capabilityName==="library.processing_queue")return dependencies.queries.libraryProcessingQueue(requestContext,parsed);
        if(capabilityName==="agent.get_context_pack")return dependencies.queries.agentContextPack(requestContext,parsed,threadId);
        if(capabilityName==="agent.memories")return dependencies.queries.agentMemories(requestContext,parsed);
        if(capabilityName==="notifications.list")return dependencies.queries.notifications(requestContext,parsed);
        if(capabilityName==="life.owned_items")return dependencies.queries.ownedItems(requestContext,parsed);
        if(capabilityName==="life.reviews")return dependencies.queries.lifeReviews(requestContext,parsed);
        if(capabilityName==="life.projects")return dependencies.queries.lifeProjects(requestContext,parsed);
        if(capabilityName==="life.planning_agenda")return dependencies.queries.planningAgenda(requestContext,parsed);
        if(capabilityName==="life.meal_planning")return dependencies.queries.mealPlanning(requestContext,parsed);
        if(capabilityName==="money.foreign_entries")return dependencies.queries.foreignEntries(requestContext,parsed);
        if(capabilityName==="operations.find")return dependencies.executor.findOperationByCommand(requestContext,(parsed as {command_id:string}).command_id);
        if(capabilityName==="operations.get")return dependencies.executor.getOperation(requestContext,(parsed as {execution_id:string}).execution_id);
        throw new KernelError(422,{protocol:"shadow.error",code:"validation",message:"Runtime requested an unsupported query capability."});
      };
      const consume=async(events:AsyncIterable<RuntimeEvent>):Promise<void>=>{for await(const rawEvent of events){
        const event=runtimeEventSchema.parse(rawEvent);
        if(terminal)return;
        if(++runtimeEventCount>200)throw new Error("Runtime event limit exceeded.");
        if(Date.now()-startedAt>120_000)throw new Error("Runtime deadline exceeded.");
        if(Buffer.byteLength(JSON.stringify(event))>256*1024)throw new Error("Runtime event is too large.");
        if(seenRuntimeEvents.has(event.id))continue;seenRuntimeEvents.add(event.id);
        if(event.type==="message.delta"){
          if(currentState==="started")await state("streaming");
          assistant+=event.text;if(assistant.length>200_000)throw new Error("Runtime answer is too large.");
          await emit({id:hostId(),run_id:runId,type:"message.delta",text:event.text,runtime_event_id:event.id});continue;
        }
        if(event.type==="input.required"){
          if(!assistant.includes(event.prompt))assistant+=`${assistant?"\n":""}${event.prompt}`;
          terminal="awaiting_input";await state("awaiting_input",{fields:[...event.fields],prompt:event.prompt});return;
        }
        if(event.type==="run.completed"){
          terminal="completed";await state("completed");return;
        }
        if(event.type==="run.interrupted"){
          terminal="interrupted";await state("interrupted",{reason:controller.signal.aborted?abortReason(controller.signal):event.reason});return;
        }
        if(++toolCallCount>20)throw new Error("Runtime tool-call limit exceeded.");
        if(currentState==="started")await state("streaming");
        let result:unknown;try{result=await dispatchTool(event.capability,event.input,event.id);}catch(error){result=toolFailure(error,event.input);}
        const execution=executionResultSchema.safeParse(result);
        if(execution.success&&capabilityRegistry[event.capability as keyof typeof capabilityRegistry]?.idempotency==="required"){
          await emit({id:hostId(),run_id:runId,type:"operation.committed",authority:"executor",subject_id:requestContext.subjectId,tool_call_id:event.id,capability:event.capability,command_id:execution.data.command_id,execution_id:execution.data.execution_id,result:execution.data});
          await state("committed_partial");
        }else{
          const rejected=isRuntimeToolError(result);
          await emit({id:hostId(),run_id:runId,type:"tool.result",tool_call_id:event.id,capability:event.capability,outcome:rejected?"rejected":"returned",result});
        }
        const runtimeResult=serializedSize(result)<=1024*1024?result:{protocol:"shadow.runtime-tool-error",code:"outcome_unknown",message:"Tool result exceeded the Runtime transfer limit.",retryable:false};
        await consume(runtime.submitToolResult({protocol:"shadow.runtime-tool-result",threadId,runId,toolCallId:event.id,capability:event.capability,result:runtimeResult},controller.signal));return;
      }};
      try{
        await state("started");
        await consume(runtime.run({threadId,runId,messageId,text:body.text.trim(),history,personalContext,contextPack,capabilityProfile},controller.signal));
        if(!terminal){const reason=controller.signal.aborted?abortReason(controller.signal):"Runtime ended without a terminal event.";terminal="interrupted";await state("interrupted",{reason});}
        await repository.finishRun(runId,terminal,terminal==="interrupted"?"Run was interrupted.":undefined,assistant?{id:nextId("message"),content:assistant}:undefined);
      }catch(error){
        const message=controller.signal.aborted?abortReason(controller.signal):error instanceof Error?error.message:"Agent run failed";
        terminal="interrupted";
        try{await state("interrupted",{reason:message});await repository.finishRun(runId,controller.signal.aborted?"interrupted":"failed",message,assistant?{id:nextId("message"),content:assistant}:undefined);}
        catch(finishError){if(!(finishError instanceof KernelError&&finishError.detail.code==="conflict"))throw finishError;}
      }finally{clearInterval(heartbeat);clearTimeout(deadline);activeRuns.delete(runId);}
    });
  });
  app.get("/api/runs/:runId",async context=>{if(!dependencies.agent)return context.json({protocol:"shadow.error",code:"not_found",message:"Run not found."},404);const requestContext=context.get("requestContext"),runId=context.req.param("runId"),run=await dependencies.agent.repository.run(requestContext.subjectId,runId);if(!run)return context.json({protocol:"shadow.error",code:"not_found",message:"Run not found."},404);const after=Number(context.req.query("after")??"0"),safeAfter=Number.isInteger(after)&&after>=0?after:0;return context.json({run,events:await dependencies.agent.repository.events(requestContext.subjectId,runId,safeAfter)});});
  app.post("/api/runs/:runId/stop",async context=>{
    if(!dependencies.agent)return context.json({protocol:"shadow.error",code:"not_found",message:"Run not found."},404);
    const requestContext=context.get("requestContext"),runId=context.req.param("runId"),status=await dependencies.agent.repository.requestStop(requestContext.subjectId,runId);
    if(!status)return context.json({protocol:"shadow.error",code:"not_found",message:"Run not found."},404);
    const active=activeRuns.get(runId);if(active?.subjectId===requestContext.subjectId&&!active.controller.signal.aborted)active.controller.abort("stopped_by_user");
    return context.json({run_id:runId,status});
  });
  app.get("/api/runs/:runId/events", async(context)=>{if(!dependencies.agent)return context.json({items:[]});const after=Number(context.req.query("after")??"0");return context.json({items:await dependencies.agent.repository.events(context.get("requestContext").subjectId,context.req.param("runId"),Number.isInteger(after)&&after>=0?after:0)});});

  app.onError((error, context) => {
    if (error instanceof KernelError) return context.json(error.detail, error.status as 400);
    if (error instanceof z.ZodError) return context.json({ protocol: "shadow.error", code: "validation", message: "Command validation failed.", fields: error.issues.map((issue) => issue.path.join(".")) }, 422);
    if (error instanceof SyntaxError) return context.json({ protocol: "shadow.error", code: "validation", message: "Command body must be valid JSON." }, 400);
    console.error(error);
    return context.json({ protocol: "shadow.error", code: "outcome_unknown", message: "The request outcome could not be established." }, 500);
  });
  return app;
}

function toolFailure(error:unknown,input?:unknown):Record<string,unknown>{
  if(error instanceof z.ZodError){const fields=error.issues.map(issue=>issue.path.join(".")).filter(Boolean),missing=error.issues.some(issue=>issue.code==="invalid_type"&&valueAt(input,issue.path)===undefined);return{protocol:"shadow.runtime-tool-error",code:missing?"missing_fact":"validation",message:missing?"缺少完成操作所需的事实，请只追问这些字段。":"工具参数不符合合同，请根据字段错误修正后继续。",fields,retryable:true};}
  if(error instanceof KernelError)return{...error.detail,protocol:"shadow.runtime-tool-error",retryable:error.detail.code==="missing_fact"||error.detail.code==="validation"||error.detail.code==="conflict"};
  return{protocol:"shadow.runtime-tool-error",code:"outcome_unknown",message:error instanceof Error?error.message:"Tool execution failed",retryable:false};
}
function valueAt(value:unknown,path:readonly PropertyKey[]):unknown{let current=value;for(const key of path){if(current===null||typeof current!=="object")return undefined;current=(current as Record<PropertyKey,unknown>)[key];}return current;}
function serializedSize(value:unknown):number{try{return Buffer.byteLength(JSON.stringify(value));}catch{return Number.POSITIVE_INFINITY;}}
function isRuntimeToolError(value:unknown):boolean{return value!==null&&typeof value==="object"&&(value as {protocol?:unknown}).protocol==="shadow.runtime-tool-error";}
function safeRequestId(value:string|undefined):string{return value&&/^[A-Za-z0-9._:-]{8,128}$/u.test(value)?value:crypto.randomUUID();}
export function requestLogRoute(path:string):string{
  if(path==="/api/commands/batch")return path;
  if(/^\/api\/operations\/by-command\/[^/]+$/u.test(path))return"/api/operations/by-command/:commandId";
  if(/^\/api\/operations\/[^/]+$/u.test(path))return"/api/operations/:executionId";
  if(/^\/api\/assets\/[^/]+(?:\/preview)?$/u.test(path))return path.endsWith("/preview")?"/api/assets/:versionId/preview":"/api/assets/:versionId";
  if(/^\/api\/commands\/[^/]+$/u.test(path))return"/api/commands/:capability";
  if(/^\/api\/health\/records\/[^/]+$/u.test(path))return"/api/health/records/:id";
  if(/^\/api\/life\/records\/[^/]+$/u.test(path))return"/api/life/records/:id";
  return path.length<=160?path:"/:long-path";
}
function abortReason(signal:AbortSignal):string{if(signal.reason==="stopped_by_user")return"Run stopped by the user.";if(signal.reason==="deadline_exceeded")return"Runtime deadline exceeded.";return"Run was cancelled.";}
type MessageCursor={at:string;id:string;as_of:string};
function decodeMessageCursor(cursor:string):MessageCursor{let value:unknown;try{value=JSON.parse(Buffer.from(cursor,"base64url").toString("utf8"));}catch{throw new KernelError(422,{protocol:"shadow.error",code:"validation",message:"Message cursor is invalid.",fields:["cursor"]});}const parsed=z.object({at:z.iso.datetime({offset:true}),id:z.string().min(8),as_of:z.iso.datetime({offset:true})}).strict().safeParse(value);if(!parsed.success)throw new KernelError(422,{protocol:"shadow.error",code:"validation",message:"Message cursor is invalid.",fields:["cursor"]});return parsed.data;}
const safePreviewMediaTypes=new Set(["image/jpeg","image/png","image/gif","image/webp","image/avif","audio/mpeg","audio/mp4","audio/ogg","video/mp4","video/webm","text/plain"]);
function secureAssetHeaders(extra:Record<string,string>={}):Record<string,string>{return{"cache-control":"private, no-store","x-content-type-options":"nosniff","cross-origin-resource-policy":"same-origin","referrer-policy":"no-referrer","content-security-policy":"default-src 'none'; sandbox",...extra};}
function assetFileName(versionId:string,mediaType:string):string{const safe=versionId.replace(/[^A-Za-z0-9._-]/gu,"_").slice(0,128)||"asset",extensions:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/gif":"gif","image/webp":"webp","image/avif":"avif","audio/mpeg":"mp3","audio/mp4":"m4a","audio/ogg":"ogg","video/mp4":"mp4","video/webm":"webm","text/plain":"txt","application/pdf":"pdf","image/svg+xml":"svg","text/html":"html"};return`${safe}.${extensions[mediaType]??"bin"}`;}
