import { randomUUID } from "node:crypto";
import type { Pool,PoolClient } from "pg";
import { conflict } from "@shadow/kernel";

export interface StoredRunEvent { sequence:number;event_type:string;payload:unknown;created_at:string; }
export interface StoredMessage { id:string;role:"user"|"assistant";content:string;createdAt:string; }
export interface StoredRun { id:string;thread_id:string;status:"running"|"awaiting_input"|"completed"|"interrupted"|"failed";error:string|null;started_at:string;finished_at:string|null;last_sequence:number; }
type Terminal=Exclude<StoredRun["status"],"running">;

export class AgentRepository {
  readonly ownerId=randomUUID();
  constructor(private readonly pool:Pool){}
  async createThread(subjectId:string,id:string,title:string){await this.pool.query("insert into threads(id,subject_id,title) values($1,$2,$3)",[id,subjectId,title]);}
  async assertThread(subjectId:string,threadId:string){if(!(await this.pool.query("select 1 from threads where id=$1 and subject_id=$2",[threadId,subjectId])).rowCount)throw new Error("thread_not_found");}
  async addMessage(threadId:string,id:string,role:"user"|"assistant",content:string){await this.pool.query("insert into messages(id,thread_id,role,content) values($1,$2,$3,$4)",[id,threadId,role,content]);await this.pool.query("update threads set updated_at=now() where id=$1",[threadId]);}
  async conversation(subjectId:string,threadId:string,limit=50):Promise<StoredMessage[]>{const result=await this.pool.query<{id:string;role:"user"|"assistant";content:string;created_at:string}>("select message.id,message.role,message.content,message.created_at::text from messages message join threads thread on thread.id=message.thread_id where message.thread_id=$1 and thread.subject_id=$2 order by message.created_at desc,message.id desc limit $3",[threadId,subjectId,limit]);return result.rows.reverse().map(row=>({id:row.id,role:row.role,content:row.content,createdAt:row.created_at}));}
  private async transaction<T>(work:(client:PoolClient)=>Promise<T>):Promise<T>{const c=await this.pool.connect();try{await c.query("begin");const result=await work(c);await c.query("commit");return result;}catch(error){await c.query("rollback");throw error;}finally{c.release();}}
  private async insertEvent(c:PoolClient,runId:string,eventType:string,payload:unknown){const next=await c.query<{sequence:number}>("select coalesce(max(sequence),0)+1 as sequence from run_events where run_id=$1",[runId]);const sequence=next.rows[0]!.sequence;await c.query("insert into run_events(run_id,sequence,event_type,payload) values($1,$2,$3,$4)",[runId,sequence,eventType,payload]);return sequence;}
  // A receipt is associated with its run in the same transaction as the business write. Recovery
  // can publish a committed receipt even if the process died between commit and SSE append.
  private async recoverReceipts(c:PoolClient,runId:string){
    const operations=await c.query<{subject_id:string;capability:string;command_id:string;execution_id:string;agent_tool_call_id:string;result:unknown}>("select o.subject_id,o.capability,o.command_id,o.execution_id,o.agent_tool_call_id,o.result from operations o where o.agent_run_id=$1 and not exists(select 1 from run_events e where e.run_id=$1 and e.event_type='operation.committed' and e.payload->>'execution_id'=o.execution_id) order by o.created_at,o.execution_id",[runId]);
    for(const o of operations.rows)await this.insertEvent(c,runId,"operation.committed",{id:`${runId}:recovered:${o.execution_id}`,run_id:runId,type:"operation.committed",authority:"executor",subject_id:o.subject_id,tool_call_id:o.agent_tool_call_id,capability:o.capability,command_id:o.command_id,execution_id:o.execution_id,result:o.result});
  }
  private async recoverThread(c:PoolClient,threadId:string){
    const orphaned=await c.query<{id:string}>("select id from runs where thread_id=$1 and status='running' and (owner_id is null or lease_expires_at is null or lease_expires_at<=clock_timestamp()) for update",[threadId]);
    for(const run of orphaned.rows){await this.recoverReceipts(c,run.id);await this.insertEvent(c,run.id,"run.state",{id:`${run.id}:lease-expired`,run_id:run.id,type:"run.state",state:"interrupted",reason:"Run owner lease expired."});await c.query("update runs set status='interrupted',error='Run owner lease expired.',finished_at=clock_timestamp() where id=$1",[run.id]);}
  }
  async createRun(threadId:string,id:string,message?:{id:string;content:string}){
    await this.transaction(async c=>{
      await c.query("select id from threads where id=$1 for no key update",[threadId]);await this.recoverThread(c,threadId);
      if((await c.query("select 1 from runs where thread_id=$1 and status='running'",[threadId])).rowCount)throw conflict("thread_has_active_run");
      await c.query("insert into runs(id,thread_id,status,owner_id,lease_expires_at) values($1,$2,'running',$3,clock_timestamp()+interval '30 seconds')",[id,threadId,this.ownerId]);
      if(message){await c.query("insert into messages(id,thread_id,role,content) values($1,$2,'user',$3)",[message.id,threadId,message.content]);await c.query("update threads set updated_at=now() where id=$1",[threadId]);}
    });
  }
  private async ownedRun(c:PoolClient,runId:string){
    await c.query("select id from runs where id=$1 for update",[runId]);
    return(await c.query<{thread_id:string;stop_requested_at:unknown}>("select thread_id,stop_requested_at from runs where id=$1 and owner_id=$2 and status='running' and lease_expires_at>clock_timestamp()",[runId,this.ownerId])).rows[0];
  }
  async heartbeat(runId:string):Promise<boolean>{return this.transaction(async c=>{const run=await this.ownedRun(c,runId);if(!run||run.stop_requested_at)return false;await c.query("update runs set lease_expires_at=clock_timestamp()+interval '30 seconds' where id=$1",[runId]);return true;});}
  async appendEvent(runId:string,eventType:string,payload:unknown){return this.transaction(async c=>{
    const run=await this.ownedRun(c,runId);
    if(!run)throw conflict("agent run lease is no longer valid");
    if(run.stop_requested_at&&!(eventType==="run.state"&&(payload as {state?:unknown})?.state==="interrupted"))throw conflict("agent run stop was requested");
    return this.insertEvent(c,runId,eventType,payload);
  });}
  async finishRun(runId:string,status:Terminal,error?:string,message?:{id:string;content:string}){
    await this.transaction(async c=>{
      const run=await this.ownedRun(c,runId);
      if(!run)throw conflict("agent run lease is no longer valid");
      const finalStatus=run.stop_requested_at?"interrupted":status;
      if(finalStatus!==status)await this.insertEvent(c,runId,"run.state",{id:`${runId}:stopped`,run_id:runId,type:"run.state",state:"interrupted",reason:"Run stopped by the user."});
      await this.recoverReceipts(c,runId);
      if(message)await c.query("insert into messages(id,thread_id,role,content) values($1,$2,'assistant',$3)",[message.id,run.thread_id,message.content]);
      await c.query("update runs set status=$2,error=$3,finished_at=clock_timestamp() where id=$1",[runId,finalStatus,error??null]);
    });
  }
  async requestStop(subjectId:string,runId:string):Promise<"stopping"|StoredRun["status"]|undefined>{return this.transaction(async c=>{
    const thread=await c.query<{thread_id:string}>("select t.id thread_id from threads t join runs r on r.thread_id=t.id where r.id=$1 and t.subject_id=$2 for no key update of t",[runId,subjectId]);if(!thread.rowCount)return undefined;
    await this.recoverThread(c,thread.rows[0]!.thread_id);
    const run=await c.query<{status:StoredRun["status"]}>("select status from runs where id=$1 for update",[runId]);if(run.rows[0]!.status!=="running")return run.rows[0]!.status;
    await c.query("update runs set stop_requested_at=coalesce(stop_requested_at,clock_timestamp()) where id=$1",[runId]);return"stopping";
  });}
  async run(subjectId:string,runId:string):Promise<StoredRun|undefined>{
    return this.transaction(async c=>{
      const thread=await c.query<{id:string}>("select t.id from threads t join runs r on r.thread_id=t.id where r.id=$1 and t.subject_id=$2 for no key update of t",[runId,subjectId]);if(!thread.rowCount)return undefined;await this.recoverThread(c,thread.rows[0]!.id);
      return(await c.query<StoredRun>("select r.id,r.thread_id,r.status,r.error,r.started_at::text,r.finished_at::text,coalesce((select max(sequence) from run_events where run_id=r.id),0)::int last_sequence from runs r where r.id=$1",[runId])).rows[0];
    });
  }
  async events(subjectId:string,runId:string,after=0):Promise<StoredRunEvent[]>{const result=await this.pool.query<StoredRunEvent>("select e.sequence,e.event_type,e.payload,e.created_at::text from run_events e join runs r on r.id=e.run_id join threads t on t.id=r.thread_id where e.run_id=$1 and t.subject_id=$2 and e.sequence>$3 order by e.sequence",[runId,subjectId,after]);return result.rows;}
  async listThreads(subjectId:string):Promise<unknown[]>{return(await this.pool.query("select t.id,t.title,t.created_at,t.updated_at,(select content from messages where thread_id=t.id order by created_at desc limit 1) last_message from threads t where subject_id=$1 order by updated_at desc limit 100",[subjectId])).rows;}
}
