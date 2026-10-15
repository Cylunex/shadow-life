import { useEffect,useRef,useState,type FormEvent } from "react";
import { AssistantFoundationSources } from "./AssistantFoundationSources.js";
import { AssistantSources } from "./AssistantSources.js";
import { applyAssistantEvent,createAssistantView,readAssistantSse,renderAssistantView,type AssistantView } from "./assistant-stream.js";
import { discoverAssistantRun,observeAssistantRun,type ObservationState } from "./assistant-recovery.js";
import type { CommandStorage,Execute } from "./command-controller.js";

type Thread={id:string;title:string};
type Message={id:string;role:"user"|"assistant";content:string;created_at:string};
type Props={identityKey:string;scopeKey:string;headers:HeadersInit;writeHeaders:()=>HeadersInit;storage:CommandStorage;execute:Execute;canAttach:boolean;hasSelection:boolean;contextReference:()=>Promise<{kind:string;id:string;revision:number}>};

export function Assistant({identityKey,scopeKey,headers,writeHeaders,storage,execute,canAttach,hasSelection,contextReference}:Props){
  const storageKey=`shadow-life:assistant-thread:${identityKey||"anonymous"}`;
  const [text,setText]=useState(""),[threads,setThreads]=useState<Thread[]>([]),[threadId,setThreadId]=useState<string>(),[messages,setMessages]=useState<Message[]>([]);
  const [view,setView]=useState<AssistantView>(),[pending,setPending]=useState(false),[ready,setReady]=useState(false),[attach,setAttach]=useState(true);
  const [error,setError]=useState<string>(),[observation,setObservation]=useState<ObservationState>("observing"),[stopState,setStopState]=useState<"requested"|"unconfirmed">();
  const [historyCursor,setHistoryCursor]=useState<string|null>(null),[historyLoading,setHistoryLoading]=useState(false);
  const session=useRef<AbortController|undefined>(undefined),latest=useRef<AssistantView|undefined>(undefined),observedFinished=useRef(false);
  const current=(controller:AbortController)=>session.current===controller&&!controller.signal.aborted;
  function publish(value:AssistantView,controller:AbortController){if(!current(controller))return;latest.current=value;setView({...value});}
  function begin(){session.current?.abort();const controller=new AbortController();session.current=controller;observedFinished.current=false;setError(undefined);setStopState(undefined);setObservation("observing");return controller;}
  function options(controller:AbortController,value?:AssistantView){return{fetcher:fetch,headers,signal:controller.signal,hidden:()=>document.visibilityState==="hidden",onUpdate:(state:ObservationState)=>{if(!current(controller))return;if(state==="finished")observedFinished.current=true;setObservation(state);if(value)publish(value,controller);}};}
  async function json<T>(url:string,controller:AbortController):Promise<T>{const response=await fetch(url,{headers,signal:controller.signal});if(!response.ok)throw new Error(`对话读取失败（HTTP ${response.status}）`);return response.json() as Promise<T>;}
  async function refreshThreads(controller:AbortController){const body=await json<{items:Thread[]}>("/api/threads",controller);if(current(controller))setThreads(body.items);return body.items;}
  async function openThread(id:string|undefined){
    const controller=begin();setThreadId(id);setView(undefined);latest.current=undefined;setMessages([]);setHistoryCursor(null);setPending(Boolean(id));setReady(false);
    try{
      if(!id){storage.removeItem?.(storageKey);return;}
      storage.setItem(storageKey,id);
      const [history,run]=await Promise.all([json<{items:Message[];next_cursor:string|null}>(`/api/threads/${encodeURIComponent(id)}/messages?limit=50`,controller),discoverAssistantRun(id,options(controller))]);
      if(!current(controller))return;
      setMessages(history.items.filter(item=>!(run&&item.role==="assistant"&&Date.parse(item.created_at)>=Date.parse(run.started_at))));setHistoryCursor(history.next_cursor);
      if(run){const restored=createAssistantView(run.id);publish(restored,controller);await observeAssistantRun(restored,options(controller,restored));}
    }catch(caught){if(current(controller))setError(caught instanceof Error?caught.message:"恢复对话失败");}
    finally{if(current(controller)){setPending(false);setReady(true);setStopState(undefined);}}
  }
  useEffect(()=>{
    const controller=begin();setReady(false);
    void refreshThreads(controller).then(items=>{if(!current(controller))return;let saved:string|null=null;try{saved=storage.getItem(storageKey);}catch{}void openThread(saved&&items.some(item=>item.id===saved)?saved:items[0]?.id);}).catch(caught=>{if(current(controller)){setError(caught instanceof Error?caught.message:"对话列表读取失败");setReady(true);}});
    return()=>session.current?.abort();
  },[identityKey,scopeKey]);
  async function olderMessages(){
    const controller=session.current;if(!controller||!threadId||!historyCursor||historyLoading)return;
    setHistoryLoading(true);
    try{const body=await json<{items:Message[];next_cursor:string|null}>(`/api/threads/${encodeURIComponent(threadId)}/messages?${new URLSearchParams({limit:"50",cursor:historyCursor})}`,controller);if(current(controller)){setMessages(items=>[...body.items,...items]);setHistoryCursor(body.next_cursor);}}
    catch(caught){if(current(controller))setError(caught instanceof Error?caught.message:"更早消息读取失败");}
    finally{if(current(controller))setHistoryLoading(false);}
  }
  async function run(event:FormEvent){
    event.preventDefault();const prompt=text.trim();if(!prompt||pending||!ready)return;
    const preceding=latest.current,controller=begin(),value=createAssistantView();let id=threadId;
    setPending(true);setText("");
    const at=new Date().toISOString();
    setMessages(items=>[...items,...(preceding?[{id:`local_${preceding.runId}`,role:"assistant" as const,content:renderAssistantView(preceding),created_at:at}]:[]),{id:`local_${at}`,role:"user",content:prompt,created_at:at}]);
    publish(value,controller);
    try{
      if(!id){
        const response=await fetch("/api/threads",{method:"POST",headers:writeHeaders(),body:JSON.stringify({title:prompt.slice(0,40)}),signal:controller.signal});
        if(!response.ok)throw new Error(`创建对话失败（HTTP ${response.status}）`);
        id=((await response.json()) as {id:string}).id;if(!current(controller))return;
        setThreadId(id);storage.setItem(storageKey,id);
      }
      let contextPackId:string|undefined;
      if(hasSelection&&attach&&canAttach){
        const ref=await contextReference();if(!current(controller))return;
        const receipt=await execute("agent.create_context_pack",{thread_id:id,object_refs:[ref],ttl_minutes:15},`assistant-context:${id}:${ref.kind}:${ref.id}:${ref.revision}`);
        if(!current(controller))return;contextPackId=String(receipt.actual_values.context_pack_id);
      }
      try{
        const response=await fetch(`/api/threads/${encodeURIComponent(id)}/runs`,{method:"POST",headers:writeHeaders(),body:JSON.stringify({text:prompt,...(contextPackId?{context_pack_id:contextPackId}:{})}),signal:controller.signal});
        if(!response.ok)throw new Error(`助手请求失败（HTTP ${response.status}）`);
        value.runId=response.headers.get("X-Shadow-Run-Id")??undefined;publish(value,controller);
        if(response.body){
          const subscription=new AbortController(),cancel=()=>subscription.abort();controller.signal.addEventListener("abort",cancel,{once:true});
          try{await readAssistantSse(response.body,(item,sequence)=>{if(!current(controller))return;applyAssistantEvent(value,item,sequence);publish(value,controller);if(value.hasGap)subscription.abort();},subscription.signal);}
          finally{controller.signal.removeEventListener("abort",cancel);}
        }
      }catch(caught){if(!current(controller))return;setObservation("reconnecting");if(!value.runId){const found=await discoverAssistantRun(id,options(controller));if(found&&found.id!==preceding?.runId)value.runId=found.id;else throw caught;}}
      if(!current(controller))return;
      if(!value.runId){const found=await discoverAssistantRun(id,options(controller));if(found&&found.id!==preceding?.runId)value.runId=found.id;}
      if(!value.runId)throw new Error("运行结果尚未确认；重新打开对话可继续查找。");
      await observeAssistantRun(value,options(controller,value));
      if(current(controller))await refreshThreads(controller);
    }catch(caught){if(current(controller))setError(caught instanceof Error?caught.message:"运行结果尚未确认");}
    finally{if(current(controller)){publish(value,controller);setPending(false);setStopState(undefined);}}
  }
  async function stop(){
    const controller=session.current,runId=latest.current?.runId;if(!controller||!runId||!pending)return;
    setStopState("requested");setError(undefined);
    try{
      const response=await fetch(`/api/runs/${encodeURIComponent(runId)}/stop`,{method:"POST",headers:writeHeaders(),signal:controller.signal});
      if(!response.ok)throw new Error(`停止请求未确认（HTTP ${response.status}）`);
      // The stop response acknowledges the request. The observer drains receipts and
      // the final state, including writes committed before the stop won the race.
    }catch(caught){if(current(controller)&&!observedFinished.current){setStopState("unconfirmed");setError(caught instanceof Error?caught.message:"停止请求未确认，正在继续观察原运行。");}}
  }
  const status=stopState==="requested"?"正在停止…":stopState==="unconfirmed"?"停止未确认，继续观察运行":observation==="reconnecting"?"连接中断，正在恢复结果":view?.state==="completed"||view?.state==="interrupted"?"正在确认运行结果":stateLabel(view?.state);
  return <section className="assistant-panel">
    <div className="assistant-thread-toolbar"><label>对话<select value={threadId??""} disabled={pending||!ready} onChange={event=>void openThread(event.target.value||undefined)}><option value="">新对话</option>{threads.map(thread=><option key={thread.id} value={thread.id}>{thread.title}</option>)}</select></label><button type="button" className="secondary" disabled={pending||!ready} onClick={()=>void openThread(undefined)}>新对话</button></div>
    {error&&<p role="alert" className="inline-error">{error}</p>}
    {historyCursor&&<button type="button" className="secondary" disabled={historyLoading||pending} onClick={()=>void olderMessages()}>{historyLoading?"读取中…":"加载更早消息"}</button>}
    {!ready&&<p>正在恢复对话…</p>}
    <div className="assistant-transcript">{messages.map(message=><p key={message.id}><b>{message.role==="user"?"你":"Shadow"}：</b>{message.content}</p>)}{view&&renderAssistantView(view)&&<p className="assistant-live" aria-live="polite"><b>Shadow：</b>{renderAssistantView(view)}</p>}</div>
    {view&&view.activities.size>0&&<ol className="assistant-activities" aria-label="助手活动">{[...view.activities].map(([id,activity])=><li key={id} data-state={activity.state}>{!pending&&activity.state==="running"?"调用已结束，完成情况未确认":activity.label}</li>)}</ol>}
    {view?.state==="awaiting_input"&&<p className="run-state">需要补充信息</p>}
    <AssistantFoundationSources key={`foundation:${view?.runId??threadId}`} queries={[...(view?.foundationQueries.values()??[])]} headers={headers}/>
    <AssistantSources key={view?.runId??threadId} queries={[...(view?.contextQueries.values()??[])]} headers={headers} unavailable={view?.contextUnavailable??false}/>
    {pending&&<p className="run-state" role="status">{status}</p>}
    <form onSubmit={run}><label>告诉 Shadow 要记录、补充或查找什么<textarea required value={text} onChange={event=>setText(event.target.value)}/></label>{hasSelection&&canAttach&&<label className="checkbox-row"><input type="checkbox" checked={attach} onChange={event=>setAttach(event.target.checked)}/>携带当前记录的临时上下文</label>}<div className="actions"><button disabled={pending||!ready}>{pending?"处理中…":"发送"}</button>{pending&&<button className="secondary" type="button" disabled={!view?.runId||stopState==="requested"} onClick={()=>void stop()}>{stopState==="requested"?"正在停止…":"停止"}</button>}</div></form>
  </section>;
}

function stateLabel(state:AssistantView["state"]):string{return({started:"正在启动",streaming:"正在回复",awaiting_input:"等待补充",committed_partial:"部分操作已保存",completed:"已完成",interrupted:"已中断"} as const)[state??"started"];}
