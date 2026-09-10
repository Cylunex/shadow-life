export type MoneyImportFormat="csv"|"json"|"markdown";
export type MoneyImportEntryType="expense"|"income"|"refund";
export interface MoneyImportCandidate{
  raw:Record<string,unknown>;
  externalId?:string;
  proposed:Partial<{entry_type:MoneyImportEntryType;amount:string;currency:"CNY";occurred_on:string;time_zone:string;counterparty:string;category:string;payment_method:string;note:string}>;
  issues:string[];
  warnings:string[];
  appliedRuleIds?:string[];
}
export interface MoneyImportRule{id:string;matchValue:string;replacements:Partial<MoneyImportCandidate["proposed"]>;}

const aliases={
  externalId:["transaction_id","transactionid","id","交易单号","订单号","流水号"],
  occurredOn:["date","occurred_on","transaction_date","交易日期","日期","时间","交易时间"],
  amount:["amount","金额","交易金额","收支金额"],
  entryType:["type","entry_type","direction","收支类型","类型","交易类型","收支"],
  counterparty:["merchant","counterparty","payee","商家","交易对方","对方","商户"],
  category:["category","分类","交易分类"],
  paymentMethod:["payment_method","method","支付方式","付款方式"],
  currency:["currency","币种","货币"],
  note:["note","memo","description","备注","说明","商品说明"]
} as const;

export function parseMoneyStatement(input:{format:MoneyImportFormat;content:string;timeZone:string}):MoneyImportCandidate[]{
  const rows=input.format==="json"?jsonRows(input.content):input.format==="markdown"?markdownRows(input.content):csvRows(input.content);
  if(rows.length===0)throw new Error("Statement contains no transaction rows.");
  if(rows.length>500)throw new Error("Statement exceeds the 500-row review limit.");
  return rows.map(row=>candidate(row,input.timeZone));
}

export function applyMoneyImportRules(candidates:readonly MoneyImportCandidate[],rules:readonly MoneyImportRule[]):MoneyImportCandidate[]{return candidates.map(candidate=>{const counterparty=candidate.proposed.counterparty?.trim().toLocaleLowerCase();if(!counterparty)return{...candidate};const matching=rules.filter(rule=>rule.matchValue.trim().toLocaleLowerCase()===counterparty);if(!matching.length)return{...candidate};return{...candidate,proposed:Object.assign({},candidate.proposed,...matching.map(rule=>rule.replacements)),warnings:[...candidate.warnings,"import_rule_applied"],appliedRuleIds:matching.map(rule=>rule.id)};});}

function candidate(raw:Record<string,unknown>,timeZone:string):MoneyImportCandidate{
  const text=normalizedEntries(raw),issues:string[]=[],warnings:string[]=[],proposed:MoneyImportCandidate["proposed"]={time_zone:timeZone,currency:"CNY"};
  const externalId=pick(text,aliases.externalId);
  const occurred=pick(text,aliases.occurredOn),date=occurred?normalizeDate(occurred):undefined;if(!occurred)issues.push("missing_date");else if(!date)issues.push("invalid_date");else proposed.occurred_on=date;
  const amountText=pick(text,aliases.amount),amount=amountText?normalizeAmount(amountText):undefined;if(!amountText)issues.push("missing_amount");else if(!amount)issues.push("invalid_amount");else proposed.amount=amount.value;
  const typeText=pick(text,aliases.entryType),entryType=typeText?normalizeType(typeText):undefined;if(typeText&&!entryType)issues.push("invalid_entry_type");else if(entryType)proposed.entry_type=entryType;else if(amount?.negative){proposed.entry_type="expense";warnings.push("type_inferred_from_negative_amount");}else issues.push("missing_entry_type");
  const currency=pick(text,aliases.currency);if(currency&&currency.trim().toUpperCase()!=="CNY")issues.push("unsupported_currency");
  const counterparty=pick(text,aliases.counterparty),category=pick(text,aliases.category),method=pick(text,aliases.paymentMethod),note=pick(text,aliases.note);
  if(counterparty)proposed.counterparty=counterparty;if(category)proposed.category=category;if(method){const paymentMethod=normalizePaymentMethod(method);if(paymentMethod)proposed.payment_method=paymentMethod;else warnings.push("unmapped_payment_method");}if(note)proposed.note=note;
  return{raw,...(externalId?{externalId}:{}),proposed,issues,warnings};
}

function normalizedEntries(row:Record<string,unknown>):Map<string,string>{const result=new Map<string,string>();for(const[key,value]of Object.entries(row)){if(value===null||value===undefined)continue;const text=typeof value==="string"?value.trim():String(value);if(text)result.set(normalizeHeader(key),text);}return result;}
function pick(row:Map<string,string>,names:readonly string[]):string|undefined{for(const name of names){const value=row.get(normalizeHeader(name));if(value)return value;}return undefined;}
function normalizeHeader(value:string):string{return value.trim().toLocaleLowerCase().replace(/[\s_-]+/gu,"");}
function normalizeDate(value:string):string|undefined{const text=value.trim(),match=/^(\d{4})[-\/.年](\d{1,2})[-\/.月](\d{1,2})(?:日|\b)/u.exec(text);if(!match)return undefined;const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]),date=new Date(Date.UTC(year,month-1,day));if(date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)return undefined;return`${String(year).padStart(4,"0")}-${String(month).padStart(2,"0")}-${String(day).padStart(2,"0")}`;}
function normalizeAmount(value:string):{value:string;negative:boolean}|undefined{let text=value.trim().replace(/[￥¥,，\s]/gu,"");let negative=false;if(text.startsWith("(")&&text.endsWith(")")){negative=true;text=text.slice(1,-1);}if(text.startsWith("-")){negative=true;text=text.slice(1);}if(text.startsWith("+"))text=text.slice(1);if(!/^\d+(?:\.\d{1,2})?$/u.test(text))return undefined;const[wholeRaw,fractionRaw=""]=text.split("."),whole=wholeRaw!.replace(/^0+(?=\d)/u,"");if(whole.length>18)return undefined;const canonical=`${whole}.${fractionRaw.padEnd(2,"0")}`;if(canonical==="0.00")return undefined;return{value:canonical,negative};}
function normalizeType(value:string):MoneyImportEntryType|undefined{const key=value.trim().toLocaleLowerCase().replace(/\s+/gu,"");if(["expense","支出","消费","付款","debit","out"].includes(key))return"expense";if(["income","收入","入账","credit","in"].includes(key))return"income";if(["refund","退款","退货退款"].includes(key))return"refund";return undefined;}
function normalizePaymentMethod(value:string):string|undefined{const key=value.trim().toLocaleLowerCase().replace(/\s+/gu,"");return({支付宝:"alipay",alipay:"alipay",微信:"wechat",微信支付:"wechat",wechat:"wechat",现金:"cash",cash:"cash",银行卡:"bank_card",bankcard:"bank_card",银行转账:"bank_transfer",banktransfer:"bank_transfer",京东支付:"jd_pay",京东白条:"jd_baitiao",花呗:"huabei",礼品卡:"gift_card",混合支付:"mixed",其他:"other"} as Record<string,string>)[key];}

function jsonRows(content:string):Record<string,unknown>[]{let value:unknown;try{value=JSON.parse(content);}catch{throw new Error("Statement JSON is invalid.");}const rows=Array.isArray(value)?value:value!==null&&typeof value==="object"&&Array.isArray((value as {transactions?:unknown}).transactions)?(value as {transactions:unknown[]}).transactions:undefined;if(!rows)throw new Error("Statement JSON must be an array or contain a transactions array.");return rows.map((row,index)=>{if(row===null||typeof row!=="object"||Array.isArray(row))throw new Error(`Statement JSON row ${index+1} is not an object.`);return row as Record<string,unknown>;});}
function csvRows(content:string):Record<string,unknown>[]{const rows=parseCsvCells(content);if(rows.length<2)return[];const headers=rows[0]!.map(value=>value.trim());if(headers.some(value=>!value))throw new Error("Statement CSV contains an empty header.");if(new Set(headers.map(normalizeHeader)).size!==headers.length)throw new Error("Statement CSV contains duplicate headers.");return rows.slice(1).filter(row=>row.some(value=>value.trim())).map(row=>Object.fromEntries(headers.map((header,index)=>[header,row[index]?.trim()??""])));}
function parseCsvCells(content:string):string[][]{const rows:string[][]=[],row:string[]=[],pushRow=()=>{row.push(cell);rows.push([...row]);row.length=0;cell="";};let cell="",quoted=false;for(let index=0;index<content.length;index++){const char=content[index]!;if(quoted){if(char==='"'&&content[index+1]==='"'){cell+='"';index++;}else if(char==='"')quoted=false;else cell+=char;continue;}if(char==='"'){if(cell.length)throw new Error("Statement CSV has an unexpected quote.");quoted=true;}else if(char===","){row.push(cell);cell="";}else if(char==="\n")pushRow();else if(char!=="\r")cell+=char;}if(quoted)throw new Error("Statement CSV has an unclosed quote.");if(cell.length||row.length)pushRow();return rows;}
function markdownRows(content:string):Record<string,unknown>[]{const lines=content.split(/\r?\n/u).map(line=>line.trim()).filter(line=>line.includes("|"));if(lines.length<3)return[];const cells=(line:string)=>line.replace(/^\||\|$/gu,"").split(/(?<!\\)\|/u).map(value=>value.replaceAll("\\|","|").trim()),headers=cells(lines[0]!);if(!cells(lines[1]!).every(value=>/^:?-{3,}:?$/u.test(value)))throw new Error("Statement Markdown needs a table separator row.");if(headers.some(value=>!value)||new Set(headers.map(normalizeHeader)).size!==headers.length)throw new Error("Statement Markdown headers are invalid or duplicated.");return lines.slice(2).map(cells).filter(row=>row.some(Boolean)).map(row=>Object.fromEntries(headers.map((header,index)=>[header,row[index]??""])));}
