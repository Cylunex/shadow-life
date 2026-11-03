import { useEffect, useState } from "react";

type Destination = { tab:"record"|"plan"|"library"; section:string };
const entries:Array<Destination & {title:string;words:string;group:string;permission:string}> = [
  {title:"体重、睡眠与健康趋势",words:"昨晚 睡了多久 体脂 称重",group:"健康与运动",permission:"health.trend",tab:"record",section:"health"},
  {title:"继续训练与动作库",words:"健身 飞鸟 卧推 运动",group:"健康与运动",permission:"health.records",tab:"record",section:"training"},
  {title:"饮食日记与营养复盘",words:"早餐 午餐 晚餐 摄入 吃了什么",group:"饮食与食材",permission:"life.list_meals",tab:"record",section:"food"},
  {title:"餐单、食谱与购物清单",words:"买菜 待买 库存 菜谱 食材",group:"饮食与食材",permission:"life.meal_planning",tab:"plan",section:"meals"},
  {title:"消费记录",words:"付款 支出 收入 退款",group:"消费与物品",permission:"money.records",tab:"record",section:"money"},
  {title:"次卡余额与使用",words:"理发卡 课时 洗车 剩余几次",group:"消费与物品",permission:"money.service_cards",tab:"plan",section:"cards"},
  {title:"账单导入与核对",words:"导入账单 核对 差异",group:"消费与物品",permission:"money.import_review",tab:"plan",section:"import"},
  {title:"预算与周期费用",words:"续费 扣费 订阅 预算",group:"消费与物品",permission:"money.planning",tab:"plan",section:"budget"},
  {title:"物品保修与说明书",words:"家电 退货 凭证 保修期",group:"消费与物品",permission:"life.owned_items",tab:"record",section:"items"},
  {title:"消耗品与补给",words:"用完 剩余 补货 库存",group:"消费与物品",permission:"money.planning",tab:"plan",section:"supplies"},
  {title:"旅行行程、预订与地图",words:"酒店 车票 住宿 出行 地点",group:"旅行",permission:"travel.workspace",tab:"plan",section:"travel"},
  {title:"生活项目",words:"下一步 行动 项目 日程",group:"计划与回顾",permission:"life.projects",tab:"plan",section:"projects"},
  {title:"生活回顾",words:"一周 回忆 复盘",group:"计划与回顾",permission:"life.reviews",tab:"plan",section:"reviews"},
  {title:"资料与原件",words:"票券 PDF 文件 照片 链接 笔记",group:"资料",permission:"library.records",tab:"library",section:"browse"}
];
export function FeatureDirectory({capabilities,headers,onOpen,onClose}:{capabilities:ReadonlySet<string>;headers:HeadersInit;onOpen:(target:Destination)=>void;onClose:()=>void}){
  const [query,setQuery]=useState("");
  const [records,setRecords]=useState<Array<{domain:string;kind:string;id:string;title:string;supporting?:string;record_id?:string}>>([]);
  const [recordStatus,setRecordStatus]=useState("");
  useEffect(()=>{
    const controller=new AbortController();
    setRecords([]);setRecordStatus("");
    if(!query.trim()||!capabilities.has("life.search"))return()=>controller.abort();
    setRecordStatus("正在查找相关记录…");
    const timer=setTimeout(()=>{
      void fetch("/api/search?"+new URLSearchParams({q:query.trim(),limit:"10"}),{headers,signal:controller.signal}).then(async response=>{
        if(!response.ok)throw new Error("暂时无法查找记录，功能入口仍可使用");
        const data=await response.json() as {items:typeof records;next_cursor:string|null};
        if(!controller.signal.aborted){setRecords(data.items);setRecordStatus(data.next_cursor?"显示最近匹配的 10 条记录":data.items.length?"":"没有匹配的生活记录");}
      }).catch(error=>{if(!controller.signal.aborted)setRecordStatus(error instanceof Error?error.message:"记录读取失败");});
    },250);
    return()=>{controller.abort();clearTimeout(timer);};
  },[query,headers]);
  const available=entries.filter(entry=>capabilities.has(entry.permission));
  const shown=available.filter(entry=>(entry.title+" "+entry.words+" "+entry.group).includes(query.trim()));
  return <div className="quick-layer" role="dialog" aria-modal="true" aria-label="全部功能">
    <button type="button" className="layer-scrim" aria-label="关闭全部功能" onClick={onClose}/>
    <section className="quick-sheet">
      <div className="panel-heading"><h2>全部功能</h2><button type="button" onClick={onClose}>关闭</button></div>
      <label>找功能<input autoFocus type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder="试试理发卡、保修、睡眠"/></label>
      {shown.map(entry=><button className="feature-result" type="button" key={entry.title} onClick={()=>onOpen(entry)}><b>{entry.title}</b><small>{entry.group} ›</small></button>)}
      {query.trim()&&capabilities.has("life.search")&&<section aria-label="相关生活记录"><h3>相关记录</h3><p role="status">{recordStatus}</p>{records.map(record=>{
        const params=new URLSearchParams({tab:"record",section:"timeline",domain:record.domain,kind:record.kind,id:record.id});
        if(record.record_id)params.set("record_id",record.record_id);
        return <a className="feature-result" key={record.domain+record.id} href={"?"+params}><b>{record.title}</b><small>{record.supporting}</small></a>;
      })}</section>}
      {!shown.length&&<p role="status">没有匹配的可用功能，试试其他词或清空搜索。</p>}
    </section>
  </div>;
}
