import {useEffect, useState, type ReactNode} from "react";
import {listMealsResultSchema} from "@shadow/contracts";
import {formatInTimeZone} from "./travel-time.js";

type Meal = ReturnType<typeof listMealsResultSchema.parse>["items"][number];
const mealLabels = {breakfast:"早餐", lunch:"午餐", dinner:"晚餐", snack:"加餐", other:"其他餐次"};

function offsetDate(day:string, days:number) {
  const date = new Date(day+"T12:00:00Z");
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}

export function MealDiary({day,onDay,headers,timeZone,refreshKey,onCapture,detail}:{
  day:string;onDay:(day:string)=>void;headers:HeadersInit;timeZone:string;refreshKey:number;
  onCapture?:(day:string)=>void;detail?:ReactNode;
}) {
  const [state,setState]=useState<{day:string;meals?:Meal[];error?:string;partial?:boolean}>();
  const [retry,setRetry]=useState(0);
  const today=formatInTimeZone(new Date(),timeZone).slice(0,10);
  const start=offsetDate(day,-((new Date(day+"T12:00:00Z").getUTCDay()+6)%7));
  const current=state?.day===day?state:undefined;
  useEffect(()=>{
    const controller=new AbortController();
    setState(undefined);
    async function read() {
      const entries=new Map<string,Meal>();
      const seen=new Set<string>();
      let cursor:string|null=null;
      do {
        const query=new URLSearchParams({occurred_on:day,limit:"100"});
        if(cursor)query.set("cursor",cursor);
        const response=await fetch(`/api/meals?${query}`,{headers,signal:controller.signal});
        if(!response.ok)throw new Error(`无法读取餐次（HTTP ${response.status}）`);
        const page=listMealsResultSchema.parse(await response.json());
        page.items.filter(meal=>meal.occurred_on===day).forEach(meal=>entries.set(meal.id,meal));
        cursor=page.items.some(meal=>meal.occurred_on<day)?null:page.next_cursor;
        if(cursor&&seen.has(cursor))throw new Error("餐次分页未能继续");
        if(cursor)seen.add(cursor);
      } while(cursor&&seen.size<20);
      if(!controller.signal.aborted)setState({day,meals:[...entries.values()],partial:cursor!==null});
    }
    void read().catch(error=>{if(!controller.signal.aborted)setState({day,error:error instanceof Error?error.message:"无法读取餐次"});});
    return()=>controller.abort();
  },[day,headers,refreshKey,retry]);
  const meals=current?.meals??[];
  const foods=meals.flatMap(meal=>meal.items);
  const energy=foods.flatMap(food=>food.energy_kcal===null?[]:[Number(food.energy_kcal)*Number(food.consumed_fraction??1)]);
  const number=new Intl.NumberFormat("zh-CN",{maximumFractionDigits:1});
  return <section className="meal-diary">
    <div className="panel-heading"><h2>饮食日记</h2>{onCapture&&<button onClick={()=>onCapture(day)}>记一餐</button>}</div>
    <div className="diary-layout">
      <div className="diary-list">
        <label>查看日期<input type="date" max={today} value={day} onChange={event=>{if(event.target.value)onDay(event.target.value);}}/></label>
        <div className="diary-week" aria-label="这一周">
          {Array.from({length:7},(_,index)=>{
            const date=offsetDate(start,index);
            return <button type="button" key={date} disabled={date>today} className="secondary" aria-label={date} aria-pressed={day===date} onClick={()=>onDay(date)}>
              <span>{"一二三四五六日"[index]}</span>{Number(date.slice(-2))}
            </button>;
          })}
        </div>
        {current?.error?<p role="alert">{current.error} <button type="button" onClick={()=>setRetry(value=>value+1)}>重试</button></p>:!current?<p role="status">正在读取当天餐次…</p>:<>
          <div className="daily-nutrition">
            <span>已记录热量</span>
            <strong>{energy.length?number.format(energy.reduce((sum,value)=>sum+value,0)):"—"} <small>kcal</small></strong>
            <small>{energy.length}／{foods.length} 项有热量{current.partial?" · 已加载餐次":""}{foods.some(food=>food.estimate)?" · 含估算":""}</small>
            <div className="diary-macros">
              {(["protein_g","carb_g","fat_g"] as const).map((key,index)=>{
                const values=foods.flatMap(food=>food[key]===null?[]:[Number(food[key])*Number(food.consumed_fraction??1)]);
                return <span key={key}>{["蛋白质","碳水","脂肪"][index]} {values.length?number.format(values.reduce((a,b)=>a+b,0))+" g":"—"}</span>;
              })}
            </div>
          </div>
          <h3>当天餐次</h3>
          {!meals.length&&<p>当天还没有餐次。</p>}
          <ul className="record-list">{meals.map(meal=><li key={meal.id}>
            <a href={`?${new URLSearchParams({tab:"record",section:"food",day,domain:"meals",kind:"meal",id:meal.id})}`}>
              <b>{mealLabels[meal.meal_type]}</b><small>{meal.items.map(food=>food.name).join("、")||"查看餐次与餐照"}</small>
            </a>
          </li>)}</ul>
        </>}
      </div>
      {detail&&<div className="diary-detail">{detail}</div>}
    </div>
  </section>;
}
