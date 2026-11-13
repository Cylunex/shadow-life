import { useEffect, useState, type FormEvent } from "react";
import { dishPreferencesResultSchema, type DishPreference } from "@shadow/contracts";
import type { Execute } from "./command-controller.js";

const choices={repeat:"还会点",avoid:"避开",try:"下次想试"} as const;
type Choice=keyof typeof choices;
type Cursor={before_at:string;before_id:string};
type Props={headers:HeadersInit;execute:Execute;canWrite:boolean;detail?:Record<string,unknown>};

export function DishPreferences({headers,execute,canWrite,detail}:Props){
  const purchase=detail?.purchase as {merchant?:string;place_ref?:string;channel_name_raw?:string}|undefined;
  const initialShop=purchase?.merchant??"";
  const initialSource=purchase?.place_ref??purchase?.channel_name_raw??"手记";
  const [filter,setFilter]=useState(initialShop),[applied,setApplied]=useState(initialShop);
  const [shop,setShop]=useState(initialShop),[source,setSource]=useState(initialSource);
  const [dish,setDish]=useState(""),[choice,setChoice]=useState<Choice>("repeat"),[note,setNote]=useState("");
  const [line,setLine]=useState<string>(),[editing,setEditing]=useState<DishPreference>();
  const [rows,setRows]=useState<DishPreference[]>([]),[next,setNext]=useState<Cursor|null>(null);
  const [page,setPage]=useState<Cursor>(),[refresh,setRefresh]=useState(0),[busy,setBusy]=useState(false);
  const [error,setError]=useState(""),[loading,setLoading]=useState(true),[open,setOpen]=useState(false);
  const items=(detail?.purchase_items??[]) as {id:string;raw_name:string;detail_role?:string}[];
  useEffect(()=>{
    if(!open)return;
    const controller=new AbortController(), query=new URLSearchParams(page);
    if(applied)query.set("shop_name",applied);
    setLoading(true);setError("");
    if(!page){setRows([]);setNext(null);}
    void (async()=>{
      const response=await fetch(`/api/life/dish-preferences?${query}`,{headers,signal:controller.signal});
      if(!response.ok)throw new Error("门店偏好读取失败");
      const result=dishPreferencesResultSchema.parse(await response.json());
      if(controller.signal.aborted)return;
      setRows(old=>page?[...old,...result.items.filter(item=>!old.some(row=>row.id===item.id))]:result.items);
      setNext(result.next);setLoading(false);
    })().catch(cause=>{if(!controller.signal.aborted){setError(String(cause));setLoading(false);}});
    return ()=>controller.abort();
  },[open,headers,applied,page,refresh]);
  function edit(row?:DishPreference){
    setEditing(row);setShop(row?.shop_name??initialShop);setSource(row?.shop_source??initialSource);
    setDish(row?.dish_name??"");setChoice(row?.preference??"try");setLine(row?.purchase_item_id??undefined);setNote(row?.note??"");
  }
  async function save(event:FormEvent,clear=false){
    event.preventDefault();if(busy)return;
    const prior=editing??rows.find(row=>row.shop_name===shop.trim()&&row.shop_source===source.trim()&&row.dish_name===dish.trim());
    setBusy(true);setError("");
    try{
      await execute("life.save_dish_preference",{shop_source:source.trim(),shop_name:shop.trim(),dish_name:dish.trim(),
        preference:clear?"cleared":choice,note:note.trim(),...(line?{purchase_item_id:line}:{}),...(prior?{expected_revision:prior.revision}:{})},
      `dish:${source}:${shop}:${dish}`);
      setApplied(shop.trim());setFilter(shop.trim());edit();setPage(undefined);setRefresh(n=>n+1);
    }catch(cause){setError(cause instanceof Error?cause.message:"保存失败");}finally{setBusy(false);}
  }
  return <details className="detail-meta" onToggle={e=>setOpen(e.currentTarget.open)}><summary>门店菜品偏好</summary>
    <form onSubmit={e=>{e.preventDefault();setApplied(filter.trim());setPage(undefined);setRefresh(n=>n+1);}}>
      <label>按门店查找<input value={filter} placeholder="全部门店" onChange={e=>setFilter(e.target.value)}/></label><button>查找</button></form>
    <ul>{rows.map(row=><li key={row.id}><b>{row.shop_name} · {row.dish_name}</b>（{row.shop_source}） · {choices[row.preference]} {row.note}
      {canWrite&&<button type="button" onClick={()=>edit(row)}>修改偏好</button>}</li>)}</ul>
    {!loading&&!error&&!rows.length&&<p>还没有标记菜品。</p>}
    {next&&<button disabled={loading} onClick={()=>setPage(next)}>更多菜品</button>}
    {canWrite&&<form onSubmit={save}>
      {items.length>0&&<label>从本单带入<select value={line??""} onChange={e=>{const item=items.find(i=>i.id===e.target.value);edit();setLine(item?.id);setDish(item?.raw_name??"");setChoice(item?"repeat":"try");}}><option value="">手动填写</option>{items.filter(i=>i.detail_role!=="folded_summary"&&!/等多件\s*$/u.test(i.raw_name)).map(i=><option key={i.id} value={i.id}>{i.raw_name}</option>)}</select></label>}
      <label>门店或分店名称<input required disabled={!!editing} maxLength={200} value={shop} onChange={e=>setShop(e.target.value)}/></label>
      <label>地点引用或来源<input required disabled={!!editing} maxLength={200} value={source} onChange={e=>setSource(e.target.value)}/></label>
      <label>菜名与做法<input required disabled={!!editing} maxLength={200} value={dish} onChange={e=>setDish(e.target.value)}/></label>
      <label>下次选择<select value={choice} onChange={e=>setChoice(e.target.value as Choice)}>{Object.entries(choices).map(([key,value])=><option key={key} value={key}>{value}</option>)}</select></label>
      <label>口味备注<input maxLength={1000} value={note} onChange={e=>setNote(e.target.value)}/></label>
      <button disabled={busy}>保存菜品偏好</button>{editing&&<><button type="button" disabled={busy} onClick={e=>void save(e,true)}>清除偏好</button><button type="button" onClick={()=>edit()}>新增另一道菜</button></>}
    </form>}{error&&<p role="alert">{error} <button onClick={()=>{setPage(undefined);setRefresh(n=>n+1);}}>重新读取</button></p>}
  </details>;
}
