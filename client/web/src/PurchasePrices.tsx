import {useEffect,useState} from "react";
import {pricesResultSchema,type PurchasePrices} from "@shadow/contracts";
import type {Execute} from "./command-controller.js";

type Sample=PurchasePrices["items"][number];
export function PurchasePricePanel({headers,execute,canWrite,lines}:{headers:HeadersInit;execute:Execute;canWrite:boolean;lines?:Array<{id:string;raw_name:string}>}){
  const [open,setOpen]=useState(false),[product,setProduct]=useState(""),[filter,setFilter]=useState("");
  const [item,setItem]=useState(lines?.[0]?.id??""),[data,setData]=useState<PurchasePrices>();
  const [after,setAfter]=useState<PurchasePrices["next"]>(null),[revision,setRevision]=useState(0),[error,setError]=useState("");
  const [edit,setEdit]=useState<Sample>(),[name,setName]=useState(""),[count,setCount]=useState("1"),[size,setSize]=useState("");
  const [unit,setUnit]=useState("ml"),[basis,setBasis]=useState("listed"),[discount,setDiscount]=useState("0"),[busy,setBusy]=useState(false);
  useEffect(()=>{
    if(!open)return;const ctrl=new AbortController();
    const params=new URLSearchParams({...after,...(item?{item_id:item}:{}),...(filter?{product:filter}:{})});
    void fetch(`/api/life/purchase-prices?${params}`,{headers,signal:ctrl.signal}).then(async response=>{
      if(!response.ok)throw new Error("购买行价读取失败");const result=pricesResultSchema.parse(await response.json());
      if(!ctrl.signal.aborted){setData(result);setError("");}
    }).catch(e=>{if(!ctrl.signal.aborted)setError(String(e));});return ()=>ctrl.abort();
  },[open,headers,item,filter,after,revision]);
  function choose(row:Sample){setEdit(row);setName(row.product);setCount(row.pack_count);setSize(row.pack_size??"");setUnit(row.unit??"ml");setBasis(row.price_basis);setDiscount(row.discount);}
  function compare(row:Sample){setProduct(row.product);setFilter(row.product);setItem("");setAfter(null);setEdit(undefined);}
  const groups=new Map<string,Sample[]>();
  for(const row of data?.items??[]){
    const key=[row.product,row.currency,row.base_unit??"规格待补",row.price_basis==="paid"?"实付行价":"行标价（只扣已分配优惠）"].join(" · ");
    groups.set(key,[...(groups.get(key)??[]),row]);
  }
  return <details className="detail-meta" onToggle={e=>setOpen(e.currentTarget.open)}><summary>我的常购价</summary>
    <form onSubmit={e=>{e.preventDefault();setFilter(product.trim());setItem("");setAfter(null);setEdit(undefined);}}>
      <label>同款商品<input value={product} placeholder="按同款名称查询" onChange={e=>setProduct(e.target.value)}/></label><button>查询历史行价</button>
    </form>{lines&&<label>本单购买行<select value={item} onChange={e=>{setItem(e.target.value);setFilter("");setAfter(null);setEdit(undefined);}}>
      <option value="">全部行价</option>{lines.map(r=><option key={r.id} value={r.id}>{r.raw_name}</option>)}</select></label>}
    {data&&<p>已确认商品行 {data.coverage.total} · 有同款名称 {data.coverage.identified} · 规格可换算 {data.coverage.convertible} · 行价可比 {data.coverage.comparable} · 至少购入三次的可比商品 {data.coverage.qualified}</p>}
    {[...groups].map(([key,rows])=><section key={key}><h4>{key}</h4><ul>{rows.map(r=><li key={r.id}>
      {r.occurred_on} · {r.merchant??"未记门店"} · {r.unit_price!==null?`${Number(r.unit_price)} ${r.currency}/${r.base_unit}`:r.has_refund?"有未分配退款":"规格或行价待补"}
      {r.line_amount!==null&&` · 原行金额 ${Number(r.line_amount)}`}
      <a href={`?${new URLSearchParams({tab:"record",section:"timeline",domain:"money",kind:"record",id:r.record_id})}`}>原单</a>
      {canWrite&&<button onClick={()=>choose(r)}>补规格与口径</button>}{filter!==r.product&&<button onClick={()=>compare(r)}>比较同款</button>}</li>)}</ul></section>)}
    {data?.next&&<button onClick={()=>setAfter(data.next)}>更早行价</button>}{after&&<button onClick={()=>setAfter(null)}>返回最近</button>}
    {edit&&<form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await execute("life.set_price_spec",{purchase_item_id:edit.id,product:name,pack_count:count,pack_size:size,
      unit,price_basis:basis,discount:basis==="paid"?"0":discount,...(edit.revision?{expected_revision:edit.revision}:{})},`prices:${edit.id}`);setEdit(undefined);setRevision(n=>n+1);
    }catch(e){setError(e instanceof Error?e.message:"保存失败");}finally{setBusy(false);}}}>
      <label>同款名称<input required value={name} maxLength={200} onChange={e=>setName(e.target.value)}/></label>
      <label>整行购买份数<input required type="number" step="any" min="0.000001" value={count} onChange={e=>setCount(e.target.value)}/></label>
      <label>每份净含量<input required type="number" step="any" min="0.000001" value={size} onChange={e=>setSize(e.target.value)}/></label>
      <label>含量单位<select value={unit} onChange={e=>setUnit(e.target.value)}>{["g","kg","ml","L","件"].map(u=><option key={u}>{u}</option>)}</select></label>
      <label>行价口径<select value={basis} onChange={e=>setBasis(e.target.value)}><option value="listed">行标价</option><option value="paid">已扣优惠的实付行价</option></select></label>
      {basis==="listed"&&<label>可明确归属本行的优惠<input type="number" min="0" step="any" value={discount} onChange={e=>setDiscount(e.target.value)}/></label>}
      <button disabled={busy}>保存规格</button><button type="button" onClick={()=>setEdit(undefined)}>取消</button></form>}
    {error&&<p role="alert">{error} <button onClick={()=>setRevision(n=>n+1)}>重新读取</button></p>}</details>;
}
