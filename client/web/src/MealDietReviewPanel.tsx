import { useEffect,useState } from "react";
import { buildCapabilityHttpRequest,dietFoodGroupLabels,mealDietReviewResultSchema,type MealDietReviewResult } from "@shadow/contracts";

const labels={energy_kcal:"热量",protein_g:"蛋白质",fat_g:"脂肪",carb_g:"碳水",fiber_g:"膳食纤维",sodium_mg:"钠",calcium_mg:"钙",iron_mg:"铁"};
const number=(value:number|null)=>value===null?"未知":new Intl.NumberFormat("zh-CN",{maximumFractionDigits:2}).format(value);

export function MealDietReviewPanel({mealId,revision,headers}:{mealId:string;revision:unknown;headers:HeadersInit}) {
  const [open,setOpen]=useState(false),[retry,setRetry]=useState(0);
  const [data,setData]=useState<MealDietReviewResult>(),[error,setError]=useState("");
  useEffect(()=>{
    if(!open)return;
    const abort=new AbortController();
    setData(undefined);setError("");
    const request=buildCapabilityHttpRequest("","life.meal_diet_review",{meal_id:mealId});
    void fetch(request.url,{headers,signal:abort.signal}).then(async response=>{
      if(!response.ok)throw Error(`本餐复盘暂时不可用（${response.status}）`);
      const result=mealDietReviewResultSchema.parse(await response.json());
      if(!abort.signal.aborted)setData(result);
    }).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:"本餐复盘暂时不可用")});
    return()=>abort.abort();
  },[mealId,revision,headers,open,retry]);
  return <details className="detail-section meal-diet-detail" onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>实吃份量与估算依据</summary>
    {open&&(error?<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>重新读取</button></p>:!data?<p role="status">正在读取本餐…</p>:<>
      <p>{data.consumed_items} 项计入实吃 · 主食{data.known_staple_grams!==null?`已知 ${number(data.known_staple_grams)} g`:"克重未知"}（{data.staples_with_grams}/{data.staples} 项有克重）</p>
      <div className="meal-diet-items">{data.items.map(item=><article key={item.id}>
        <strong>{item.name}</strong>
        {(item.stall||item.merchant)&&<small>{[item.merchant,item.stall].filter(Boolean).join(" · ")}</small>}
        <span>{item.consumed_fraction===0?"未食用":[item.quantity!==null?`${number(item.quantity)} ${item.unit??""}`:"",item.grams!==null?`${number(item.grams)} g`:"",item.estimated?"估算":""].filter(Boolean).join(" · ")||"实吃份量未知"}</span>
        <small>{item.groups.map(group=>dietFoodGroupLabels[group]).join("、")}{item.weight_basis==="measured_net"?" · 有实称依据":item.weight_basis==="payment_derived"?" · 付款推估":""}</small>
        {item.basis&&<small>{item.basis}</small>}
      </article>)}</div>
      <div className="wellness-table"><table aria-label="本餐营养覆盖"><thead><tr><th>营养</th><th>已知实吃量</th><th>有值条目</th><th>其中估算</th></tr></thead>
        <tbody>{data.totals.map(row=><tr key={row.nutrient}><th>{labels[row.nutrient]}</th><td>{number(row.known_total)}{row.known_total===null?"":row.nutrient==="energy_kcal"?" kcal":row.nutrient.endsWith("_mg")?" mg":" g"}</td>
          <td>{row.known_items}/{data.consumed_items}</td><td>{row.estimated_items}</td></tr>)}</tbody></table></div>
    </>)}
  </details>;
}
