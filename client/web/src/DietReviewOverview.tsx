import { useEffect, useRef, useState, type FormEvent } from "react";
import { dietDiaryKey, dietDiaryStatements, dietFoodGroupLabels, weighingScheduleSchema, type DietReviewResult } from "@shadow/contracts";
import type { Execute } from "./command-controller.js";

type Weight = NonNullable<DietReviewResult["weight"]>;
type Point = Weight["morning"][number];
const format = (value:number) => new Intl.NumberFormat("zh-CN",{maximumFractionDigits:2}).format(value);
const waistStatements = {maintain:"维持腰围",gain:"增加腰围",lose:"减小腰围"} as const;
const goalStatements = {maintain:"维持体重",gain:"增加体重",lose:"降低体重"} as const;
const compositionLabels = {body_fat:"体脂率",muscle_mass:"肌肉量",body_water_rate:"体水分率",visceral_fat:"内脏脂肪"} as const;
const diaryLabels = {unknown:"完整性待确认",complete:"已基本记全",partial:"还有漏记",recheck:"餐次曾移动或撤销，请重新核对"} as const;
const trendLabels = {up:"持续上行",down:"持续下行",steady:"近期平稳",uncertain:"继续观察"} as const;
const recordHref=(domain:string,kind:string,id:string)=>"?" + new URLSearchParams({tab:"record",section:"timeline",domain,kind,id});

function WeightChart({weight}:{weight:Weight}) {
  const chart=useRef<HTMLCanvasElement>(null);
  const morning=weight.morning,evening=weight.evening;
  useEffect(()=>{
    const canvas=chart.current;
    if(!canvas)return;
    const draw=()=>{
      const ctx=canvas.getContext("2d");
      if(!ctx)return;
      const {width,height}=canvas.getBoundingClientRect(),ratio=window.devicePixelRatio||1;
      canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
      ctx.scale(ratio,ratio);
      const left=39,right=width-14,top=12,bottom=height-28;
      const first=morning[0]?.date??evening[0]?.date;
      const dates=[weight.weeks[0]!.from,first,evening[0]?.date].filter((date):date is string=>!!date).sort();
      const from=Date.parse(dates[0]!), to=Date.parse(weight.weeks.at(-1)!.to);
      const values=[...morning,...evening].flatMap(p=>[p.kg,p.smoothed_kg]);
      const min=Math.floor(Math.min(...values)-0.2),max=Math.ceil(Math.max(...values)+0.2);
      const x=(date:string)=>left+(right-left)*Math.max(0,(Date.parse(date)-from)/(to-from));
      const y=(kg:number)=>bottom-(kg-min)/(max-min)*(bottom-top);
      ctx.font="11px system-ui";
      for(const sample of [min,(min+max)/2,max]){
        ctx.strokeStyle="#85848855";ctx.beginPath();ctx.moveTo(left,y(sample));ctx.lineTo(right,y(sample));ctx.stroke();
        ctx.fillStyle=getComputedStyle(canvas).color;ctx.fillText(format(sample),2,y(sample)+4);
      }
      const axis=[dates[0]!,weight.weeks[2]!.from,weight.weeks.at(-1)!.to];
      ctx.fillStyle=getComputedStyle(canvas).color;
      axis.forEach((date,index)=>{ctx.textAlign=index===0?"left":index===axis.length-1?"right":"center";ctx.fillText(date.slice(5),index===0?left:index===axis.length-1?right:x(date),height-7);});
      const plot=(points:Point[],color:string,smoothed:boolean)=>{
        ctx.strokeStyle=color;ctx.fillStyle=color;ctx.lineWidth=2;
        if(smoothed){
          ctx.beginPath();
          points.forEach((point,index)=>{if(index===0)ctx.moveTo(x(point.date),y(point.smoothed_kg));else ctx.lineTo(x(point.date),y(point.smoothed_kg));});
          ctx.stroke();
        }
        for(const point of points){
          ctx.beginPath();ctx.arc(x(point.date),y(point.kg),smoothed?3:2.6,0,Math.PI*2);ctx.fill();
        }
      };
      plot(evening,"#a47bed",false);plot(morning,"#30b981",true);
    };
    const resize=new ResizeObserver(draw);resize.observe(canvas);
    draw();
    return()=>resize.disconnect();
  },[weight,morning,evening]);
  return <><div className="diet-chart-key"><span>晨重及平滑线</span><span>晚重</span></div>
    <canvas className="diet-chart" ref={chart} role="img" aria-label="近四周晨重和晚重走势，屏幕阅读器可展开下方称重数据"/>
    <details><summary>查看称重数据</summary><div className="wellness-table"><table><thead><tr><th>归属日</th><th>时段</th><th>体重</th></tr></thead><tbody>
      {[...morning.map(point=>({point,band:"晨间"})),...evening.map(point=>({point,band:"晚间"}))].sort((a,b)=>b.point.date.localeCompare(a.point.date)).map(({point,band})=><tr key={point.id}><th>{point.date}</th><td>{band}</td><td><a href={recordHref("health","observation",point.id)}>{format(point.kg)} kg</a></td></tr>)}
    </tbody></table></div></details></>;
}

export function DietReviewOverview({data,date,canWrite,execute,reload}:{data:DietReviewResult;date:string;canWrite:boolean;execute:Execute;reload:()=>void}) {
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const declaration=data.diary.find(day=>day.date===date);
  const weight=data.weight, latest=weight?.morning.at(-1);
  const week=weight?.weeks.at(-1), previous=weight?.weeks.at(-2);
  const day=data.wellness.days.find(row=>row.date===date);
  const lunch=data.lunches.at(-1);
  const currentGoal=weight?.goal??null;
  const energy=data.energy;
  const [waistDirection,setWaistDirection]=useState<keyof typeof waistStatements>(weight?.waist_goal?.direction??"lose");
  const [schedule,setSchedule]=useState(weight?.settings?.schedule);
  const [direction,setDirection]=useState<keyof typeof goalStatements>(currentGoal?.direction??"maintain");
  const [lower,setLower]=useState(energy.lower?.toString()??""),[upper,setUpper]=useState(energy.upper?.toString()??"");
  const windowDays=data.wellness.current.days;
  const knownEnergy=day?.nutrients.energy_kcal.known_total;

  async function save(key:string,kind:"preference"|"goal",statement:string,original:{id:string;revision:number}|null,validity:Record<string,string>={}) {
    if(busy)return;
    setBusy(true);setError("");
    try {
      await execute("agent.set_intention",{scope:"health",kind,category:"dietary",key,assertion:"explicit",statement,...validity,
        ...(original?{id:original.id,expected_revision:original.revision,reason:"本人更新饮食复盘设置"}:{})},key);
      reload();
    }catch(caught){setError(caught instanceof Error?caught.message:"保存失败，请重试");}
    finally{setBusy(false);}
  }
  function saveDiary(state:keyof typeof dietDiaryStatements) {
    const end=new Date(Date.parse(date)+86400000).toISOString().slice(0,10);
    return save(dietDiaryKey(date,data.time_zone),"preference",dietDiaryStatements[state],declaration?.declaration??null,{valid_from:date,valid_to_exclusive:end});
  }
  function saveEnergy(event:FormEvent) {
    event.preventDefault();
    if(!/^[1-9]\d{0,4}$/u.test(lower)||!/^[1-9]\d{0,4}$/u.test(upper)||Number(lower)>Number(upper)){setError("请输入从低到高的整数热量范围");return;}
    void save("wellness.energy","goal",`每日热量 ${lower}–${upper} kcal`,energy.target,{valid_from:data.wellness.current.to});
  }
  return <div className="diet-overview">
    <section className="diet-lead">
      <div><h3>下一顿怎么吃</h3><strong>{data.next_meal?.text??(lunch?"今天的记录还不足以给出具体搭配建议":"记下一顿午餐后，就能按实吃的菜和份量看搭配")}</strong>
      {data.next_meal?.meal&&<p><a href={recordHref("meals","meal",data.next_meal.meal.id)}>查看作为参考的午餐</a></p>}</div>
      <div className="diet-coverage"><span>饮食覆盖</span><strong>{data.recorded_complete_days} <small>/ {windowDays} 天基本记全</small></strong>
      <span>{data.complete_energy_days} 天热量可完整比较</span></div>
    </section>
    <div className="diet-grid">
      <section className="diet-card" aria-label="食物组覆盖">
        <h3>食物组出现天数</h3>
        <p>{data.wellness.current.meal_days} 天有餐食记录 · {data.unclassified_days} 天含未分类条目或空餐</p>
        {data.food_groups.map(row=><div className="diet-group" key={row.group}>
          <span>{dietFoodGroupLabels[row.group]}</span><meter min={0} max={windowDays} value={row.days} aria-label={dietFoodGroupLabels[row.group]}/>
          <strong>{row.days} 天</strong>
        </div>)}
        {!!data.micronutrients?.length&&<details><summary>钙与铁的记录覆盖</summary><ul>{data.micronutrients.map(nutrient=><li key={nutrient.nutrient}>
          {nutrient.nutrient==="calcium_mg"?"钙":"铁"} · {nutrient.known_total===null?"摄入未知":`已知 ${format(nutrient.known_total)} mg`} · {nutrient.known_items}/{data.wellness.current.items} 项有值
          {nutrient.estimated_items>0&&`，其中 ${nutrient.estimated_items} 项估算`}
        </li>)}</ul></details>}
        <details><summary>{data.menu ? data.menu.merchant+" · " : ""}已记录午餐（{data.lunch_count}）</summary>
          {lunch&&<p>最近一餐 {lunch.date.slice(5)} · {lunch.estimated_items} 项估算，{lunch.classified_items}/{lunch.items} 项可辨认</p>}
          <ul>{data.lunches.slice().reverse().map(meal=><li key={meal.id}>
            <a href={recordHref("meals","meal",meal.id)}>{meal.date.slice(5)} 午餐</a>
            <span> {meal.staples.join("、")||"主食份量待核对"}
              {meal.known_staple_grams!==null&&` · 已知${meal.estimated_staples>0?"约":""} ${format(meal.known_staple_grams)} g（${meal.weighed_staples}/${meal.staples.length} 项有克重）`}</span>
          </li>)}</ul>
        </details>
      </section>
      {weight&&<section className="diet-card" aria-label="晨重与晚重">
        <div className="diet-card-title"><h3>晨重与晚重</h3><span>{trendLabels[weight.trend]}</span></div>
        <div className="diet-weight-stats"><strong>{week?.mean_kg==null?"暂无晨重":`${format(week.mean_kg)} kg`}</strong>
          <small>最近 7 天 · {week?.days??0} 次晨测{previous?.mean_kg!=null?` · 前一周 ${format(previous.mean_kg)} kg（${previous.days} 次）`:""}</small></div>
        {data.weight_followup&&<p>{data.weight_followup.text}</p>}
        {weight.weekly_change_kg!==null&&<p>晨重周均变化 {weight.weekly_change_kg>0?"+":""}{format(weight.weekly_change_kg)} kg</p>}
        {currentGoal&&<p>目标 {goalStatements[currentGoal.direction]} · {weight.alignment==="aligned"?"走势符合目标":weight.alignment==="off_track"?"走势偏离目标":"样本还不足以判断"}</p>}
        {weight.waist.length>0&&<p>最近腰围 {format(weight.waist.at(-1)!.cm)} cm · {weight.waist.length} 次记录</p>}
        {weight.settings?.schedule.scale_id?<p>图表使用你选定的秤和称重时段。</p>:weight.source_count>1&&<p>图表选用晨重样本最多的一台秤。</p>}
        {(weight.morning.length>0||weight.evening.length>0)&&<WeightChart weight={weight}/>}
        {!!weight.composition?.length&&<details><summary>体成分按来源和时段对照</summary>
          <div className="wellness-table"><table aria-label="体成分前后周对照"><thead><tr><th>指标</th><th>时段与依据</th><th>前一周</th><th>最近一周</th></tr></thead>
          <tbody>{weight.composition.map(row=><tr key={[row.band,row.metric,row.method,row.unit].join("/")}>
            <th>{compositionLabels[row.metric]}</th><td>{row.band==="morning"?"早":"晚"} · {row.method??"方法未知"}</td>
            {[row.previous,row.current].map((period,i)=><td key={i}>{period.mean===null?"无记录":`${format(period.mean)} ${row.unit==="level"?"级":row.unit}（${period.days} 天）`}</td>)}
          </tr>)}</tbody></table></div></details>}
        {canWrite&&schedule&&weight.settings&&<details><summary>调整称重时段与秤</summary><form className="canteen-form" onSubmit={event=>{
          event.preventDefault();
          const config=weighingScheduleSchema.safeParse(schedule);
          if(!config.success){setError("请按先早后晚的顺序填写互不重叠的时段，晚间结束可以跨到次日。");return;}
          void save("wellness.weighing","preference",JSON.stringify(config.data),weight.settings?.declaration??null,{valid_from:data.wellness.current.to});
        }}>
          {([["morning_from","晨测开始"],["morning_to","晨测结束"],["evening_from","晚测开始"],["evening_to","晚测结束"]] as const).map(([key,label])=>
            <label key={key}>{label}<input type="time" required value={schedule[key]} onChange={event=>setSchedule({...schedule,[key]:event.target.value})}/></label>)}
          <label>称重设备<select value={schedule.scale_id??""} onChange={event=>setSchedule({...schedule,scale_id:event.target.value||null})}>
            <option value="">按晨测覆盖自动选择</option>
            {schedule.scale_id&&!weight.settings.scales.some(scale=>scale.id===schedule.scale_id)&&<option value={schedule.scale_id}>已选秤 · 本期暂无记录</option>}
            {weight.settings.scales.map((scale,index)=><option key={scale.id} value={scale.id}>{scale.label} · 设备 {index+1} · {scale.days} 天</option>)}
          </select></label><button disabled={busy}>保存称重设置</button>
        </form></details>}
        {latest?.composition.length?<p>最近晨测体成分（{latest.date.slice(5)} 估算） · {latest.composition.map(row=>`${compositionLabels[row.metric]} ${format(row.value)}${row.unit==="level"?" 级":row.unit}`).join(" · ")}</p>:null}
        {data.background&&(data.background.step_days>0||data.background.sleep_days>0||data.background.active_days)&&<p>
          {data.background.step_days>0&&<>步数中位 {format(data.background.median_steps!)} 步（{data.background.step_days} 天）</>}
          {(data.background.active_days??0)>0&&<> · 活动分钟中位 {format(data.background.median_active_minutes!)}（{data.background.active_days} 天）</>}
          {data.background.sleep_days>0&&<> · 主睡眠 {data.background.mean_sleep_minutes} 分钟（{data.background.sleep_days} 晚）</>}
        </p>}
        {data.background?.latest?.state==="pending"&&<p>截至日的三星活动记录尚未到达。</p>}
      </section>}
    </div>
    <section className="diet-card diet-day-state" aria-label="饮食记录完整性">
      <h3>{date.slice(5)} 饮食记录</h3>
      <p>{diaryLabels[declaration?.state??"unknown"]} · 热量 {knownEnergy==null?"未知":format(Number(knownEnergy))+" kcal"}
        {day&&` · ${day.nutrients.energy_kcal.estimated_items} 项估算`}</p>
      {date===data.wellness.current.to&&energy.target&&energy.status!=="unknown"&&<p>{({above:"可靠的已记录摄入已超过目标上沿",below:"全天已记录摄入低于目标下沿",within:"全天已记录摄入在目标范围内"} as const)[energy.status]}</p>}
      {canWrite&&<div className="diet-day-buttons">
        <button type="button" disabled={busy||declaration?.state==="complete"} onClick={()=>void saveDiary("complete")}>已吃完并记全</button>
        <button type="button" className="secondary" disabled={busy||declaration?.state==="partial"} onClick={()=>void saveDiary("partial")}>还有漏记</button>
      </div>}
      {canWrite&&<details><summary>我的饮食目标</summary><div className="diet-goals">
        {weight&&<form onSubmit={event=>{event.preventDefault();void save("wellness.weight","goal",goalStatements[direction],currentGoal,{valid_from:data.wellness.current.to});}}>
          <label>体重方向<select value={direction} onChange={event=>setDirection(event.target.value as typeof direction)}>{Object.entries(goalStatements).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          <button disabled={busy}>保存体重方向</button>
        </form>}
        {weight&&<form onSubmit={event=>{event.preventDefault();void save("wellness.waist","goal",waistStatements[waistDirection],weight.waist_goal??null,{valid_from:data.wellness.current.to});}}>
          <label>腰围方向<select value={waistDirection} onChange={event=>setWaistDirection(event.target.value as typeof waistDirection)}>{Object.entries(waistStatements).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
          <button disabled={busy}>保存腰围方向</button>
        </form>}
        <form onSubmit={saveEnergy}><label>每日热量下沿（kcal）<input inputMode="numeric" value={lower} onChange={event=>setLower(event.target.value)} required/></label>
          <label>每日热量上沿（kcal）<input inputMode="numeric" value={upper} onChange={event=>setUpper(event.target.value)} required/></label>
          <button disabled={busy}>保存热量范围</button>
        </form>
      </div></details>}
      {error&&<p role="alert">{error} <button type="button" onClick={reload}>重新读取</button></p>}
    </section>
  </div>;
}
