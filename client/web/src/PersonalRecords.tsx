import {useEffect,useRef,useState} from "react";
import QRCode from "qrcode";
import type {WriteCapabilityName} from "@shadow/contracts";
import definitions from "../../features/personal-records.json";
import type {Execute} from "./command-controller.js";

type Field={key:string;label:string;type:string;initial?:string;choices?:Record<string,string>};
type Action={title:string;cap:string;fields:Field[];path?:string;rows?:string;pick?:Record<string,string>};
type Group={title:string;actions:Action[]};
type Row=Record<string,any>;
const groups=definitions as unknown as Group[];
const labels:Record<string,string>={...Object.fromEntries(groups.flatMap(g=>g.actions.flatMap(a=>a.fields.map(f=>[f.key,f.label])))),date:"日期",raw_name:"原名",minutes_per_km:"分钟/公里",duration_minutes:"时长（分钟）",rpe:"主观用力",heart_rate_avg:"平均心率",distance_km:"公里",sleep_minutes:"主睡眠分钟",records:"正式支出明细",basis:"核对依据",occurred_at:"交易时刻",payment_method:"支付渠道",counterparty:"交易对方",import_ids:"导入凭据",order_ids:"订单凭据",record_id:"消费记录",received:"已到账",remaining:"差额",quote:"原文",local_day:"日期",group:"训练分组",path:"位置",name:"名称",kind:"来源",relation:"关联",printed_fare:"票面金额",confirmation_code:"订票编号",service_number:"车次",origin:"发站",destination:"到站",value:"结果",reference:"报告参考范围",report_title:"报告",provenance:"食品出处",refunds:"可分配的退款",amount:"金额",available:"可用",allocated:"已分配",wake_date:"醒来日",samples:"有睡眠数据",days:"天数",missing:"缺测",average_minutes:"平均分钟",starts_at:"发车时刻",source_name:"来源名称",body:"日记",supporting:"详情",starts_on:"开始日期",occurred_on:"发生日期",happened_on:"日期",serving_amount:"标准份量",serving_unit:"标准单位",nutrients:"营养",evidence:"出处",capture_ids:"采集记录",external_id:"外部来源"};
const values:Record<string,string>={same_day_amount:"同日同额，需核对",same_time_amount:"同一时刻同额，需核对",rest:"明确休息",evening:"晚间训练",other:"其他",unknown:"未知",elapsed:"总用时",moving:"移动用时",linked:"已关联",suspected_duplicate:"疑似重复",order_conflict:"订单有冲突",manual:"手工补记",app_usage:"设备使用",mail:"邮件",source:"材料",import_candidate:"导入候选",android_order:"安卓订单"};
const date=(n=0)=>{const d=new Date();d.setDate(d.getDate()+n);return new Intl.DateTimeFormat("sv-SE").format(d);};
const initial=(f:Field)=>f.initial==="today"?date():f.initial==="week"?date(-6):f.initial==="zone"?Intl.DateTimeFormat().resolvedOptions().timeZone:f.initial??"";
const hints:Record<string,string>={refs:"每行填写 类型 编号，如 photo item_…（visit、photo、audio）",allocations:"每行填写 退款编号 分配金额",points:"每行填写 带时区的时刻 程度(0–10) 备注",evidence:"输入出处说明，或 menu_photo 照片编号，或 meal_intake 餐次编号 摄入编号"};
function encodeField(f:Field,s:string):unknown{
  if(f.type==="int")return Number(s);
  if(f.type==="seconds")return Math.round(Number(s)*1000);
  if(f.type==="bool")return s==="true";
  if(f.type==="instant")return new Date(s).toISOString();
  if(f.type==="evidence"){const [kind,a,b]=s.split(/\s+/u);if(kind==="menu_photo")return {kind,library_item_id:a};if(kind==="meal_intake")return {kind,meal_id:a,intake_id:b};return {kind:"note",note:s};}
  if(["refs","allocations","points"].includes(f.type))return s.split("\n").filter(Boolean).map(line=>{
    const [a,b,...rest]=line.trim().split(/\s+/u);
    if(f.type==="refs")return {kind:a,id:b};
    if(f.type==="allocations")return {refund_entry_id:a,amount:b};
    return {at:new Date(a!).toISOString(),severity:Number(b),...(rest.length?{note:rest.join(" ")}:{})};
  });
  return s;
}
function fill(key:string,val:any){
  if(val==null)return "";
  if(key.endsWith("_ms"))return String(val/1000);
  if(key==="refs")return val.map((v:Row)=>v.kind+" "+v.id).join("\n");
  if(key==="points")return val.map((v:Row)=>[v.at,v.severity??"",v.note??""].join(" ").trim()).join("\n");
  if(key==="allocations")return val.filter((v:Row)=>Number(v.allocated)>0).map((v:Row)=>v.refund_entry_id+" "+v.allocated).join("\n");
  if(key==="started_at"||key==="ended_at"){const t=new Date(val);return new Date(t.getTime()-t.getTimezoneOffset()*60000).toISOString().slice(0,19);}
  return String(val);
}
const show=(v:any):string=>Array.isArray(v)?v.map(show).join(" · "):typeof v==="object"&&v?Object.entries(v).filter(([,x])=>x!=null).map(([k,x])=>(labels[k]??k)+" "+show(x)).join("，"):values[String(v)]??String(v);
function download(name:string,blob:Blob){const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);}
function AudioClip({row,headers}:{row:Row;headers:HeadersInit}){
  const [url,setUrl]=useState(""),[error,setError]=useState("");
  useEffect(()=>()=>{if(url)URL.revokeObjectURL(url);},[url]);
  return url?<audio controls autoPlay src={url+"#t="+row.start_ms/1000+","+row.end_ms/1000} onTimeUpdate={e=>{if(e.currentTarget.currentTime>=row.end_ms/1000)e.currentTarget.pause();}}/>:<button type="button" disabled={!row.asset_version_id} onClick={async()=>{try{const r=await fetch("/api/assets/"+row.asset_version_id,{headers});if(!r.ok)throw Error("原声读取失败");setUrl(URL.createObjectURL(await r.blob()));}catch(e){setError(String(e));}}}>{error||(!row.asset_version_id?"原声不可用":"播放选段")}</button>;
}
export function PersonalRecords({headers,execute,capabilities,sections}:{sections?:string[];headers:HeadersInit;execute:Execute;capabilities:ReadonlySet<string>}){
  const link=new URLSearchParams(location.search).get("container");
  const available=groups.filter(g=>(!sections||sections.includes(g.title))&&g.actions.some(a=>capabilities.has(a.cap)));
  const [group,setGroup]=useState(link?"收纳位置":""),[tab,setTab]=useState(0),[open,setOpen]=useState(!!link);
  const [form,setForm]=useState<Record<string,string>>(link?{container_id:link}:{}),[data,setData]=useState<Row>(),[rows,setRows]=useState<Row[]>([]),[next,setNext]=useState<Row>();
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[qr,setQr]=useState(""),[selected,setSelected]=useState<string[]>([]);
  const serial=useRef(0);
  const openedLink=useRef(false);
  const actions=(available.find(g=>g.title===group)??available[0])?.actions.filter(a=>capabilities.has(a.cap))??[],active=actions[tab]??actions[0];
  function reset(){serial.current++;setBusy(false);setData(undefined);setRows([]);setNext(undefined);setSelected([]);setQr("");setMessage("");}
  function field(k:string,v:string){setForm(current=>({...current,[k]:v}));}
  function pick(a:Action,r:Row){const patch:Record<string,string>={};for(const [key,source] of Object.entries(a.pick??{}))patch[key]=fill(key,r[source]);setForm(p=>({...p,...patch}));setMessage("已选中 "+(r.title??r.name??r.label??r.raw_name??r.dish??r.date??r.id));}
  function build(a:Action){const payload:Row={};for(const f of a.fields){const s=(form[f.key]??initial(f)).trim();if(s)payload[f.key]=encodeField(f,s);}
    if(a.cap==="life.place_item"&&!payload.container_id)payload.container_id=null;
    if(a.cap==="life.record_meal"){const {dish,food_ref_id,amount_g,...meal}=payload;return {...meal,items:[{name:dish,food_ref_id,...(amount_g?{amount_g,estimate:true,evidence_note:"本次用餐估重"}:{})}]};}
    return payload;
  }
  async function run(a:Action,more?:Row){const id=++serial.current;setBusy(true);setMessage("");try{
    const payload=build(a);
    if(a.path){const params=new URLSearchParams({...payload,...more}),r=await fetch(a.path+"?"+params,{headers});if(!r.ok)throw Error((await r.json()).message??"读取失败");
      const d=await r.json();if(serial.current!==id)return;const list:Row[]=a.rows==="ticket"?[d]:d[a.rows??"items"]??[];
      setData(d);setRows(prev=>more?[...prev,...list]:list);setSelected([]);
      setNext(d.next_cursor?{cursor:d.next_cursor}:d.next_offset!=null?{offset:d.next_offset}:typeof d.next==="string"?{[a.cap==="library.saved_filters"||a.cap==="life.merchant_menu"?"after":"after_id"]:d.next}:d.next&&typeof d.next==="object"?d.next:(a.rows==="containers"?d.more_containers:d.more_items)?{offset:Number(more?.offset??0)+list.length}:undefined);
      if(!list.length)setMessage("没有匹配的记录");
    }else{const receipt=await execute(a.cap as WriteCapabilityName,payload,"personal:"+a.cap);if(serial.current!==id)return;setMessage("已保存 · "+receipt.resources.map(r=>r.id).join("、"));setForm(p=>({...p,id:"",case_id:"",expected_revision:""}));}
  }catch(e){if(serial.current===id)setMessage(e instanceof Error?e.message:String(e));}finally{if(serial.current===id)setBusy(false);}}
  async function book(r:Row,existing?:Row){try{setBusy(true);const input={reservation_type:"rail",title:[r.service_number,r.origin,r.destination].filter(Boolean).join(" ")||"铁路预订",state:"confirmed",visibility:"private",
    ...Object.fromEntries(["confirmation_code","starts_at","origin","destination","service_number"].filter(k=>r[k]).map(k=>[k,r[k]])),source:{kind:"text",external_id:`library:${r.library_item_id}:r${r.library_revision}`,captured_on:date(),original_text:r.quote}};
    await execute(existing?"travel.correct_reservation":"travel.add_reservation",existing?{...input,reservation_id:existing.id,expected_revision:existing.revision,reason:"按铁路确认单更正"}:{...input,trip_id:form.trip_id},"rail-ticket:"+r.library_item_id);await run(active!);setMessage("预订已保存");}catch(e){setMessage(String(e));}finally{setBusy(false);}}
  async function exportDiary(row:Row){try{const refs=[];for(const ref of row.refs){const copy={...ref};if(ref.asset_version_id){const r=await fetch("/api/assets/"+ref.asset_version_id,{headers});if(!r.ok)throw Error("原件不可导出");const blob=await r.blob();copy.data=await new Promise((ok,fail)=>{const reader=new FileReader();reader.onload=()=>ok(reader.result);reader.onerror=fail;reader.readAsDataURL(blob);});}refs.push(copy);}
    download("旅行小记-"+row.local_day+".json",new Blob([JSON.stringify({...row,refs},null,2)],{type:"application/json"}));}catch(e){setMessage(String(e));}}
  useEffect(()=>{if(link&&!openedLink.current&&active?.cap==="life.containers"){openedLink.current=true;void run(active);}},[link,active]);
  if(!active)return null;
  return <details open={open} onToggle={e=>setOpen(e.currentTarget.open)}><summary>{sections?.join("、")??"生活记录与复盘"}</summary>{open&&<section className="compact-form">
    <label>方向<select aria-label="方向" value={group||available[0]?.title} onChange={e=>{reset();setGroup(e.target.value);setTab(0);setForm({});}}>{available.map(g=><option key={g.title}>{g.title}</option>)}</select></label>
    <label>操作<select aria-label="操作" value={tab} onChange={e=>{reset();setTab(Number(e.target.value));}}>{actions.map((a,i)=><option key={a.title} value={i}>{a.title}</option>)}</select></label>
    {active.fields.map(f=><label key={f.key}>{f.label}{f.type==="choice"||f.type==="bool"?<select aria-label={f.label} value={form[f.key]??initial(f)} onChange={e=>field(f.key,e.target.value)}><option value="">请选择</option>{Object.entries(f.choices??{true:"是",false:"否"}).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>:hints[f.type]||f.type==="long"?<textarea value={form[f.key]??initial(f)} placeholder={hints[f.type]} onChange={e=>field(f.key,e.target.value)}/>:<input type={f.type==="date"?"date":f.type==="instant"?"datetime-local":["int","seconds","decimal"].includes(f.type)?"number":"text"} step="any" value={form[f.key]??initial(f)} onChange={e=>field(f.key,e.target.value)}/>}</label>)}
    <div><button type="button" disabled={busy} onClick={()=>void run(active)}>{busy?"处理中…":active.path?"查询":active.title}</button> <button type="button" className="secondary" disabled={busy} onClick={()=>{setForm({});reset();}}>清空选择</button></div>
    {message&&<p role="status">{message}</p>}
    {data?.coverage==="unknown_outside_observations"&&<p>已记录 {data.active_minutes} 分钟 · 其余时段覆盖未知</p>}
    {data?.confirmed_expenses!==undefined&&<p>正式支出 {data.confirmed_expenses} 笔，合计 {data.gross_amount} {data.currency}。同日同额的 {data.candidate_groups} 组仍计入合计。</p>}
    {data?.evening&&<p>晚间训练 {show(data.evening)}；休息日 {show(data.rest)}</p>}
    {rows.map((r,i)=><article key={r.id??r.date??i}><dl>{Object.entries(r).filter(([k,v])=>v!=null&&k in labels&&k!=="expected_revision"&&k!=="time_zone"&&typeof v!=="boolean"&&(!Array.isArray(v)||v.length>0)).map(([k,v])=><div key={k}><dt>{labels[k]}</dt><dd>{show(v)}</dd></div>)}</dl>
      {active.pick&&r.editable!==false&&<button type="button" onClick={()=>pick(active,r)}>选择这条记录</button>}
      {active.cap==="health.lab_results"&&<><a href={"?tab=library&section=browse&item="+encodeURIComponent(r.report_id)}>查看原报告 · 第 {r.page} 页</a><button type="button" onClick={()=>{field("left_id",r.id);setMessage("已选第一项");}}>选为第一项</button><button type="button" onClick={()=>{field("right_id",r.id);setMessage("已选第二项");}}>选为第二项</button></>}
      {active.cap==="health.evening_sleep"&&<>{[...(r.workouts??[]),...(r.sleep_id?[{id:r.sleep_id}]:[])].map((fact:Row)=><a key={fact.id} href={"?tab=record&section=timeline&domain=health&kind="+(fact.id===r.sleep_id?"sleep_session":"workout_session")+"&id="+encodeURIComponent(fact.id)}>{fact.id===r.sleep_id?"查看主睡眠":"查看训练"}</a>)}</>}
      {active.cap==="health.episodes"&&<label><input type="checkbox" checked={selected.includes(r.id)} onChange={()=>setSelected(prev=>prev.includes(r.id)?prev.filter(id=>id!==r.id):[...prev,r.id])}/>加入导出</label>}
      {active.cap==="life.clips"&&<AudioClip headers={headers} row={r}/>}
      {active.cap==="travel.diary"&&<button type="button" onClick={()=>void exportDiary(r)}>导出此篇及所选原件</button>}
      {active.cap==="life.containers"&&active.rows==="containers"&&<button type="button" onClick={async()=>{const u=new URL(location.pathname,location.origin);u.searchParams.set("tab","record");u.searchParams.set("section","timeline");u.searchParams.set("container",r.id);setQr(await QRCode.toDataURL(u.href,{width:240}));}}>显示容器二维码</button>}
      {active.cap==="travel.rail_ticket"&&(r.matched.length?r.matched.map((b:Row)=><button key={b.id} disabled={busy||!capabilities.has("travel.correct_reservation")} onClick={()=>void book(r,b)}>更正 {b.title}</button>):<button disabled={busy||!r.service_number||!capabilities.has("travel.add_reservation")} onClick={()=>void book(r)}>保存为私人铁路预订</button>)}
    </article>)}
    {selected.length>0&&<button onClick={()=>download("发作摘要.json",new Blob([JSON.stringify(rows.filter(r=>selected.includes(r.id)),null,2)],{type:"application/json"}))}>导出选中的 {selected.length} 条</button>}
    {qr&&<img src={qr} alt="容器二维码"/>}{next&&<button disabled={busy} onClick={()=>void run(active,next)}>下一页</button>}
  </section>}</details>;
}
