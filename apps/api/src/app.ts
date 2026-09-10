import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import { createHash } from "node:crypto";
import { capabilityRegistry, executionResultSchema, healthTrendInputSchema, lifeRecordInputSchema, lifeTimelineInputSchema, lifeTodayInputSchema, writeCapabilityNameSchema } from "@shadow/contracts";
import { AssetService, type PostgresUnitOfWork } from "@shadow/database";
import type { AgentRepository } from "@shadow/database";
import { hostRunEventSchema, runtimeEventSchema, type AgentRuntimeAdapter, type HostRunEvent, type RuntimeEvent, type RunState } from "@shadow/agent-adapter";
import { CommandExecutor, KernelError, QueryService } from "@shadow/kernel";
import { authMiddleware } from "./auth.js";
import { installWebSessionRoutes, type WebSessionOptions } from "./web-session.js";

export function createApp(dependencies: { unitOfWork: PostgresUnitOfWork; executor: CommandExecutor; queries: QueryService; developmentAuth: boolean; auth?:{issuer:string;audience:string;jwksUrl:string;webOrigin?:string}; webSession?:WebSessionOptions; agent?: { repository: AgentRepository; runtime: AgentRuntimeAdapter; nextId(type: "thread"|"message"|"run"): string } }) {
  const app = new Hono();
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
  app.use("/api/assets",bodyLimit({maxSize:20*1024*1024,onError:context=>context.json({protocol:"shadow.error",code:"validation",message:"Asset is too large."},413)}));
  app.get("/api/capabilities", (context) => context.json({
    capabilities: visibleCapabilities(context.get("requestContext").effects).map((item) => ({ name: item.name, description: item.description, possible_effects: item.possibleEffects }))
  }));
  app.get("/api/write-epochs",async context=>context.json({items:(await dependencies.unitOfWork.pool.query("select domain,epoch,stage,target_schema from write_epochs order by domain")).rows}));
  app.get("/api/capabilities/:name", (context) => {
    const capability = capabilityRegistry[context.req.param("name") as keyof typeof capabilityRegistry];
    return capability === undefined||!capability.possibleEffects.some(effect=>context.get("requestContext").effects.has(effect)) ? context.json({ protocol: "shadow.error", code: "not_found", message: "Capability not found." }, 404) : context.json({ name: capability.name, description: capability.description, possible_effects: capability.possibleEffects, input_schema: z.toJSONSchema(capability.inputSchema), result_schema: z.toJSONSchema(capability.resultSchema) });
  });
  app.post("/api/assets",async context=>{const requestContext=context.get("requestContext");if(!requestContext.effects.has("library.item.write"))return context.json({protocol:"shadow.error",code:"permission_denied",message:"Missing effect: library.item.write"},403);const mediaType=context.req.header("content-type")?.split(";")[0]?.trim();if(!mediaType||!mediaType.includes("/"))return context.json({protocol:"shadow.error",code:"validation",message:"A media Content-Type is required."},422);const bytes=Buffer.from(await context.req.arrayBuffer());if(bytes.length===0)return context.json({protocol:"shadow.error",code:"validation",message:"Asset bytes are empty."},422);await dependencies.unitOfWork.ensurePrincipal(requestContext.subjectId);return context.json(await assets.store(requestContext.subjectId,mediaType,bytes),201);});
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
  app.get("/api/operations/by-command/:commandId",async context=>context.json(await dependencies.executor.findOperationByCommand(context.get("requestContext"),context.req.param("commandId"))));
  app.get("/api/operations/:executionId", async (context) => context.json(await dependencies.executor.getOperation(context.get("requestContext"), context.req.param("executionId"))));
  app.get("/api/meals", async (context) => context.json({ items: await dependencies.queries.listMeals(context.get("requestContext"), Number(context.req.query("limit") ?? "20")) }));
  app.get("/api/today",async context=>{const domains=context.req.query("domains")?.split(",").filter(Boolean);return context.json(await dependencies.queries.lifeToday(context.get("requestContext"),lifeTodayInputSchema.parse({date:context.req.query("date")??new Date().toISOString().slice(0,10),time_zone:context.req.query("time_zone")??"UTC",...(domains?.length?{domains}:{})})));});
  app.get("/api/timeline",async context=>{const domains=context.req.query("domains")?.split(",").filter(Boolean),cursor=context.req.query("cursor");return context.json(await dependencies.queries.lifeTimeline(context.get("requestContext"),lifeTimelineInputSchema.parse({...(domains?.length?{domains}:{}),limit:Number(context.req.query("limit")??"30"),...(cursor?{cursor}:{})})));});
  app.get("/api/money/summary", async (context) => context.json(await dependencies.queries.summarizeMoney(context.get("requestContext"))));
  app.get("/api/health/trend",async context=>context.json(await dependencies.queries.healthTrend(context.get("requestContext"),healthTrendInputSchema.parse({metric_key:context.req.query("metric_key"),...(context.req.query("from")?{from:context.req.query("from")} :{}),...(context.req.query("to")?{to:context.req.query("to")} :{}),limit:Number(context.req.query("limit")??"100")}))));
  app.get("/api/health/sources",async context=>context.json(await dependencies.queries.healthSources(context.get("requestContext"))));
  app.get("/api/life/records/:id",async context=>{const sections=context.req.query("sections")?.split(",").filter(Boolean);const input=lifeRecordInputSchema.parse({id:context.req.param("id"),...(sections?.length?{sections}:{})});return context.json(await dependencies.queries.lifeRecord(context.get("requestContext"),input.id,input.sections));});
  app.get("/api/money/planning",async context=>context.json(await dependencies.queries.moneyPlanning(context.get("requestContext"),context.req.query("period")??new Date().toISOString().slice(0,7))));
  app.get("/api/money/imports/:batchId",async context=>context.json(await dependencies.queries.moneyImportReview(context.get("requestContext"),context.req.param("batchId"))));
  app.get("/api/health/daily/:date",async context=>context.json(await dependencies.queries.healthDaily(context.get("requestContext"),context.req.param("date"))));
  app.get("/api/travel/trips/:id",async context=>context.json(await dependencies.queries.travelTrip(context.get("requestContext"),context.req.param("id"))));
  app.get("/api/library/items/:id",async context=>context.json(await dependencies.queries.libraryItem(context.get("requestContext"),context.req.param("id"))));
  app.get("/api/:domain{money|health|travel|library}", async (context) => {const query=context.req.query("q"),cursor=context.req.query("cursor");return context.json(await dependencies.queries.listDomain(context.get("requestContext"), context.req.param("domain") as "money" | "health" | "travel" | "library", {limit:Number(context.req.query("limit")??"50"),...(query?{query}:{}),...(cursor?{cursor}:{})}));});
  app.get("/api/threads", async (context) => context.json({ items: dependencies.agent ? await dependencies.agent.repository.listThreads(context.get("requestContext").subjectId) : [] }));
  app.get("/api/threads/:threadId/messages",async context=>{if(!dependencies.agent)return context.json({items:[]});const requestContext=context.get("requestContext"),threadId=context.req.param("threadId");await dependencies.agent.repository.assertThread(requestContext.subjectId,threadId);return context.json({items:await dependencies.agent.repository.conversation(requestContext.subjectId,threadId,100)});});
  app.post("/api/threads", async (context) => {
    if (!dependencies.agent) return context.json({ protocol:"shadow.error",code:"retryable_not_applied",message:"Agent runtime is unavailable." },503);
    const requestContext=context.get("requestContext"); await dependencies.unitOfWork.ensurePrincipal(requestContext.subjectId); const body=await context.req.json<{title?:string}>(); const id=dependencies.agent.nextId("thread"); await dependencies.agent.repository.createThread(requestContext.subjectId,id,body.title?.trim()||"新对话"); return context.json({id},201);
  });
  app.post("/api/threads/:threadId/runs", async (context) => {
    if (!dependencies.agent) return context.json({ protocol:"shadow.error",code:"retryable_not_applied",message:"Agent runtime is unavailable." },503);
    const requestContext=context.get("requestContext"); if(!requestContext.effects.has("agent.run")) throw new KernelError(403,{protocol:"shadow.error",code:"permission_denied",message:"Missing effect: agent.run"});
    const body=await context.req.json<{text:string}>(); if(typeof body.text!=="string"||!body.text.trim()) return context.json({protocol:"shadow.error",code:"validation",message:"text is required",fields:["text"]},422);
    const {repository,runtime,nextId}=dependencies.agent; const threadId=context.req.param("threadId"); await repository.assertThread(requestContext.subjectId,threadId); const messageId=nextId("message"),runId=nextId("run"); await repository.addMessage(threadId,messageId,"user",body.text.trim()); const [history,personalContext]=await Promise.all([repository.conversation(requestContext.subjectId,threadId),dependencies.queries.agentPersonalContext(requestContext)]);await repository.createRun(threadId,runId);
    const capabilityProfile=visibleCapabilities(requestContext.effects).map(item=>item.name);
    return streamSSE(context,async(stream)=>{
      const controller=new AbortController(),startedAt=Date.now(),seenRuntimeEvents=new Set<string>();
      let assistant="",terminal:"awaiting_input"|"completed"|"interrupted"|undefined,runtimeEventCount=0,toolCallCount=0,hostEventCount=0,currentState:RunState="started";
      const deadline=setTimeout(()=>controller.abort("deadline_exceeded"),120_000);
      activeRuns.set(runId,{subjectId:requestContext.subjectId,controller});
      stream.onAbort(()=>{if(!controller.signal.aborted)controller.abort("client_disconnected");});
      const emit=async(event:HostRunEvent):Promise<number>=>{const parsed=hostRunEventSchema.parse(event),sequence=await repository.appendEvent(runId,parsed.type,parsed);try{await stream.writeSSE({id:String(sequence),event:parsed.type,data:JSON.stringify(parsed)});}catch{/* persistence remains authoritative when the client disconnects */}return sequence;};
      const hostId=()=>`${runId}:host:${++hostEventCount}`;
      const state=async(next:RunState,detail?:{reason?:string;fields?:string[];prompt?:string})=>{currentState=next;await emit({id:hostId(),run_id:runId,type:"run.state",state:next,...detail});};
      const dispatchTool=async(capabilityName:string,input:unknown,callId:string):Promise<unknown>=>{
        const capability=capabilityRegistry[capabilityName as keyof typeof capabilityRegistry];
        if(!capability||!capability.possibleEffects.some(effect=>requestContext.effects.has(effect)))throw new KernelError(403,{protocol:"shadow.error",code:"permission_denied",message:"Runtime requested a capability that is not visible."});
        if(capability.idempotency==="required"){const callKey=createHash("sha256").update(`${runId}:${callId}`).digest("hex");return dependencies.executor.execute(requestContext,{protocol:"shadow.command",capability:capabilityName,command_id:`cmd_agent_${callKey}`,input});}
        const parsed=capability.inputSchema.parse(input);
        if(capabilityName==="life.list_meals")return{items:await dependencies.queries.listMeals(requestContext,(parsed as {limit:number}).limit)};
        if(capabilityName==="life.today")return dependencies.queries.lifeToday(requestContext,parsed);
        if(capabilityName==="life.timeline")return dependencies.queries.lifeTimeline(requestContext,parsed);
        if(capabilityName==="money.summarize")return dependencies.queries.summarizeMoney(requestContext);
        if(capabilityName==="money.records"||capabilityName==="health.records"||capabilityName==="travel.records"||capabilityName==="library.records")return dependencies.queries.listDomain(requestContext,capabilityName.split(".")[0] as "money"|"health"|"travel"|"library",parsed as {query?:string|undefined;limit?:number|undefined;cursor?:string|undefined});
        if(capabilityName==="health.trend")return dependencies.queries.healthTrend(requestContext,parsed as {metric_key:string;from?:string|undefined;to?:string|undefined;limit:number});
        if(capabilityName==="health.sources")return dependencies.queries.healthSources(requestContext);
        if(capabilityName==="life.get_record"){const value=parsed as {id:string;sections?:readonly ("meal"|"purchase"|"money"|"sources")[]};return dependencies.queries.lifeRecord(requestContext,value.id,value.sections);}
        if(capabilityName==="money.planning")return dependencies.queries.moneyPlanning(requestContext,(parsed as {period:string}).period);
        if(capabilityName==="money.import_review")return dependencies.queries.moneyImportReview(requestContext,(parsed as {batch_id:string}).batch_id);
        if(capabilityName==="health.daily")return dependencies.queries.healthDaily(requestContext,(parsed as {date:string}).date);
        if(capabilityName==="travel.get_trip")return dependencies.queries.travelTrip(requestContext,(parsed as {id:string}).id);
        if(capabilityName==="library.get_item")return dependencies.queries.libraryItem(requestContext,(parsed as {id:string}).id);
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
        if(execution.success){
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
        await consume(runtime.run({threadId,runId,messageId,text:body.text.trim(),history,personalContext,capabilityProfile},controller.signal));
        if(!terminal){const reason=controller.signal.aborted?abortReason(controller.signal):"Runtime ended without a terminal event.";terminal="interrupted";await state("interrupted",{reason});}
        if(assistant)await repository.addMessage(threadId,nextId("message"),"assistant",assistant);
        await repository.finishRun(runId,terminal,terminal==="interrupted"?"Run was interrupted.":undefined);
      }catch(error){
        const message=controller.signal.aborted?abortReason(controller.signal):error instanceof Error?error.message:"Agent run failed";
        terminal="interrupted";await state("interrupted",{reason:message});
        if(assistant)await repository.addMessage(threadId,nextId("message"),"assistant",assistant);
        await repository.finishRun(runId,controller.signal.aborted?"interrupted":"failed",message);
      }finally{clearTimeout(deadline);activeRuns.delete(runId);}
    });
  });
  app.get("/api/runs/:runId",async context=>{if(!dependencies.agent)return context.json({protocol:"shadow.error",code:"not_found",message:"Run not found."},404);const requestContext=context.get("requestContext"),runId=context.req.param("runId"),run=await dependencies.agent.repository.run(requestContext.subjectId,runId);if(!run)return context.json({protocol:"shadow.error",code:"not_found",message:"Run not found."},404);const after=Number(context.req.query("after")??"0"),safeAfter=Number.isInteger(after)&&after>=0?after:0;return context.json({run,events:await dependencies.agent.repository.events(requestContext.subjectId,runId,safeAfter)});});
  app.post("/api/runs/:runId/stop",async context=>{if(!dependencies.agent)return context.json({protocol:"shadow.error",code:"not_found",message:"Run not found."},404);const requestContext=context.get("requestContext"),runId=context.req.param("runId"),run=await dependencies.agent.repository.run(requestContext.subjectId,runId);if(!run)return context.json({protocol:"shadow.error",code:"not_found",message:"Run not found."},404);const active=activeRuns.get(runId);if(active?.subjectId===requestContext.subjectId&&!active.controller.signal.aborted)active.controller.abort("stopped_by_user");return context.json({run_id:runId,status:active?"stopping":run.status});});
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
function abortReason(signal:AbortSignal):string{if(signal.reason==="stopped_by_user")return"Run stopped by the user.";if(signal.reason==="deadline_exceeded")return"Runtime deadline exceeded.";if(signal.reason==="client_disconnected")return"Client disconnected before the run completed.";return"Run was cancelled.";}
const safePreviewMediaTypes=new Set(["image/jpeg","image/png","image/gif","image/webp","image/avif","audio/mpeg","audio/mp4","audio/ogg","video/mp4","video/webm","text/plain"]);
function secureAssetHeaders(extra:Record<string,string>={}):Record<string,string>{return{"cache-control":"private, no-store","x-content-type-options":"nosniff","cross-origin-resource-policy":"same-origin","referrer-policy":"no-referrer","content-security-policy":"default-src 'none'; sandbox",...extra};}
function assetFileName(versionId:string,mediaType:string):string{const safe=versionId.replace(/[^A-Za-z0-9._-]/gu,"_").slice(0,128)||"asset",extensions:Record<string,string>={"image/jpeg":"jpg","image/png":"png","image/gif":"gif","image/webp":"webp","image/avif":"avif","audio/mpeg":"mp3","audio/mp4":"m4a","audio/ogg":"ogg","video/mp4":"mp4","video/webm":"webm","text/plain":"txt","application/pdf":"pdf","image/svg+xml":"svg","text/html":"html"};return`${safe}.${extensions[mediaType]??"bin"}`;}
