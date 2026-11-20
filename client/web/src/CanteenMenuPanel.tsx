import { useEffect,useState,type FormEvent } from "react";
import { buildCapabilityHttpRequest,dietFoodGroupLabels,merchantDishProfileSchema,merchantMenuResultSchema,rememberMerchantDishSchema } from "@shadow/contracts";
import type { Execute } from "./command-controller.js";

type Menu=ReturnType<typeof merchantMenuResultSchema.parse>;
type Profile=ReturnType<typeof merchantDishProfileSchema.parse>;
type Draft={
  dish:string;stall:string;aliases:string;cooking:string;groups:NonNullable<Profile["groups"]>;classify:boolean;staple:""|"yes"|"no";
  quantity:string;unit:string;grams:string;estimated:boolean;basis:string;evidence:string;
  nutrients:Partial<Record<keyof NonNullable<NonNullable<Profile["portion"]>["nutrients"]>,string|undefined>>;
};
const blank=():Draft=>({dish:"",stall:"",aliases:"",cooking:"",groups:[],classify:false,staple:"",
  quantity:"",unit:"",grams:"",estimated:false,basis:"",evidence:"",nutrients:{}});
const nutrientLabels={energy_kcal:"热量（kcal）",protein_g:"蛋白质（g）",fat_g:"脂肪（g）",carb_g:"碳水（g）",
  fiber_g:"纤维（g）",sodium_mg:"钠（mg）",calcium_mg:"钙（mg）",iron_mg:"铁（mg）"} as const;

export function CanteenMenuPanel({merchant,day,headers,execute,canEdit,onSaved}:{merchant:string;day:string;headers:HeadersInit;execute:Execute;canEdit:boolean;onSaved:()=>void}){
  const [query,setQuery]=useState(""),[searchTerm,setSearchTerm]=useState("");
  const [rows,setRows]=useState<Menu>(),[error,setError]=useState(""),[busy,setBusy]=useState(false);
  const [picked,setPicked]=useState<Menu["items"][number]>(),[draft,setDraft]=useState<Draft>();
  const [reload,setReload]=useState(0),[after,setAfter]=useState<string>();
  useEffect(()=>{
    const abort=new AbortController();
    setBusy(true);setError("");
    const target=buildCapabilityHttpRequest("","life.merchant_menu",{merchant,on:day,...(searchTerm?{query:searchTerm}:{}),with_profiles:"1",limit:25,...(after?{after}:{})});
    void fetch(target.url,{headers,signal:abort.signal}).then(async response=>{
      if(!response.ok)throw Error(response.status===409?"请输入门店或先设置常去食堂":`菜单读取失败（${response.status}）`);
      const result=merchantMenuResultSchema.parse(await response.json());
      if(!abort.signal.aborted)setRows(previous=>after&&previous?.merchant===result.merchant?{...result,items:[...previous.items,...result.items]}:result);
    }).catch(e=>{if(!abort.signal.aborted)setError(e instanceof Error?e.message:"菜单读取失败")})
      .finally(()=>{if(!abort.signal.aborted)setBusy(false)});
    return()=>abort.abort();
  },[after,day,headers,merchant,reload,searchTerm]);
  function search(event:FormEvent){
    event.preventDefault();setAfter(undefined);setRows(undefined);setDraft(undefined);setPicked(undefined);
    setSearchTerm(query.trim());setReload(n=>n+1);
  }
  function edit(item?:Menu["items"][number]){
    setError("");setPicked(item);setDraft(item?{...blank(),dish:item.dish,stall:item.profile?.stall??"",aliases:item.profile?.aliases.join("、")??"",
      cooking:item.profile?.cooking??"",groups:item.profile?.groups??[],classify:item.profile?.groups!==undefined,
      staple:item.profile?.staple===true?"yes":item.profile?.staple===false?"no":"",
      quantity:item.profile?.portion?.quantity??"",unit:item.profile?.portion?.unit??"",grams:item.profile?.portion?.grams??"",
      basis:item.profile?.portion?.basis??"",estimated:item.profile?.portion?.estimated??false,nutrients:item.profile?.portion?.nutrients??{}}:blank());
  }
  function field<K extends keyof Draft>(key:K,value:Draft[K]){setDraft(old=>old?{...old,[key]:value}:old)}
  async function save(event:FormEvent){
    event.preventDefault();if(!rows||!draft||busy)return;
    setError("");setBusy(true);
    try{
      const profile=merchantDishProfileSchema.parse({
        aliases:draft.aliases.split(/[、,，]/u).map(v=>v.trim()).filter(Boolean),...(draft.cooking.trim()?{cooking:draft.cooking.trim()}:{}),
        ...(draft.classify?{groups:draft.groups}:{}),...(draft.staple?{staple:draft.staple==="yes"}:{}),
        ...(draft.quantity||draft.unit||draft.grams||draft.basis||Object.values(draft.nutrients).some(Boolean)?{
          portion:{quantity:draft.quantity.trim(),unit:draft.unit.trim(),...(draft.grams.trim()?{grams:draft.grams.trim()}:{}),
            basis:draft.basis.trim(),estimated:draft.estimated,
            nutrients:Object.fromEntries(Object.entries(draft.nutrients).filter(([,v])=>v?.trim()).map(([k,v])=>[k,v!.trim()]))}
        }:{})
      });
      const input=rememberMerchantDishSchema.parse({
        merchant:rows.merchant,dish:draft.dish,...(picked||draft.stall.trim()?{stall:draft.stall.trim()||null}:{}),
        ...(picked?{food_id:picked.id,expected_revision:picked.revision}:{}),profile,evidence:{kind:"note",note:draft.evidence.trim()}
      });
      await execute("life.remember_merchant_dish",input,`canteen:${picked?.id??rows.merchant}`);
      setDraft(undefined);setPicked(undefined);setRows(undefined);setAfter(undefined);setReload(n=>n+1);onSaved();
    }catch(e){setError(e instanceof Error&&e.name!=="ZodError"?e.message:"请核对菜名、出处，以及常用份量的数字、单位和依据。");setBusy(false);}
  }
  return <section className="wellness-review canteen-menu" aria-label="门店菜品档案">
    <div className="panel-heading"><h3>{merchant} · 菜品档案</h3></div>
    <form className="canteen-form" onSubmit={search}>
      <label>搜索菜名或别名<input maxLength={160} value={query} onChange={e=>setQuery(e.target.value)}/></label>
      <button disabled={busy}>查询菜单</button>
    </form>
    {busy&&!rows&&<p role="status">正在读取门店菜单…</p>}
    {error&&<p role="alert">{error} {!draft&&<button type="button" onClick={()=>setReload(n=>n+1)}>重试</button>}</p>}
    {rows&&<>
      <div className="diet-card-title">{canEdit&&<button type="button" onClick={()=>edit()}>收录菜品</button>}</div>
      <div className="meal-diet-items">{rows.items.map(item=><article key={item.id}>
        <strong>{item.dish}</strong>
        <small>{[item.profile?.stall,item.profile?.cooking,...(item.profile?.groups??[]).map(group=>dietFoodGroupLabels[group])].filter(Boolean).join(" · ")}</small>
        {item.profile?.aliases.length?<small>别名 {item.profile.aliases.join("、")}</small>:null}
        {item.profile?.portion?<small>{item.profile.portion.quantity} {item.profile.portion.unit}{item.profile.portion.grams?` · ${item.profile.portion.estimated?"约 ":""}${item.profile.portion.grams} g`:""}</small>:null}
        {item.profile?.portion?.basis&&<small>{item.profile.portion.basis}</small>}
        {canEdit&&<button className="secondary" type="button" onClick={()=>edit(item)}>补充菜品档案</button>}
      </article>)}</div>
      {!rows.items.length&&<p>当前门店没有匹配的菜品。</p>}
      {rows.stall_prices?.length ? <details><summary>当日有效的档口价目（{rows.stall_prices.length}）</summary><ul>{rows.stall_prices.map(price =>
        <li key={JSON.stringify([price.stall,price.price_name,price.valid_from])}>{price.stall} · {price.price_name} · {price.terms.price_cny} 元／{price.terms.mode==="by_weight" ? price.terms.per_grams+" g" : "份"}
          {Number(price.terms.staple_fee_cny)>0 && ` · 主食费 ${price.terms.staple_fee_cny} 元`} · {price.evidence_note}</li>)}</ul></details> : null}
      {rows.next&&<button type="button" disabled={busy} onClick={()=>setAfter(rows.next!)}>加载更多菜品</button>}
    </>}
    {draft&&<form className="canteen-editor" onSubmit={save}>
      <h3>{picked?`补充 ${picked.dish}`:"收录常吃菜品"}</h3>
      <div className="canteen-form">
        <label>菜名<input value={draft.dish} readOnly={!!picked} onChange={e=>field("dish",e.target.value)} required/></label>
        <label>档口<input value={draft.stall} onChange={e=>field("stall",e.target.value)}/></label>
        <label>别名<input value={draft.aliases} onChange={e=>field("aliases",e.target.value)} placeholder="用顿号分隔"/></label>
        <label>做法<input value={draft.cooking} onChange={e=>field("cooking",e.target.value)}/></label>
        <label>是否主食<select value={draft.staple} onChange={e=>field("staple",e.target.value as Draft["staple"])}><option value="">按名称识别</option><option value="yes">主食</option><option value="no">其他</option></select></label>
      </div>
      <fieldset><legend>食物类别</legend>
        <label><input type="checkbox" checked={draft.classify} onChange={e=>field("classify",e.target.checked)}/>使用手工分类</label>
        {draft.classify&&Object.entries(dietFoodGroupLabels).map(([key,label])=>{const group=key as Draft["groups"][number];return <label key={key}><input type="checkbox" checked={draft.groups.includes(group)} onChange={e=>field("groups",e.target.checked?[...draft.groups,group]:draft.groups.filter(value=>value!==group))}/>{label}</label>})}
      </fieldset>
      <fieldset><legend>常用份量</legend><div className="canteen-form">
        <label>数量<input inputMode="decimal" value={draft.quantity} onChange={e=>field("quantity",e.target.value)} placeholder="如 1"/></label>
        <label>单位<input value={draft.unit} onChange={e=>field("unit",e.target.value)} placeholder="如 平勺"/></label>
        <label>对应克重<input inputMode="decimal" value={draft.grams} onChange={e=>field("grams",e.target.value)}/></label>
        <label><input type="checkbox" checked={draft.estimated} onChange={e=>field("estimated",e.target.checked)}/>估算份量或营养</label>
        <label>份量与营养依据<input value={draft.basis} onChange={e=>field("basis",e.target.value)} placeholder="如 本人实称一平勺熟菜"/></label>
      </div></fieldset>
      <details><summary>填写这份的营养</summary><div className="canteen-form">{Object.entries(nutrientLabels).map(([key,label])=>{
        const name=key as keyof Draft["nutrients"];
        return <label key={key}>{label}<input inputMode="decimal" value={draft.nutrients[name]??""} onChange={e=>field("nutrients",{...draft.nutrients,[name]:e.target.value})}/></label>;
      })}</div></details>
      <label>这次补充的出处<input required value={draft.evidence} onChange={e=>field("evidence",e.target.value)}/></label>
      <div className="actions"><button disabled={busy}>保存菜品</button><button type="button" className="secondary" onClick={()=>setDraft(undefined)}>取消</button></div>
    </form>}
  </section>;
}
