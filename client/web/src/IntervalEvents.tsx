import {useEffect,useState} from "react";
import {intervalResultSchema,type IntervalEvent} from "@shadow/contracts";
import type {Execute} from "./command-controller.js";

const zone=Intl.DateTimeFormat().resolvedOptions().timeZone;
const localDay=()=>new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
type Occurrence=IntervalEvent["history"][number];
export function IntervalEvents({headers,execute,capabilities}:{headers:HeadersInit;execute:Execute;capabilities:ReadonlySet<string>}){
  const parameters=new URLSearchParams(location.search),source=parameters.get("occurrence_source"),sourceId=parameters.get("occurrence_source_id");
  const linked=Boolean(sourceId&&(source==="owned_item_event"||source==="service_card_use"));
  const [open,setOpen]=useState(linked),[events,setEvents]=useState<IntervalEvent[]>([]),[selected,setSelected]=useState("");
  const [name,setName]=useState(""),[date,setDate]=useState(localDay),[note,setNote]=useState("");
  const [edit,setEdit]=useState<Occurrence>(),[history,setHistory]=useState<Occurrence[]>([]),[more,setMore]=useState(false);
  const [revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [after,setAfter]=useState<string>(),[next,setNext]=useState<string|null>(null),[offset,setOffset]=useState(0);
  const active=events.find(e=>e.id===selected),today=localDay();
  function reset(){setEdit(undefined);setNote("");setDate(localDay());setOffset(0);}
  useEffect(()=>{
    if(!open)return;
    const ctrl=new AbortController();
    const params=new URLSearchParams({as_of:today,...(after?{after_id:after}:{})});
    void fetch(`/api/life/interval-events?${params}`,{headers,signal:ctrl.signal}).then(async response=>{
      if(!response.ok)throw new Error("事项读取失败");const data=intervalResultSchema.parse(await response.json());
      if(ctrl.signal.aborted)return;
      setEvents(prev=>after?[...prev,...data.events.filter(e=>!prev.some(x=>x.id===e.id))]:data.events);setNext(data.next);
    }).catch(e=>{if(!ctrl.signal.aborted)setError(String(e));});return ()=>ctrl.abort();
  },[open,headers,after,revision,today]);
  useEffect(()=>{
    if(!open||!selected)return;
    const ctrl=new AbortController(),params=new URLSearchParams({as_of:today,event_id:selected,offset:String(offset),history_limit:"20"});
    void fetch(`/api/life/interval-events?${params}`,{headers,signal:ctrl.signal}).then(async response=>{
      if(!response.ok)throw new Error("发生记录读取失败");const item=intervalResultSchema.parse(await response.json()).events[0];
      if(!ctrl.signal.aborted){setHistory(item?.history??[]);setMore(item?.more_history??false);}
    }).catch(e=>{if(!ctrl.signal.aborted)setError(String(e));});return ()=>ctrl.abort();
  },[open,selected,headers,revision,offset,today]);
  async function write(capability:"life.save_interval_event"|"life.record_occurrence",input:Record<string,unknown>){
    setBusy(true);setError("");
    try{const result=await execute(capability,input,`interval:${selected}:${edit?.id??""}`);
      if(result.status==="committed"){
        if(capability==="life.save_interval_event"){setName("");setSelected(String(result.actual_values.event_id));}
        reset();setAfter(undefined);setRevision(n=>n+1);
      }
    }catch(e){setError(e instanceof Error?e.message:"保存失败");}finally{setBusy(false);}
  }
  function record(occurredOn:string,voided=false,link=false){
    const ref=edit?.source_kind?{source_kind:edit.source_kind,source_id:edit.source_id}:link?{source_kind:source,source_id:sourceId}:undefined;
    return write("life.record_occurrence",{event_id:selected,time_zone:edit?.time_zone??zone,...(ref??{occurred_on:occurredOn}),
      ...(edit?.occurred_at&&edit.occurred_on===occurredOn?{occurred_at:edit.occurred_at}:{}),note,
      ...(edit?{occurrence_id:edit.id,expected_revision:edit.revision,voided}:{})});
  }
  return <details open={open} onToggle={e=>setOpen(e.currentTarget.open)} className="detail-meta"><summary>上次是什么时候</summary>
    {capabilities.has("life.save_interval_event")&&<form onSubmit={e=>{e.preventDefault();void write("life.save_interval_event",{name:name.trim()});}}>
      <label>新事项<input required maxLength={160} placeholder="换滤芯" value={name} onChange={e=>setName(e.target.value)}/></label><button disabled={busy}>创建事项</button></form>}
    <label>选择事项<select value={selected} onChange={e=>{setSelected(e.target.value);reset();setHistory([]);}}>
      <option value="">请选择</option>{events.map(e=><option key={e.id} value={e.id}>{e.name}{e.archived?"（归档）":""}</option>)}</select></label>
    {next&&<button onClick={()=>setAfter(next)}>更多事项</button>}
    {selected&&<section><h3>{active?.name??"事项记录"}</h3>
      {active?.history[0]&&<p>上次 {active.history[0].occurred_on} · 距今 {active.history[0].days_ago} 天</p>}
      {capabilities.has("life.record_occurrence")&&(!active?.archived||edit)&&<>
        {!edit&&<button disabled={busy} onClick={()=>void record(today)}>今天做了</button>}
        {!edit&&linked&&<button disabled={busy} onClick={()=>void record(today,false,true)}>关联这次{source==="service_card_use"?"核销":"物品事件"}</button>}
        <form onSubmit={e=>{e.preventDefault();void record(date);}}>
          <label>发生日期<input type="date" required max={today} value={date} disabled={!!edit?.source_kind} onChange={e=>setDate(e.target.value)}/></label>
          <label>发生备注<input maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>
          <button disabled={busy}>{edit?"保存更正":"补记一次"}</button>{edit&&<><button type="button" disabled={busy} onClick={()=>void record(date,true)}>撤销这次记录</button><button type="button" onClick={reset}>取消编辑</button></>}
        </form></>}
      <ol>{history.map(row=><li key={row.id}>{row.occurred_on}{row.interval_days!==null?` · 与上次间隔 ${row.interval_days} 天`:""} {row.note} {row.source_kind==="service_card_use"?"次卡核销":row.source_kind==="owned_item_event"?"物品事件":""}
        {capabilities.has("life.record_occurrence")&&<button onClick={()=>{setEdit(row);setDate(row.occurred_on);setNote(row.note??"");}}>更正记录</button>}</li>)}</ol>
      {offset>0&&<button onClick={()=>setOffset(n=>Math.max(0,n-20))}>上一页</button>}{more&&<button onClick={()=>setOffset(n=>n+20)}>更早记录</button>}
      {active&&capabilities.has("life.save_interval_event")&&<button disabled={busy} onClick={()=>void write("life.save_interval_event",{event_id:selected,name:active.name,expected_revision:active.revision,archived:!active.archived})}>{active.archived?"恢复事项":"归档事项"}</button>}
    </section>}{error&&<p role="alert">{error} <button onClick={()=>setRevision(n=>n+1)}>重新读取</button></p>}</details>;
}

export function intervalLink(kind:"owned_item_event"|"service_card_use",id:string){
  return `?${new URLSearchParams({tab:"record",section:"timeline",occurrence_source:kind,occurrence_source_id:id})}`;
}
