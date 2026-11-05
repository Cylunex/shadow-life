import { useEffect, useRef, useState } from "react";
import type { DomainRecordSummary } from "@shadow/contracts";
import { RecordBrowser } from "./RecordBrowser.js";
import { MoneyImportPanel } from "./MoneyImportPanel.js";
import { ForeignMoneyPanel } from "./ForeignMoneyPanel.js";
import { formatMoneyAmount } from "./money-display.js";
import type { RecordSelection } from "./record-detail.js";
import type { Execute } from "./command-controller.js";

export function moneyRecordHref(id:string,kind="money_entry") {
  return `?${new URLSearchParams({tab:"record",section:"money",domain:"money",kind,id})}`;
}
export function MoneyWorkspace({headers,capabilities,execute,onChanged,selection,timeZone,onCapture}:{headers:HeadersInit;capabilities:ReadonlySet<string>;execute:Execute;onChanged:()=>Promise<void>;selection?:RecordSelection|undefined;timeZone:string;onCapture:()=>void}) {
  const [page,setPage]=useState<{items:DomainRecordSummary[];next_cursor:string|null}>(),[query,setQuery]=useState(""),[search,setSearch]=useState(""),[error,setError]=useState(""),[loading,setLoading]=useState(false),[reload,setReload]=useState(0);
  const [tab,setTab]=useState("records");
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
  if(selection)return <RecordBrowser timeline={[]} nextCursor={null} selection={selection} capabilities={capabilities} headers={headers} execute={execute} onChanged={async()=>{setReload(value=>value+1);await onChanged();}}/>;
  return <section className="money-workspace wide">
    <div className="panel-heading"><div><span className="eyebrow">MONEY</span><h2>消费与账单</h2></div>{capabilities.has("money.record_entry")&&<button onClick={onCapture}>记一笔</button>}</div>
    <p>摇一摇、Agent、邮件、App 账单和手动录入的正式记录，在这里统一查看。导入候选在「账单待处理」。</p>
    <nav className="panel-actions" aria-label="消费与账单分区"><button aria-pressed={tab==="records"} onClick={()=>setTab("records")}>消费明细</button>{capabilities.has("money.import_review")&&<button aria-pressed={tab==="imports"} onClick={()=>setTab("imports")}>账单待处理</button>}{capabilities.has("money.foreign_entries")&&<button aria-pressed={tab==="foreign"} onClick={()=>setTab("foreign")}>外币与分摊</button>}<a href="?tab=record&section=stats">消费统计</a><a href="?tab=record&section=food">饮食日记</a></nav>
    {tab==="records"&&<><p className="form-context">一条明细查看购买、付款、餐次与原件。未记录付款的购买不计入支出；买过食物不代表已吃。</p><form onSubmit={event=>{event.preventDefault();setSearch(query.trim());setReload(value=>value+1);}} className="money-search"><label>搜索全部消费<input value={query} onChange={event=>setQuery(event.target.value)} placeholder="商家、分类或备注"/></label><button>搜索</button></form>
      {error&&<p role="alert" className="inline-error">{error} <button onClick={()=>setReload(value=>value+1)}>重试</button></p>}
      {loading&&!page&&<p role="status">正在读取消费记录…</p>}
      {page&&<ol className="record-list">{page.items.map(row=><li key={`${row.kind}:${row.id}`}><a href={moneyRecordHref(row.record_id??row.id,row.kind)}><span><b>{row.title}</b> · {row.state==="voided"?"已作废":row.kind==="purchase"?"购买 · 未记录付款":({expense:"支出",income:"收入",refund:"退款"})[row.entry_type??"expense"]}</span><small>{row.supporting}{row.amount!=null?` · ${formatMoneyAmount(row.amount,row.currency)} ${row.currency??""}`:""} · 查看关联与原件 →</small></a></li>)}</ol>}
      {page&&!page.items.length&&<p>没有匹配的正式记录；尚未确认的账单可在「账单待处理」查看。</p>}
      {page?.next_cursor&&<button disabled={loading} onClick={()=>void more()}>{loading?"读取中…":"加载更多消费"}</button>}
    </>}
    {tab==="imports"&&<MoneyImportPanel enabled headers={headers} execute={execute} timeZone={timeZone} canStage={capabilities.has("money.stage_import")}/>}
    {tab==="foreign"&&<ForeignMoneyPanel headers={headers} capabilities={capabilities} execute={execute} onChanged={onChanged}/>}
  </section>;
}
