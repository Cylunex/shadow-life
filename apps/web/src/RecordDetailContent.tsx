import { useState, type ReactNode } from "react";
import { TravelItinerary } from "./TravelItinerary.js";
import { itineraryDates, selectedItineraryDate, type TravelDayPlan, type TravelTrip } from "./travel-workspace.js";
import { formatInTimeZone } from "./travel-time.js";
import { formatMoneyAmount } from "./money-display.js";
import { recordRelations, recordTitle, type RecordSelection } from "./record-detail.js";

const metadata=new Set(["id","record_id","meal_id","subject_id","revision","created_at","updated_at","as_of","kind","source_id","raw_id","group_id","raw_version","current_revision","plan_id","trip_id","stop_id","position","food_ref_id","purchase_id","source_scale","effective","related_records","related_observations"]);
const sources=new Set(["sources","source","raw","revisions","proofs","legacy_links","processing_jobs","derivations","members","plan_versions","my_runs"]);
const labels:Record<string,string>={occurred_on:"发生日",occurred_at:"发生时间",starts_on:"开始日期",ends_on:"结束日期",starts_at:"开始时间",ends_at:"结束时间",started_at:"开始时间",ended_at:"结束时间",wake_date:"醒来日期",time_zone:"时区",title:"标题",name:"名称",note:"备注",notes:"备注",state:"状态",amount:"金额",currency:"币种",entry_type:"类型",counterparty:"交易对方",category:"分类",payment_method:"支付方式",metric:"指标",metric_key:"指标",value:"数值",unit:"单位",meal_type:"餐次",money_entry:"账目",purchase:"消费",purchase_items:"购买明细",meals:"关联餐次",items:"食物与内容",payments:"付款",trip:"旅程",reservations:"预订",segments:"实际交通",visits:"实际到访",item:"资料",annotations:"批注",fact:"记录内容",raw_name:"名称",quantity:"数量",unit_price:"单价",line_amount:"明细金额",energy_kcal:"热量（kcal）",protein_g:"蛋白质（g）",fat_g:"脂肪（g）",carb_g:"碳水（g）",fiber_g:"膳食纤维（g）",sodium_mg:"钠（mg）",amount_g:"重量（g）",estimate:"估算",evidence_note:"依据",merchant:"商家",scene:"场景",channel_name_raw:"渠道",rating:"评分",would_repeat:"愿意再来",origin:"出发地",destination:"目的地",mode:"交通方式",distance_km:"距离（km）",place_name:"地点",reservation_type:"预订类型",service_number:"班次",seat:"座位",confirmation_code:"确认号",visibility:"可见范围",text:"正文",url:"链接",tags:"标签",reading_state:"阅读进度",total_minutes:"时长（分钟）",deep_minutes:"深睡（分钟）",light_minutes:"浅睡（分钟）",rem_minutes:"REM（分钟）",awake_minutes:"清醒（分钟）",steps:"步数",active_minutes:"活跃分钟",effective_calories_kcal:"活动热量（kcal）",duration_minutes:"时长（分钟）",heart_rate_avg:"平均心率",session_type:"运动",label:"标签",autofilled:"推导值",original_field:"原字段",done_count:"完成次数",explicit_denial:"明确未完成",habit_key:"习惯",mood_score:"心情",energy_level:"精力",sleep_quality:"睡眠质量",progress:"进度"};
const values:Record<string,string>={dine_in:"堂食",takeout:"外卖",delivery:"配送",groceries:"食材采购",online:"线上",offline:"线下",breakfast:"早餐",lunch:"午餐",dinner:"晚餐",snack:"加餐",other:"其他",expense:"支出",income:"收入",refund:"退款",confirmed:"已确认",draft:"草稿",voided:"已作废",active:"有效",archived:"已归档",cancelled:"已取消",private:"私密",shared:"共享",weight:"体重",body_fat:"体脂率",heart_rate:"心率",steps:"步数",walk:"步行",rail:"铁路",flight:"航班",hotel:"住宿",restaurant:"餐厅",activity:"活动",wechat:"微信",alipay:"支付宝",cash:"现金",bank_card:"银行卡"};
const obj=(value:unknown):Record<string,unknown>=>value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:{};

export function RecordDetailContent({value,selection}:{value:Record<string,unknown>;selection:RecordSelection}){
  const trip=obj(value.trip),fact=obj(value.fact),entry=obj(value.money_entry),item=obj(value.item),zone=String(trip.time_zone??fact.time_zone??value.time_zone??"UTC");
  const relations=recordRelations(value),[date,setDate]=useState<string>(),[allRelations,setAllRelations]=useState(false);
  const plans=(Array.isArray(value.day_plans)?value.day_plans:[]) as TravelDayPlan[],travelTrip=trip as unknown as TravelTrip;
  const dates=trip.starts_on?itineraryDates(travelTrip,plans):[],selectedDate=selectedItineraryDate(dates,date,formatInTimeZone(new Date(),zone).slice(0,10));
  const content=Object.entries(value).filter(([key,content])=>!isMetadata(key)&&!sources.has(key)&&content!==null&&content!==undefined&&!(["payments","meals","day_plans"].includes(key)));
  const basics=Object.fromEntries(content.filter(([,item])=>typeof item!=="object")),sections=content.filter(([,item])=>typeof item==="object");
  return <div className="record-detail-content">
    <header className={`record-hero ${selection.domain}`}><small>{({meals:"饮食记录",money:"消费记录",health:"健康记录",travel:"旅行",library:"资料"})[selection.domain]}</small><h2>{recordTitle(value,selection)}</h2>{entry.amount!==undefined&&<strong>{formatMoneyAmount(entry.amount,entry.currency,entry.source_scale)} {String(entry.currency??"")}</strong>}{fact.value!==undefined&&<strong>{formatMoneyAmount(fact.value)} {String(fact.unit??"")}</strong>}<p>{String(value.occurred_on??fact.occurred_on??fact.wake_date??trip.starts_on??item.item_type??"")}{trip.ends_on?` — ${String(trip.ends_on)}`:""}</p></header>
    {relations.length>0&&<section className="detail-relations"><h3>关联记录</h3><div>{(allRelations?relations:relations.slice(0,6)).map(link=><a key={link.href} href={link.href}><b>{link.title}</b>{link.supporting&&<span>{link.supporting}</span>}<small>查看详情 →</small></a>)}</div>{relations.length>6&&<button type="button" className="text-button" onClick={()=>setAllRelations(!allRelations)}>{allRelations?"收起":`查看全部 ${relations.length} 条关联`}</button>}</section>}
    {Boolean(trip.starts_on)&&<><TravelItinerary trip={travelTrip} plans={plans} date={selectedDate} onDate={setDate}/><a className="detail-workspace-link" href={`?tab=plan&section=travel&trip=${encodeURIComponent(String(trip.id))}`}>打开旅行工作台，调整日程 →</a></>}
    <div className="detail-sections">{Object.keys(basics).length>0&&<section className="detail-section"><h3>基本信息</h3><DetailValue value={basics} field="basics" zone={zone}/></section>}{sections.map(([key,content])=><section className="detail-section" key={key}><h3>{labels[key]??key.replaceAll("_"," ")}</h3><DetailValue value={content} field={key} zone={zone}/></section>)}</div>
    <details className="detail-meta"><summary>来源与版本</summary><pre>{JSON.stringify(Object.fromEntries(Object.entries(value).filter(([key])=>sources.has(key)||metadata.has(key))),null,2)}</pre></details>
  </div>;
}
function isMetadata(key:string):boolean{return metadata.has(key)||key.endsWith("_id");}
function DetailValue({value,field,zone}:{value:unknown;field:string;zone:string}):ReactNode{
  const[expanded,setExpanded]=useState(false);
  if(value===null||value===undefined||value==="")return <span className="unknown-value">未记录</span>;
  if(typeof value==="boolean")return value?"是":"否";
  if(typeof value==="string"||typeof value==="number"){
    if(typeof value==="string"&&/^\d{4}-\d\d-\d\dT/.test(value))return formatInTimeZone(value,zone).replace("T"," ");
    const translated=["scene","state","entry_type","meal_type","metric","metric_key","mode","reservation_type","visibility","payment_method"].includes(field)?values[String(value)]:undefined;
    return translated??(typeof value==="number"||["value","quantity","amount_g","energy_kcal","protein_g","fat_g","carb_g","fiber_g","sodium_mg","distance_km"].includes(field)?formatMoneyAmount(value):String(value));
  }
  if(Array.isArray(value))return <>{!value.length?<span className="unknown-value">暂无记录</span>:<ul className="detail-object-list">{(expanded?value:value.slice(0,4)).map((row,index)=><li key={String(obj(row).id??index)}><DetailValue value={row} field={field} zone={zone}/></li>)}</ul>}{value.length>4&&<button type="button" className="text-button" onClick={()=>setExpanded(!expanded)}>{expanded?"收起":`展开全部 ${value.length} 项`}</button>}</>;
  const rows=Object.entries(obj(value)).filter(([key,content])=>!isMetadata(key)&&content!==null);
  return <dl className="structured-fields">{rows.map(([key,content])=><div key={key}><dt>{labels[key]??key.replaceAll("_"," ")}</dt><dd>{["amount","line_amount","unit_price"].includes(key)?formatMoneyAmount(content,obj(value).currency,obj(value).source_scale):<DetailValue value={content} field={key} zone={zone}/>}</dd></div>)}</dl>;
}
