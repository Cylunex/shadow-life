import { capturedPaymentHasCnyEvidence, inspectActivityOrder } from "./activity-order.js";

export type PaymentCaptureGroupSource={id:string;device_id:string;app_package:string;text:string;started_at:string;time_zone:string;platform:string;source_account:string};
export type PaymentCaptureGroupDetail=PaymentCaptureGroupSource&{record_id:string;conflict:boolean};

function method(text:string):string|null {
 const lines=text.split(/\r?\n/u).map(v=>v.trim()).filter(Boolean),values=new Set<string>();
 for(let i=0;i<lines.length;i++){
  const m=/^(?:付款方式|支付方式)(?:[:：]\s*(.+))?$/u.exec(lines[i]!);
  if(m){const value=m[1]??lines[i+1];if(value&&/^(?:零钱通?|余额|余额宝|花呗|.+(?:银行|信用卡|储蓄卡|借记卡).*)$/u.test(value))values.add(value);}
 }
 return values.size===1?[...values][0]!:null;
}

function localClock(at:number,zone:string):string {
 const parts=new Intl.DateTimeFormat("en-CA",{timeZone:zone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h23"}).formatToParts(at);
 const p=(key:string)=>parts.find(v=>v.type===key)!.value;
 return `${p("year")}-${p("month")}-${p("day")} ${p("hour")}:${p("minute")}:${p("second")}`;
}

/** Presentation-only correlation. Never supplies a missing transaction ID or authorizes accounting.
 * Recompute on every read so a later competing transaction withdraws the grouping. */
export function relatedPaymentRecord(source:PaymentCaptureGroupSource,details:readonly PaymentCaptureGroupDetail[]):string|null {
 if(!["alipay","wechat"].includes(source.platform)||source.device_id.startsWith("restore_"))return null;
 if(/退款|待付款|支付失败|交易关闭|收款成功/u.test(source.text))return null;
 const observed=inspectActivityOrder(source.text,source.platform,true),payMethod=method(source.text);
 if(observed.order_id||observed.transaction_id||observed.status!=="paid"||!observed.paid_amount||!payMethod||!capturedPaymentHasCnyEvidence(source.text,source.platform,true))return null;
 if(observed.issues.some(v=>/多个|不同值/u.test(v)))return null;
 const started=Date.parse(source.started_at);if(!Number.isFinite(started))return null;
 // Only a result observed 0–15 seconds after the explicit second-resolution payment time.
 const clocks=new Set(Array.from({length:16},(_,i)=>Math.floor(started/1000)*1000-i*1000)
  .filter(at=>started-at<=15000).map(at=>localClock(at,source.time_zone)));
 const matches=new Set<string>();
 for(const detail of details){
  if(detail.device_id!==source.device_id||detail.platform!==source.platform||detail.source_account!==source.source_account||detail.time_zone!==source.time_zone)continue;
  const parsed=inspectActivityOrder(detail.text,detail.platform);
  if(parsed.status!=="paid"||parsed.paid_amount!==observed.paid_amount||!parsed.payment_time||!clocks.has(parsed.payment_time)||method(detail.text)!==payMethod)continue;
  if(observed.payment_time&&observed.payment_time!==parsed.payment_time||observed.merchant&&parsed.merchant&&observed.merchant!==parsed.merchant)continue;
  // Conflicted evidence must prevent choosing another apparently clean match.
  if(detail.conflict||parsed.issues.some(v=>/多个|不同值/u.test(v)))return null;
  if(!parsed.transaction_id||!capturedPaymentHasCnyEvidence(detail.text,detail.platform))continue;
  matches.add(detail.record_id);
 }
 return matches.size===1?[...matches][0]!:null;
}
