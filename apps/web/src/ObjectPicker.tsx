import { useEffect, useMemo, useState } from "react";

export type ObjectKind = "trip" | "health_plan" | "recurring_plan" | "owned_item" | "library_item" | "money_entry" | "meal" | "recipe";
export type ObjectOption = { kind: ObjectKind; id: string; revision: number; title: string; subtitle?: string };

export function ObjectPicker({kind,headers,value,onChange,optional=true,label="关联对象"}:{kind:ObjectKind;headers:HeadersInit;value:string;onChange:(option:ObjectOption|undefined)=>void;optional?:boolean;label?:string}) {
  const [options,setOptions]=useState<ObjectOption[]>([]),[query,setQuery]=useState(""),[error,setError]=useState<string>(),[loading,setLoading]=useState(false);
  useEffect(()=>{let active=true;setLoading(true);setError(undefined);void loadObjectOptions(kind,headers).then(items=>{if(active)setOptions(items)}).catch(caught=>{if(active)setError(caught instanceof Error?caught.message:"对象读取失败")}).finally(()=>{if(active)setLoading(false)});return()=>{active=false};},[kind]);
  const visible=useMemo(()=>{const needle=query.trim().toLocaleLowerCase();return needle?options.filter(item=>`${item.title} ${item.subtitle??""}`.toLocaleLowerCase().includes(needle)):options;},[options,query]);
  const selected=options.find(item=>item.id===value);
  return <div className="object-picker"><label>{label}<input value={query} onChange={event=>setQuery(event.target.value)} placeholder={loading?"正在读取…":"搜索标题、日期或说明"}/></label><div className="picker-options" role="listbox" aria-label={label}>{optional&&<button type="button" className={!value?"selected":""} onClick={()=>onChange(undefined)}>不关联</button>}{visible.map(item=><button type="button" role="option" aria-selected={item.id===value} className={item.id===value?"selected":""} key={`${item.kind}:${item.id}:${item.revision}`} onClick={()=>onChange(item)}><span><b>{item.title}</b>{item.subtitle&&<small>{item.subtitle}</small>}</span><em>v{item.revision}</em></button>)}</div>{selected&&<span className="reference-chip">{kindLabel(selected.kind)} · {selected.title} · v{selected.revision}</span>}{!loading&&!error&&!options.length&&<small>当前没有可关联的{kindLabel(kind)}。</small>}{error&&<small className="inline-error">{error}</small>}</div>;
}

export async function loadObjectOptions(kind:ObjectKind,headers:HeadersInit):Promise<ObjectOption[]> {
  const routes:Record<ObjectKind,string>={trip:"/api/travel/workspace",health_plan:"/api/health?limit=100",recurring_plan:`/api/money/planning?period=${new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit"}).format(new Date()).replace("-","-")}`,owned_item:"/api/life/owned-items?limit=100",library_item:"/api/library?limit=100",money_entry:"/api/money?limit=100",meal:"/api/meals?limit=100",recipe:"/api/life/foods?limit=100"};
  const response=await fetch(routes[kind],{headers});
  if(!response.ok)throw new Error(`读取${kindLabel(kind)}失败（HTTP ${response.status}）`);
  const body=await response.json() as Record<string,unknown>;
  const candidates=kind==="trip"?array(body.trips):kind==="recipe"?array(body.recipes):kind==="recurring_plan"?array(body.recurring_plans??body.plans):array(body.items);
  return candidates.map(object).filter(row=>accept(kind,row)).flatMap(row=>{
    const id=text(row.id??row.meal_id),revision=Number(row.revision??row.current_revision??row.currentRevision),title=text(row.title??row.name??row.counterparty??row.raw_name??row.metric_label??row.metric_key??row.kind);
    if(!id||!Number.isInteger(revision)||revision<1)return[];
    const dates=[row.starts_on,row.ends_on,row.occurred_on,row.due_on].filter(item=>typeof item==="string").join(" 至 ");
    const subtitle=[dates,text(row.state)].filter(Boolean).join(" · ");
    return[{kind,id,revision,title:title||kindLabel(kind),...(subtitle?{subtitle}:{})}];
  });
}

function accept(kind:ObjectKind,row:Record<string,unknown>):boolean {
  const value=text(row.kind??row.plan_kind);
  if(kind==="health_plan")return ["goal","habit","workout_plan","health_goal","health_habit"].includes(value);
  if(kind==="money_entry")return !value||value.includes("money")||value==="expense"||value==="income";
  return true;
}
function array(value:unknown):unknown[]{return Array.isArray(value)?value:[];}
function object(value:unknown):Record<string,unknown>{return value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function text(value:unknown):string{return typeof value==="string"||typeof value==="number"?String(value):"";}
function kindLabel(kind:ObjectKind):string{return({trip:"旅行",health_plan:"健康计划",recurring_plan:"周期事项",owned_item:"物品",library_item:"资料",money_entry:"账目",meal:"餐次",recipe:"食谱"})[kind];}
