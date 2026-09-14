import { useState, type FormEvent } from "react";
import { buildWorkoutCommand, initialWorkoutFields, workoutTypeLabel } from "./workout.js";
import type { Execute } from "./command-controller.js";

export function WorkoutPanel({records,date,timeZone,execute,onChanged}:{records:unknown[];date:string;timeZone:string;execute:Execute;onChanged:()=>Promise<void>}){
  const plans=records.map(objectValue).filter(value=>value.kind==="workout_plan"&&value.state==="active");
  const sessions=records.map(objectValue).filter(value=>value.kind==="workout_session").slice(0,8);
  const[fields,setFields]=useState(()=>initialWorkoutFields(date,timeZone));
  const[showEditor,setShowEditor]=useState(false);
  const[pending,setPending]=useState(false);
  const[error,setError]=useState<string>();

  async function save(event:FormEvent){
    event.preventDefault();setPending(true);setError(undefined);
    try{const built=buildWorkoutCommand(fields);await execute(built.capability,built.input,"workout:record");setFields(initialWorkoutFields(date,timeZone));setShowEditor(false);await onChanged();}
    catch(caught){setError(caught instanceof Error?caught.message:"训练保存失败");}
    finally{setPending(false);}
  }

  return <section className="workout-panel">
    <div className="panel-heading"><div><span className="eyebrow">TRAINING</span><h2>训练执行</h2></div><button type="button" className={showEditor?"secondary":""} onClick={()=>setShowEditor(value=>!value)}>{showEditor?"收起录入":"＋ 记录训练"}</button></div>
    <p>训练计划是安排；只有实际执行或设备同步记录才进入历史。</p>
    {error&&<p className="inline-error">{error}</p>}
    {showEditor&&<form className="workout-form editor-card" onSubmit={save}>{plans.length>0&&<label className="full">关联计划<select value={fields.planId} onChange={event=>setFields({...fields,planId:event.target.value})}><option value="">不关联计划</option>{plans.map(plan=><option key={String(plan.id)} value={String(plan.id)}>{String(plan.title??plan.name??plan.id)}</option>)}</select></label>}<label>训练类型<input required value={fields.sessionType} onChange={event=>setFields({...fields,sessionType:event.target.value})}/></label><label>日期<input type="date" required value={fields.occurredOn} onChange={event=>setFields({...fields,occurredOn:event.target.value})}/></label><label>时区<input required value={fields.timeZone} onChange={event=>setFields({...fields,timeZone:event.target.value})}/></label><label>时长（分钟）<input type="number" min="0" value={fields.durationMinutes} onChange={event=>setFields({...fields,durationMinutes:event.target.value})}/></label><label>距离（公里）<input inputMode="decimal" value={fields.distanceKm} onChange={event=>setFields({...fields,distanceKm:event.target.value})}/></label><label>消耗（千卡）<input inputMode="decimal" value={fields.caloriesKcal} onChange={event=>setFields({...fields,caloriesKcal:event.target.value})}/></label><label>主观强度（0–10）<input type="number" min="0" max="10" value={fields.rpe} onChange={event=>setFields({...fields,rpe:event.target.value})}/></label><label>平均心率<input type="number" min="1" value={fields.heartRateAvg} onChange={event=>setFields({...fields,heartRateAvg:event.target.value})}/></label><label className="full">执行备注<textarea value={fields.note} onChange={event=>setFields({...fields,note:event.target.value})}/></label><button disabled={pending}>{pending?"保存中…":"记录实际训练"}</button></form>}
    <h3>最近训练</h3>{sessions.length?<ul className="workout-history">{sessions.map(session=><li key={String(session.id)}><b>{workoutTypeLabel(String(session.sessionType??session.session_type??"other"))}</b><span>{String(session.occurredOn??session.occurred_on??"")}{session.durationMinutes??session.duration_minutes?` · ${String(session.durationMinutes??session.duration_minutes)} 分钟`:""}{session.planId??session.plan_id?" · 来自计划":""}</span></li>)}</ul>:<p>还没有实际训练记录。</p>}
  </section>;
}

function objectValue(value:unknown):Record<string,unknown>{return value!==null&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};}
