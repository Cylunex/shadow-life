/** Deterministic field observations only; page text is untrusted and never executes commands. */
export function inspectActivityOrder(text:string){
 const lines=text.split(/\r?\n/u).map(s=>s.trim()).filter(Boolean);
 const issues:string[]=[];
 function field(labels:string[]):string|null{
   const values=new Set<string>();
   for(let i=0;i<lines.length;i++)for(const label of labels){
     const line=lines[i]!;
     if(line===label||line===`${label}：`||line===`${label}:`){if(lines[i+1])values.add(lines[i+1]!);}
     else if(line.startsWith(`${label}：`)||line.startsWith(`${label}:`))values.add(line.slice(label.length+1).trim());
   }
   if(values.size>1){issues.push(`${labels[0]}存在多个不同值`);return null;}
   return [...values][0]??null;
 }
 function amount(labels:string[]){const value=field(labels);if(value===null)return null;const match=/^(?:[¥￥]\s*)?(\d{1,12})(?:\.(\d{1,2}))?(?:\s*元)?$/u.exec(value);if(!match){issues.push(`${labels[0]}格式无法明确识别`);return null;}return `${BigInt(match[1]!)}.${(match[2]??"").padEnd(2,"0")}`;}
 const order_id=field(["订单号","订单编号"]),transaction_id=field(["交易单号","交易号"]),merchant=field(["商家名称","商户名称","交易对方"]),product=field(["商品名称","商品说明"]);
 const paid_amount=amount(["实付金额","实付款","实际支付"]),order_amount=amount(["订单金额","订单总额"]),refund_amount=amount(["退款金额","已退金额"]);
 const payment_time=field(["付款时间","支付时间"]),order_time=field(["下单时间","订单创建时间"]);
 const statuses=new Set(lines.filter(line=>["支付成功","交易成功","待付款","等待付款","已取消","交易关闭","退款成功","退款处理中"].includes(line)));
 const status=statuses.size===1?({"支付成功":"paid","交易成功":"paid","待付款":"pending","等待付款":"pending","已取消":"cancelled","交易关闭":"cancelled","退款成功":"refunded","退款处理中":"refund_pending"} as Record<string,string>)[[...statuses][0]!]!:"unknown";
 if(statuses.size>1)issues.push("页面包含多个状态，需核对当前交易状态");
 if(!order_id&&!transaction_id)issues.push("缺少明确订单或交易身份");
 if(!paid_amount)issues.push("没有明确实付金额");
 if(!payment_time)issues.push("没有明确付款时间");
 return {parser_version:"screen-order-v1",order_id,transaction_id,merchant,product,paid_amount,order_amount,refund_amount,payment_time,order_time,status,issues,accounting_created:false as const};
}

export function mergeOrderObservations(observations:Array<ReturnType<typeof inspectActivityOrder>>){
 const merged:Record<string,unknown>={};let conflict=false;
 const statuses=new Set<string>();for(const observation of observations){if(observation.status!=="unknown")statuses.add(observation.status);
  for(const [key,value] of Object.entries(observation)){if(["issues","parser_version","accounting_created","status"].includes(key)||value===null)continue;if(merged[key]!==undefined&&merged[key]!==value)conflict=true;else merged[key]=value;}
  if(observation.issues.some(issue=>issue.includes("多个")||issue.includes("不同值")))conflict=true;
 }
 // Settlement may progress; paid is never rolled backwards by a later pending page.
 const status=statuses.has("refunded")?"refunded":statuses.has("refund_pending")?"refund_pending":statuses.has("paid")?"paid":statuses.has("cancelled")?"cancelled":statuses.has("pending")?"pending":"unknown";
 if(statuses.has("paid")&&statuses.has("cancelled"))conflict=true;
 return {fields:merged,status,conflict};
}

/** The canonical payment identity follows the platform's statement import convention. */
export function capturedPaymentIdentity(platform:string,fields:Record<string,unknown>):string|undefined{
 const key=["taobao","jd","meituan"].includes(platform)?"order_id":"transaction_id";
 return typeof fields[key]==="string"?fields[key] as string:undefined;
}
/** Currency on an unrelated shipping fee is insufficient evidence for the paid amount. */
export function capturedPaymentHasCnyEvidence(text:string):boolean{
 if(/(?:\b(?:USD|HKD|JPY|EUR|GBP|AUD|CAD|SGD|KRW)\b|美元|港元|港币|日元|欧元|英镑|韩元|新加坡元|澳元|加元|\$)/iu.test(text))return false;
 const lines=text.split(/\r?\n/u).map(v=>v.trim()).filter(Boolean);let explicit=false,paidCurrency=false;
 for(let i=0;i<lines.length;i++){
  const currency=/^(?:交易)?(?:币种|货币)\s*[:：]?\s*(.*)$/u.exec(lines[i]!);
  if(currency){const value=(currency[1]||lines[i+1]||"").trim();if(!/^(?:CNY|RMB|人民币)$/iu.test(value))return false;explicit=true;}
  const paid=/^(?:实付金额|实付款|实际支付)(?:\s*[:：]\s*(.*)|\s*)$/u.exec(lines[i]!);
  if(paid){const value=(paid[1]||lines[i+1]||"").trim();if(/^(?:[¥￥]\s*\d+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?\s*元)$/u.test(value))paidCurrency=true;}
 }
 return explicit||paidCurrency;
}
