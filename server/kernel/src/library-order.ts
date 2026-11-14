import { inspectActivityOrder } from "./activity-order.js";

/** Read-only interpretation of a vision candidate. Item prices are not order totals. */
export function inspectLibraryOrder(text:string,platform?:string){
 const lines=text.split(/\r?\n/u).map(line=>line.replace(/\*\*|`/gu,"").trim());
 let section:"order"|"items"|"fees"|"totals"|"ignored"="order";
 const order:string[]=[],totals:string[]=[];
 for(const raw of lines){
  const line=raw.replace(/^[-*]\s+|^\d+[.)、]\s*/u,"");
  const heading=/^#{1,6}\s+(.+)$/u.exec(line)?.[1];
  const title=(heading??line).replace(/^\d+[.、]\s*/u,"");
  if(heading || /^(?:商品明细|商品列表|其他费用|价格明细|价格明细与合计|订单合计|订单信息)[:：]?$/u.test(title)){
   if(/推荐|营销|广告|限时福利|常见问题|安心权益/u.test(title))section="ignored";
   else if(/价格明细|合计|总计|整单|优惠明细/u.test(title))section="totals";
   else if(/商品明细|商品列表|购买商品/u.test(title))section="items";
   else if(/费用|配送费|打包费/u.test(title))section="fees";
   else if(/订单|商户|支付|交易/u.test(title))section="order";
   continue;
  }
  if(section==="ignored")continue;
  // Numbered item blocks also occur without Markdown headings.
  if(/^\d+[.)、]\s*(?:商品名称|商品)[:：]/u.test(raw))section="items";
  const strong=/^(?:整单实付|订单实付|合计实付)[:：]\s*(.*)$/u.exec(line);
  if(strong){order.push(`实付：${strong[1]}`);totals.push(`实付：${strong[1]}`);continue;}
  if(section==="items"||section==="fees")continue;
  const clean=line.replace(/\s*(?:\[复制\]|（(?:右侧有)?[“"]?复制[”"]?(?:按钮)?）|\(复制\)|[（(](?:后有|右侧有)?[“"]?明细\s*>?[”"]?(?:按钮)?[）)])\s*$/u,"");
  order.push(clean);
  if(section==="totals" || /^(?:总价|订单总额|总优惠|优惠合计|商品优惠|配送费优惠|红包\/抵用券|店铺活动\/券)[:：]/u.test(clean))totals.push(clean);
 }
 const fields=inspectActivityOrder(order.join("\n"),platform);
 const money=(value:string):bigint|null=>{
  const m=/^([+-])?\s*[¥￥]?\s*(\d{1,12})(?:\.(\d{1,2}))?(?:\s*元)?$/u.exec(value);
  return m?(BigInt(m[2]!)*100n+BigInt((m[3]??"").padEnd(2,"0")))*(m[1]==="-"?-1n:1n):null;
 };
 const format=(v:bigint)=>`${v<0n?"-":""}${(v<0n?-v:v)/100n}.${((v<0n?-v:v)%100n).toString().padStart(2,"0")}`;
 const read=(labels:string[],discount=false)=>{
  const values=new Set<bigint>();let invalid=false;
  for(const line of totals){const m=/^([^:：]+)[:：]\s*(.*)$/u.exec(line);if(!m||!labels.includes(m[1]!))continue;
   const v=money(m[2]!);if(v===null || (!discount&&v<0n))invalid=true;else values.add(discount&&v<0n?-v:v);
  }
  return !invalid&&values.size===1?[...values][0]!:null;
 };
 const total=read(["总价","订单总额"]),discount=read(["总优惠","优惠合计"],true);
 const groups=[["商品优惠"],["配送费优惠"],["红包/抵用券","红包／抵用券"],["店铺活动/券","店铺活动／券"]];
 const components=groups.flatMap(labels=>{const value=read(labels,true);return value===null?[]:[{label:labels[0]!,amount:format(value)}];});
 const paid=fields.paid_amount===null?null:money(fields.paid_amount);
 const calculated=total!==null&&discount!==null?total-discount:null;
 const totalsMatch=calculated!==null&&paid!==null?calculated===paid:null;
 const discountsMatch=discount!==null&&components.length?components.reduce((sum,c)=>sum+money(c.amount)!,0n)===discount:null;
 if(totalsMatch===false)fields.issues.push("总价减优惠与整单实付不一致");
 if(discountsMatch===false)fields.issues.push("可见优惠明细合计与总优惠不一致，需核对是否完整");
 return {...fields,...(totals.length?{price_check:{total_amount:total===null?null:format(total),discount_amount:discount===null?null:format(discount),
  discount_components:components,calculated_paid_amount:calculated===null?null:format(calculated),totals_match:totalsMatch,discounts_match:discountsMatch}}:{})};
}
