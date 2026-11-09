import {takeoutCaptureSchema} from "@shadow/contracts";
import {inspectMeituanOrder} from "./meituan-order.js";
export const takeoutPrefix="life.takeout.v1\n";
export function readTakeoutCapture(text:string){if(!text.startsWith(takeoutPrefix))return null;try{const result=takeoutCaptureSchema.safeParse(JSON.parse(text.slice(takeoutPrefix.length)));return result.success?result.data:null;}catch{return null;}}
const compact=(s:string)=>s.replace(/(\d)[,，](\d{2})(?!\d)/gu,"$1.$2").replace(/\s+/gu,"").replaceAll("：",":").replace(/支付万式/gu,"支付方式").replace(/配迭费/gu,"配送费").replace(/总优[患恵]/gu,"总优惠");
const cents=(s:string|null)=>{if(s===null)return null;const m=/^(\d{1,8})(?:\.(\d{1,2}))?$/u.exec(s);return m?BigInt(m[1]!)*100n+BigInt((m[2]??"").padEnd(2,"0")):null;};
const money=(v:bigint|null)=>v===null?null:`${v/100n}.${String(v%100n).padStart(2,"0")}`;
function feePrice(s:string){return price(s)??money(cents(/^[^\d]*?(\d{1,8}(?:\.\d{1,2})?)$/u.exec(compact(s))?.[1]??null));}
function price(s:string){return money(cents(/(?:[¥￥]|实付:?)(\d{1,8}(?:\.\d{1,2})?)/u.exec(compact(s))?.[1]??null));}
export function inspectTakeoutOrder(text:string){
 const capture=readTakeoutCapture(text);if(!capture)return null;
 if(capture.platform==="meituan")return inspectMeituanOrder(capture);
 const boxes=capture.blocks.map(([x,y,w,h,text])=>({x,y,w,h,text:compact(text)})).sort((a,b)=>a.y-b.y||a.x-b.x);
 const rows:Array<{y:number;h:number;parts:typeof boxes}>=[];
 for(const b of boxes){let row=rows.find(r=>Math.abs(r.y+r.h/2-b.y-b.h/2)<Math.min(r.h,b.h)*0.6);if(!row){row={y:b.y,h:b.h,parts:[]};rows.push(row);}row.parts.push(b);}
 rows.sort((a,b)=>a.y-b.y);for(const r of rows)r.parts.sort((a,b)=>a.x-b.x);
 const line=(i:number)=>rows[i]?.parts.map(b=>b.text).join(" ")??"";
 const stop=rows.findIndex((_,i)=>/安心权益|常见问题/u.test(line(i)));
 const usable=rows.slice(0,stop<0?rows.length:stop);
 const find=(pattern:RegExp)=>usable.findIndex((_,i)=>pattern.test(line(i)));
 const value=(pattern:RegExp)=>{const i=find(pattern);return i<0?null:line(i).replace(pattern,"").trim()||line(i+1);};
 const summary=find(/价格明细/u),footer=find(/订单号|订单编号/u),fees=find(/打包费|包装费|配送费/u);
 const issues:string[]=[];
 const paidRow=summary<0?null:usable.slice(summary,Math.min(footer<0?usable.length:footer,summary+4)).map((_,j)=>line(summary+j)).find(s=>/实付/u.test(s));
 let paid_amount=paidRow?price(paidRow.slice(paidRow.lastIndexOf("实付"))):null;
 const total=value(/总价[:：]?/u),order_amount=total?price(total):null;
 const discount=summary<0?null:usable.slice(summary,summary+3).map((_,j)=>line(summary+j)).find(s=>/总优惠/u.test(s));
 const discount_amount=discount?price(discount.slice(discount.indexOf("总优惠")+3)):null;
 const packing= value(/(?:打包费|包装费)[?？]?[:：]?/u),delivery=value(/配送费(?!优惠)[?？]?[:：]?/u);
 const packing_fee=packing?feePrice(packing):null,delivery_fee=delivery?feePrice(delivery):null;
 const itemEnd=fees>=0?usable[fees]!.y:summary>=0?usable[summary]!.y:0;
 const quantities=boxes.filter(b=>b.y<itemEnd&&/^[×xX*][1-9]\d{0,2}$/u.test(b.text));
 const items:Array<{name:string;quantity:number;paid_amount:string|null;option:boolean}>=[];
 let previous=0;
 for(const q of quantities){
  const prices=boxes.filter(b=>b.y>=previous&&b.y<=q.y+q.h&&b.x>capture.width*.65&&price(b.text)!==null);
  const actual=prices.find(b=>b.text.includes("实付"))??prices[0];
  const top=actual?actual.y-actual.h:Math.max(previous,q.y-3*q.h);
  const names=boxes.filter(b=>b.y>=top&&b.y<q.y&&b.x<capture.width*.7&&(b.x>capture.width*.12||/^[「|【\[]?折/u.test(b.text))&&!/^(?:闪购|蜂鸟准时达|实付|[¥￥]|[×xX*])/u.test(b.text));
  const name=names.map(b=>b.text.replace(/^[「|【\[]?折/u,"").replace(/实付.*$/u,"")).join(" ").trim();
  if(name&&name.length<=300)items.push({name,quantity:Number(q.text.slice(1)),paid_amount:actual?price(actual.text):null,option:/^(?:特辣|微辣|中辣|不辣|不要保温袋|无需餐具|不需要餐具)$/u.test(name)});
  else issues.push("部分商品名称未识别完整");
  previous=q.y+q.h;
 }
 const merchantBox=boxes.find(b=>b.y<(quantities[0]?.y??itemEnd)&&b.text.includes("闪购")&&b.text.length>2);
 let merchant=merchantBox?.text.replace(/^.*?闪购/u,"").replace(/[>›〉]$/u,"")||null;
 if(!merchant){const marker=boxes.find(b=>b.text==="闪购");merchant=marker?boxes.find(b=>b.x>marker.x+marker.w*.5&&b.x<capture.width*.7&&!/蜂鸟|准时达/u.test(b.text)&&Math.abs(b.y-marker.y)<marker.h)?.text??null:null;}
 const rawId=value(/(?:订单号|订单编号)[:：]?/u);
 const identities=rawId?[...new Set([...rawId.replace(/复制/gu,"").matchAll(/\d{8,40}/gu)].map(m=>m[0]))]:[];
 const order_id=identities.length===1?identities[0]!:null;
 if(identities.length>1)issues.push("订单号存在多个不同值，请核对原始材料");
 const rawTime=value(/下单时间[:：]?/u);const order_time=rawTime?/\d{4}-\d{2}-\d{2}\s*\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?/u.exec(rawTime)?.[0]?.replace(/^(\d{4}-\d{2}-\d{2})(\d)/u,"$1 $2")??null:null;
 const payment_method=value(/支付方式[:：]?/u)?.match(/支付宝|微信支付|微信|银行卡|余额/u)?.[0]??null;
 const delivery_status=boxes.find(b=>/订单已送到指定位置|订单已完成|已送达|订单已取消|退款成功/u.test(b.text))?.text??null;
 if(delivery_status&&/取消|退款/u.test(delivery_status))issues.push("订单已取消或退款，保留原始材料");
 if(paid_amount&&order_amount&&discount_amount&&(cents(order_amount)!-cents(discount_amount)!)!==cents(paid_amount)){
  paid_amount=null;issues.push("订单实付与总价减优惠不一致，未采用疑似拼接金额");
 }
 if(!capture.complete)issues.push("页面采集未完整结束");if(!order_id)issues.push("缺少订单号");if(!order_time)issues.push("缺少下单时间");if(!paid_amount)issues.push("缺少订单总实付");if(!items.length)issues.push("缺少商品明细");
 if(items.some(i=>i.paid_amount===null))issues.push("部分商品行实付未识别，请核对原图");
 const allAmounts=items.length>0&&items.every(i=>i.paid_amount!==null)&&packing_fee!==null&&delivery_fee!==null;
 const itemTotal=allAmounts?items.reduce((sum,i)=>sum+cents(i.paid_amount)!,0n)+cents(packing_fee)!+cents(delivery_fee)!:null;
 const reconciled=itemTotal!==null&&paid_amount!==null&&itemTotal===cents(paid_amount)&&order_amount!==null&&discount_amount!==null&&(cents(order_amount)!-cents(discount_amount)!)===cents(paid_amount);
 if(!reconciled)issues.push("商品、费用、优惠与订单实付尚未全部核对一致");
 const takeout={platform:capture.platform,complete:capture.complete,amounts_reconciled:reconciled,delivery_status,payment_method,items,packing_fee,delivery_fee,discount_amount,issues};
 return {parser_version:"takeout-layout-v1",order_id,transaction_id:null,merchant,product:items.map(i=>i.name).join("、")||null,paid_amount,order_amount,refund_amount:null,payment_time:null,order_time,status:"unknown" as const,issues,accounting_created:false as const,takeout};
}
