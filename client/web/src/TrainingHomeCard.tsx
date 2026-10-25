import { useEffect, useState } from "react";
import { loadMenuPlans, type MenuPlan } from "./workout-menu.js";
import { planWeekdays } from "./workout-session.js";
import "./workout-menu.css";

export function TrainingHomeCard({headers,date,onOpen}:{headers:HeadersInit;date:string;onOpen:()=>void}){
  const [plans,setPlans]=useState<MenuPlan[]>([]),[status,setStatus]=useState("loading");
  useEffect(()=>{const controller=new AbortController();void loadMenuPlans(fetch,headers,controller.signal).then(items=>{setPlans(items);setStatus("ready");}).catch(()=>{if(!controller.signal.aborted)setStatus("error");});return()=>controller.abort();},[headers]);
  const weekday=new Date(`${date}T12:00:00Z`).getUTCDay()||7,due=plans.find(plan=>planWeekdays(plan).includes(weekday));
  return <section className="training-home-card" aria-label="训练计划"><div><span className="eyebrow">YOUR TRAINING</span><h2>训练计划</h2><h3>{due?.title??(plans.length?"今天自由练 / 恢复":"今天练什么？")}</h3><p>{status==="loading"?"正在读取计划，动作库随时可用":status==="error"?"计划暂未读取，仍可进入训练":plans.length?`${plans.length} 份计划 · 按状态选择动作` :"徒手与哑铃 · 自选动作 · 逐组记录"}</p></div><button type="button" onClick={onOpen}>进入训练 <span aria-hidden="true">→</span></button></section>;
}
