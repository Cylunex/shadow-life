import { useEffect, useState, type FormEvent } from "react";
import type { TripConnection } from "@shadow/contracts";
import { connectionModes, connectionDescription, fetchConnections } from "./travel-connections.js";
import type { Execute } from "./command-controller.js";
import { formatInTimeZone, parseInTimeZone } from "./travel-time.js";
import type { TravelDayPlan } from "./travel-workspace.js";
import type { TravelReservation } from "./travel-reservations.js";

export function TravelConnections({headers,tripId,zone,day,bookings,canWrite,execute}:{headers:HeadersInit;tripId:string;zone:string;day:TravelDayPlan;bookings:TravelReservation[];canWrite:boolean;execute:Execute}){
  const [rows,setRows]=useState<TripConnection[]>([]),[loaded,setLoaded]=useState(false),[retry,setRetry]=useState(0),[error,setError]=useState("");
  const [editing,setEditing]=useState(false),[from,setFrom]=useState(day.items[0]?.stop_id??""),[target,setTarget]=useState("");
  const [departure,setDeparture]=useState(""),[travel,setTravel]=useState(""),[buffer,setBuffer]=useState("0");
  const [mode,setMode]=useState<TripConnection["mode"]>("walk"),[busy,setBusy]=useState(false);
  const next=day.items[day.items.findIndex(stop=>stop.stop_id===from)+1];
  const bookingIds=bookings.filter(item=>item.state==="confirmed"&&item.id);
  useEffect(()=>{
    const controller=new AbortController();
    setLoaded(false);
    void fetchConnections(tripId,headers,controller.signal).then(result=>{
      if(controller.signal.aborted)return;
      setError("");setRows(result.items.filter(item=>item.day_plan_id===day.id));setLoaded(true);
    }).catch(cause=>{if(!controller.signal.aborted)setError(String(cause));});
    return ()=>controller.abort();
  },[headers,tripId,day.id,day.revision,bookings,retry]);
  function fill(origin:string,destination:string) {
    setFrom(origin);setTarget(destination);
    const existing=rows.find(r=>r.from_stop_id===origin&&(r.to_stop_id??r.reservation_id)===destination);
    setDeparture(existing?formatInTimeZone(existing.departure_at,zone):"");
    setTravel(String(existing?.travel_minutes??""));setBuffer(String(existing?.buffer_minutes??0));setMode(existing?.mode??"walk");
  }
  async function save(event:FormEvent) {
    event.preventDefault();if(!loaded||busy)return;setBusy(true);setError("");
    try{
      const old=rows.find(r=>r.from_stop_id===from&&(r.to_stop_id??r.reservation_id)===target);
      const receipt=await execute("travel.save_connection",{
        trip_id:tripId,day_plan_id:day.id,plan_revision:day.revision,from_stop_id:from,
        ...(next?.stop_id===target?{to_stop_id:target}:{reservation_id:target}),
        ...(old?{expected_revision:old.revision}:{}),departure_at:parseInTimeZone(departure,zone),
        mode,travel_minutes:travel===""?null:Number(travel),buffer_minutes:Number(buffer),
      },`connection:${day.id}:${from}:${target}`);
      if(receipt.status==="committed"){setEditing(false);setRetry(n=>n+1);}
    }catch(cause){setError(cause instanceof Error?cause.message:"保存失败");}finally{setBusy(false);}
  }
  return <section aria-label="行程衔接"><h3>行程衔接</h3>
    {rows.map(row=><p key={row.id}>{row.from_title??"原停留点"} → {row.to_title??"原目的地"} · {connectionModes[row.mode]} {row.travel_minutes??"—"} 分钟 · 提前 {row.buffer_minutes} 分钟 · <strong>{connectionDescription(row)}</strong>
      {canWrite&&loaded&&row.status!=="check_stops"&&row.status!=="check_booking"&&<button type="button" onClick={()=>{fill(row.from_stop_id,(row.to_stop_id??row.reservation_id)!);setEditing(true);}}>调整估时</button>}</p>)}
    {error&&<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>重新读取</button></p>}
    {canWrite&&day.items.length>0&&!editing&&<button type="button" disabled={!loaded} onClick={()=>{fill(day.items[0]!.stop_id,"");setEditing(true);}}>添加衔接</button>}
    {editing&&<form className="compact-form" onSubmit={save}>
      <label>从哪里离开<select value={from} onChange={e=>fill(e.target.value,"")}>{day.items.map(s=><option key={s.stop_id} value={s.stop_id}>{s.title}</option>)}</select></label>
      <label>要赶到哪里<select required value={target} onChange={e=>fill(from,e.target.value)}><option value="">选择下一站或预订</option>{next&&<option value={next.stop_id}>{next.title}</option>}{bookingIds.map(b=><option key={b.id} value={b.id}>{b.title}</option>)}</select></label>
      <label>预计离开（{zone}）<input required type="datetime-local" value={departure} onChange={e=>setDeparture(e.target.value)}/></label>
      <label>交通方式<select value={mode} onChange={e=>setMode(e.target.value as TripConnection["mode"])}>{Object.entries(connectionModes).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
      <label>交通分钟<input type="number" min="0" max="10080" value={travel} onChange={e=>setTravel(e.target.value)}/></label>
      <label>提前到达分钟<input required type="number" min="0" max="10080" value={buffer} onChange={e=>setBuffer(e.target.value)}/></label>
      <button disabled={busy||!loaded}>保存衔接</button><button type="button" onClick={()=>setEditing(false)}>收起</button>
    </form>}
  </section>;
}
