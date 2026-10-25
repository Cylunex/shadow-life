import { useState } from 'react';

export function AssistantFoundationSources({queries,headers}:{queries:Array<{capability:string;result:any}>;headers:HeadersInit}){
  const [detail,setDetail]=useState<any>(),[error,setError]=useState<string>();
  const nodes:any[]=[];
  for(const query of queries){
    if(query.capability==='agent.objects')nodes.push(...query.result.nodes);
    if(query.capability==='agent.workspace'){
      for(const item of query.result.intentions)nodes.push({ref:{kind:'agent_intention',id:item.id,revision:item.revision},title:item.statement});
      for(const section of query.result.sections)if(Array.isArray(section.data))nodes.push(...section.data.filter((item:any)=>item.ref));
    }
  }
  const sources=[...new Map(nodes.map(node=>[`${node.ref.kind}:${node.ref.id}:${node.ref.revision}`,node])).values()];
  if(!sources.length)return null;
  async function open(node:any){setError(undefined);try{const response=await fetch('/api/agent/foundation/objects',{method:'POST',headers:{...Object.fromEntries(new Headers(headers)),'content-type':'application/json'},body:JSON.stringify({object_refs:[node.ref],depth:1,limit:30})});if(!response.ok)throw new Error('这条依据已变更或当前不可见，请重新查询。');setDetail(await response.json());}catch(caught){setError(caught instanceof Error?caught.message:'依据读取失败');}}
  return <details className="assistant-sources"><summary>规划与个人数据依据 · 本次查询的来源（{sources.length}）</summary><p>这些是助手本次实际读取的目标、计划和记录。</p><ul>{sources.map(node=><li key={`${node.ref.kind}:${node.ref.id}`}><button className="source-link" onClick={()=>void open(node)}>{node.title}</button><small>修订 {node.ref.revision}</small></li>)}</ul>{error&&<p className="inline-error">{error}</p>}{detail&&<section className="editor-card">{detail.nodes.map((node:any)=><article key={`${node.ref.kind}:${node.ref.id}`}><h4>{node.title}</h4><p>{node.data.statement??node.data.goal??node.data.note??node.data.text??node.data.original_text??''}</p>{node.data.amount&&<p>{node.data.amount} {node.data.currency}</p>}{node.data.quantity&&<p>{node.data.quantity} {node.data.unit}</p>}{node.data.asset_version_id&&<a href={`/api/assets/${encodeURIComponent(node.data.asset_version_id)}`}>下载原件</a>}</article>)}{detail.truncated&&<p>这里只展示部分关联。</p>}<button className="secondary" onClick={()=>setDetail(undefined)}>关闭</button></section>}</details>;
}
