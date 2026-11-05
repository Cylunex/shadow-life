/** Deterministic field observations only; page text is untrusted and never executes commands. */
export function inspectActivityOrder(text:string,platform?:string){
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
 const order_id=field(["订单号","订单编号"]),product=field(["商品名称","商品说明"]);
 let transaction_id=field(["交易单号","交易号","微信支付单号","支付宝交易号"]),merchant=field(["商家名称","商户名称","交易对方","收款方","收款方全称"]);
 let paid_amount=amount(["实付金额","实付款","实际支付"]);
 const order_amount=amount(["订单金额","订单总额"]),refund_amount=amount(["退款金额","已退金额"]);
 const statusLines=lines.map(line=>line.replace(/^(?:当前状态|交易状态)[:：]\s*/u,""));
 const statuses=new Set(statusLines.filter(line=>["支付成功","交易成功","待付款","等待付款","已取消","交易关闭","退款成功","退款处理中"].includes(line)));
 const status=statuses.size===1?({"支付成功":"paid","交易成功":"paid","待付款":"pending","等待付款":"pending","已取消":"cancelled","交易关闭":"cancelled","退款成功":"refunded","退款处理中":"refund_pending"} as Record<string,string>)[[...statuses][0]!]!:"unknown";
 const detail=lines.some(line=>line==="账单详情"||line==="交易详情");
 // Only a settled single transaction may use its prominent signed debit or transaction time.
 // A list, credit, refund or unsigned total is never a substitute for a paid amount.
 const alipayDebit=platform==="alipay"?alipayDetailDebit(text):null;
 // Alipay labels its payment identity as 订单号, separately from 商家订单号.
 if(alipayDebit&&status==="paid"&&order_id){
   if(transaction_id&&transaction_id!==order_id)issues.push("交易号与支付宝订单号存在不同值");
   else transaction_id=order_id;
   if(paid_amount&&paid_amount!==alipayDebit.amount)issues.push("实付与支出金额存在不同值");
   else if(!paid_amount&&!issues.some(issue=>issue.startsWith("实付金额")))paid_amount=alipayDebit.amount;
   merchant=alipayDebit.merchant??merchant;
 }
 const debit=detailDebit(text);
 if(detail && transaction_id && status==="paid" && debit){
   if(paid_amount && paid_amount!==debit.amount)issues.push("实付与支出金额存在不同值");
   else if(!paid_amount && !issues.some(issue=>issue.startsWith("实付金额")))paid_amount=debit.amount;
 }
 const timeLabels=["付款时间","支付时间"];
 if(detail && transaction_id && status==="paid")timeLabels.push("交易时间");
 const payment_time=field(timeLabels)?.replace(/^(\d{4})年(\d{1,2})月(\d{1,2})日/u,(_,y,m,d)=>`${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`)??null,order_time=field(["下单时间","订单创建时间"]);
 if(platform==="wechat"&&detail&&transaction_id&&status==="paid"&&debit&&!merchant){const title=lines.findIndex(line=>line==="交易详情"||line==="账单详情");if(title===2&&lines[1]==="主页")merchant=lines[0]!;}
 if(statuses.size>1)issues.push("页面包含多个状态，需核对当前交易状态");
 if(!order_id&&!transaction_id)issues.push("缺少明确订单或交易身份");
 if(!paid_amount)issues.push("没有明确实付金额");
 if(!payment_time)issues.push("没有明确付款时间");
 return {parser_version:"screen-order-v3",order_id,transaction_id,merchant,product,paid_amount,order_amount,refund_amount,payment_time,order_time,status,issues,accounting_created:false as const};
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
// An unlabelled debit is usable only in the heading, before the detail fields.
function detailDebit(text:string){
 const lines=text.split(/\r?\n/u).map(s=>s.trim()).filter(Boolean);
 const title=lines.findIndex(line=>line==="账单详情"||line==="交易详情");
 if(title<0 || /退款|收入|收款成功/u.test(text))return null;
 const amounts=lines.map((line,i)=>({i,m:/^([-−+])\s*([¥￥]?)\s*(\d{1,12})(?:\.(\d{1,2}))?(元?)$/u.exec(line)})).filter(x=>x.m);
 if(amounts.length!==1)return null;
 const {i,m}=amounts[0]!;
 if(!m||m[1]==="+"||i<=title||i>title+3||lines.slice(title+1,i).some(l=>/金额|优惠|折扣|手续费|退款|余额|[:：]/u.test(l)))return null;
 return {amount:`${BigInt(m[3]!)}.${(m[4]??"").padEnd(2,"0")}`,currency:Boolean(m[2]||m[5])};
}
/** Currency on an unrelated shipping fee is insufficient evidence for the paid amount. */
export function capturedPaymentHasCnyEvidence(text:string,platform?:string):boolean{
 if(/(?:\b(?:USD|HKD|JPY|EUR|GBP|AUD|CAD|SGD|KRW)\b|美元|港元|港币|日元|欧元|英镑|韩元|新加坡元|澳元|加元|\$)/iu.test(text))return false;
 const lines=text.split(/\r?\n/u).map(v=>v.trim()).filter(Boolean);let explicit=false,paidCurrency=false;
 for(let i=0;i<lines.length;i++){
  const currency=/^(?:交易)?(?:币种|货币)\s*[:：]?\s*(.*)$/u.exec(lines[i]!);
  if(currency){const value=(currency[1]||lines[i+1]||"").trim();if(!/^(?:CNY|RMB|人民币)$/iu.test(value))return false;explicit=true;}
  const paid=/^(?:实付金额|实付款|实际支付)(?:\s*[:：]\s*(.*)|\s*)$/u.exec(lines[i]!);
  if(paid){const value=(paid[1]||lines[i+1]||"").trim();if(/^(?:[¥￥]\s*\d+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?\s*元)$/u.test(value))paidCurrency=true;}
 }
 if(explicit||paidCurrency)return true;
 if(platform==="alipay"&&alipayDetailDebit(text)){const value=inspectActivityOrder(text,platform);if(value.status==="paid"&&value.transaction_id&&value.paid_amount&&!value.issues.some(i=>i.includes("不同值")))return true;}
 const debit=detailDebit(text);
 if(!debit?.currency){
   // The domestic WeChat wallet detail renders a bare signed amount. Its wallet
   // payment method and Tenpay provider identify the CNY channel, not arbitrary numbers.
   const wallet=platform==="wechat"&&debit&&lines.some((line,i)=>line==="支付方式"&&["零钱","零钱通"].includes(lines[i+1]??""))&&lines.includes("财付通支付科技有限公司");
   if(!wallet)return false;
 }
 const observed=inspectActivityOrder(text);
 return Boolean(observed.transaction_id && observed.status==="paid" && debit.amount===observed.paid_amount && !observed.issues.some(i=>i.includes("不同值")));
}

/** Alipay accessibility traversal places the page title last, but the labelled debit first.
 * Discounts and the order total are separate fields and never replace the settled debit. */
function alipayDetailDebit(text:string){
 const lines=text.split(/\r?\n/u).map(s=>s.trim()).filter(Boolean);
 if(!lines.includes("账单详情")||!lines.includes("商家订单号")||!lines.includes("订单号")||!lines.includes("支付时间"))return null;
 const debits=lines.map((line,index)=>({index,match:/^支出\s*(?:[¥￥]\s*)?(\d{1,12})(?:\.(\d{1,2}))?\s*元$/u.exec(line)})).filter(x=>x.match);
 if(debits.length!==1||debits[0]!.index>2||lines.some(line=>/^(?:收入|退款金额|已退金额)/u.test(line)))return null;
 const {match,index}=debits[0]!;
 const merchant=index===1&&!/[:：]|详情|金额|支付|交易|订单/u.test(lines[0]!)?lines[0]!:null;
 return {amount:`${BigInt(match![1]!)}.${(match![2]??"").padEnd(2,"0")}`,merchant};
}

export function capturedPaymentPlatform(appPackage:string):string|undefined {return ({"com.tencent.mm":"wechat","com.eg.android.AlipayGphone":"alipay"} as Record<string,string>)[appPackage];}
