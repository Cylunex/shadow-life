import { useEffect, useRef, useState } from "react";
import {domainRecordsResultSchema,localDate,moneySummarySchema,type DomainRecordSummary,type MoneySummary} from "@shadow/contracts";
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
  const params=new URLSearchParams(location.search);
  const [page,setPage]=useState<{items:DomainRecordSummary[];next_cursor:string|null}>(),[query,setQuery]=useState(params.get("q")??""),[search,setSearch]=useState(params.get("q")??""),[error,setError]=useState(""),[loading,setLoading]=useState(false),[reload,setReload]=useState(0);
  const defaultMonth=formatInTimeZone(new Date(),timeZone).slice(0,7);
  const [tab,setTab]=useState(params.get("money_tab")==="imports"&&capabilities.has("money.import_review")?"imports":params.get("money_tab")==="foreign"&&capabilities.has("money.foreign_entries")?"foreign":"records");
  const [period,setPeriod]=useState(/^\d{4}-(0[1-9]|1[0-2])$/u.test(params.get("period")??"")?params.get("period")!:defaultMonth);
  const [currency,setCurrency]=useState(/^[A-Z]{3}$/u.test(params.get("money_currency")??"")?params.get("money_currency")!:"");
  const [on,setOn]=useState(localDate.safeParse(params.get("money_on")).success&&params.get("money_on")?.startsWith(period+"-")?params.get("money_on")!:"");
  const [type,setType]=useState(["expense","refund","income"].includes(params.get("entry_type")??"")?params.get("entry_type")!:"");
  const [category,setCategory]=useState(params.get("category"));
  const [monthRead,setMonthRead]=useState<{period:string;data?:MoneySummary;error?:string}>();
  const [receiptVersion,setReceiptVersion]=useState(0);
  const summary=monthRead?.period===period?monthRead:undefined;
  const canSummarize=capabilities.has("money.summarize");
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
    setPeriod(value);setOn("");setCategory(null);
    const query=new URLSearchParams(location.search);
    query.set("period",value);query.delete("money_on");query.delete("category");
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
  useEffect(()=>{
    if(!canSummarize||tab!=="records")return;
    const controller=new AbortController();
    setMonthRead(undefined);
    async function read(){
      const response=await fetch(`/api/money/summary?period=${encodeURIComponent(period)}`,{headers,signal:controller.signal});
      if(!response.ok)throw new Error(`月度汇总读取失败（HTTP ${response.status}）`);
      const data=moneySummarySchema.parse(await response.json());
      if(!controller.signal.aborted)setMonthRead({period,data});
    }
    void read().catch(error=>{if(!controller.signal.aborted)setMonthRead({period,error:error instanceof Error?error.message:"月度汇总读取失败"});});
    return()=>controller.abort();
  },[canSummarize,tab,period,headers,receiptVersion]);
  function filters(extra:Record<string,string>={}){
    return {period,...(currency?{currency}:{}),...(on?{on}:{}),...(type?{entry_type:type}:{}),...(category!==null?{category}:{}),
      ...(search?{q:search}:{}),...extra};
  }
  function applyFilters(next:{currency?:string;on?:string;type?:string;category?:string|null;search?:string}){
    const query=new URLSearchParams(location.search);
    const keys={currency:"money_currency",on:"money_on",type:"entry_type",category:"category",search:"q"} as const;
    for(const [name,value] of Object.entries(next) as Array<[keyof typeof keys,string|null]>){
      if(value||(name==="category"&&value===""))query.set(keys[name],value);else query.delete(keys[name]);
    }
    query.set("period",period);
    history.replaceState(null,"",`?${query}`);
    if(next.currency!==undefined)setCurrency(next.currency);
    if(next.on!==undefined)setOn(next.on);
    if(next.type!==undefined)setType(next.type);
    if(next.category!==undefined)setCategory(next.category);
    if(next.search!==undefined){setSearch(next.search);setQuery(next.search);}
  }
  function workspaceHref(record?:DomainRecordSummary){
    const query=new URLSearchParams({tab:"record",section:"money",money_tab:tab,period});
    for(const key of ["batch","money_currency","money_on","entry_type","category","q"]){
      const value=new URLSearchParams(location.search).get(key);
      if(value!==null)query.set(key,value);
    }
    if(record){
      query.set("domain","money");query.set("kind",record.kind);query.set("id",record.record_id??record.id);
    }
    return `?${query}`;
  }
  const generation=useRef(0);
  useEffect(()=>{
    if(tab!=="records"||selection)return;
    const controller=new AbortController(),request=++generation.current;
    setPage(undefined);setError("");setLoading(true);
    const params=new URLSearchParams(filters({limit:"30"}));
    void fetch(`/api/money?${params}`,{headers,signal:controller.signal}).then(async response=>{
      if(!response.ok)throw new Error(`消费记录读取失败（HTTP ${response.status}）`);
      const data=domainRecordsResultSchema.parse(await response.json());if(request===generation.current)setPage(data);
    }).catch(e=>{if(!controller.signal.aborted)setError(e instanceof Error?e.message:"读取失败");}).finally(()=>{if(request===generation.current)setLoading(false);});
    return()=>{controller.abort();++generation.current;};
  },[headers,search,reload,period,currency,on,type,category,tab,selection?.id]);
  async function more(){
    if(!page?.next_cursor||loading)return;
    const request=generation.current;setLoading(true);setError("");
    try{
      const response=await fetch(`/api/money?${new URLSearchParams(filters({limit:"30",cursor:page.next_cursor}))}`,{headers});
      if(!response.ok)throw new Error(`加载更多失败（HTTP ${response.status}）`);
      const next=domainRecordsResultSchema.parse(await response.json());
      if(request===generation.current)setPage(current=>({items:[...new Map([...(current?.items??[]),...next.items].map(row=>[`${row.kind}:${row.id}`,row])).values()],next_cursor:next.next_cursor}));
    }catch(e){if(request===generation.current)setError(e instanceof Error?e.message:"读取失败");}
    finally{if(request===generation.current)setLoading(false);}
  }
  if(selection){
    return <RecordBrowser timeline={[]} nextCursor={null} selection={selection} capabilities={capabilities} headers={headers} execute={execute}
      returnTo={{href:workspaceHref(),label:"返回消费与账单"}}
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
    {tab==="records"&&<label className="workspace-date">查看月份<input type="month" value={period} onChange={event=>{if(event.target.value)changePeriod(event.target.value);}}/></label>}
    {tab==="records"&&canSummarize&&(summary?.error?<p role="alert">{summary.error} <button onClick={()=>setReceiptVersion(n=>n+1)}>重试</button></p>
      :summary?.data?<MonthlySummary data={summary.data} period={period} currency={currency} onDay={on}
        onFilter={applyFilters} canOpen={capabilities.has("money.records")}/>:<p role="status">正在读取月度汇总…</p>)}
    {tab==="records"&&<><form id="money-month-records" onSubmit={event=>{event.preventDefault();applyFilters({search:query.trim()});setReload(n=>n+1);}} className="money-search">
      <label>搜索本月消费<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="商家、分类或备注"/></label><button>搜索</button>
      <label>收支类型<select value={type} onChange={event=>applyFilters({type:event.target.value})}>
        <option value="">全部</option><option value="expense">支出</option><option value="refund">退款</option><option value="income">收入</option></select></label>
    </form>
      {(on||category!==null||currency)&&<div className="panel-actions"><span>{[on,category===""?"未分类":category,currency].filter(Boolean).join(" · ")}</span>
        <button className="secondary" type="button" onClick={()=>applyFilters({on:"",currency:"",category:null})}>清除明细筛选</button></div>}
      {error&&<p role="alert" className="inline-error">{error} <button onClick={()=>setReload(value=>value+1)}>重试</button></p>}
      {loading&&!page&&<p role="status">正在读取消费记录…</p>}
      {page&&<ol className="record-list money-records">{page.items.map(row=><li key={`${row.kind}:${row.id}`}><a href={workspaceHref(row)}><span><b>{row.title}</b> · {row.state==="voided"?"已作废":row.kind==="purchase"?"购买 · 未记录付款":({expense:"支出",income:"收入",refund:"退款"})[row.entry_type??"expense"]}</span><small>{row.supporting}{row.amount!=null?` · ${formatMoneyAmount(row.amount,row.currency)} ${row.currency??""}`:""} · 查看关联与原件 →</small></a></li>)}</ol>}
      {page&&!page.items.length&&<p>没有匹配的正式记录；尚未确认的账单可在「账单待处理」查看。</p>}
      {page?.next_cursor&&<button disabled={loading} onClick={()=>void more()}>{loading?"读取中…":"加载更多消费"}</button>}
    </>}
    {tab==="imports"&&<MoneyImportPanel enabled headers={headers} execute={execute} timeZone={timeZone} canStage={capabilities.has("money.stage_import")} canResolve={capabilities.has("money.resolve_import_candidate")} selectedPeriod={period} onPeriod={changePeriod}
      onChanged={()=>{setReload(value=>value+1);setReceiptVersion(value=>value+1);}}/>}
    {tab==="foreign"&&<ForeignMoneyPanel headers={headers} capabilities={capabilities} execute={execute} onChanged={onChanged}/>}
  </section>;
}


function MonthlySummary({data,period,currency,onDay,onFilter,canOpen}:{
  data:MoneySummary;period:string;currency:string;onDay:string;canOpen:boolean;
  onFilter:(next:{currency?:string;on?:string;type?:string;category?:string|null;search?:string})=>void;
}){
  const [displayCurrency,setDisplayCurrency]=useState("");
  const code=currency||displayCurrency||data.totals.find(row=>row.currency==="CNY")?.currency||data.totals[0]?.currency;
  const total=data.totals.find(row=>row.currency===code);
  const lookup=new Map(data.days?.filter(day=>day.currency===code).map(day=>[day.on,day]));
  const categories=data.categories?.filter(item=>item.currency===code)??[];
  const first=new Date(period+"-01T12:00:00Z"),offset=(first.getUTCDay()+6)%7;
  const last=new Date(first);last.setUTCMonth(last.getUTCMonth()+1);last.setUTCDate(0);
  const net=(value:string)=>`${code} ${formatMoneyAmount(value,code)}`;
  function drill(next:{on?:string;type?:string;category?:string}){
    onFilter({on:"",type:"",category:null,search:"",...next,currency:code??""});
    document.getElementById("money-month-records")?.scrollIntoView({block:"nearest"});
  }
  return <section className="money-month-overview">
    <h3>本月已确认收支</h3>
    {data.totals.length>1&&<label>汇总币种<select value={code} onChange={event=>{
      setDisplayCurrency(event.target.value);onFilter({currency:event.target.value,on:"",category:null});}}>
      {data.totals.map(row=><option key={row.currency}>{row.currency}</option>)}</select></label>}
    {!total?<p>该币种本月没有已确认收支。</p>:<>
      <div className="money-period-total"><small>净支出 · {total.entries} 笔</small><strong>{net(total.net_spending)}</strong></div>
      <div className="panel-actions">{([{kind:"expense",label:"支出",value:total.gross_expense},{kind:"refund",label:"退款",value:total.refund},
        {kind:"income",label:"收入",value:total.income}]).map(item=>canOpen?<button type="button" className="secondary" key={item.kind}
          onClick={()=>drill({type:item.kind})}>{item.label} {net(item.value)}</button>:<span key={item.kind}>{item.label} {net(item.value)}</span>)}</div>
      {lookup.size>0&&<details className="money-day-calendar" open><summary>流水月历 · {lookup.size} 天有流水</summary>
        <div aria-label="流水月历" className="diary-week">
          {[..."一二三四五六日"].map(name=><span key={name}>{name}</span>)}
          {Array.from({length:offset},(_,i)=><span key={`pad-${i}`}/>)}
          {Array.from({length:last.getUTCDate()},(_,i)=>{
            const date=`${period}-${String(i+1).padStart(2,"0")}`,day=lookup.get(date);
            return day&&canOpen?<button type="button" key={date} className="secondary" aria-pressed={onDay===date}
              aria-label={`${date}，${day.entries} 笔，净支出 ${net(day.net_spending)}`} onClick={()=>drill({on:date})}>{i+1}</button>
              :<span key={date}>{i+1}</span>;
          })}
        </div></details>}
      {categories.length>0&&<details><summary>消费分类</summary><ul className="record-list">
        {categories.map(row=><li key={row.category??""}><button className="secondary" type="button" disabled={!canOpen}
          onClick={()=>drill({category:row.category??"",type:"expense"})}>{row.category??"未分类"} · {net(row.gross_expense)}</button></li>)}
      </ul></details>}
    </>}
  </section>;
}
