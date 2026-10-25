import { useEffect, useRef, useState } from "react";
import type { TimelineItem } from "./dashboard.js";
import { selectionHref } from "./record-detail.js";

type DayRelated={domain:TimelineItem["domain"]|"items"|"plans";kind:string;id:string;title:string};
type DayItem=Omit<TimelineItem,"domain">&{domain:TimelineItem["domain"]|"items"|"plans";happened_on?:string;years_ago?:number;related?:DayRelated[]};
type DayResult={items:DayItem[];total:number;next_cursor:string|null;authorized_domains:string[]};
const today=()=>new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
const zone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone;
const labels:Record<string,string>={meals:"饮食",money:"消费",health:"健康",travel:"旅行",library:"资料",items:"物品",plans:"计划执行"};
function sourceHref(item:DayRelated&{record_id?:string}):string{
  if(item.domain==="items")return `?tab=record&section=items&item=${encodeURIComponent(item.record_id??item.id)}`;
  if(item.domain==="plans")return `?tab=plan&section=projects&project=${encodeURIComponent(item.record_id??item.id)}`;
  if(item.domain==="library")return `?tab=library&section=browse&item=${encodeURIComponent(item.id)}`;
  return selectionHref(item as TimelineItem);
}
export function DayMemoryPanel({headers}:{headers:HeadersInit}){
  const [date,setDate]=useState(today),[day,setDay]=useState<DayResult>(),[memories,setMemories]=useState<DayItem[]>([]),[error,setError]=useState<string>(),[loading,setLoading]=useState(false);
  const requestSequence=useRef(0);
  async function read(cursor?:string){const sequence=++requestSequence.current;setLoading(true);setError(undefined);try{
    const base=`date=${encodeURIComponent(date)}&time_zone=${encodeURIComponent(zone())}`;
    const response=await fetch(`/api/life/day?${base}&limit=30${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`,{headers});if(!response.ok)throw new Error(`读取某一天失败（HTTP ${response.status}）`);
    const value=await response.json() as DayResult;if(sequence!==requestSequence.current)return;setDay(current=>cursor&&current?{items:[...current.items,...value.items],total:value.total,next_cursor:value.next_cursor,authorized_domains:value.authorized_domains}:value);
    if(!cursor){const recall=await fetch(`/api/life/memories?${base}`,{headers});if(!recall.ok)throw new Error(`读取往日回忆失败（HTTP ${recall.status}）`);const recalled=(await recall.json()) as {items:DayItem[]};if(sequence===requestSequence.current)setMemories(recalled.items);}
  }catch(caught){if(sequence===requestSequence.current)setError(caught instanceof Error?caught.message:"读取失败");}finally{if(sequence===requestSequence.current)setLoading(false);}}
  useEffect(()=>{setDay(undefined);setMemories([]);void read();},[date]);
  return <section className="day-memory wide"><div className="panel-heading"><div><span className="eyebrow">A DAY IN LIFE</span><h3>某一天</h3></div><label>本地日期<input type="date" value={date} onChange={event=>setDate(event.target.value)}/></label></div><small>按 {zone()} 的日期查看已授权记录。日期记录保留原日；有时刻的记录按当前时区归日。</small>{error&&<p className="inline-error">{error}</p>}<h4>{date} · {day?.authorized_domains.length?day.total:"—"} 条记录</h4>{day?.items.length?<ul className="record-list">{day.items.map(item=><li key={`${item.domain}:${item.kind}:${item.id}`}><a href={sourceHref(item)}><b>{labels[item.domain]??item.domain}</b> · {item.title}<small>{item.amount?` · ${item.currency} ${item.amount}`:""} · 查看来源</small></a>{item.related?.length?<small>显式关联：{item.related.map(link=><a key={`${link.domain}:${link.id}`} href={sourceHref(link)}>{link.title}</a>)}</small>:null}</li>)}</ul>:<p>{loading?"正在读取…":day?.authorized_domains.length?"这一天没有可显示的授权记录。":"当前没有可读取的领域。"}</p>}{day?.next_cursor&&<button type="button" className="secondary" disabled={loading} onClick={()=>void read(day.next_cursor!)}>加载更多</button>}<h4>往日回忆</h4>{memories.length?<ul className="record-list">{memories.map(item=><li key={`recall:${item.years_ago}:${item.domain}:${item.id}`}><a href={sourceHref(item)}><b>{item.years_ago} 年前 · {labels[item.domain]??item.domain}</b> · {item.title}<small>{item.happened_on} · 查看原记录</small></a></li>)}</ul>:<p>过去五年同日没有可显示的来源。</p>}</section>;
}
