import { useEffect, useRef, useState, type FormEvent } from "react";
import { morningWindowResultSchema } from "@shadow/contracts";
import type { Execute } from "./command-controller.js";

type Morning = ReturnType<typeof morningWindowResultSchema.parse>["days"][number];

export function MorningCheckinPanel({headers, execute, date, canWrite}:{headers:HeadersInit; execute:Execute; date:string; canWrite:boolean}) {
  const timeZone=Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [end,setEnd]=useState(date), [selected,setSelected]=useState(date);
  const [days,setDays]=useState<Morning[]>([]), [retry,setRetry]=useState(0), [error,setError]=useState("");
  const current=days.find(row=>row.wake_date===selected);
  useEffect(()=>{
    const controller=new AbortController();
    setDays([]); setError("");
    async function read() {
      const params=new URLSearchParams({to:end,time_zone:timeZone});
      const response=await fetch(`/api/health/morning-window?${params}`,{headers,signal:controller.signal});
      if(!response.ok) throw new Error("晨起记录暂时无法读取");
      const data=morningWindowResultSchema.parse(await response.json());
      if(!controller.signal.aborted) setDays(data.days);
    }
    void read().catch(cause=>{if(!controller.signal.aborted)setError(String(cause.message??cause));});
    return ()=>controller.abort();
  },[headers,end,timeZone,retry]);
  return <section className="editor-card" aria-label="睡眠与晨起感受">
    <h2>睡眠与晨起感受</h2>
    <label>查看截至<input type="date" value={end} onChange={e=>{if(e.target.value){setEnd(e.target.value);setSelected(e.target.value);}}}/></label>
    {error&&<p role="alert">{error} <button onClick={()=>setRetry(v=>v+1)}>重试</button></p>}
    {current&&<p>{current.sleep?`主睡眠 ${current.sleep.minutes} 分钟`:"当天暂无睡眠记录"}</p>}
    <details><summary>近 14 天对照</summary>
    <ul>{days.map(row=><li key={row.wake_date}><button type="button" aria-pressed={selected===row.wake_date} onClick={()=>setSelected(row.wake_date)}>
      {row.wake_date} · {row.sleep?`主睡眠 ${row.sleep.minutes} 分钟`:"无睡眠记录"} · {row.checkin?`精力 ${row.checkin.energy_level??"—"}/10 · 睡眠质量 ${row.checkin.sleep_quality??"—"}/10`:"未填晨评"}
    </button></li>)}</ul>
    </details>
    {current && (canWrite ? <MorningEditor key={current.wake_date} row={current} timeZone={timeZone} execute={execute} reload={()=>setRetry(v=>v+1)}/> : <p>{current.checkin?.notes}</p>)}
  </section>;
}

function MorningEditor({row,timeZone,execute,reload}:{row:Morning;timeZone:string;execute:Execute;reload:()=>void}) {
  const previous=row.checkin;
  const [energy,setEnergy]=useState(String(previous?.energy_level??"")), [quality,setQuality]=useState(String(previous?.sleep_quality??""));
  const [notes,setNotes]=useState(previous?.notes??""), [busy,setBusy]=useState(false), [message,setMessage]=useState("");
  const firstFill=useRef<string|undefined>(undefined);
  async function save(e:FormEvent) {
    e.preventDefault(); if(busy)return;
    setBusy(true); setMessage("");
    firstFill.current??=new Date().toISOString();
    try {
      const receipt=await execute("health.save_morning_checkin",{
        wake_date:row.wake_date,time_zone:timeZone,filled_at:previous?.filled_at??firstFill.current,
        energy_level:energy===""?null:Number(energy),sleep_quality:quality===""?null:Number(quality),notes:notes.trim()||null,
        ...(previous?{expected_revision:previous.revision}:{}),
      },`morning:${timeZone}:${row.wake_date}`);
      if(receipt.status==="committed")reload();
      else setMessage("尚未收到保存回执");
    } catch(error){setMessage(error instanceof Error?error.message:"晨评保存失败");}
    finally {setBusy(false);}
  }
  return <form className="compact-form" onSubmit={save}>
    <h3>{row.wake_date} 醒来感受</h3>
    <label>精力（0–10）<input type="number" min="0" max="10" value={energy} onChange={e=>setEnergy(e.target.value)}/></label>
    <label>睡眠质量（0–10）<input type="number" min="0" max="10" value={quality} onChange={e=>setQuality(e.target.value)}/></label>
    <label>备注<textarea maxLength={2000} value={notes} onChange={e=>setNotes(e.target.value)}/></label>
    {previous&&<small>首次填写于 {new Date(previous.filled_at).toLocaleString()}</small>}
    <button disabled={busy||(!energy&&!quality&&!notes.trim())}>保存晨评</button>
    {message&&<p role="alert">{message} <button type="button" onClick={reload}>重新读取</button></p>}
  </form>;
}
