import { z } from "zod";
import { capabilityRegistry, type CapabilityName } from "./registry.js";

export type CapabilityHttpRequest={method:"GET"|"POST";url:string;body?:string};
type ReadRoute=(input:any)=>Omit<CapabilityHttpRequest,"url">&{path:string};
const search=(values:Record<string,unknown>):string=>{const result=new URLSearchParams();for(const[key,value]of Object.entries(values)){if(value===undefined||value===null||value==="")continue;result.set(key,Array.isArray(value)?value.join(","):String(value));}const encoded=result.toString();return encoded?`?${encoded}`:"";};
const get=(path:string):ReturnType<ReadRoute>=>({method:"GET",path});
const post=(path:string,input:unknown):ReturnType<ReadRoute>=>({method:"POST",path,body:JSON.stringify(input)});

export const queryTransportRegistry:Readonly<Record<string,ReadRoute>>={
  "life.today":input=>get(`/api/today${search({date:input.date,time_zone:input.time_zone,domains:input.domains})}`),
  "life.daily_record_check":input=>post("/api/life/daily-record-check",input),
  "life.timeline":input=>get(`/api/timeline${search({domains:input.domains,limit:input.limit,cursor:input.cursor})}`),
  "life.search":input=>get(`/api/search${search({q:input.q,types:input.types,from_on:input.from_on,to_on_exclusive:input.to_on_exclusive,limit:input.limit,cursor:input.cursor})}`),
  "life.consumption_stats":input=>get(`/api/life/consumption-stats${search({from_on:input.from_on,to_on_exclusive:input.to_on_exclusive,time_zone:input.time_zone,scopes:input.scopes,categories:input.categories,merchant_rank_by:input.merchant_rank_by,item_rank_by:input.item_rank_by,currency:input.currency,limit:input.limit})}`),
  "life.list_meals":input=>get(`/api/meals${search({limit:input.limit,cursor:input.cursor})}`),
  "life.food_catalog":input=>get(`/api/life/foods${search({q:input.query,limit:input.limit})}`),
  "money.summarize":()=>get("/api/money/summary"),
  "money.records":input=>get(`/api/money${search({q:input.query,limit:input.limit,cursor:input.cursor})}`),
  "health.records":input=>get(`/api/health${search({q:input.query,limit:input.limit,cursor:input.cursor})}`),
  "travel.records":input=>get(`/api/travel${search({q:input.query,limit:input.limit,cursor:input.cursor})}`),
  "library.records":input=>get(`/api/library${search({q:input.query,limit:input.limit,cursor:input.cursor})}`),
  "health.get_record":input=>get(`/api/health/records/${encodeURIComponent(input.id)}`),
  "health.release_history":input=>get(`/api/health/releases${search({from:input.from,to:input.to,limit:input.limit})}`),
  "health.trend":input=>get(`/api/health/trend${search({metric_key:input.metric_key,from:input.from,to:input.to,limit:input.limit})}`),
  "health.sources":()=>get("/api/health/sources"),
  "life.get_record":input=>get(`/api/life/records/${encodeURIComponent(input.id)}${search({sections:input.sections})}`),
  "money.service_cards":input=>get(`/api/money/service-cards${search(input)}`),
  "money.planning":input=>get(`/api/money/planning${search({period:input.period})}`),
  "money.import_review":input=>get(`/api/money/imports/${encodeURIComponent(input.batch_id)}`),
  "health.daily":input=>get(`/api/health/daily/${encodeURIComponent(input.date)}`),
  "health.sleep_insights":input=>get(`/api/health/sleep-insights${search({to:input.to,days:input.days})}`),
  "travel.get_trip":input=>get(`/api/travel/trips/${encodeURIComponent(input.id)}`),
  "travel.workspace":input=>get(`/api/travel/workspace${search({trip_id:input.trip_id})}`),
  "travel.export":input=>get(`/api/travel/trips/${encodeURIComponent(input.trip_id)}/export${search({format:input.format})}`),
  "travel.preview_portable":input=>post("/api/travel/portable/preview",input),
  "library.get_item":input=>get(`/api/library/items/${encodeURIComponent(input.id)}`),
  "library.processing_queue":input=>get(`/api/library/processing${search({kind:input.kind,limit:input.limit})}`),
  "agent.get_context_pack":input=>get(`/api/agent/context-packs/${encodeURIComponent(input.context_pack_id)}`),
  "agent.memories":input=>get(`/api/agent/memories${search({category:input.category,limit:input.limit})}`),
  "notifications.list":input=>get(`/api/notifications${search({limit:input.limit,cursor:input.cursor})}`),
  "life.owned_items":input=>get(`/api/life/owned-items${search({id:input.id,state:input.state,limit:input.limit})}`),
  "life.reviews":input=>get(`/api/life/reviews${search({id:input.id,limit:input.limit})}`),
  "life.projects":input=>get(`/api/life/projects${search({id:input.id,state:input.state,limit:input.limit})}`),
  "life.planning_agenda":input=>get(`/api/planning/agenda${search({from_on:input.from_on,to_on_exclusive:input.to_on_exclusive,time_zone:input.time_zone,limit:input.limit})}`),
  "life.meal_planning":input=>get(`/api/life/meal-planning${search({limit:input.limit})}`),
  "money.foreign_entries":input=>get(`/api/money/foreign${search({trip_id:input.trip_id,limit:input.limit})}`),
  "operations.find":input=>get(`/api/operations/by-command/${encodeURIComponent(input.command_id)}`),
  "operations.get":input=>get(`/api/operations/${encodeURIComponent(input.execution_id)}`)
};

export function buildCapabilityHttpRequest(baseUrl:string,name:CapabilityName,args:unknown):CapabilityHttpRequest{
  const capability=capabilityRegistry[name];if(!capability)throw new Error(`Unknown capability: ${name}`);
  const base=baseUrl.replace(/\/$/u,"");
  if(capability.idempotency==="required"){
    const parsed=z.object({command_id:z.string(),input:z.unknown()}).strict().parse(args);
    const command=capability.commandSchema.parse({protocol:"shadow.command",capability:name,...parsed});
    return{method:"POST",url:`${base}/api/commands/${encodeURIComponent(name)}`,body:JSON.stringify(command)};
  }
  const route=queryTransportRegistry[name];if(!route)throw new Error(`Query capability is not wired: ${name}`);
  const parsed=capability.inputSchema.parse(args);const request=route(parsed);return{...request,url:base+request.path};
}

export function parseCapabilityResult(name:CapabilityName,value:unknown):unknown{return capabilityRegistry[name].resultSchema.parse(value);}

export function assertCompleteQueryTransport():void{const missing=Object.entries(capabilityRegistry).filter(([,capability])=>capability.idempotency==="not-applicable").map(([name])=>name).filter(name=>queryTransportRegistry[name]===undefined);if(missing.length)throw new Error(`Missing query transports: ${missing.join(", ")}`);const extra=Object.keys(queryTransportRegistry).filter(name=>capabilityRegistry[name as CapabilityName]?.idempotency!=="not-applicable");if(extra.length)throw new Error(`Invalid query transports: ${extra.join(", ")}`);}
