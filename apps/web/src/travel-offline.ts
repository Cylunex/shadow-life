import { formatInTimeZone } from "./travel-time.js";
import { itineraryDates, type TravelChecklist, type TravelDayPlan, type TravelTrip } from "./travel-workspace.js";

type Reservation={title:string;reservation_type:string;state:string;starts_at:string|null;ends_at:string|null;origin:string|null;destination:string|null;confirmation_code?:string|null;seat?:string|null};
type Segment={origin:string;destination:string;mode:string;starts_at:string|null;ends_at:string|null;note?:string|null};
type Visit={place_name:string;occurred_on:string;occurred_at:string|null;time_zone:string};
export type OfflineTripDetail={trip:Pick<TravelTrip,"title"|"starts_on"|"ends_on"|"time_zone">;reservations:Reservation[];segments:Segment[];visits:Visit[];day_plans:TravelDayPlan[]};
const escape=(value:unknown)=>String(value??"").replace(/[&<>"']/gu,char=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[char]!);
const local=(instant:string|null,zone:string)=>instant?formatInTimeZone(instant,zone).replace("T"," "):"时间待定";
const dayOf=(instant:string|null,zone:string)=>instant?formatInTimeZone(instant,zone).slice(0,10):"";

export function renderOfflineItinerary(detail:OfflineTripDetail,checklist:TravelChecklist|null):string{
  const {trip}=detail,zone=trip.time_zone,days=itineraryDates(trip,detail.day_plans);
  const rows=days.map(date=>{
    const plan=detail.day_plans.find(item=>item.plan_date===date);
    const stops=plan?.items.map((stop,index)=>`<li>${index+1}. ${escape(stop.starts_at?local(stop.starts_at,zone).slice(11):"时间待定")} · ${escape(stop.title)}${stop.note?`<small>${escape(stop.note)}</small>`:""}</li>`).join("")??"";
    const bookings=detail.reservations.filter(item=>dayOf(item.starts_at,zone)===date).map(item=>`<li>${escape(local(item.starts_at,zone).slice(11))} · ${escape(item.title)}（${escape(item.reservation_type)}，${escape(item.state)}）${item.origin||item.destination?` ${escape(item.origin)} → ${escape(item.destination)}`:""}${item.confirmation_code?`<small>确认号：${escape(item.confirmation_code)}</small>`:""}${item.seat?`<small>座位：${escape(item.seat)}</small>`:""}</li>`).join("");
    const segments=detail.segments.filter(item=>dayOf(item.starts_at,zone)===date).map(item=>`<li>${escape(local(item.starts_at,zone).slice(11))} · ${escape(item.origin)} → ${escape(item.destination)}（${escape(item.mode)}）${item.note?`<small>${escape(item.note)}</small>`:""}</li>`).join("");
    return`<section><h2>${escape(date)}</h2><h3>计划停留</h3><ol>${stops||"<li>当天尚无计划</li>"}</ol><h3>预订</h3><ul>${bookings||"<li>暂无按开始时间归入当天的预订</li>"}</ul><h3>交通</h3><ul>${segments||"<li>暂无按开始时间归入当天的交通</li>"}</ul></section>`;
  }).join("");
  const unknownBookings=detail.reservations.filter(item=>!item.starts_at).map(item=>`<li>${escape(item.title)}（${escape(item.state)}）</li>`).join("");
  const unknownSegments=detail.segments.filter(item=>!item.starts_at).map(item=>`<li>${escape(item.origin)} → ${escape(item.destination)}</li>`).join("");
  const checks=checklist?.items.map(item=>`<li>☐ ${escape(item.title)}（${escape(({needed:"待准备",packed:"已备好",skipped:"无需准备"})[item.state])}）${item.note?`<small>${escape(item.note)}</small>`:""}</li>`).join("")??"";
  const visits=detail.visits.map(item=>`<li>${escape(item.occurred_on)} · ${escape(item.place_name)}${item.occurred_at?` · ${escape(local(item.occurred_at,item.time_zone))}`:""}</li>`).join("");
  return`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(trip.title)} · 离线行程单</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:2rem auto;padding:0 1rem;color:#18202b}h1,h2{line-height:1.25}section{border-top:1px solid #c8d0da;padding:1rem 0}li{margin:.4rem 0}small{display:block;color:#526071}button{display:none}@media print{body{margin:0}}</style></head><body><h1>${escape(trip.title)}</h1><p>${escape(trip.starts_on)} 至 ${escape(trip.ends_on)} · 时区 ${escape(zone)}</p><p>本文件是下载时可见事实的静态副本；离线可打开。计划停留与实际到访分开记录。</p><section><h2>旅程清单</h2><ul>${checks||"<li>暂无清单</li>"}</ul></section>${rows}<section><h2>未定时间</h2><h3>预订</h3><ul>${unknownBookings||"<li>无</li>"}</ul><h3>交通</h3><ul>${unknownSegments||"<li>无</li>"}</ul></section><section><h2>实际到访（独立记录）</h2><ul>${visits||"<li>暂无实际到访记录</li>"}</ul></section></body></html>`;
}
