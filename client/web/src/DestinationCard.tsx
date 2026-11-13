import {useEffect,useState} from "react";
import type {Destinations} from "@shadow/contracts";
import {fetchDestinations,offlineDriverCard} from "./travel-destination.js";
import {isConfirmedOvernight,type TravelReservation} from "./travel-reservations.js";
import type {TravelPlace} from "./travel-workspace.js";
import type {Execute} from "./command-controller.js";
type Props={trip:string;on:string;zone:string;places:TravelPlace[];bookings:TravelReservation[];headers:HeadersInit;
  execute:Execute;canWrite:boolean;download:(v:{content:string;mime_type:string;filename:string})=>void};
export function DestinationCard({trip,on,zone,places,bookings,headers,execute,canWrite,download}:Props){
  const [data,setData]=useState<Destinations>(),[retry,setRetry]=useState(0),[edit,setEdit]=useState(false),[show,setShow]=useState(false);
  const [place,setPlace]=useState(""),[hotel,setHotel]=useState(""),[name,setName]=useState(""),[address,setAddress]=useState(""),[entrance,setEntrance]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{const c=new AbortController();void fetchDestinations(trip,headers,on,c.signal).then(v=>{if(!c.signal.aborted){setData(v);setError("");}})
    .catch(e=>{if(!c.signal.aborted)setError(String(e));});return ()=>c.abort();},[on,trip,headers,retry,bookings]);
  const row=data?.items[0],hotels=bookings.filter(b=>isConfirmedOvernight(b,on,zone));
  function begin(){setHotel(row?.hotel_id??"");setPlace(row?.place_id??"");setName(row?.local_name??"");setAddress(row?.address??"");setEntrance(row?.entrance??"");setEdit(true);}
  return <section aria-label="目的地卡"><h3>目的地卡</h3>{row?.name&&<><p>{row.name} · {row.address??"地址待补"}</p>
    <button onClick={()=>setShow(true)}>给司机看</button><button onClick={()=>download({content:offlineDriverCard(row,data!.as_of),filename:on+"-目的地.html",mime_type:"text/html;charset=utf-8"})}>保存离线目的地卡</button></>}
    {canWrite&&data&&!edit&&<button onClick={begin}>{row?.name?"编辑目的地卡":"选择目的地"}</button>}
    {show&&row&&<dialog open aria-label="给司机看的目的地" style={{position:"fixed",inset:0,margin:0,maxWidth:"100vw",maxHeight:"100vh",width:"100%",height:"100%",zIndex:100,boxSizing:"border-box",padding:"8vw",overflow:"auto"}}>
      <div style={{fontSize:"clamp(2rem,7vw,4rem)",lineHeight:1.35}}>{[row.local_name,row.name,row.address,row.entrance].filter((s,i,a)=>s&&a.indexOf(s)===i).map(s=><p key={s}>{s}</p>)}</div><button onClick={()=>setShow(false)}>关闭大字卡</button></dialog>}
    {edit&&<form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await execute("travel.save_destination",{trip_id:trip,on,...(hotel?{reservation_id:hotel}:{}),
      ...(place?{place_id:place}:{}),...(name.trim()?{local_name:name.trim()}:{}),...(address.trim()?{address:address.trim()}:{}),...(entrance.trim()?{entrance:entrance.trim()}:{}),
      ...(row?.revision?{expected_revision:row.revision}:{})},`destination:${trip}:${on}`);setEdit(false);setRetry(n=>n+1);
    }catch(e){setError(e instanceof Error?e.message:"保存失败");}finally{setBusy(false);}}}>
      <label>当晚住宿<select value={hotel} onChange={e=>{setHotel(e.target.value);setAddress(hotels.find(b=>b.id===e.target.value)?.destination??"");}}><option value="">手选地点</option>{hotels.map(b=><option key={b.id} value={b.id}>{b.title}</option>)}</select></label>
      <label>关联地点<select value={place} onChange={e=>{setPlace(e.target.value);setAddress(places.find(p=>p.id===e.target.value)?.address??"");}}><option value="">使用住宿名称</option>{places.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>当地名称<input maxLength={200} value={name} onChange={e=>setName(e.target.value)}/></label><label>街道地址<input maxLength={600} value={address} onChange={e=>setAddress(e.target.value)}/></label>
      <label>入口说明<input maxLength={400} value={entrance} onChange={e=>setEntrance(e.target.value)}/></label>
      <button disabled={busy||(!place&&!hotel)}>保存目的地</button><button type="button" onClick={()=>setEdit(false)}>取消</button></form>}
    {error&&<p role="alert">{error} <button onClick={()=>setRetry(n=>n+1)}>重新读取</button></p>}</section>;
}
