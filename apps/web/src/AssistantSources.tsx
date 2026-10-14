import { useState } from 'react';
import type { AgentContextRecord, AgentContextResult } from '@shadow/contracts';

export function sourceHref(record:AgentContextRecord,latest=false):string{
  const kind=record.ref.kind==='health_measurement'?'measurement':record.ref.kind==='health_workout'?'workout_session':record.ref.kind;
  const query=new URLSearchParams({tab:'record',section:'timeline',domain:record.domain,kind,id:record.ref.id});
  if(record.detail.capability==='life.get_record')query.set('record_id',String(record.detail.input.id));
  if(record.ref.kind==='library_item'&&!latest)query.set('source_revision',String(record.ref.revision));
  return `?${query}`;
}
export function AssistantSources({queries,headers,unavailable=false}:{queries:AgentContextResult[];headers:HeadersInit;unavailable?:boolean}){
  const [changed,setChanged]=useState<Set<string>>(new Set()),[error,setError]=useState<string>(),[checking,setChecking]=useState<string>();
  const sources=[...new Map(queries.flatMap(query=>query.records).map(record=>[`${record.ref.kind}:${record.ref.id}:${record.ref.revision}`,record])).entries()];
  if(!sources.length&&!queries.length&&!unavailable)return null;
  async function open(key:string,record:AgentContextRecord){
    setChecking(key);setError(undefined);
    try{
      const response=await fetch('/api/agent/context',{method:'POST',headers:{...Object.fromEntries(new Headers(headers)), 'content-type':'application/json'},body:JSON.stringify({object_refs:[record.ref],limit:1})});
      if(response.status===404||response.status===403){setChanged(current=>new Set([...current,key]));return;}
      if(!response.ok)throw new Error('来源暂时无法读取，请重试。');
      window.location.href=sourceHref(record);
    }catch(failure){setError(failure instanceof Error?failure.message:'来源暂时无法读取。');}finally{setChecking(undefined);}
  }
  return <details className="assistant-sources"><summary>依据记录 · 本次查询的来源（{sources.length}）</summary><p>这些记录由本次查询读取。回答未提供逐句引用。</p>{unavailable&&<p>记录已变更或当前不可见，请重新查询。</p>}{queries.some(query=>query.truncation.truncated)&&<p>本次仅显示部分来源，可继续查询或打开详情。</p>}{!sources.length&&!unavailable&&<p>本次查询没有可展示的记录来源。</p>}<ul>{sources.map(([key,record])=><li key={key}>{changed.has(key)?<><span>记录已变更或当前不可见。</span><a href={sourceHref(record,true)}>打开最新记录</a></>:<><button type="button" className="source-link" disabled={checking===key} onClick={()=>void open(key,record)}>{record.title||'记录'}</button><small>{record.happened_on} · {({manual:'手动记录',text:'文本来源',image:'图片来源',receipt:'收据来源',import:'导入来源',device:'设备记录',note:'笔记',trip:'旅程'} as Record<string,string>)[record.source_type]??record.source_type} · 修订 {record.ref.revision}{record.amount?` · ${record.amount} ${record.currency}`:''}</small>{record.ref.kind==='library_item'&&<small>查询来源保留修订 {record.ref.revision}；详情可查看该历史正文。</small>}</>}</li>)}</ul>{error&&<p className="inline-error">{error}</p>}</details>;
}
