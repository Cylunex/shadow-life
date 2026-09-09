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
