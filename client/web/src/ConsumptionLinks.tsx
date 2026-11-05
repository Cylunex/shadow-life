import { useState } from "react";
import { ObjectPicker, type ObjectOption } from "./ObjectPicker.js";
import type { Execute } from "./command-controller.js";

export function consumptionLinkStatus(detail:Record<string,unknown>):Array<{label:string;value:string}> {
  const rows=(value:unknown)=>Array.isArray(value)?value:[];
  if(detail.kind==="meal")return [{label:"消费关联",value:rows(detail.payments).length||rows(detail.related_records).length?"已有关联，点开下方记录核对商家、日期与金额":"未显示关联消费；可以先记饮食，再补充关联"}];
  const status=[{label:"记录状态",value:detail.state==="confirmed"?"正式记录":detail.state==="voided"?"已作废，不计入支出":"草稿"}];
  if("money_entry" in detail)status.push({label:"付款",value:detail.money_entry?"已记录（消费与付款只计一笔账）":"未记录付款，不计入支出"});
  if("purchase" in detail)status.push({label:"购买",value:detail.purchase?`已记录 · ${rows(detail.purchase_items).length} 项明细`:"仅有收支，未补购买明细"});
  if("meals" in detail)status.push({label:"饮食",value:rows(detail.meals).length?`已关联 ${rows(detail.meals).length} 餐 · 可点开核对实际食用内容`:"未关联餐次 · 购买食物不会自动计入营养"});
  if("sources" in detail)status.push({label:"凭证",value:rows(detail.sources).length?`${rows(detail.sources).length} 份来源 · 在下方查看原文或原件`:"未附凭证，录入渠道未记录"});
  return status;
}
export function ConsumptionLinkSummary({detail}:{detail:Record<string,unknown>}) {
  return <section className="detail-section consumption-chain"><h3>消费、付款与饮食</h3><dl className="structured-fields">{consumptionLinkStatus(detail).map(item=><div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl></section>;
}
export function MealConsumptionLink({detail,headers,execute,onChanged}:{detail:Record<string,unknown>;headers:HeadersInit;execute:Execute;onChanged:()=>Promise<void>}) {
  const [meal,setMeal]=useState<ObjectOption>(),[pending,setPending]=useState(false),[message,setMessage]=useState("");
  const linked=new Set((Array.isArray(detail.meals)?detail.meals:[]).map(row=>String(row.id)));
  async function link(){
    if(!meal||pending)return;setPending(true);setMessage("");
    try{await execute("life.link_meal_consumption",{meal_id:meal.id,consumption_record_id:detail.record_id,evidence:"user_confirmed"},`meal-consumption:${detail.record_id}:${meal.id}`);await onChanged();setMeal(undefined);setMessage("已关联，并已重新读取实际结果。付款金额不会再记一次。");}
    catch(error){setMessage(error instanceof Error?error.message:"关联失败");}finally{setPending(false);}
  }
  return <details className="detail-meta"><summary>关联已有饮食记录</summary><p>选择实际吃过的那一餐。已有付款只建立关联，不再次记账，也不根据订单猜测食用量。</p><fieldset disabled={pending}><ObjectPicker kind="meal" headers={headers} value={meal?.id??""} onChange={setMeal} label="选择餐次"/><button disabled={!meal||pending||linked.has(meal?.id??"")} onClick={()=>void link()}>{linked.has(meal?.id??"")?"这餐已关联":pending?"关联中…":"关联这餐"}</button></fieldset>{message&&<p role="status">{message}</p>}</details>;
}
