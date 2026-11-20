import {useState, type FormEvent} from "react";
import type {Execute} from "./command-controller.js";

interface MealIntake {
  id:string;
  revision:number;
  name:string;
  quantity?:string|null;
  unit?:string|null;
  consumed_fraction?:string|null;
}

export function MealIntakeEditor({items,execute,onChanged}:{
  items:unknown[];execute:Execute;onChanged:()=>Promise<void>;
}){
  const foods=items.filter((value):value is MealIntake=>{
    if(!value||typeof value!=="object")return false;
    const row=value as Partial<MealIntake>;
    return typeof row.id==="string"&&typeof row.name==="string"&&Number.isInteger(row.revision);
  });
  return <section className="meal-intake-editor">
    <h3>本餐食物</h3>
    {!foods.length&&<p>暂无可更正的食物。</p>}
    {foods.map(food=><IntakeRow key={`${food.id}:${food.revision}`} food={food} execute={execute} onChanged={onChanged}/>)}
  </section>;
}

function IntakeRow({food,execute,onChanged}:{food:MealIntake;execute:Execute;onChanged:()=>Promise<void>}){
  const original=food.consumed_fraction==null?null:Number((Number(food.consumed_fraction)*100).toFixed(4));
  const [percent,setPercent]=useState(()=>original?.toString()??"");
  const [pending,setPending]=useState(false);
  const [error,setError]=useState<string>();
  const valid=/^\d{1,3}(?:[.]\d{1,4})?$/u.test(percent.trim())&&Number(percent)<=100;
  async function save(event:FormEvent){
    event.preventDefault();
    if(!valid||pending)return;
    setPending(true);setError(undefined);
    try{
      const fraction=String(Number((Number(percent)/100).toFixed(6)));
      await execute("life.correct_intake",{item_id:food.id,expected_revision:food.revision,consumed_fraction:fraction,
        reason:"从餐次详情更正实际食用份量"},`intake:portion:${food.id}:${food.revision}`);
      await onChanged();
    }catch(caught){setError(caught instanceof Error?caught.message:"保存份量失败");}
    finally{setPending(false);}
  }
  return <details className="intake-edit-row">
    <summary>{food.name} · {original===null?"食用比例未填":`已吃 ${original}%`}</summary>
    <form onSubmit={save}>
      {food.quantity&&food.unit&&<p>原份量 {food.quantity} {food.unit}</p>}
      <label>实际吃了多少（%）<input value={percent} inputMode="decimal" onChange={event=>setPercent(event.target.value)}/></label>
      <div className="panel-actions intake-portion-actions">
        {([["0","没吃"],["25","四分之一"],["50","半份"],["75","四分之三"],["100","全份"]] as const).map(([value,label])=>
          <button key={value} type="button" className="secondary" aria-pressed={percent===value} onClick={()=>setPercent(value)}>{label}</button>)}
      </div>
      {error&&<p role="alert">{error}</p>}
      <button disabled={!valid||pending||Number(percent)===original}>{pending?"正在保存…":"保存份量"}</button>
    </form>
  </details>;
}
