import { createHash } from "node:crypto";
export type CaptureReviewFact={id:string;kind:string;title:string;started_at:string;ended_at:string;text:string|null;stamp:string};
export function captureReviewSignature(facts:CaptureReviewFact[]){return createHash("sha256").update(JSON.stringify([...facts].sort((a,b)=>a.id.localeCompare(b.id)))).digest("hex");}
export function buildCaptureReview(facts:CaptureReviewFact[],zone:string,period:string){
 const stamp=(date:string)=>new Intl.DateTimeFormat("sv-SE",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(new Date(date));
 const buckets=new Map<string,CaptureReviewFact[]>();
 for(const fact of [...facts].sort((a,b)=>a.started_at.localeCompare(b.started_at)||a.id.localeCompare(b.id))){const local=stamp(fact.started_at),minute=Number(local.slice(-2)),key=local.slice(0,-2)+String(Math.floor(minute/10)*10).padStart(2,"0");buckets.set(key,[...(buckets.get(key)??[]),fact]);}
 const days=new Map<string,Map<string,Array<[string,CaptureReviewFact[]]>>>();
 for(const [key,items] of buckets){const day=key.slice(0,10),hour=key.slice(11,13);if(!days.has(day))days.set(day,new Map());const hours=days.get(day)!;hours.set(hour,[...(hours.get(hour)??[]),[key,items]]);}
 const sourceRefs:Array<{id:string;title:string;started_at:string}>=[];
 const cite=(item:CaptureReviewFact)=>{sourceRefs.push({id:item.id,title:item.title,started_at:item.started_at});return `来源 ${sourceRefs.length}`;};
 const lines=[`${({day:"日",week:"周",month:"月"} as Record<string,string>)[period]}回顾 · ${facts.length} 项可见来源`,"仅根据已采集内容整理；未记录时段保持未知。","跨期区间归入本期内的起点，不将跨片段活动重复统计。"];
 if(!facts.length)lines.push("所选期间没有可见采集记录。");
 for(const [day,hours] of days){lines.push(`\n${day} · 日概览：${[...new Set([...hours.values()].flatMap(groups=>groups.flatMap(([,items])=>items.map(v=>v.title))))].slice(0,8).join("；")}`);
  if(period==="month"){const sample=[...hours.values()][0]?.[0]?.[1]?.[0];if(sample)lines.push(`依据：${cite(sample)}；可按日查看小时与十分钟材料。`);continue;}
  for(const [hour,groups] of hours){lines.push(`${hour}:00 · 小时主线：${[...new Set(groups.flatMap(([,items])=>items.map(v=>v.title)))].slice(0,5).join("；")}`);
   if(period==="week"){const sample=groups[0]?.[1]?.[0];if(sample)lines.push(`依据：${cite(sample)}；可按日查看十分钟材料。`);continue;}
   for(const [key,items] of groups){lines.push(`  ${key.slice(11)} · 十分钟材料`);for(const item of items.slice(0,3))lines.push(`  - ${item.title.slice(0,80)}${item.text?`：${item.text.replaceAll("\n"," ").slice(0,80)}`:""}（${cite(item)}）`);if(items.length>3)lines.push(`  另有 ${items.length-3} 项来源，可在活动记录按时间查看。`);}}
 }
 return {body:lines.join("\n"),source_refs:sourceRefs};
}
