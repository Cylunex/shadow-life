import {useEffect,useRef,useState} from "react";
import {amountEvidenceResultSchema,type AmountEvidence,type EvidenceField} from "@shadow/contracts";
import type {Execute} from "./command-controller.js";

const fields={paid:"实付",discount:"优惠",delivery:"配送费"} as const;
type Row=AmountEvidence["items"][number];
type Region=NonNullable<Row["region"]>;
type Point={x:number;y:number};
function Original({headers,asset,region,select,page}:{page?:number|null;headers:HeadersInit;asset:string;region:Region|null;select?:(r:Region)=>void}){
  const [url,setUrl]=useState(""),[type,setType]=useState(""),[error,setError]=useState("");
  const [dimensions,setDimensions]=useState({width:0,height:0});
  const start=useRef<Point|null>(null);
  useEffect(()=>{
    const ctrl=new AbortController();let objectUrl:string|undefined;
    setUrl("");setError("");setDimensions({width:0,height:0});
    void fetch(`/api/assets/${encodeURIComponent(asset)}`,{headers,signal:ctrl.signal}).then(async response=>{
      if(!response.ok)throw new Error("当前无法读取原件");const blob=await response.blob();
      if(ctrl.signal.aborted)return;
      objectUrl=URL.createObjectURL(blob);setType(blob.type);setUrl(objectUrl);
    }).catch(e=>{if(!ctrl.signal.aborted)setError(String(e));});
    return ()=>{ctrl.abort();if(objectUrl)URL.revokeObjectURL(objectUrl);};
  },[asset,headers]);
  function point(event:React.PointerEvent<HTMLImageElement>):Point{
    const image=event.currentTarget,box=image.getBoundingClientRect();
    return {x:Math.round(Math.max(0,Math.min(1,(event.clientX-box.left)/box.width))*image.naturalWidth),
      y:Math.round(Math.max(0,Math.min(1,(event.clientY-box.top)/box.height))*image.naturalHeight)};
  }
  const valid=region&&region.image_width===dimensions.width&&region.image_height===dimensions.height;
  return <div>{error&&<p role="alert">{error}</p>}{url&&(type.startsWith("image/")?
    <div style={{position:"relative",display:"inline-block",maxWidth:"100%",lineHeight:0}}>
      <img alt="金额来源原图" src={url} draggable={false} onLoad={e=>setDimensions({width:e.currentTarget.naturalWidth,height:e.currentTarget.naturalHeight})}
        style={{maxWidth:"100%",display:"block",height:"auto",touchAction:select?"none":"auto",cursor:select?"crosshair":"auto"}}
        onPointerDown={e=>{if(select){start.current=point(e);e.currentTarget.setPointerCapture(e.pointerId);}}} onPointerCancel={()=>{start.current=null;}}
        onPointerUp={e=>{if(!select||!start.current)return;const a=start.current,b=point(e);start.current=null;
          if(Math.abs(b.x-a.x)>1&&Math.abs(b.y-a.y)>1)select({space:"original_pixels",x:Math.min(a.x,b.x),y:Math.min(a.y,b.y),width:Math.abs(b.x-a.x),height:Math.abs(b.y-a.y),image_width:dimensions.width,image_height:dimensions.height});
        }}/>
      {valid&&<span aria-label="金额选区" style={{position:"absolute",pointerEvents:"none",border:"2px solid #d65216",boxSizing:"border-box",
        left:`${100*region.x/dimensions.width}%`,top:`${100*region.y/dimensions.height}%`,width:`${100*region.width/dimensions.width}%`,height:`${100*region.height/dimensions.height}%`}}/>}
    </div>:<a href={page&&type==="application/pdf"?url+"#page="+page:url} target="_blank" rel="noreferrer">打开原件</a>)}</div>;
}

export function AmountEvidencePanel({headers,record,execute,canWrite,paid}:{headers:HeadersInit;record:string;execute:Execute;canWrite:boolean;paid:string}){
  const [open,setOpen]=useState(false),[data,setData]=useState<AmountEvidence>(),[refresh,setRefresh]=useState(0);
  const [field,setField]=useState<EvidenceField>("paid"),[amount,setAmount]=useState(paid),[source,setSource]=useState("");
  const [page,setPage]=useState(""),[quote,setQuote]=useState(""),[region,setRegion]=useState<Region|null>(null);
  const [editing,setEditing]=useState(false),[view,setView]=useState<Row>(),[busy,setBusy]=useState(false),[error,setError]=useState("");
  useEffect(()=>{
    if(!open)return;const ctrl=new AbortController();
    void fetch(`/api/life/amount-evidence?record_id=${encodeURIComponent(record)}`,{headers,signal:ctrl.signal}).then(async response=>{
      if(!response.ok)throw new Error("金额来源读取失败");const result=amountEvidenceResultSchema.parse(await response.json());
      if(!ctrl.signal.aborted){setData(result);setError("");}
    }).catch(e=>{if(!ctrl.signal.aborted)setError(String(e));});
    return ()=>ctrl.abort();
  },[open,record,headers,refresh]);
  function begin(key:EvidenceField,row?:Row){
    setField(key);setAmount(row?.amount??(key==="paid"?paid:""));setSource(row?.source_id??data?.sources[0]?.id??"");
    setPage(String(row?.page??""));setQuote(row?.quote??"");setRegion(row?.region??null);setEditing(true);setView(undefined);
  }
  const original=data?.sources.find(s=>s.id===source);
  return <details className="detail-meta" onToggle={e=>setOpen(e.currentTarget.open)}><summary>核对金额来源</summary>
    {data&&<>{data.items.map((r,index)=><p key={r.id??index}><button onClick={()=>{setView(r);setEditing(false);}}>{fields[r.field]} {Number(r.amount)} · 查看依据</button>
      {r.page&&`第 ${r.page} 页／屏`}{canWrite&&<button onClick={()=>begin(r.field,r)}>标注来源</button>}</p>)}
      {!data.items.length&&<p>当前没有已定位的金额。</p>}{canWrite&&data.sources.length>0&&<button onClick={()=>begin("paid")}>添加字段依据</button>}
      {view&&<div>{view.quote&&<blockquote>{view.quote}</blockquote>}{view.page&&<p>来源第 {view.page} 页／屏</p>}
        {view.asset_version_id&&<Original headers={headers} asset={view.asset_version_id} region={view.region} page={view.page}/>}</div>}
      {editing&&<form onSubmit={async e=>{e.preventDefault();if(!original||busy)return;setBusy(true);setError("");
        const prior=data.items.find(r=>r.field===field&&r.revision!==null);
        try{await execute("life.save_amount_evidence",{record_id:record,field,amount,source_id:source,...(original.asset_version_id?{asset_version_id:original.asset_version_id}:{}),
          ...(page?{page:Number(page)}:{}),...(quote.trim()?{quote:quote.trim()}:{}),...(region?{region}:{}),...(prior?{expected_revision:prior.revision}:{})},`evidence:${record}:${field}`);
          setEditing(false);setRefresh(n=>n+1);
        }catch(e){setError(e instanceof Error?e.message:"保存失败");}finally{setBusy(false);}
      }}>
        <label>金额字段<select value={field} onChange={e=>{const key=e.target.value as EvidenceField;begin(key,data.items.find(r=>r.field===key));}}>{Object.entries(fields).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
        <label>原件所示金额<input required type="number" min="0" step="0.000001" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
        <label>所用原件<select value={source} onChange={e=>{setSource(e.target.value);setRegion(null);setQuote("");setPage("");}}>{data.sources.map((s,i)=><option key={s.id} value={s.id}>凭证 {i+1} · {s.asset_version_id?"附件":"文字"}</option>)}</select></label>
        <label>依据原文<input maxLength={500} required={!original?.asset_version_id} value={quote} onChange={e=>setQuote(e.target.value)}/></label>
        {original?.asset_version_id&&<><label>原件页码或截图屏序<input type="number" min="1" max="10000" value={page} onChange={e=>setPage(e.target.value)}/></label>
          <p>在原图拖选可标记金额位置。</p><Original headers={headers} asset={original.asset_version_id} region={region} select={setRegion}/>
          {region&&<button type="button" onClick={()=>setRegion(null)}>清除选区</button>}</>}
        <button disabled={busy}>保存字段依据</button><button type="button" onClick={()=>setEditing(false)}>收起标注</button></form>}</>}
    {error&&<p role="alert">{error} <button onClick={()=>setRefresh(n=>n+1)}>重新读取</button></p>}</details>;
}
