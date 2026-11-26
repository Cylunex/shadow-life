import { useEffect, useState, type FormEvent } from "react";
import type { Execute } from "./command-controller.js";
import { ObjectPicker } from "./ObjectPicker.js";

type SharedAllocation={id:string;participant_label:string;original_amount:string;state:"unsettled"|"settled"|"waived";settled_on:string|null;revision:number};
type ForeignEntry={id:string;revision:number;entry_type:"expense"|"income"|"refund";settlement?:{amount:string;currency:string;settled_on:string}|null;amount:string;currency:string;source_scale:number;occurred_on:string;base_amount:string|null;base_currency:string|null;rate:string|null;source_kind:string|null;trip_id:string|null;allocations:SharedAllocation[]};
type AllocationDraft={participant_label:string;original_amount:string};
const today=()=>new Intl.DateTimeFormat("en-CA").format(new Date());

export function ForeignMoneyPanel({headers,capabilities,execute,onChanged}:{headers:HeadersInit;capabilities:ReadonlySet<string>;execute:Execute;onChanged:()=>Promise<void>}){
  const[items,setItems]=useState<ForeignEntry[]>([]),[amount,setAmount]=useState(""),[currency,setCurrency]=useState(""),[date,setDate]=useState(today),[baseAmount,setBaseAmount]=useState(""),[rate,setRate]=useState(""),[quotedAt,setQuotedAt]=useState(()=>new Date().toISOString()),[counterparty,setCounterparty]=useState(""),[tripId,setTripId]=useState(""),[allocations,setAllocations]=useState<AllocationDraft[]>([]),[participant,setParticipant]=useState(""),[share,setShare]=useState(""),[showEditor,setShowEditor]=useState(false),[error,setError]=useState<string>(),[pending,setPending]=useState(false);
  const [settling,setSettling]=useState<string>(),[settledOn,setSettledOn]=useState(today),[actualAmount,setActualAmount]=useState("");
  async function load(){const response=await fetch("/api/money/foreign?limit=50",{headers});if(!response.ok)throw new Error(`读取外币记录失败（HTTP ${response.status}）`);setItems(((await response.json()) as {items:ForeignEntry[]}).items);}
  useEffect(()=>{void load().catch(caught=>setError(caught instanceof Error?caught.message:"读取外币记录失败"));},[]);
  function addAllocation(){const label=participant.trim(),value=share.trim();if(!label||!value){setError("共同费用需要同时填写参与者和承担额。");return;}if(allocations.some(item=>item.participant_label.toLocaleLowerCase()===label.toLocaleLowerCase())){setError("同一参与者不能重复添加。");return;}setAllocations(current=>[...current,{participant_label:label,original_amount:value}]);setParticipant("");setShare("");setError(undefined);}
  async function save(event:FormEvent){event.preventDefault();setPending(true);setError(undefined);try{if(Boolean(baseAmount.trim())!==Boolean(rate.trim()))throw new Error("请同时填写换算金额和汇率，或将两项留空。");const normalizedAmount=amount.trim(),fraction=normalizedAmount.split(".")[1]??"";await execute("money.record_foreign_entry",{entry_type:"expense",amount:normalizedAmount,currency:currency.trim().toUpperCase(),source_scale:fraction.length,occurred_on:date,time_zone:Intl.DateTimeFormat().resolvedOptions().timeZone,...(counterparty.trim()?{counterparty:counterparty.trim()}:{}),...(tripId.trim()?{trip_id:tripId.trim()}:{}),...(baseAmount.trim()?{conversion:{base_amount:baseAmount.trim(),base_currency:"CNY",rate:rate.trim(),quoted_at:quotedAt,source_kind:"manual"}}:{}),allocations:allocations.map(item=>({...item,state:"unsettled" as const}))},"foreign-money:record");setAmount("");setCurrency("");setBaseAmount("");setRate("");setQuotedAt(new Date().toISOString());setAllocations([]);setShowEditor(false);await load();await onChanged();}catch(caught){setError(caught instanceof Error?caught.message:"保存外币记录失败");}finally{setPending(false);}}
  async function settle(event:FormEvent,item:ForeignEntry){
    event.preventDefault();setPending(true);setError(undefined);
    try{
      const amount=actualAmount.trim();
      if(!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/u.test(amount))throw new Error("请输入银行账单上的人民币金额，最多两位小数。");
      const [whole,fraction=""]=amount.split(".");
      await execute("money.settle_foreign_entry",{money_entry_id:item.id,expected_revision:item.revision,
        amount:`${whole}.${fraction.padEnd(2,"0")}`,settled_on:settledOn},`foreign-money:settle:${item.id}`);
      setSettling(undefined);await load();await onChanged();
    }catch(caught){setError(caught instanceof Error?caught.message:"保存实际结算失败");}finally{setPending(false);}
  }
  async function updateAllocation(allocation:SharedAllocation,state:"settled"|"waived"){setPending(true);setError(undefined);try{await execute("money.update_shared_allocation",{allocation_id:allocation.id,expected_revision:allocation.revision,state,...(state==="settled"?{settled_on:today()}: {})},`foreign-money:allocation:${allocation.id}`);await load();}catch(caught){setError(caught instanceof Error?caught.message:"更新共同费用失败");}finally{setPending(false);}}
  if(!capabilities.has("money.foreign_entries"))return null;
  return <section className="wide foreign-money">
    <div className="panel-heading"><div><span className="eyebrow">FOREIGN MONEY</span><h2>外币交易与共同费用</h2></div>{capabilities.has("money.record_foreign_entry")&&<button type="button" className={showEditor?"secondary":""} onClick={()=>setShowEditor(value=>!value)}>{showEditor?"收起录入":"＋ 记录外币付款"}</button>}</div>
    <p>可先保存原币金额，银行出账后再补实际人民币结算。</p>{error&&<p className="inline-error">{error}</p>}
    {showEditor&&<form className="compact-form editor-card" onSubmit={save}><h3>记录外币付款</h3><label>原币金额<input required inputMode="decimal" value={amount} onChange={event=>setAmount(event.target.value)} placeholder="实际支付金额"/></label><label>币种<input required maxLength={3} value={currency} onChange={event=>setCurrency(event.target.value)} placeholder="如 JPY"/></label><label>支付日<input required type="date" value={date} onChange={event=>setDate(event.target.value)}/></label><label>交易对方<input value={counterparty} onChange={event=>setCounterparty(event.target.value)}/></label><details className="conversion-fields full" open><summary>参考换算（可选）</summary><div className="field-pair"><label>人民币金额<input inputMode="decimal" value={baseAmount} onChange={event=>setBaseAmount(event.target.value)} placeholder="有换算依据时填写"/></label><label>汇率（CNY / 原币）<input inputMode="decimal" value={rate} onChange={event=>setRate(event.target.value)} placeholder="当时使用的汇率"/></label></div><small>换算快照固定于 {new Date(quotedAt).toLocaleString()}；小数精度由原币金额自动保留。</small></details><div className="full"><ObjectPicker kind="trip" headers={headers} value={tripId} label="关联旅行（可选）" onChange={option=>setTripId(option?.id??"")}/></div><label>共同费用参与者<input value={participant} onChange={event=>setParticipant(event.target.value)}/></label><label>其原币承担额<input inputMode="decimal" value={share} onChange={event=>setShare(event.target.value)}/></label><button type="button" className="secondary" onClick={addAllocation}>加入参与者</button>{allocations.length>0&&<ul className="full">{allocations.map((allocation,index)=><li key={`${allocation.participant_label}:${index}`}>{allocation.participant_label} · {allocation.original_amount} {currency.toUpperCase()} <button type="button" className="text-button" onClick={()=>setAllocations(current=>current.filter((_,position)=>position!==index))}>移除</button></li>)}</ul>}<button disabled={pending}>{pending?"保存中…":"保存原币事实"}</button></form>}
    {items.length?<ul className="foreign-list">{items.map(item=><li key={item.id}><b>{item.entry_type==="refund"?"退款 ":item.entry_type==="income"?"收入 ":""}{item.amount} {item.currency}</b>
      <span>{item.settlement?`实结 ${item.settlement.amount} CNY · ${item.settlement.settled_on}`:item.currency!=="CNY"?"待结算":""}</span>
      {item.base_amount&&<small>参考换算 {item.base_amount} {item.base_currency} · 汇率 {item.rate}</small>}
      <small>{item.occurred_on} · 保留 {item.source_scale} 位小数{item.trip_id?" · 已关联旅行":""} · {item.allocations.length} 个共同份额</small>
      {item.currency!=="CNY"&&!item.settlement&&capabilities.has("money.settle_foreign_entry")&&(settling===item.id?
        <form className="compact-form" onSubmit={event=>void settle(event,item)}>
          <label>实际结算金额（CNY）<input required inputMode="decimal" value={actualAmount} onChange={event=>setActualAmount(event.target.value)}/></label>
          <label>结算日<input required type="date" min={item.occurred_on} value={settledOn} onChange={event=>setSettledOn(event.target.value)}/></label>
          <button disabled={pending}>保存结算</button>
          <button type="button" className="secondary" disabled={pending} onClick={()=>setSettling(undefined)}>取消</button>
        </form>:<button type="button" className="secondary" disabled={pending} onClick={()=>{setSettling(item.id);setActualAmount("");setSettledOn(today());}}>补实际结算</button>)}
      {item.allocations.map(allocation=><div className="allocation-row" key={allocation.id}><span>{allocation.participant_label} · {allocation.original_amount} {item.currency} · {allocation.state==="unsettled"?"待结清":allocation.state==="settled"?"已结清":"已免除"}</span>{allocation.state==="unsettled"&&capabilities.has("money.update_shared_allocation")&&<span><button type="button" className="secondary" disabled={pending} onClick={()=>void updateAllocation(allocation,"settled")}>已结清</button><button type="button" className="secondary" disabled={pending} onClick={()=>void updateAllocation(allocation,"waived")}>免除</button></span>}</div>)}</li>)}</ul>:<p>还没有外币记录。</p>}
  </section>;
}
