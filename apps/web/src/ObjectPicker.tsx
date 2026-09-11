import { useEffect, useState } from "react";

export type ObjectKind = "trip" | "health_plan" | "recurring_plan" | "owned_item" | "library_item" | "money_entry" | "purchase_item" | "meal" | "recipe";
export type ObjectOption = { kind: ObjectKind; id: string; revision: number; title: string; subtitle?: string };
type ObjectPage={items:ObjectOption[];nextCursor:string|null};

export function ObjectPicker({kind,headers,value,onChange,optional=true,label="关联对象",refreshKey=""}:{kind:ObjectKind;headers:HeadersInit;value:string;onChange:(option:ObjectOption|undefined)=>void;optional?:boolean;label?:string;refreshKey?:string}) {
  const[options,setOptions]=useState<ObjectOption[]>([]),[query,setQuery]=useState(""),[cursor,setCursor]=useState<string|null>(null),[error,setError]=useState<string>(),[loading,setLoading]=useState(false);
  useEffect(()=>{let active=true;const timer=setTimeout(()=>{setLoading(true);setError(undefined);void loadObjectOptions(kind,headers,query).then(page=>{if(active){setOptions(page.items);setCursor(page.nextCursor);}}).catch(caught=>{if(active)setError(caught instanceof Error?caught.message:"对象读取失败")}).finally(()=>{if(active)setLoading(false)});},250);return()=>{active=false;clearTimeout(timer)};},[kind,query,refreshKey]);
  async function more(){if(!cursor)return;setLoading(true);setError(undefined);try{const page=await loadObjectOptions(kind,headers,query,cursor);setOptions(current=>[...current,...page.items.filter(item=>!current.some(existing=>existing.id===item.id))]);setCursor(page.nextCursor);}catch(caught){setError(caught instanceof Error?caught.message:"对象读取失败");}finally{setLoading(false);}}
  const selected=options.find(item=>item.id===value);
  return <div className="object-picker"><label>{label}<input value={query} onChange={event=>setQuery(event.target.value)} placeholder={loading?"正在读取…":"输入关键词从服务端搜索"}/></label><div className="picker-options" role="listbox" aria-label={label}>{optional&&<button type="button" className={!value?"selected":""} onClick={()=>onChange(undefined)}>不关联</button>}{options.map(item=><button type="button" role="option" aria-selected={item.id===value} className={item.id===value?"selected":""} key={`${item.kind}:${item.id}:${item.revision}`} onClick={()=>onChange(item)}><span><b>{item.title}</b>{item.subtitle&&<small>{item.subtitle}</small>}</span><em>v{item.revision}</em></button>)}</div>{cursor&&<button type="button" className="secondary" disabled={loading} onClick={()=>void more()}>加载更多</button>}{selected&&<span className="reference-chip">{kindLabel(selected.kind)} · {selected.title} · v{selected.revision}</span>}{!loading&&!error&&!options.length&&<small>当前没有匹配的{kindLabel(kind)}。</small>}{error&&<small className="inline-error">{error}</small>}</div>;
}

export async function loadObjectOptions(kind:ObjectKind,headers:HeadersInit,query="",cursor?:string):Promise<ObjectPage> {
  const generic:Partial<Record<ObjectKind,{route:string;recordKind:string}>>={trip:{route:"/api/travel",recordKind:"trip"},health_plan:{route:"/api/health",recordKind:"health_plan"},library_item:{route:"/api/library",recordKind:"library_item"},money_entry:{route:"/api/money",recordKind:"money_entry"}};
  const source=generic[kind];
  let route:string;
  if(source){const params=new URLSearchParams({limit:"50"});if(query.trim())params.set("q",query.trim());if(cursor)params.set("cursor",cursor);route=`${source.route}?${params}`;}
  else {const q=query.trim()?`&q=${encodeURIComponent(query.trim())}`:"",routes:Partial<Record<ObjectKind,string>>={recurring_plan:`/api/money/planning?period=${new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit"}).format(new Date())}`,owned_item:`/api/life/owned-items?limit=100${q}`,purchase_item:`/api/life/purchase-items?limit=100${q}`,meal:"/api/meals?limit=100",recipe:`/api/life/foods?limit=100${q}`};route=routes[kind]??"/api/meals?limit=100";}
  const response=await fetch(route,{headers});
  if(!response.ok)throw new Error(`读取${kindLabel(kind)}失败（HTTP ${response.status}）`);
  const body=await response.json() as Record<string,unknown>;
  let candidates=kind==="recipe"?array(body.recipes):kind==="recurring_plan"?array(body.recurring_plans??body.plans):array(body.items);
  if(source)candidates=candidates.filter(value=>{const row=object(value),actual=text(row.kind);return kind==="health_plan"?["habit_plan","goal","workout_plan"].includes(actual):actual===source.recordKind;});
  if(!source&&kind!=="recipe"&&query.trim()){const needle=query.trim().toLocaleLowerCase();candidates=candidates.filter(value=>JSON.stringify(value).toLocaleLowerCase().includes(needle));}
  const items=candidates.map(object).filter(row=>accept(kind,row)).flatMap(row=>{
    const id=text(row.id??row.meal_id),revision=Number(row.revision??row.current_revision??row.currentRevision),title=text(row.title??row.name??row.counterparty??row.raw_name??row.metric_label??row.metric_key??row.kind);
    if(!id||!Number.isInteger(revision)||revision<1)return[];
    const dates=[row.starts_on,row.ends_on,row.occurred_on,row.due_on].filter(item=>typeof item==="string").join(" 至 "),subtitle=[dates,text(row.state)].filter(Boolean).join(" · ");
    return[{kind,id,revision,title:title||kindLabel(kind),...(subtitle?{subtitle}:{})}];
  });
  return{items,nextCursor:source&&typeof body.next_cursor==="string"?body.next_cursor:null};
}

function accept(kind:ObjectKind,row:Record<string,unknown>):boolean {
  const value=text(row.kind??row.plan_kind);
  if(kind==="health_plan")return ["goal","habit_plan","workout_plan","health_goal","health_habit"].includes(value);
  if(kind==="money_entry")return value==="money_entry"||value==="expense"||value==="income";
  return true;
}
function array(value:unknown):unknown[]{return Array.isArray(value)?value:[];}
function object(value:unknown):Record<string,unknown>{return value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
function text(value:unknown):string{return typeof value==="string"||typeof value==="number"?String(value):"";}
function kindLabel(kind:ObjectKind):string{return({trip:"旅行",health_plan:"健康计划",recurring_plan:"周期事项",owned_item:"物品",library_item:"资料",money_entry:"账目",purchase_item:"购买明细",meal:"餐次",recipe:"食谱"})[kind];}
