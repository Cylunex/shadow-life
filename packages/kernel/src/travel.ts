import { createHash } from "node:crypto";

export interface DraftTripPlanItem {stop_id?:string|undefined;title:string;starts_at?:string|undefined;place_id?:string|undefined;note?:string|undefined;}
export interface DraftTripPlanDay {id:string;plan_date:string;items:readonly DraftTripPlanItem[];}
export interface PublishedTripPlanItem extends DraftTripPlanItem {stop_id:string;}
export interface PublishedTripPlan {days:{plan_date:string;items:PublishedTripPlanItem[]}[];stop_count:number;}

function historicalStopId(dayPlanId:string,position:number):string{return `trip_stop_${createHash("sha256").update(`${dayPlanId}:${position}`).digest("hex").slice(0,24)}`;}
function stopSignature(item:DraftTripPlanItem):string{return JSON.stringify([item.title,item.starts_at??null,item.place_id??null]);}

export function assignTripStopIds(existing:readonly DraftTripPlanItem[],incoming:readonly DraftTripPlanItem[],nextId:()=>string):PublishedTripPlanItem[]{
  const candidates=new Map<string,string[]>(),incomingCounts=new Map<string,number>();
  for(const item of existing){if(item.stop_id){const key=stopSignature(item),values=candidates.get(key)??[];values.push(item.stop_id);candidates.set(key,values);}}
  for(const item of incoming){const key=stopSignature(item);incomingCounts.set(key,(incomingCounts.get(key)??0)+1);}
  const assigned=incoming.map(item=>{const key=stopSignature(item),matches=candidates.get(key)??[],stopId=item.stop_id??(matches.length===1&&incomingCounts.get(key)===1?matches[0]!:nextId());return{...item,stop_id:stopId};});
  if(new Set(assigned.map(item=>item.stop_id)).size!==assigned.length)throw new Error("Day plan contains duplicate stop ids");return assigned;
}

export function tripRunIsComplete(expected:Set<string>,actual:Iterable<string>):boolean{const outcomes=new Set(actual);return outcomes.size===expected.size&&[...expected].every(id=>outcomes.has(id));}

export function publishTripPlan(days:readonly DraftTripPlanDay[]):PublishedTripPlan{
  if(days.length===0)throw new Error("A trip plan needs at least one day");
  const stopIds=new Set<string>();let stopCount=0;
  const published=days.map(day=>({plan_date:day.plan_date,items:day.items.map((item,position)=>{const stopId=item.stop_id??historicalStopId(day.id,position);if(stopIds.has(stopId))throw new Error(`Duplicate trip stop id: ${stopId}`);stopIds.add(stopId);stopCount++;return{...item,stop_id:stopId};})})).sort((left,right)=>left.plan_date.localeCompare(right.plan_date));
  if(stopCount===0)throw new Error("A trip plan needs at least one stop");
  return{days:published,stop_count:stopCount};
}

export function tripPlanStopIds(snapshot:unknown):Set<string>{
  if(!snapshot||typeof snapshot!=="object"||!Array.isArray((snapshot as {days?:unknown}).days))throw new Error("Published trip plan is invalid");
  const ids=new Set<string>();for(const day of (snapshot as {days:unknown[]}).days){if(!day||typeof day!=="object"||!Array.isArray((day as {items?:unknown}).items))throw new Error("Published trip plan day is invalid");for(const item of (day as {items:unknown[]}).items){const id=item&&typeof item==="object"?(item as {stop_id?:unknown}).stop_id:undefined;if(typeof id!=="string"||ids.has(id))throw new Error("Published trip stop identity is invalid");ids.add(id);}}
  if(ids.size===0)throw new Error("Published trip plan has no stops");return ids;
}
