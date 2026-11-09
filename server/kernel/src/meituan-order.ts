import type { takeoutCaptureSchema } from "@shadow/contracts";

/** Native Meituan order layout. Order metadata precedes goods; recommendations follow the total. */
export function inspectMeituanOrder(capture:ReturnType<typeof takeoutCaptureSchema.parse>){
 const boxes=capture.blocks.map(([x,y,w,h,text])=>({x,y,w,h,text:text.replace(/\s+/gu,"")})).sort((a,b)=>a.y-b.y||a.x-b.x);
 const rows:Array<{y:number;h:number;parts:typeof boxes}>=[];
 for(const b of boxes){let row=rows.find(r=>Math.abs(r.y+r.h/2-b.y-b.h/2)<Math.min(r.h,b.h)*.6);if(!row){row={y:b.y,h:b.h,parts:[]};rows.push(row);}row.parts.push(b);}
 rows.sort((a,b)=>a.y-b.y);for(const row of rows)row.parts.sort((a,b)=>a.x-b.x);
 const text=(row:typeof rows[number])=>row.parts.map(b=>b.text).join("");
 const goods=rows.findIndex(r=>text(r)==="商品费用");
 const totalIndex=rows.findIndex((r,i)=>i>goods&&r.parts.some(b=>/^(?:合计|实付|实付款)$/u.test(b.text)));
 const end=totalIndex<0?rows.length:totalIndex+1;
 const usable=rows.slice(0,end);
 const issues:string[]=[];
 const decimal=(raw:string)=>{const m=/^(?:[¥￥])?(\d{1,8})(?:\.(\d{1,2}))?$/u.exec(raw);return m?`${BigInt(m[1]!)}.${(m[2]??"").padEnd(2,"0")}`:null;};
 const cents=(raw:string)=>{const [a,b]=raw.split(".");return BigInt(a!)*100n+BigInt(b!);};
 // Native nodes may split currency and digits. Separate complete prices remain separate.
 const prices=(row:typeof rows[number])=>{const result:Array<{x:number;amount:string}>=[];for(let i=0;i<row.parts.length;i++){const b=row.parts[i]!;let raw=b.text;if(/^[¥￥]$/u.test(raw)){const next=row.parts[i+1];if(!next||next.x-b.x-b.w>Math.max(b.h,20))continue;raw+=next.text;i++;const fraction=row.parts[i+1];if(fraction&&/^\.\d{1,2}$/u.test(fraction.text)&&fraction.x-next.x-next.w<=Math.max(next.h,20)){raw+=fraction.text;i++;}}else if(!/^[¥￥]\d/u.test(raw))continue;const amount=decimal(raw);if(amount)result.push({x:b.x,amount});}return result;};
 const field=(label:RegExp)=>{const i=usable.findIndex(r=>r.parts.some(b=>label.test(b.text)));if(i<0)return null;const parts=usable[i]!.parts.filter(b=>!label.test(b.text)&&b.text!=="复制");return parts.map(b=>b.text).join("")|| (usable[i+1]?text(usable[i+1]!):null);};
 const rawId=field(/^订单(?:号码|号|编号)[:：]?$/u);
 const order_id=rawId&&/^\d{8,40}$/u.test(rawId)?rawId:null;
 const order_time=field(/^下单时间[:：]?$/u)?.match(/\d{4}-\d{2}-\d{2}\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?/u)?.[0]?.replace(/^(\d{4}-\d{2}-\d{2})(\d)/u,"$1 $2")??null;
 const payment_method=field(/^支付方式[:：]?$/u);
 const totalRow=totalIndex>=0?rows[totalIndex]:undefined;
 const totals=totalRow?prices(totalRow):[];
 const paid_amount=totals.length===1?totals[0]!.amount:null;
 const discount=totalRow?.parts.map(b=>b.text).join("").match(/已优惠(\d+(?:\.\d{1,2})?)元/u)?.[1];
 const discount_amount=discount?decimal(discount):null;
 const packingRow=usable.find(r=>r.parts.some(b=>/^(?:打包费|包装费)$/u.test(b.text)));
 const deliveryRow=usable.find(r=>r.parts.some(b=>/^(?:用户)?配送费$/u.test(b.text)));
 const packingPrices=packingRow?prices(packingRow):[];const deliveryPrices=deliveryRow?prices(deliveryRow):[];
 const packing_fee=packingPrices.length===1?packingPrices[0]!.amount:null;
 // Meituan places the original fee left of the final discounted fee.
 const delivery_fee=deliveryPrices.length>0&&deliveryPrices.length<=2?deliveryPrices.at(-1)!.amount:null;
 const feesStart=usable.findIndex((r,i)=>i>goods&&r.parts.some(b=>/^(?:打包费|包装费|用户配送费|配送费)$/u.test(b.text)));
 const itemRows=goods>=0?usable.slice(goods+1,feesStart<0?(totalIndex<0?usable.length:totalIndex):feesStart):[];
 const merchant=itemRows[0]?.parts.find(b=>b.x<capture.width*.7&&b.text!=="已收藏")?.text??null;
 const items:Array<{name:string;quantity:number;paid_amount:string|null;option:boolean}>=[];
 let pending:{name:string;amount:string|null}|null=null;
 for(const row of itemRows.slice(1)){
   const amounts=prices(row);const names=row.parts.filter(b=>b.x<capture.width*.8&&!/^(?:[¥￥]|[×xX*]|\d|已收藏)/u.test(b.text));
   if(names.length&&amounts.length===1)pending={name:names.map(b=>b.text).join(" "),amount:amounts[0]!.amount};
   const quantity=text(row).match(/^[×xX*]([1-9]\d{0,2})$/u);
   if(quantity&&pending){items.push({name:pending.name,quantity:Number(quantity[1]),paid_amount:pending.amount,option:/^(?:需要餐具|无需餐具|不需要餐具|不要保温袋)$/u.test(pending.name)});pending=null;}
 }
 // Product prices are before the red-packet discount, not necessarily per-line final payments.
 const redPacket=usable.filter(r=>r.parts.some(b=>/已用.*红包/u.test(b.text))).map(r=>prices(r));
 const coupons=redPacket.flat();
 const knownExtraCharges=usable.filter(r=>r.parts.some(b=>/^(?:准时宝|放心吃)$/u.test(b.text))&&prices(r).length>0);
 const complete=capture.complete&&goods>=0&&totalIndex>=0&&Boolean(order_id&&order_time);
 if(!capture.complete)issues.push("页面采集未完整结束");if(!order_id)issues.push("缺少订单号");if(!order_time)issues.push("缺少下单时间");if(!paid_amount)issues.push("缺少订单总实付");if(!items.length)issues.push("缺少商品明细");
 const delivery_status=boxes.find(b=>/订单已完成|订单已取消|退款成功/u.test(b.text))?.text??null;
 if(delivery_status&&/取消|退款/u.test(delivery_status))issues.push("订单已取消或退款，保留原始材料");
 const itemTotal=items.length&&items.every(i=>i.paid_amount!==null)&&packing_fee!==null&&delivery_fee!==null?items.reduce((s,i)=>s+cents(i.paid_amount!),0n)+cents(packing_fee)+cents(delivery_fee)-coupons.reduce((s,c)=>s+cents(c.amount),0n):null;
 const reconciled=itemTotal!==null&&paid_amount!==null&&itemTotal===cents(paid_amount)&&knownExtraCharges.length===0;
 if(!reconciled)issues.push("商品、费用、优惠与订单实付尚未全部核对一致");
 if(coupons.length){issues.push("商品标价为红包抵扣前金额，不作为逐项实付");for(const item of items)if(!item.option)item.paid_amount=null;}
 const order_amount=paid_amount&&discount_amount?`${(cents(paid_amount)+cents(discount_amount))/100n}.${String((cents(paid_amount)+cents(discount_amount))%100n).padStart(2,"0")}`:null;
 return {parser_version:"meituan-native-v1",order_id,transaction_id:null,merchant,product:items.map(i=>i.name).join("、")||null,paid_amount,order_amount,refund_amount:null,payment_time:null,order_time,status:"unknown" as const,issues,accounting_created:false as const,takeout:{platform:capture.platform,complete,amounts_reconciled:reconciled,delivery_status,payment_method,items,packing_fee,delivery_fee,discount_amount,issues}};
}
