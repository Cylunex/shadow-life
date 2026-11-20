import {useEffect, useState, type ReactNode} from "react";
import {listMealsResultSchema} from "@shadow/contracts";
import {dailyHref,offsetDate,weekStart} from "./daily-navigation.js";
import {formatInTimeZone} from "./travel-time.js";

type Meal = ReturnType<typeof listMealsResultSchema.parse>["items"][number];
const mealLabels = {breakfast:"早餐", lunch:"午餐", dinner:"晚餐", snack:"加餐", other:"其他餐次"};

export function MealDiary({day,onDay,headers,timeZone,refreshKey,onCapture,detail,canReadHealth}:{
  day:string;onDay:(day:string)=>void;headers:HeadersInit;timeZone:string;refreshKey:number;
  onCapture?:(day:string)=>void;detail?:ReactNode;canReadHealth?:boolean;
}) {
  const [state,setState]=useState<{day:string;meals?:Meal[];error?:string;partial?:boolean}>();
  const [retry,setRetry]=useState(0);
  const today=formatInTimeZone(new Date(),timeZone).slice(0,10);
  const start=weekStart(day);
  const [nutrient,setNutrient]=useState<{day:string;key:"energy_kcal"|"protein_g"|"carb_g"|"fat_g"}>();
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
  const foods=meals.flatMap(meal=>meal.items.map(item=>({meal,item})));
  const fields={energy_kcal:"热量",protein_g:"蛋白质",carb_g:"碳水",fat_g:"脂肪"} as const;
  type Key=keyof typeof fields;
  const amount=(food:Meal["items"][number],key:Key)=>food[key]===null?null:Number(food[key])*Number(food.consumed_fraction??1);
  const totals=(key:Key)=>foods.flatMap(({item})=>{const value=amount(item,key);return value===null?[]:[value];});
  const energy=totals("energy_kcal");
  const active=nutrient?.day===day?nutrient.key:undefined;
  function mealLink(id:string){return dailyHref("food",day,{domain:"meals",kind:"meal",id});}
  function selectNutrient(key:Key){setNutrient(active===key?undefined:{day,key});}
  const number=new Intl.NumberFormat("zh-CN",{maximumFractionDigits:1});
  return <section className="meal-diary">
    <div className="panel-heading"><h2>饮食日记</h2><div className="panel-actions">{canReadHealth&&<a href={dailyHref("health",day)}>查看同日健康</a>}
      {onCapture&&<button onClick={()=>onCapture(day)}>记一餐</button>}</div></div>
    <div className="diary-layout">
      <div className="diary-list">
        <label>查看日期<input type="date" max={today} value={day} onChange={event=>{if(event.target.value&&event.target.value<=today)onDay(event.target.value);}}/></label>
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
            <small>{energy.length}／{foods.length} 项有热量{current.partial?" · 已加载餐次":""}{foods.some(({item})=>item.estimate)?" · 含估算":""}</small>
            {foods.length>0&&<div className="diary-macros">
              <button type="button" className="secondary" aria-pressed={active==="energy_kcal"} onClick={()=>selectNutrient("energy_kcal")}>热量来源</button>
              {(["protein_g","carb_g","fat_g"] as const).map(key=>{
                const values=totals(key);
                return <button key={key} type="button" className="secondary" aria-pressed={active===key} onClick={()=>selectNutrient(key)}>
                  {fields[key]} {values.length?number.format(values.reduce((a,b)=>a+b,0))+" g":"—"}</button>;
              })}
            </div>}
          </div>
          {active&&<section className="diary-contributors">
            <h3>{fields[active]}来源</h3>
            <ul className="record-list">{foods.map(({item,meal})=>({item,meal,value:amount(item,active)}))
              .sort((a,b)=>(b.value??-1)-(a.value??-1)).map(({item,meal,value})=><li key={item.id}>
                <a href={mealLink(meal.id)}><span>{item.name} · {mealLabels[meal.meal_type]}</span>
                  <b>{value===null?"未记录":`${number.format(value)} ${active==="energy_kcal"?"kcal":"g"}`}{item.estimate&&value!==null?" · 估算":""}</b></a>
              </li>)}</ul>
          </section>}
          <h3>当天餐次</h3>
          {!meals.length&&<p>当天还没有餐次。</p>}
          <ul className="record-list">{meals.map(meal=><li key={meal.id}>
            <a href={mealLink(meal.id)}>
              <b>{mealLabels[meal.meal_type]}</b><small>{meal.items.map(food=>food.name).join("、")||"查看餐次与餐照"}</small>
            </a>
          </li>)}</ul>
        </>}
      </div>
      {detail&&<div className="diary-detail">{detail}</div>}
    </div>
  </section>;
}
