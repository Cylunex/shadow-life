import { executionResultSchema, type ExecutionResult, type WriteCapabilityName } from "@shadow/contracts";

export type Execute = (capability: WriteCapabilityName, input: unknown, scope: string) => Promise<ExecutionResult>;

type CommandState = "pending" | "unknown";
type StoredCommand = {
  version: 2;
  issuer: string;
  subjectId: string;
  clientId: string;
  capability: WriteCapabilityName;
  inputDigest: string;
  commandId: string;
  intentId: string;
  state: CommandState;
  createdAt: string;
  updatedAt: string;
};
type StoredDraft = {
  version: 1;
  issuer: string;
  subjectId: string;
  clientId: string;
  commandId: string;
  inputDigest: string;
  expiresAt: string;
  input: unknown;
};
type LegacyCommand = {version:1;capability:WriteCapabilityName;inputHash:string;commandId:string;state:string};

export interface CommandStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

const DRAFT_TTL_MS=30*60*1000;

export class CommandController {
  private readonly inFlight = new Map<string, Promise<ExecutionResult>>();
  private identity:{issuer:string;subjectId:string;clientId:string}|undefined;

  constructor(
    private readonly fetcher: typeof fetch,
    private readonly headers: () => HeadersInit,
    private readonly journalStorage: CommandStorage,
    private readonly namespace = "shadow-life:web-command:v2",
    private readonly draftStorage: CommandStorage = journalStorage,
  ) {}

  setIdentity(issuer:string,subjectId:string,clientId:string):void {
    const next={issuer:issuer.trim(),subjectId:subjectId.trim(),clientId:clientId.trim()};
    if(!next.issuer||!next.subjectId||!next.clientId)throw new Error("服务端没有返回完整的会话身份，已停止写入。");
    if(this.identity&&(this.identity.issuer!==next.issuer||this.identity.subjectId!==next.subjectId||this.identity.clientId!==next.clientId)&&this.inFlight.size)throw new Error("写入过程中会话身份发生变化，请等待当前操作结束。");
    this.identity=next;
  }

  readonly execute: Execute = async (capability, input, scope) => {
    const identity=this.identity;
    if(!identity)throw new Error("会话身份仍在初始化，请稍后重试；本次没有提交。");
    const key=this.key(scope,identity);
    const running=this.inFlight.get(key);
    if(running)return running;
    const run=()=>this.executeOne(capability,input,scope,key,identity).finally(()=>this.inFlight.delete(key));
    const locks=typeof navigator!=="undefined"?navigator.locks:undefined;
    const operation:Promise<ExecutionResult>=(async()=>locks?await locks.request(`shadow-life:${key}`,async()=>await run()):await run())();
    this.inFlight.set(key,operation);
    return operation;
  };

  private async executeOne(capability:WriteCapabilityName,input:unknown,scope:string,key:string,identity:{issuer:string;subjectId:string;clientId:string}):Promise<ExecutionResult> {
    const inputDigest=await digest(stableJson(input));
    const previous=await this.read(key,identity,scope);
    if(previous){
      const recovered=await this.recover(previous,key);
      if(recovered)return recovered;
      if(previous.capability!==capability)throw new Error("上一笔操作尚未在服务端找到；当前操作类型已变化。为避免覆盖或重复写入，请先完成原操作。");
      const draft=this.readDraft(key,previous);
      if(!draft)throw new Error("上一笔操作尚未在服务端找到，且本地临时草稿已过期；操作保持未知状态，请由服务端运维确认后再继续。");
      // The persisted draft is the source of truth for an unresolved intent. UI defaults such as
      // quoted_at may change after reload; replaying them would silently create a second intent.
      return this.submit({...previous,state:"pending",updatedAt:new Date().toISOString()},draft.input,key);
    }

    const now=new Date().toISOString();
    const command:StoredCommand={version:2,...identity,capability,inputDigest,commandId:`cmd_web_${crypto.randomUUID()}`,intentId:`intent_web_${crypto.randomUUID()}`,state:"pending",createdAt:now,updatedAt:now};
    this.write(key,command);
    this.writeDraft(key,{version:1,...identity,commandId:command.commandId,inputDigest,expiresAt:new Date(Date.now()+DRAFT_TTL_MS).toISOString(),input});
    return this.submit(command,input,key);
  }

  private request(...args:Parameters<typeof fetch>):ReturnType<typeof fetch>{
    const fetcher=this.fetcher;
    return fetcher(...args);
  }

  private async recover(command:StoredCommand,key:string):Promise<ExecutionResult|undefined> {
    let response:Response;
    try{response=await this.request(`/api/operations/by-command/${encodeURIComponent(command.commandId)}`,{headers:this.headers()});}
    catch{this.markUnknown(key,command);throw new Error("网络不可用，上一笔操作的结果仍未知；请恢复网络后重试。");}
    if(response.ok){
      const result=this.parseReceipt(await response.json(),command);
      return this.finish(key,result);
    }
    if(response.status===404){this.markUnknown(key,command);return undefined;}
    this.markUnknown(key,command);
    throw new Error(await responseMessage(response,"暂时无法确认上一笔操作是否成功。"));
  }

  private async submit(command:StoredCommand,input:unknown,key:string):Promise<ExecutionResult> {
    this.write(key,{...command,state:"pending",updatedAt:new Date().toISOString()});
    let response:Response;
    try{
      response=await this.request(`/api/commands/${command.capability}`,{method:"POST",headers:this.headers(),body:JSON.stringify({protocol:"shadow.command",capability:command.capability,command_id:command.commandId,input})});
    }catch{
      this.markUnknown(key,command);
      throw new Error("提交后连接中断，结果尚未确认；再次点击会先查询并重放原操作，不会创建新操作。");
    }
    if(!response.ok){
      const value=await response.clone().json().catch(()=>undefined) as {code?:string;message?:string}|undefined;
      if([400,409,413,422].includes(response.status)&&value?.code!=="outcome_unknown")this.clear(key);
      else this.markUnknown(key,command);
      throw new Error(value?.message??`保存失败（HTTP ${response.status}）`);
    }
    const result=this.parseReceipt(await response.json(),command);
    return this.finish(key,result);
  }

  private parseReceipt(value:unknown,command:StoredCommand):ExecutionResult {
    const parsed=executionResultSchema.safeParse(value);
    if(!parsed.success||parsed.data.status!=="committed"||parsed.data.command_id!==command.commandId||parsed.data.capability!==command.capability)throw new Error("服务端返回的执行回执与当前操作不匹配；结果保持未知，请勿重复提交。");
    return parsed.data;
  }

  private finish(key:string,result:ExecutionResult):ExecutionResult {
    try{this.clear(key);return result;}
    catch{return{...result,warnings:[...result.warnings,"服务端已保存，但浏览器未能清理本地恢复状态；后续会继续按同一命令核对。"]};}
  }

  private markUnknown(key:string,command:StoredCommand):void {this.write(key,{...command,state:"unknown",updatedAt:new Date().toISOString()});}

  private async read(key:string,identity:{issuer:string;subjectId:string;clientId:string},scope:string):Promise<StoredCommand|undefined> {
    let raw:string|null;
    try{raw=this.journalStorage.getItem(key);}catch{throw new Error("浏览器无法读取安全重试状态；为避免重复写入，本次没有提交。");}
    if(!raw){
      const legacyKey=`${this.namespace}:${scope}`;
      let legacyRaw:string|null;
      try{legacyRaw=this.journalStorage.getItem(legacyKey);}catch{throw new Error("浏览器无法读取安全重试状态；为避免重复写入，本次没有提交。");}
      if(!legacyRaw)return undefined;
      try{
        const legacy=JSON.parse(legacyRaw) as LegacyCommand;
        if(legacy.version!==1||typeof legacy.commandId!=="string"||typeof legacy.capability!=="string"||typeof legacy.inputHash!=="string")return undefined;
        const now=new Date().toISOString();
        const migrated:StoredCommand={version:2,...identity,capability:legacy.capability,inputDigest:await digest(legacy.inputHash),commandId:legacy.commandId,intentId:`intent_legacy_${legacy.commandId}`,state:"unknown",createdAt:now,updatedAt:now};
        this.write(key,migrated);
        this.remove(this.journalStorage,legacyKey);
        return migrated;
      }catch(error){
        if(error instanceof Error&&error.message.includes("浏览器无法"))throw error;
        return undefined;
      }
    }
    try{
      const value=JSON.parse(raw) as StoredCommand;
      if(value.version===2&&value.issuer===identity.issuer&&value.subjectId===identity.subjectId&&value.clientId===identity.clientId&&typeof value.commandId==="string")return value;
      return undefined;
    }catch{return undefined;}
  }

  private readDraft(key:string,command:StoredCommand):StoredDraft|undefined {
    let raw:string|null;
    try{raw=this.draftStorage.getItem(`${key}:draft`);}catch{return undefined;}
    if(!raw)return undefined;
    try{const value=JSON.parse(raw) as StoredDraft;if(value.version!==1||value.issuer!==command.issuer||value.subjectId!==command.subjectId||value.clientId!==command.clientId||value.commandId!==command.commandId||value.inputDigest!==command.inputDigest||Date.parse(value.expiresAt)<=Date.now()){this.remove(this.draftStorage,`${key}:draft`);return undefined;}return value;}catch{this.remove(this.draftStorage,`${key}:draft`);return undefined;}
  }

  private write(key:string,value:StoredCommand):void {try{this.journalStorage.setItem(key,JSON.stringify(value));}catch{throw new Error("浏览器无法保存安全重试状态；为避免重复写入，本次没有提交。");}}
  private writeDraft(key:string,value:StoredDraft):void {try{this.draftStorage.setItem(`${key}:draft`,JSON.stringify(value));}catch{this.remove(this.journalStorage,key);throw new Error("浏览器无法保存本次临时草稿；为避免无法安全重放，本次没有提交。");}}
  private clear(key:string):void {this.remove(this.draftStorage,`${key}:draft`);this.remove(this.journalStorage,key);}
  private remove(storage:CommandStorage,key:string):void {if(storage.removeItem)storage.removeItem(key);else storage.setItem(key,"");}
  private key(scope:string,identity:{issuer:string;subjectId:string;clientId:string}):string {return `${this.namespace}:${encodeURIComponent(identity.issuer)}:${encodeURIComponent(identity.subjectId)}:${encodeURIComponent(identity.clientId)}:${scope}`;}
}

function stableJson(value:unknown):string {
  if(Array.isArray(value))return`[${value.map(stableJson).join(",")}]`;
  if(value!==null&&typeof value==="object")return`{${Object.entries(value as Record<string,unknown>).sort(([left],[right])=>left.localeCompare(right)).map(([key,item])=>`${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  return JSON.stringify(value)??"null";
}

async function digest(value:string):Promise<string>{const bytes=new TextEncoder().encode(value),hash=await crypto.subtle.digest("SHA-256",bytes);return[...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,"0")).join("");}
async function responseMessage(response:Response,fallback:string):Promise<string>{const value=await response.json().catch(()=>undefined) as {message?:string}|undefined;return value?.message??fallback;}
