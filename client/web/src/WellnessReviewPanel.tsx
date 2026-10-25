import { useEffect, useState } from "react";
import { buildCapabilityHttpRequest, wellnessNutrients, wellnessReviewResultSchema, type WellnessReviewResult } from "@shadow/contracts";
import "./wellness-review.css";

const labels = {energy_kcal:"热量",protein_g:"蛋白质",fat_g:"脂肪",carb_g:"碳水",fiber_g:"膳食纤维",sodium_mg:"钠"};
const unit = (key:string)=>key==="energy_kcal"?"kcal":key==="sodium_mg"?"mg":"g";
const show = (value:string|number|null|undefined)=>value==null?"未知":String(value).replace(/(\.\d*?[1-9])0+$|\.0+$/u,"$1");
function sourceLink(kind:string,id:string) {return `?${new URLSearchParams({tab:"record",section:"timeline",domain:"health",kind,id})}`;}

export function WellnessReviewPanel({headers,date}:{headers:HeadersInit;date:string}) {
  const [to,setTo]=useState(date),[days,setDays]=useState<7|30|90>(7),[retry,setRetry]=useState(0);
  const [result,setResult]=useState<{key:string;data:WellnessReviewResult}>(),[error,setError]=useState<{key:string;message:string}>();
  const key=`${to}:${days}:${retry}`;
  useEffect(()=>{
    const controller=new AbortController();
    async function load(){try{
      const request=buildCapabilityHttpRequest("","life.wellness_review",{to,days});
      const response=await fetch(request.url,{headers,signal:controller.signal});
      if(!response.ok)throw new Error(`复盘读取失败（${response.status}）`);
      const data=wellnessReviewResultSchema.parse(await response.json());
      if(!controller.signal.aborted){setError(undefined);setResult({key,data});}
    }catch(caught){if(!controller.signal.aborted)setError({key,message:caught instanceof Error?caught.message:"复盘读取失败"});}}
    void load();return()=>controller.abort();
  },[to,days,headers,key]);
  const data=result?.key===key?result.data:undefined, message=error?.key===key?error.message:undefined;
  return <section className="wellness-review" aria-label="健康与饮食复盘">
    <div className="panel-heading"><div><span className="eyebrow">HEALTH & NUTRITION</span><h2>健康与饮食复盘</h2><p>把吃饭、体重、睡眠和训练放在一起，先看记录覆盖，再看变化。</p></div></div>
    <div className="wellness-filters"><label>截至日期<input type="date" min="0002-01-01" value={to} onChange={event=>setTo(event.target.value)}/></label><fieldset><legend>复盘范围</legend>{([7,30,90] as const).map(value=><button type="button" key={value} aria-pressed={days===value} onClick={()=>setDays(value)}>{value} 天</button>)}</fieldset></div>
    {message?<p role="alert">{message} <button type="button" onClick={()=>setRetry(value=>value+1)}>重试</button></p>:!data?<p role="status">正在汇总这段时间的记录…</p>:<>
      <p>{data.current.from} — {data.current.to} · 前期 {data.previous.from} — {data.previous.to}</p>
      <div className="wellness-metrics">
        <article><span>有饮食记录</span><strong>{data.current.meal_days} / {days} 天</strong><small>{data.current.meals} 餐 · {data.current.items} 个条目</small></article>
        <article><span>每日最后体重均值</span><strong>{show(data.current.average_weight_kg)} kg</strong><small>{data.current.weight_days} 天 · 前期 {show(data.previous.average_weight_kg)} kg（{data.previous.weight_days} 天）</small></article>
        <article><span>主睡眠均值</span><strong>{show(data.current.average_sleep_minutes)} 分钟</strong><small>{data.current.sleep_days} 天 · 前期 {show(data.previous.average_sleep_minutes)} 分钟（{data.previous.sleep_days} 天）</small></article>
        <article><span>实际训练</span><strong>{data.current.workout_sessions} 次</strong><small>{data.current.workout_minutes===null?"时长未知":`已知 ${data.current.workout_minutes} 分钟`} · {data.current.known_workout_duration_sessions} / {data.current.workout_sessions} 次有时长；前期 {data.previous.workout_sessions} 次</small></article>
      </div>
      <h3>营养记录与前期对照</h3><p>均值仅计算已记录条目中该字段齐全的日期，仍可能有漏记；估算也包含在内。不同覆盖的均值不能直接当作摄入增减。</p>
      <div className="wellness-table" tabIndex={0} aria-label="营养覆盖和前期对照"><table><thead><tr><th>营养</th><th>已知合计</th><th>字段覆盖</th><th>其中估算</th><th>齐全日期均值</th><th>前期均值</th></tr></thead><tbody>{wellnessNutrients.map(key=>{const current=data.current.nutrients[key],previous=data.previous.nutrients[key];return <tr key={key}><th>{labels[key]} ({unit(key)})</th><td>{show(current.known_total)}</td><td>{current.known_items} / {data.current.items} 项</td><td>{current.estimated_items} 项</td><td>{show(current.average_on_complete_days)} · {current.complete_days} 天</td><td>{show(previous.average_on_complete_days)} · {previous.complete_days} 天</td></tr>})}</tbody></table></div>
      <p>热量字段齐全且同日有体重：{data.current.paired_energy_weight_days} 天；同日有睡眠：{data.current.paired_energy_sleep_days} 天。同日出现不代表因果关系。</p>
      <details><summary>逐日记录与来源（{data.days.length} 天）</summary><div className="wellness-table" tabIndex={0} aria-label="逐日记录"><table><thead><tr><th>日期</th><th>餐次</th><th>已知热量 / 覆盖</th><th>体重</th><th>主睡眠</th><th>训练</th></tr></thead><tbody>{data.days.map(day=><tr key={day.date}><th>{day.date}</th><td>{day.meals}{day.empty_meals>0?`（${day.empty_meals} 餐无条目）`:""}</td><td>{show(day.nutrients.energy_kcal.known_total)} kcal · {day.nutrients.energy_kcal.known_items}/{day.items}</td><td>{day.weight?<a href={sourceLink(day.weight.kind,day.weight.id)}>{show(day.weight.value)} kg</a>:"未知"}</td><td>{day.sleep?<a href={sourceLink("sleep_session",day.sleep.id)}>{day.sleep.minutes} 分钟</a>:"未知"}</td><td>{day.workouts.sessions} 次 · {show(day.workouts.minutes)} 分钟</td></tr>)}</tbody></table></div></details>
      <details><summary>统计口径</summary><ul>{data.limitations.map(note=><li key={note}>{note}</li>)}</ul><small>数据时点：{new Date(data.as_of).toLocaleString()}</small></details>
    </>}
  </section>;
}
