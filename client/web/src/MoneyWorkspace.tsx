import { useEffect, useRef, useState } from "react";
import type { DomainRecordSummary } from "@shadow/contracts";
import { RecordBrowser } from "./RecordBrowser.js";
import { MoneyImportPanel } from "./MoneyImportPanel.js";
import { ForeignMoneyPanel } from "./ForeignMoneyPanel.js";
import { formatInTimeZone } from "./travel-time.js";
import { formatMoneyAmount } from "./money-display.js";
import type { RecordSelection } from "./record-detail.js";
import type { Execute } from "./command-controller.js";

export function moneyRecordHref(id:string,kind="money_entry") {
  return `?${new URLSearchParams({tab:"record",section:"money",domain:"money",kind,id})}`;
}
export function MoneyWorkspace({headers,capabilities,execute,onChanged,selection,timeZone,onCapture}:{headers:HeadersInit;capabilities:ReadonlySet<string>;execute:Execute;onChanged:()=>Promise<void>;selection?:RecordSelection|undefined;timeZone:string;onCapture:()=>void}) {
  const [page,setPage]=useState<{items:DomainRecordSummary[];next_cursor:string|null}>(),[query,setQuery]=useState(""),[search,setSearch]=useState(""),[error,setError]=useState(""),[loading,setLoading]=useState(false),[reload,setReload]=useState(0);
  const defaultMonth=formatInTimeZone(new Date(),timeZone).slice(0,7);
  const params=new URLSearchParams(location.search);
  const [tab,setTab]=useState(params.get("money_tab")==="imports"&&capabilities.has("money.import_review")?"imports":"records");
  const [period,setPeriod]=useState(/^\d{4}-(0[1-9]|1[0-2])$/u.test(params.get("period")??"")?params.get("period")!:defaultMonth);
  const [count,setCount]=useState<{period:string;value:number|null}>();
  function changeTab(value:string){
    setTab(value);
    const query=new URLSearchParams(location.search);
    query.set("money_tab",value);
    if(value!=="imports")query.delete("batch");
    query.set("period",period);
    history.replaceState(null,"",`?${query}`);
  }
  function changePeriod(value:string){
    setPeriod(value);
    const query=new URLSearchParams(location.search);
    query.set("period",value);
    history.replaceState(null,"",`?${query}`);
  }
  useEffect(()=>{
    if(!capabilities.has("money.import_review"))return;
    const controller=new AbortController();
    setCount(undefined);
    void fetch(`/api/money/import-month?period=${encodeURIComponent(period)}`,{headers,signal:controller.signal})
      .then(async response=>{
        if(!response.ok)throw new Error("读取失败");
        const data=await response.json() as {totals:{unconfirmed:number}};
        if(!controller.signal.aborted)setCount({period,value:data.totals.unconfirmed});
      }).catch(()=>{if(!controller.signal.aborted)setCount({period,value:null});});
    return()=>controller.abort();
  },[period,reload,headers,capabilities.has("money.import_review")]);
  const generation=useRef(0);
  useEffect(()=>{
    const controller=new AbortController(),request=++generation.current;
    setPage(undefined);setError("");setLoading(true);
    const params=new URLSearchParams({limit:"30",...(search?{q:search}:{})});
    void fetch(`/api/money?${params}`,{headers,signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error(`消费记录读取失败（HTTP ${response.status}）`);
      const data=await response.json();if(request===generation.current)setPage(data);
    }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:"读取失败");}).finally(()=>{if(request===generation.current)setLoading(false);});
    return()=>{controller.abort();++generation.current;};
  },[headers,search,reload]);
  async function more(){
    if(!page?.next_cursor||loading)return;
    const request=generation.current;setLoading(true);setError("");
    try{
      const response=await fetch(`/api/money?${new URLSearchParams({limit:"30",q:search,cursor:page.next_cursor})}`,{headers});
      if(!response.ok)throw new Error(`加载更多失败（HTTP ${response.status}）`);
      const next=await response.json() as NonNullable<typeof page>;
      if(request===generation.current)setPage(current=>({items:[...new Map([...(current?.items??[]),...next.items].map(row=>[`${row.kind}:${row.id}`,row])).values()],next_cursor:next.next_cursor}));
    }catch(e){if(request===generation.current)setError(e instanceof Error?e.message:"读取失败");}
    finally{if(request===generation.current)setLoading(false);}
  }
  if(selection){
    const result=new URLSearchParams({tab:"record",section:"money",money_tab:tab,period});
    if(tab==="imports"&&params.get("batch"))result.set("batch",params.get("batch")!);
    return <RecordBrowser timeline={[]} nextCursor={null} selection={selection} capabilities={capabilities} headers={headers} execute={execute}
      returnTo={{href:`?${result}`,label:"返回消费与账单"}}
      onChanged={async()=>{setReload(value=>value+1);await onChanged();}}/>;
  }
  return <section className="money-workspace wide">
    <div className="panel-heading"><h2>消费与账单</h2>{capabilities.has("money.record_entry")&&<button onClick={onCapture}>记一笔</button>}</div>
    <nav className="panel-actions" aria-label="消费与账单分区">
      <button aria-pressed={tab==="records"} onClick={()=>changeTab("records")}>消费明细</button>
      {capabilities.has("money.import_review")&&<button aria-pressed={tab==="imports"} onClick={()=>changeTab("imports")}>账单待处理
        {count?.period===period&&count.value!==null?` · ${count.value} 笔`:""}
      </button>}
      {capabilities.has("money.foreign_entries")&&<button aria-pressed={tab==="foreign"} onClick={()=>changeTab("foreign")}>外币与分摊</button>}
      <a href="?tab=record&section=stats">消费统计</a><a href="?tab=plan&section=budget">规划</a><a href="?tab=record&section=food">饮食日记</a>
    </nav>
    {tab==="records"&&page&&<MonthlyLoadedRows records={page.items} period={period} onPeriod={changePeriod} filtered={search!==""} more={page.next_cursor!==null}/>}
    {tab==="records"&&<><p className="form-context">一条明细查看购买、付款、餐次与原件。未记录付款的购买不计入支出；买过食物不代表已吃。</p><form onSubmit={event=>{event.preventDefault();setSearch(query.trim());setReload(value=>value+1);}} className="money-search"><label>搜索全部消费<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="商家、分类或备注"/></label><button>搜索</button></form>
      {error&&<p role="alert" className="inline-error">{error} <button onClick={()=>setReload(value=>value+1)}>重试</button></p>}
      {loading&&!page&&<p role="status">正在读取消费记录…</p>}
      {page&&<ol className="record-list">{page.items.map(row=><li key={`${row.kind}:${row.id}`}><a href={moneyRecordHref(row.record_id??row.id,row.kind)+`&period=${period}`}><span><b>{row.title}</b> · {row.state==="voided"?"已作废":row.kind==="purchase"?"购买 · 未记录付款":({expense:"支出",income:"收入",refund:"退款"})[row.entry_type??"expense"]}</span><small>{row.supporting}{row.amount!=null?` · ${formatMoneyAmount(row.amount,row.currency)} ${row.currency??""}`:""} · 查看关联与原件 →</small></a></li>)}</ol>}
      {page&&!page.items.length&&<p>没有匹配的正式记录；尚未确认的账单可在「账单待处理」查看。</p>}
      {page?.next_cursor&&<button disabled={loading} onClick={()=>void more()}>{loading?"读取中…":"加载更多消费"}</button>}
    </>}
    {tab==="imports"&&<MoneyImportPanel enabled headers={headers} execute={execute} timeZone={timeZone} canStage={capabilities.has("money.stage_import")} selectedPeriod={period} onPeriod={changePeriod}
      onChanged={()=>setReload(value=>value+1)}/>}
    {tab==="foreign"&&<ForeignMoneyPanel headers={headers} capabilities={capabilities} execute={execute} onChanged={onChanged}/>}
  </section>;
}


function MonthlyLoadedRows({records,period,onPeriod,filtered,more}:{
  records:DomainRecordSummary[];period:string;onPeriod:(value:string)=>void;filtered:boolean;more:boolean;
}){
  const totals=new Map<string,{net:bigint;count:number}>();
  for(const row of records){
    if(row.kind!=="money_entry"||row.state==="voided"||!row.happened_on?.startsWith(period)||!row.currency||!row.amount||!row.entry_type)continue;
    const match=/^(-?)([0-9]+)(?:[.]([0-9]{1,6}))?$/u.exec(row.amount);
    if(!match)continue;
    const value=(match[1]==="-"?-1n:1n)*(BigInt(match[2]!)*1000000n+BigInt((match[3]??"").padEnd(6,"0")));
    const sum=totals.get(row.currency)??{net:0n,count:0};
    sum.net+=row.entry_type==="expense"?value:row.entry_type==="refund"?-value:0n;
    sum.count++;
    totals.set(row.currency,sum);
  }
  return <div className="money-month-overview">
    <label>汇总月份<input type="month" value={period} onChange={event=>{if(event.target.value)onPeriod(event.target.value);}}/></label>
    <small>净支出（支出减退款） · {filtered?"搜索结果小计":"已加载明细小计"}{more?" · 还有更早记录":""}</small>
    {totals.size===0?<p>已加载明细中暂无该月收支。</p>:[...totals].map(([currency,{net,count}])=>{
      const cents=net<0n?-net:net;
      const value=`${net<0n?"-":""}${cents/1000000n}.${String(cents%1000000n).padStart(6,"0")}`;
      return <div key={currency}><strong>{formatMoneyAmount(value,currency)} {currency}</strong><small>{count} 笔</small></div>;
    })}
  </div>;
}
