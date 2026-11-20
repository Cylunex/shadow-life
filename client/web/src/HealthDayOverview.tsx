import {useEffect,useState} from "react";
import {healthDailyResultSchema} from "@shadow/contracts";
import {dailyHref,offsetDate,weekStart} from "./daily-navigation.js";
import {formatInTimeZone} from "./travel-time.js";

type HealthDay=ReturnType<typeof healthDailyResultSchema.parse>;
const activityLabel:Record<string,string>={walking:"步行",walk:"步行",running:"跑步",run:"跑步",cycling:"骑行",strength:"力量训练"};
export function HealthDayOverview({day,today,headers,onDay,canOpenRecords,canReadMeals,version}:{
  day:string;today:string;headers:HeadersInit;onDay:(value:string)=>void;canOpenRecords:boolean;canReadMeals:boolean;version:number
}){
  const [retry,setRetry]=useState(0);
  const [read,setRead]=useState<{day:string;version:number;retry:number;data?:HealthDay;error?:string}>();
  useEffect(()=>{
    const controller=new AbortController(),identity={day,version,retry};
    async function load(){
      const response=await fetch(`/api/health/daily/${day}`,{headers,signal:controller.signal});
      if(response.status===404){if(!controller.signal.aborted)setRead(identity);return;}
      if(!response.ok)throw new Error(`无法读取当天健康记录（HTTP ${response.status}）`);
      const data=healthDailyResultSchema.parse(await response.json());
      if(data.occurred_on!==day)throw new Error("返回的健康日期与所选日期不同");
      if(!controller.signal.aborted)setRead({...identity,data});
    }
    void load().catch(error=>{if(!controller.signal.aborted)setRead({...identity,error:String(error instanceof Error?error.message:error)});});
    return()=>controller.abort();
  },[day,version,retry,headers]);
  const current=read?.day===day&&read.version===version&&read.retry===retry?read:undefined;
  const data=current?.data?.result;
  const start=weekStart(day);
  const metric=(title:string,value:number|string|null|undefined,unit:string)=><div><small>{title}</small><strong>{value??"—"} {value!=null&&unit}</strong></div>;
  const record=(kind:string,id:string,label:string)=>canOpenRecords
    ?<a href={dailyHref("health",day,{domain:"health",kind,id})}>{label}</a>
    :<span>{label}</span>;
  return <section className="health-card daily-health-card">
    <div className="panel-heading"><h3>{day===today?"今日健康":"当日健康"}</h3>
      {canReadMeals&&<a href={dailyHref("food",day)}>查看同日饮食</a>}</div>
    <label className="workspace-date">查看日期<input type="date" value={day} max={today} onChange={e=>{if(e.target.value&&e.target.value<=today)onDay(e.target.value);}}/></label>
    <div className="diary-week" aria-label="这一周">{Array.from({length:7},(_,i)=>{
      const date=offsetDate(start,i);
      return <button type="button" key={date} className="secondary" aria-label={date} disabled={date>today}
        aria-pressed={date===day} onClick={()=>onDay(date)}><span>{"一二三四五六日"[i]}</span>{Number(date.slice(-2))}</button>;
    })}</div>
    {current?.error?<p role="alert">{current.error} <button onClick={()=>setRetry(n=>n+1)}>重试</button></p>
      :!current?<p role="status">正在读取当天健康记录…</p>:!data?<p>当天没有已同步的健康记录。</p>:<>
      {data.activity&&<div className="event-metrics">{metric("步数",data.activity.steps,"步")}{metric("活跃时间",data.activity.active_minutes,"分钟")}
        {metric("活动热量",data.activity.calories_kcal,"kcal")}</div>}
      <ul className="record-list health-day-facts">
        {data.sleep&&<li>{record("sleep_session",data.sleep.id,`主睡眠 · ${data.sleep.total_minutes} 分钟 · 按醒来日`)}</li>}
        {data.facts.filter(item=>item.key==="weight").map(item=><li key={item.id}>{record(item.kind,item.id,`体重 · ${item.value} ${item.unit}`)}</li>)}
        {data.workouts.map(item=><li key={item.id}>{record("workout_session",item.id,[
          activityLabel[item.session_type]??item.session_type,
          item.started_at&&formatInTimeZone(new Date(item.started_at),item.time_zone??"UTC").slice(11,16),
          item.duration_minutes==null?"时长未记录":`${item.duration_minutes} 分钟`
        ].filter(Boolean).join(" · "))}</li>)}
      </ul>
    </>}
  </section>;
}
