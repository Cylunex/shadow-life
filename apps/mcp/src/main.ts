import { createInterface } from "node:readline";
import { capabilityRegistry } from "@shadow/contracts";
import { z } from "zod";

const api=(process.env.SHADOW_API_URL??"http://127.0.0.1:8787").replace(/\/$/u,"");
const token=process.env.SHADOW_ACCESS_TOKEN;
const reply=(id:unknown,result?:unknown,error?:unknown)=>process.stdout.write(`${JSON.stringify({jsonrpc:"2.0",id,...(error?{error}:{result})})}\n`);

async function visibleTools():Promise<unknown[]>{
  if(!token)throw new Error("SHADOW_ACCESS_TOKEN is required");
  const response=await fetch(`${api}/api/capabilities`,{headers:{authorization:`Bearer ${token}`}});
  if(!response.ok)throw new Error(`Capability discovery failed with HTTP ${response.status}`);
  const body=await response.json() as {capabilities:{name:string;description:string}[]};
  return Promise.all(body.capabilities.map(async item=>{
    const detail=await fetch(`${api}/api/capabilities/${encodeURIComponent(item.name)}`,{headers:{authorization:`Bearer ${token}`}});
    if(!detail.ok)throw new Error(`Capability schema failed with HTTP ${detail.status}`);
    const capability=await detail.json() as {input_schema:unknown},registered=capabilityRegistry[item.name as keyof typeof capabilityRegistry];
    return{name:item.name,description:item.description,inputSchema:registered?.idempotency==="required"?{type:"object",additionalProperties:false,required:["command_id","input"],properties:{command_id:{type:"string",description:"Stable idempotency key"},input:capability.input_schema}}:capability.input_schema};
  }));
}

function queryRequest(name:string,input:unknown,headers:Record<string,string>):Promise<Response>{
  if(name==="life.list_meals")return fetch(`${api}/api/meals?limit=${encodeURIComponent(String((input as {limit:number}).limit))}`,{headers});
  if(name==="life.food_catalog"){const value=input as {query?:string;limit:number},search=new URLSearchParams({limit:String(value.limit)});if(value.query)search.set("q",value.query);return fetch(`${api}/api/life/foods?${search}`,{headers});}
  if(name==="money.summarize")return fetch(`${api}/api/money/summary`,{headers});
  if(name==="money.records"||name==="health.records"||name==="travel.records"||name==="library.records"){const domain=name.split(".")[0],value=input as {query?:string;limit:number;cursor?:string},search=new URLSearchParams({limit:String(value.limit)});if(value.query)search.set("q",value.query);if(value.cursor)search.set("cursor",value.cursor);return fetch(`${api}/api/${domain}?${search}`,{headers});}
  if(name==="health.trend"){const value=input as {metric_key:string;from?:string;to?:string;limit:number},search=new URLSearchParams({metric_key:value.metric_key,limit:String(value.limit)});if(value.from)search.set("from",value.from);if(value.to)search.set("to",value.to);return fetch(`${api}/api/health/trend?${search}`,{headers});}
  if(name==="health.sources")return fetch(`${api}/api/health/sources`,{headers});
  if(name==="life.get_record"){const value=input as {id:string;sections?:string[]},search=new URLSearchParams();if(value.sections?.length)search.set("sections",value.sections.join(","));return fetch(`${api}/api/life/records/${encodeURIComponent(value.id)}${search.size?`?${search}`:""}`,{headers});}
  if(name==="money.planning")return fetch(`${api}/api/money/planning?period=${encodeURIComponent((input as {period:string}).period)}`,{headers});
  if(name==="money.import_review")return fetch(`${api}/api/money/imports/${encodeURIComponent((input as {batch_id:string}).batch_id)}`,{headers});
  if(name==="health.daily")return fetch(`${api}/api/health/daily/${encodeURIComponent((input as {date:string}).date)}`,{headers});
  if(name==="health.get_record")return fetch(`${api}/api/health/records/${encodeURIComponent((input as {id:string}).id)}`,{headers});
  if(name==="travel.get_trip")return fetch(`${api}/api/travel/trips/${encodeURIComponent((input as {id:string}).id)}`,{headers});
  if(name==="travel.workspace"){const value=input as {trip_id?:string},search=new URLSearchParams();if(value.trip_id)search.set("trip_id",value.trip_id);return fetch(`${api}/api/travel/workspace${search.size?`?${search}`:""}`,{headers});}
  if(name==="travel.export"){const value=input as {trip_id:string;format:string};return fetch(`${api}/api/travel/trips/${encodeURIComponent(value.trip_id)}/export?format=${encodeURIComponent(value.format)}`,{headers});}
  if(name==="travel.preview_portable")return fetch(`${api}/api/travel/portable/preview`,{method:"POST",headers,body:JSON.stringify(input)});
  if(name==="library.get_item")return fetch(`${api}/api/library/items/${encodeURIComponent((input as {id:string}).id)}`,{headers});
  if(name==="library.processing_queue"){const value=input as {kind?:string;limit:number},search=new URLSearchParams({limit:String(value.limit)});if(value.kind)search.set("kind",value.kind);return fetch(`${api}/api/library/processing?${search}`,{headers});}
  if(name==="agent.get_context_pack")return fetch(`${api}/api/agent/context-packs/${encodeURIComponent((input as {context_pack_id:string}).context_pack_id)}`,{headers});
  if(name==="agent.memories"){const value=input as {category?:string;limit:number},search=new URLSearchParams({limit:String(value.limit)});if(value.category)search.set("category",value.category);return fetch(`${api}/api/agent/memories?${search}`,{headers});}
  if(name==="notifications.list")return fetch(`${api}/api/notifications?limit=${encodeURIComponent(String((input as {limit:number}).limit))}`,{headers});
  if(name==="life.owned_items"){const value=input as {state?:string;limit:number},search=new URLSearchParams({limit:String(value.limit)});if(value.state)search.set("state",value.state);return fetch(`${api}/api/life/owned-items?${search}`,{headers});}
  if(name==="life.reviews")return fetch(`${api}/api/life/reviews?limit=${encodeURIComponent(String((input as {limit:number}).limit))}`,{headers});
  if(name==="operations.get")return fetch(`${api}/api/operations/${encodeURIComponent((input as {execution_id:string}).execution_id)}`,{headers});
  throw new Error("Query capability is not wired");
}

async function call(name:string,args:unknown):Promise<unknown>{
  if(!token)throw new Error("SHADOW_ACCESS_TOKEN is required");
  const capability=capabilityRegistry[name as keyof typeof capabilityRegistry];if(!capability)throw new Error("Unknown capability");
  const headers={authorization:`Bearer ${token}`,"content-type":"application/json"};let response:Response;
  if(capability.idempotency==="required"){const parsed=z.object({command_id:z.string(),input:z.unknown()}).strict().parse(args);response=await fetch(`${api}/api/commands/${encodeURIComponent(name)}`,{method:"POST",headers,body:JSON.stringify({protocol:"shadow.command",capability:name,...parsed})});}
  else response=await queryRequest(name,capability.inputSchema.parse(args),headers);
  const body=await response.json();if(!response.ok)throw new Error(JSON.stringify(body));return body;
}

const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
for await(const line of lines){
  if(!line.trim())continue;let message:Record<string,unknown>;try{message=JSON.parse(line) as Record<string,unknown>;}catch{continue;}
  try{
    if(message.method==="initialize")reply(message.id,{protocolVersion:"2025-06-18",capabilities:{tools:{listChanged:false}},serverInfo:{name:"shadow-life",version:"0.1.0"}});
    else if(message.method==="notifications/initialized")continue;
    else if(message.method==="tools/list")reply(message.id,{tools:await visibleTools()});
    else if(message.method==="tools/call"){const params=message.params as {name:string;arguments:unknown},result=await call(params.name,params.arguments);reply(message.id,{content:[{type:"text",text:JSON.stringify(result)}],structuredContent:result});}
    else reply(message.id,undefined,{code:-32601,message:"Method not found"});
  }catch(error){reply(message.id,undefined,{code:-32000,message:error instanceof Error?error.message:"MCP call failed"});}
}
