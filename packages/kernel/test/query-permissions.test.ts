import assert from "node:assert/strict";
import test from "node:test";
import { QueryService, type RequestContext, type TransactionStore, type UnitOfWork } from "../src/index.js";

function context(effects:string[]):RequestContext{return{actorId:"subject_test",subjectId:"subject_test",clientId:"client_test",traceId:"trace_test",effects:new Set(effects)};}

test("agent context performs no personal fact query without its read effects",async()=>{
  let reads=0;const unit={read:async()=>{reads++;throw new Error("must not read");}} as unknown as UnitOfWork;
  assert.deepEqual(await new QueryService(unit).agentPersonalContext(context(["agent.run"])),{aliases:[],mealTemplates:[]});assert.equal(reads,0);
});

test("agent context selects only fact kinds authorized for the run",async()=>{
  const calls:Array<{kinds:readonly string[];templates:boolean}>=[];const store={agentPersonalContext:async(_subject:string,kinds:readonly string[],templates:boolean)=>{calls.push({kinds,templates});return{aliases:[],mealTemplates:[]};}} as unknown as TransactionStore;const unit={read:async<T>(work:(value:TransactionStore)=>Promise<T>)=>work(store)} as unknown as UnitOfWork,queries=new QueryService(unit);
  await queries.agentPersonalContext(context(["agent.run","money.entry.read"]));assert.deepEqual(calls.pop(),{kinds:["merchant","payment_method"],templates:false});
  await queries.agentPersonalContext(context(["agent.run","life.meal.read"]));assert.deepEqual(calls.pop(),{kinds:["food","meal_template"],templates:true});
});

test("money planning rejects impossible months before reading storage",async()=>{
  let reads=0;const unit={read:async()=>{reads++;return{};}} as unknown as UnitOfWork,queries=new QueryService(unit);
  await assert.rejects(()=>queries.moneyPlanning(context(["money.entry.read"]),"2026-13"),(error:unknown)=>(error as {detail?:{code?:string}}).detail?.code==="validation");
  assert.equal(reads,0);
});

test("health record detail authorizes before looking up provenance",async()=>{let reads=0;const store={healthRecord:async()=>{reads++;return{kind:"measurement",fact:{id:"health_12345678",value:"68.4"},source:null,raw:null};}} as unknown as TransactionStore,unit={read:async<T>(work:(value:TransactionStore)=>Promise<T>)=>work(store)} as unknown as UnitOfWork,queries=new QueryService(unit);await assert.rejects(()=>queries.healthRecord(context([]),"health_12345678"),(error:unknown)=>(error as {detail?:{code?:string}}).detail?.code==="permission_denied");assert.equal(reads,0);assert.equal((await queries.healthRecord(context(["health.measurement.read"]),"health_12345678") as {kind:string}).kind,"measurement");assert.equal(reads,1);});

test("food catalog authorizes and validates before storage",async()=>{let reads=0;const store={foodCatalog:async()=>{reads++;return{foods:[],recipes:[],as_of:"2026-09-10T00:00:00Z"};}} as unknown as TransactionStore,unit={read:async<T>(work:(value:TransactionStore)=>Promise<T>)=>work(store)} as unknown as UnitOfWork,queries=new QueryService(unit);await assert.rejects(()=>queries.foodCatalog(context([]),{}),(error:unknown)=>(error as {detail?:{code?:string}}).detail?.code==="permission_denied");await assert.rejects(()=>queries.foodCatalog(context(["life.meal.read"]),{limit:101}),(error:unknown)=>(error as {detail?:{code?:string}}).detail?.code==="validation");assert.equal(reads,0);assert.deepEqual(await queries.foodCatalog(context(["life.meal.read"]),{}),{foods:[],recipes:[],as_of:"2026-09-10T00:00:00Z"});assert.equal(reads,1);});

test("overview queries read only explicitly authorized domains",async()=>{
  const calls:{today?:readonly string[];timeline?:readonly string[]}={};const store={
    lifeToday:async(_subject:string,date:string,_zone:string,domains:readonly string[])=>{calls.today=domains;return{date,domains:{money:{entries:0,totals:[],freshness:null}},as_of:"2026-09-10T00:00:00Z"};},
    lifeTimeline:async(_subject:string,domains:readonly string[])=>{calls.timeline=domains;return{items:[],hasMore:false,asOf:"2026-09-10T00:00:00Z"};}
  } as unknown as TransactionStore,unit={read:async<T>(work:(value:TransactionStore)=>Promise<T>)=>work(store)} as unknown as UnitOfWork,queries=new QueryService(unit),moneyContext=context(["money.entry.read"]);
  await queries.lifeToday(moneyContext,{date:"2026-09-10",time_zone:"Asia/Shanghai"});assert.deepEqual(calls.today,["money"]);
  await queries.lifeTimeline(moneyContext,{});assert.deepEqual(calls.timeline,["money"]);
  await assert.rejects(()=>queries.lifeToday(moneyContext,{date:"2026-09-10",time_zone:"Asia/Shanghai",domains:["health"]}),(error:unknown)=>(error as {detail?:{code?:string}}).detail?.code==="permission_denied");
});

test("timeline cursor is bound to the authorized domain selection",async()=>{
  let reads=0;const store={lifeTimeline:async()=>{reads++;return{items:[{domain:"money",kind:"money_entry",id:"money_12345678",happened_at:"2026-09-10T00:00:00Z",title:"餐饮",amount:"20.00",currency:"CNY",record_id:"record_12345678"}],hasMore:true,asOf:"2026-09-10T01:00:00Z"};}} as unknown as TransactionStore,unit={read:async<T>(work:(value:TransactionStore)=>Promise<T>)=>work(store)} as unknown as UnitOfWork,queries=new QueryService(unit),readContext=context(["money.entry.read","health.measurement.read"]);
  const first=await queries.lifeTimeline(readContext,{domains:["money"],limit:1});assert.ok(first.next_cursor);assert.equal(reads,1);
  await assert.rejects(()=>queries.lifeTimeline(readContext,{domains:["health"],limit:1,cursor:first.next_cursor}),(error:unknown)=>(error as {detail?:{code?:string}}).detail?.code==="validation");assert.equal(reads,1);
});

test("travel workspace and portable export authorize before storage",async()=>{let reads=0;const store={travelWorkspace:async()=>{reads++;return{places:[],maps:[],trips:[],selected_trip_id:null,active_run:null,tracks:[],as_of:"2026-09-10T00:00:00Z"};},travelExportData:async()=>{reads++;return{trip:{id:"trip_12345678",title:"杭州",starts_on:"2026-10-01",ends_on:"2026-10-03",time_zone:"Asia/Shanghai",note:null,revision:1},places:[],maps:[],reservations:[],segments:[],visits:[],day_plans:[],plan_versions:[],tracks:[]};}} as unknown as TransactionStore,unit={read:async<T>(work:(value:TransactionStore)=>Promise<T>)=>work(store)} as unknown as UnitOfWork,queries=new QueryService(unit);await assert.rejects(()=>queries.travelWorkspace(context([]),{}),(error:unknown)=>(error as {detail?:{code?:string}}).detail?.code==="permission_denied");await assert.rejects(()=>queries.travelExport(context([]),{trip_id:"trip_12345678",format:"ics"}),(error:unknown)=>(error as {detail?:{code?:string}}).detail?.code==="permission_denied");await assert.rejects(()=>queries.previewTravelPortable(context([]),{format:"gpx",content:"<gpx/>"}),(error:unknown)=>(error as {detail?:{code?:string}}).detail?.code==="permission_denied");assert.equal(reads,0);const exported=await queries.travelExport(context(["travel.trip.read"]),{trip_id:"trip_12345678",format:"ics"});assert.match(exported.content,/UID:trip_12345678@shadow-life/u);assert.equal(reads,1);const preview=await queries.previewTravelPortable(context(["travel.trip.read"]),{format:"gpx",content:'<gpx><trkpt lat="30" lon="120"></trkpt></gpx>'}) as {points:number;bounds:{south:number;east:number}};assert.equal(preview.points,1);assert.deepEqual(preview.bounds,{south:30,west:120,north:30,east:120});assert.equal(reads,1);});

test("library processor queue requires both processor and asset permissions",async()=>{let reads=0;const store={libraryProcessingQueue:async()=>{reads++;return{items:[],as_of:"2026-09-10T00:00:00Z"};}} as unknown as TransactionStore,unit={read:async<T>(work:(value:TransactionStore)=>Promise<T>)=>work(store)} as unknown as UnitOfWork,queries=new QueryService(unit);await assert.rejects(()=>queries.libraryProcessingQueue(context(["library.processor.write"]),{}),(error:unknown)=>(error as {detail?:{code?:string}}).detail?.code==="permission_denied");assert.equal(reads,0);assert.deepEqual(await queries.libraryProcessingQueue(context(["library.processor.write","library.asset.read"]),{}),{items:[],as_of:"2026-09-10T00:00:00Z"});assert.equal(reads,1);});

test("owned item details and stored reviews are trimmed by current read effects",async()=>{let visibility:unknown,domains:readonly string[]=[];const store={ownedItems:async(_subject:string,_state:string|undefined,_limit:number,value:unknown)=>{visibility=value;return{items:[]};},lifeReviews:async(_subject:string,_limit:number,value:readonly string[])=>{domains=value;return{items:[]};}} as unknown as TransactionStore,unit={read:async<T>(work:(value:TransactionStore)=>Promise<T>)=>work(store)} as unknown as UnitOfWork,queries=new QueryService(unit);await assert.rejects(()=>queries.ownedItems(context([]),{}),(error:unknown)=>(error as {detail?:{code?:string}}).detail?.code==="permission_denied");await queries.ownedItems(context(["life.item.read","library.item.read"]),{});assert.deepEqual(visibility,{purchase:false,library:true,money:false});await queries.lifeReviews(context(["life.review.read","life.item.read","money.entry.read"]),{});assert.deepEqual(domains,["money","items"]);});
