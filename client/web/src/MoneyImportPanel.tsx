import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  canConfirmWithoutEdit,
  disableImportRuleCommand,
  initialCandidateFields,
  loadMoneyImportReview,
  resolveCandidateCommand,
  type CandidateFields,
  type MoneyImportCandidate,
  type MoneyImportReview,
  type MoneyImportRule
} from "./money-import.js";
import { loadRecordDetail } from "./record-detail.js";
import { ObjectPicker } from "./ObjectPicker.js";
import type { Execute } from "./command-controller.js";
import { formatInTimeZone } from "./travel-time.js";

export function MoneyImportPanel({enabled,headers,execute,timeZone,canStage=true,canResolve=true,selectedPeriod,onPeriod,onChanged}:{enabled:boolean;canStage?:boolean;canResolve?:boolean;headers:HeadersInit;execute:Execute;timeZone:string;selectedPeriod?:string;onPeriod?:(period:string)=>void;onChanged?:()=>void}){
  const [localPeriod,setLocalPeriod]=useState(()=>formatInTimeZone(new Date(),timeZone).slice(0,7));
  const period=selectedPeriod??localPeriod;
  const monthRequest=useRef(0),reviewRequest=useRef(0);
  const [month,setMonth]=useState<{batches:Array<{id:string;source_name:string;status:string;created_at:string;total:number;unconfirmed:number;duplicates:number;uncategorized:number;refunds_unlinked:number;platform?:string;source_account?:string}>;totals:{unconfirmed:number;duplicates:number;uncategorized:number;refunds_unlinked:number}}>();
  const [filter,setFilter]=useState<"all"|"unconfirmed"|"duplicates"|"uncategorized"|"refunds">("all");
  const [format,setFormat]=useState<"csv"|"json"|"markdown">("csv");
  const [sourceName,setSourceName]=useState("账单.csv");
  const [content,setContent]=useState("");
  const [review,setReview]=useState<MoneyImportReview>();
  const [pending,setPending]=useState(false);
  const [error,setError]=useState<string>();
  const [preview,setPreview]=useState(false);
  const [selection,setSelection]=useState<Map<string,number>>(new Map());
  const [outcomes,setOutcomes]=useState<Array<{id:string;name:string;state:"committed"|"failed";message?:string}>>([]);
  const [source,setSource]=useState("");
  const [showStage,setShowStage]=useState(false);
  const [showBatches,setShowBatches]=useState(true);
  const [readingFile,setReadingFile]=useState(false);
  const fileRead=useRef(0);
  const candidates=review?.candidates.filter(candidate=>{
    const unresolved=candidate.status==="pending"||candidate.status==="invalid";
    switch(filter){
      case "all":return true;
      case "unconfirmed":return unresolved;
      case "duplicates":return unresolved&&Boolean(candidate.duplicate_of_record_id||candidate.duplicate_of_candidate_id);
      case "uncategorized":return unresolved&&!candidate.proposed.category;
      case "refunds":return unresolved&&candidate.proposed.entry_type==="refund";
    }
  })??[];
  const eligible=candidates.filter(canConfirmWithoutEdit);
  const picked=eligible.filter(item=>selection.get(item.id)===item.revision);
  function resetPreview(){setSelection(new Map());setPreview(false);setOutcomes([]);}
  async function readFile(file:File){
    const request=++fileRead.current;
    setReadingFile(true);setError(undefined);
    try{
      const extension=file.name.split(".").at(-1)?.toLowerCase();
      if(extension!=="csv"&&extension!=="json"&&extension!=="md"&&extension!=="markdown")throw new Error("请选择 CSV、JSON 或 Markdown 账单");
      if(file.size>1024*1024)throw new Error("账单超过单次提交大小，请拆分后导入");
      const text=new TextDecoder("utf-8",{fatal:true}).decode(await file.arrayBuffer());
      if(request!==fileRead.current)return;
      if(!text.trim())throw new Error("文件没有可读取的账单内容");
      setFormat(extension==="md"?"markdown":extension);
      setSourceName(file.name.slice(0,200));setContent(text);
    }catch(error){if(request===fileRead.current)setError(error instanceof Error?error.message:"读取文件失败");}
    finally{if(request===fileRead.current)setReadingFile(false);}
  }
  async function confirmSelected(){
    if(!review||!picked.length||pending)return;
    const rows=picked,batchId=review.batch.id;
    setPending(true);setError(undefined);setOutcomes([]);
    try{
      for(const candidate of rows){
        const name=candidate.proposed.counterparty||candidate.proposed.occurred_on||`第 ${candidate.position+1} 行`;
        try{
          const built=resolveCandidateCommand(candidate,"confirm",initialCandidateFields(candidate,timeZone));
          await execute(built.capability,built.input,`money-import:candidate:${candidate.id}`);
          setOutcomes(previous=>[...previous,{id:candidate.id,name,state:"committed"}]);
          setSelection(previous=>{const next=new Map(previous);next.delete(candidate.id);return next;});
        }catch(error){
          setOutcomes(previous=>[...previous,{id:candidate.id,name,state:"failed",message:error instanceof Error?error.message:"未取得回执"}]);
        }
      }
      await refresh(batchId);onChanged?.();
    }catch(error){setError(error instanceof Error?error.message:"刷新批次失败");}
    finally{setPending(false);}
  }
  async function loadMonth(value=period){const request=++monthRequest.current;const response=await fetch(`/api/money/import-month?period=${encodeURIComponent(value)}`,{headers});if(!response.ok)throw new Error(`读取月度核对失败（HTTP ${response.status}）`);const result=await response.json();if(request===monthRequest.current)setMonth(result);}
  useEffect(()=>{if(enabled)void loadMonth().catch(error=>setError(error instanceof Error?error.message:"读取月度核对失败"));},[enabled,period]);
  async function refresh(batchId:string){
    const request=++reviewRequest.current;
    const updated=await loadMoneyImportReview(fetch,headers,batchId);
    if(request===reviewRequest.current){
      setReview(updated);
      if(window.matchMedia("(max-width: 720px)").matches)setShowBatches(false);
      const query=new URLSearchParams(location.search);
      query.set("batch",batchId);
      history.replaceState(null,"",`?${query}`);
      await loadMonth();
    }
  }
  useEffect(()=>{
    const batch=new URLSearchParams(location.search).get("batch");
    if(enabled&&batch)void refresh(batch).catch(caught=>setError(caught instanceof Error?caught.message:"读取批次失败"));
    return()=>{++reviewRequest.current;};
  },[enabled,headers]);
  async function stage(event:FormEvent){event.preventDefault();setPending(true);setError(undefined);try{if(content.length>900000)throw new Error("账单文本超过单次提交大小");const result=await execute("money.stage_import",{format,source_name:sourceName,content,time_zone:timeZone},"money-import:stage"),batchId=String(result.actual_values.batch_id);resetPreview();await refresh(batchId);setContent("");setShowStage(false);onChanged?.();}catch(caught){setError(caught instanceof Error?caught.message:"导入失败");}finally{setPending(false);}}
  async function resolve(candidate:MoneyImportCandidate,decision:"confirm"|"ignore",fields:CandidateFields){setPending(true);setError(undefined);try{const built=resolveCandidateCommand(candidate,decision,fields);await execute(built.capability,built.input,`money-import:candidate:${candidate.id}`);await refresh(review!.batch.id);onChanged?.();}catch(caught){setError(caught instanceof Error?caught.message:"复核失败");}finally{setPending(false);}}
  async function disableRule(rule:MoneyImportRule){setPending(true);setError(undefined);const built=disableImportRuleCommand(rule);try{await execute(built.capability,built.input,`money-import:rule:${rule.id}`);await refresh(review!.batch.id);}catch(caught){setError(caught instanceof Error?caught.message:"规则更新失败");}finally{setPending(false);}}
  if(!enabled)return null;
  return <section className="import-panel">
    <div className="panel-heading"><h2>账单导入复核</h2>{review&&<span className={`status ${review.batch.status}`}>{review.batch.status==="completed"?"已完成":"待复核"}</span>}</div>
    <div className="import-workspace"><div className="import-batch-list">
    {review&&<button type="button" className="secondary import-batch-toggle" aria-expanded={showBatches} disabled={pending}
      onClick={()=>setShowBatches(value=>!value)}>{showBatches?"收起批次列表":"切换月份或批次"}</button>}
    <div className={review&&!showBatches?"import-month-picker collapsed":"import-month-picker"}>
    <label>核对月份<input type="month" value={period} disabled={pending} onChange={event=>{
      const value=event.target.value;
      if(!value)return;
      ++reviewRequest.current;
      setReview(undefined);setMonth(undefined);resetPreview();
      const query=new URLSearchParams(location.search);
      query.delete("batch");
      history.replaceState(null,"",`?${query}`);
      if(onPeriod)onPeriod(value);else setLocalPeriod(value);
    }}/></label>{month&&<><span>未确认 {month.totals.unconfirmed} · 疑似重复 {month.totals.duplicates} · 未分类 {month.totals.uncategorized} · 退款待关联 {month.totals.refunds_unlinked}</span><label>来源账号<select value={source} onChange={event=>setSource(event.target.value)}>
      <option value="">全部来源</option>
      {[...new Set(month.batches.map(batch=>[batch.platform,batch.source_account].filter(Boolean).join(" · ")).filter(Boolean))].map(name=><option key={name}>{name}</option>)}
    </select></label><div className="import-batch-list">{month.batches.filter(batch=>!source||[batch.platform,batch.source_account].filter(Boolean).join(" · ")===source).map(batch=><button type="button" className="secondary" key={batch.id} disabled={pending} aria-pressed={review?.batch.id===batch.id} onClick={()=>{resetPreview();void refresh(batch.id).catch(caught=>setError(caught instanceof Error?caught.message:"读取导入复核失败"));}}>{batch.source_name} · {batch.total} 行 · 待处理 {batch.unconfirmed}</button>)}</div></>}</div></div><div className="import-candidate-pane">
    {canStage&&<details className="detail-meta" open={showStage} onToggle={e=>setShowStage(e.currentTarget.open)}><summary>导入新的账单</summary><form className="import-form" onSubmit={stage}><label className="full">选择账单文件
      <input type="file" accept=".csv,.json,.md,.markdown" disabled={pending} onChange={event=>{
        const file=event.currentTarget.files?.[0];if(file)void readFile(file);event.currentTarget.value="";
      }}/></label><label>格式<select value={format} onChange={event=>setFormat(event.target.value as typeof format)}><option value="csv">CSV</option><option value="json">JSON</option><option value="markdown">Markdown 表格</option></select></label><label>来源名称<input required value={sourceName} onChange={event=>setSourceName(event.target.value)}/></label><label className="full">账单内容<textarea required value={content} onChange={event=>setContent(event.target.value)} placeholder="粘贴平台导出的原始账单内容"/></label><button disabled={pending||readingFile}>{pending?"解析中…":readingFile?"读取文件中…":"生成复核候选"}</button></form></details>}
    {error&&<p className="inline-error">{error}</p>}
    {review&&<><div className="import-summary"><b>{review.batch.source_name}</b><span>共 {review.batch.total} · 待确认 {review.batch.pending} · 无效 {review.batch.invalid} · 已确认 {review.batch.confirmed} · 已忽略 {review.batch.ignored}</span></div><div className="panel-actions">{(["all","unconfirmed","duplicates","uncategorized","refunds"] as const).map(value=><button key={value} type="button" className={filter===value?"":"secondary"} disabled={pending} onClick={()=>{setFilter(value);resetPreview();}}>{({all:"全部",unconfirmed:"未确认",duplicates:"疑似重复",uncategorized:"未分类",refunds:"退款待关联"})[value]}</button>)}</div>{canResolve&&eligible.length>0&&<button type="button" className="secondary" disabled={pending}
      onClick={()=>{setPreview(!preview);setSelection(new Map());}}>{preview?"收起批量核对":"选择多笔入账"}</button>}
    {preview&&eligible.length>0&&<section className="import-bulk-preview" aria-label="批量入账预览">
      <h3>选择要入账的候选</h3>
      {eligible.map(item=><label key={item.id}><input type="checkbox" disabled={pending} checked={selection.get(item.id)===item.revision}
        onChange={event=>{const checked=event.target.checked;setSelection(previous=>{const next=new Map(previous);if(checked)next.set(item.id,item.revision);else next.delete(item.id);return next;});}}/>
        <span>{item.proposed.occurred_on} · {item.proposed.counterparty||"未记录商家"} · {item.proposed.entry_type==="income"?"收入":"支出"} {item.proposed.amount} CNY</span>
      </label>)}
      <button type="button" disabled={pending||picked.length===0} onClick={()=>void confirmSelected()}>
        {pending?"逐笔核对中…":`确认入账 ${picked.length} 笔`}</button>
    </section>}
    {outcomes.length>0&&<ul aria-live="polite">{outcomes.map(row=><li key={row.id}>{row.name} · {row.state==="committed"?"已入账":row.message}</li>)}</ul>}
    <div className="candidate-list">{candidates.map(candidate=><CandidateEditor key={`${candidate.id}:${candidate.revision}`} candidate={candidate} rules={review.rules}
      pending={pending} canResolve={canResolve} timeZone={timeZone} resolve={resolve} headers={headers}/>)}</div><RuleList rules={review.rules} pending={pending||!canResolve} disableRule={disableRule}/></>}
  </div></div></section>;
}

function CandidateEditor({candidate,rules,pending,timeZone,resolve,headers,canResolve}:{canResolve:boolean;headers:HeadersInit;candidate:MoneyImportCandidate;rules:MoneyImportRule[];pending:boolean;timeZone:string;resolve:(candidate:MoneyImportCandidate,decision:"confirm"|"ignore",fields:CandidateFields)=>Promise<void>}){
  const [fields,setFields]=useState(()=>initialCandidateFields(candidate,timeZone));
  const [editing,setEditing]=useState(false);
  const resolved=candidate.status==="confirmed"||candidate.status==="ignored";
  return <article className={`candidate ${candidate.status}`}>
    <header className="import-row-header">
      <div className="import-row-title">
        <b>{candidate.proposed.counterparty||"未记录商家"}</b>
        <small>{candidate.proposed.occurred_on||"日期待补"} · {candidateStatus(candidate.status)}</small>
      </div>
      <div className="import-row-amount">
        <strong>{candidate.proposed.amount||"待补金额"}</strong>
        {candidate.proposed.amount&&<small>{candidate.proposed.currency??"CNY"}</small>}
      </div>
    </header>
    {candidate.duplicate_of_candidate_id&&!candidate.duplicate_of_record_id&&<p>批次内已有一条相同交易，先核对原候选。</p>}{candidate.duplicate_of_record_id&&<DuplicateImportComparison candidate={candidate} headers={headers} id={candidate.duplicate_of_record_id}/>}{candidate.issues.length>0&&<p className="inline-error">需修正：{candidate.issues.map(issueLabel).join("、")}</p>}{candidate.warnings.length>0&&<p className="warning">提示：{candidate.warnings.map(issueLabel).join("、")}</p>}{candidate.applied_rule_ids.length>0&&<p className="rule-hit">规则预览：{candidate.applied_rule_ids.map(id=>{const rule=rules.find(item=>item.id===id);return rule?`${rule.match_value} → ${Object.entries(rule.replacements).map(([key,value])=>`${key}=${value}`).join("、")}`:id;}).join("；")}</p>}{resolved?<p>{candidate.status==="confirmed"?<a href={importRecordHref(candidate.linked_record_id!)}>查看已入账记录 →</a> :"已忽略"}</p>:<>
    <div className="actions import-row-actions">
      <button type="button" disabled={!canResolve||pending||Boolean(candidate.duplicate_of_record_id||candidate.duplicate_of_candidate_id)||!fields.amount||!fields.occurredOn||
        (candidate.status==="invalid"&&!editing)||(fields.entryType==="refund"&&!fields.originalEntryId)}
        onClick={()=>void resolve(candidate,"confirm",fields)}>确认写入</button>
      <button type="button" className="secondary" aria-expanded={editing} onClick={()=>setEditing(value=>!value)}>{editing?"收起修改":"修改"}</button>
      <button type="button" className="secondary" disabled={!canResolve||pending} onClick={()=>void resolve(candidate,"ignore",fields)}>忽略</button>
    </div>
    {editing&&<div className="candidate-fields"><label>类型<select value={fields.entryType} onChange={event=>setFields({...fields,entryType:event.target.value as CandidateFields["entryType"],rememberRule:event.target.value==="refund"?false:fields.rememberRule})}><option value="expense">支出</option><option value="income">收入</option><option value="refund">退款</option></select></label><label>金额<input required inputMode="decimal" value={fields.amount} onChange={event=>setFields({...fields,amount:event.target.value})}/></label><label>发生日<input required type="date" value={fields.occurredOn} onChange={event=>setFields({...fields,occurredOn:event.target.value})}/></label><label>时区<input required value={fields.timeZone} onChange={event=>setFields({...fields,timeZone:event.target.value})}/></label><label>交易对方<input value={fields.counterparty} onChange={event=>setFields({...fields,counterparty:event.target.value})}/></label><label>分类<input value={fields.category} onChange={event=>setFields({...fields,category:event.target.value})}/></label><label>支付方式<select value={fields.paymentMethod} onChange={event=>setFields({...fields,paymentMethod:event.target.value})}><option value="">未映射</option><option value="alipay">支付宝</option><option value="wechat">微信</option><option value="cash">现金</option><option value="bank_card">银行卡</option><option value="bank_transfer">银行转账</option><option value="other">其他</option></select></label>{fields.entryType==="refund"&&<div className="full"><ObjectPicker kind="money_entry" expenseOnly headers={headers}
      value={fields.originalEntryId} onChange={entry=>setFields({...fields,originalEntryId:entry?.id??""})} optional={false} label="选择原交易"/></div>}<label className="full">备注<textarea value={fields.note} onChange={event=>setFields({...fields,note:event.target.value})}/></label>{fields.entryType!=="refund"&&<label className="full checkbox-row"><input type="checkbox" checked={fields.rememberRule} disabled={!fields.counterparty.trim()} onChange={event=>setFields({...fields,rememberRule:event.target.checked})}/>记住该交易对方的类型、分类与支付方式</label>}</div>}</>}<details><summary>查看原始行</summary><pre>{JSON.stringify(candidate.raw,null,2)}</pre></details></article>;
}

function DuplicateImportComparison({id,candidate,headers}:{id:string;candidate:MoneyImportCandidate;headers:HeadersInit}){
  const [open,setOpen]=useState(false);
  const [record,setRecord]=useState<Record<string,unknown>>();
  const [error,setError]=useState<string>();
  useEffect(()=>{
    if(!open)return;
    let active=true;
    void loadRecordDetail(fetch,headers,{domain:"money",kind:"money_entry",id})
      .then(value=>{if(active)setRecord(value);})
      .catch(caught=>{if(active)setError(caught instanceof Error?caught.message:"读取已有流水失败");});
    return()=>{active=false;};
  },[open,id,headers]);
  const entry=record?.money_entry as Record<string,unknown>|undefined;
  return <details onToggle={event=>setOpen(event.currentTarget.open)}>
    <summary>疑似重复 · 核对原始行与流水</summary>
    {open&&<div className="import-comparison">
      <section><h4>账单候选</h4><pre>{JSON.stringify(candidate.raw,null,2)}</pre></section>
      <section><h4>已有流水</h4>
        {error?<p role="alert">{error}</p>:record?<p>{[record.occurred_on,entry?.counterparty,entry?.amount,entry?.currency].filter(Boolean).map(String).join(" · ")}</p>:<p role="status">正在读取…</p>}
        <a href={importRecordHref(id)}>打开已有流水和来源</a>
      </section>
    </div>}
  </details>;
}

function importRecordHref(id:string){
  const params=new URLSearchParams(location.search);
  for(const [key,value] of Object.entries({tab:"record",section:"money",domain:"money",kind:"money_entry",id}))params.set(key,value);
  return `?${params}`;
}

function RuleList({rules,pending,disableRule}:{rules:MoneyImportRule[];pending:boolean;disableRule:(rule:MoneyImportRule)=>Promise<void>}){if(!rules.length)return null;return <section className="import-rules"><h3>商家导入规则</h3><p>仅精确匹配交易对方；可随时停用，不改写已确认账目。</p>{rules.map(rule=><article key={`${rule.id}:${rule.revision}`}><div><b>{rule.match_value}</b><small>{Object.entries(rule.replacements).map(([key,value])=>`${key}=${value}`).join(" · ")}</small></div><span className={`status ${rule.state}`}>{rule.state==="active"?"启用":"已停用"}</span>{rule.state==="active"&&<button type="button" className="secondary" disabled={pending} onClick={()=>void disableRule(rule)}>停用</button>}</article>)}</section>;}
function candidateStatus(value:MoneyImportCandidate["status"]):string{return({pending:"待确认",invalid:"需修正",confirmed:"已确认",ignored:"已忽略"})[value];}
function issueLabel(value:string):string{return({missing_date:"缺少日期",invalid_date:"日期无效",missing_amount:"缺少金额",invalid_amount:"金额无效",missing_entry_type:"缺少收支类型",invalid_entry_type:"收支类型无效",unsupported_currency:"仅支持 CNY 写入",unmapped_payment_method:"支付方式未映射",type_inferred_from_negative_amount:"已根据负号推断为支出",duplicate_external_id:"交易单号已确认过",import_rule_applied:"已应用精确商家规则"} as Record<string,string>)[value]??value;}
