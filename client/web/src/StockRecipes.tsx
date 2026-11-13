import {useEffect,useState} from "react";
import {stockRecipesResultSchema,type StockRecipe} from "@shadow/contracts";
import type {Execute} from "./command-controller.js";

export function StockRecipes({lot,on,headers,execute,capabilities,onChanged}:{lot:string;on:string;headers:HeadersInit;execute:Execute;capabilities:ReadonlySet<string>;onChanged:()=>Promise<void>}){
  const [open,setOpen]=useState(false),[rows,setRows]=useState<StockRecipe[]>([]),[offset,setOffset]=useState(0),[next,setNext]=useState<number|null>(null);
  const [loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[retry,setRetry]=useState(0);
  const [plans,setPlans]=useState<Record<string,string>>({}),[lists,setLists]=useState<Record<string,string>>({});
  useEffect(()=>{
    if(!open)return;const ctrl=new AbortController();setLoaded(false);
    void fetch(`/api/life/stock-recipes?${new URLSearchParams({lot_id:lot,on,offset:String(offset)})}`,{headers,signal:ctrl.signal}).then(async response=>{
      if(!response.ok)throw new Error("食谱读取失败");const data=stockRecipesResultSchema.parse(await response.json());
      if(!ctrl.signal.aborted){setRows(data.items);setNext(data.next_offset);setLoaded(true);setError("");}
    }).catch(e=>{if(!ctrl.signal.aborted)setError(String(e));});return ()=>ctrl.abort();
  },[open,lot,on,headers,offset,retry]);
  async function schedule(row:StockRecipe){
    setBusy(true);setError("");
    try{const outcome=await execute("life.save_meal_plan",{title:row.title,state:"active",starts_on:on,ends_on:on,time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone,
      entries:[{plan_date:on,meal_type:"other",title:row.title,servings:row.servings,recipe_id:row.id,recipe_revision:row.revision}]},`stock-recipe-plan:${lot}:${row.id}`);
      if(outcome.status==="committed"){setPlans(p=>({...p,[row.id]:String(outcome.actual_values.meal_plan_id)}));await onChanged();}
    }catch(e){setError(e instanceof Error?e.message:"安排失败");}finally{setBusy(false);}
  }
  async function buy(row:StockRecipe){
    setBusy(true);setError("");
    try{const outcome=await execute("life.build_shopping_list",{meal_plan_id:plans[row.id],expected_meal_plan_revision:1,title:row.title+"缺项",shortfall_on:on},
      `stock-recipe-list:${plans[row.id]}`);if(outcome.status==="committed"){setLists(p=>({...p,[row.id]:String(outcome.actual_values.shopping_list_id)}));await onChanged();}
    }catch(e){setError(e instanceof Error?e.message:"生成缺项失败");}finally{setBusy(false);}
  }
  return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>用这批食材找菜</summary>
    {loaded&&!rows.length&&<p>没有用到这批有效食材的食谱。</p>}
    {rows.map(r=><article key={r.id}><h4>{r.title} · {Number(r.servings)} 份</h4>
      <p>{r.unknown_count?`${r.unknown_count} 项库存或用量待核对`:r.short_count?`缺 ${r.short_count} 种`:"现有库存可做"}</p>
      <ul>{r.ingredients.map((i,n)=><li key={n}>{i.name} · {i.missing===null?"缺量未知":Number(i.missing)>0?`差 ${Number(i.missing)} ${i.unit}`:"已有足量"}</li>)}</ul>
      {capabilities.has("life.save_meal_plan")&&<button disabled={busy||!!plans[r.id]} onClick={()=>void schedule(r)}>{plans[r.id]?"已加入当日餐单":"加入当日餐单"}</button>}
      {plans[r.id]&&(r.unknown_count+r.short_count)>0&&capabilities.has("life.build_shopping_list")&&<button disabled={busy||!!lists[r.id]} onClick={()=>void buy(r)}>{lists[r.id]?"已生成缺项清单":"把缺项加入购物清单"}</button>}
    </article>)}{offset>0&&<button onClick={()=>setOffset(Math.max(0,offset-15))}>上一页食谱</button>}{next!==null&&<button onClick={()=>setOffset(next)}>更多食谱</button>}
    {error&&<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>重新读取</button></p>}</details>;
}
