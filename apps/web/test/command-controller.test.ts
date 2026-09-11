import assert from "node:assert/strict";
import test from "node:test";
import type { ExecutionResult } from "@shadow/contracts";
import { CommandController } from "../src/command-controller.js";

class MemoryStorage {
  values=new Map<string,string>();
  getItem(key:string){return this.values.get(key)??null;}
  setItem(key:string,value:string){this.values.set(key,value);}
  removeItem(key:string){this.values.delete(key);}
}
const result=(commandId:string):ExecutionResult=>({protocol:"shadow.execution-result",capability:"money.record_entry",command_id:commandId,execution_id:"execution_12345678",status:"committed",result_kind:"record",resources:[{type:"money_entry",id:"money_entry_12345678",revision:1}],actual_values:{},warnings:[],replayed:false});
function controller(fetcher:typeof fetch,journal:MemoryStorage,drafts=new MemoryStorage()){const value=new CommandController(fetcher,()=>({authorization:"Bearer test"}),journal,"test",drafts);value.setIdentity("https://identity.example.com","subject_test","client_test");return value;}

test("successful receipts clear the minimal journal and a later click is a new intent",async()=>{
  const journal=new MemoryStorage(),drafts=new MemoryStorage();let posts=0,firstCommand="";
  const fetcher=(async(_input:string|URL|Request,init?:RequestInit)=>{posts+=1;const body=JSON.parse(String(init?.body)) as {command_id:string};firstCommand ||= body.command_id;return Response.json(result(body.command_id),{status:201});}) as typeof fetch;
  const value=controller(fetcher,journal,drafts),first=await value.execute("money.record_entry",{amount:"12.00"},"quick-money"),second=await value.execute("money.record_entry",{amount:"12.00"},"quick-money");
  assert.equal(posts,2);assert.equal(first.command_id,firstCommand);assert.notEqual(second.command_id,first.command_id);assert.equal(journal.values.size,0);assert.equal(drafts.values.size,0);
});

test("coalesces concurrent clicks into one command",async()=>{
  const journal=new MemoryStorage();let posts=0;
  const fetcher=(async(_input:string|URL|Request,init?:RequestInit)=>{posts+=1;const body=JSON.parse(String(init?.body)) as {command_id:string};await Promise.resolve();return Response.json(result(body.command_id),{status:201});}) as typeof fetch;
  const value=controller(fetcher,journal),one=value.execute("money.record_entry",{amount:"12.00"},"quick-money"),same=value.execute("money.record_entry",{amount:"12.00"},"quick-money");
  assert.equal((await one).command_id,(await same).command_id);assert.equal(posts,1);
});

test("queries the original command after an unknown outcome",async()=>{
  const journal=new MemoryStorage(),drafts=new MemoryStorage();let postCommand="",calls=0,saved=false;
  const fetcher=(async(input:string|URL|Request,init?:RequestInit)=>{calls+=1;if(init?.method==="POST"){postCommand=(JSON.parse(String(init.body)) as {command_id:string}).command_id;if(!saved){saved=true;throw new TypeError("disconnected");}}else{assert.match(String(input),new RegExp(postCommand));return Response.json(result(postCommand));}return Response.json(result(postCommand),{status:200});}) as typeof fetch;
  const value=controller(fetcher,journal,drafts);await assert.rejects(value.execute("money.record_entry",{amount:"12.00"},"quick-money"),/结果尚未确认/);const recovered=await value.execute("money.record_entry",{amount:"12.00"},"quick-money");
  assert.equal(recovered.command_id,postCommand);assert.equal(calls,2);assert.equal(journal.values.size,0);
});

test("404 recovery replays the persisted draft with the same id even if UI defaults changed",async()=>{
  const journal=new MemoryStorage(),drafts=new MemoryStorage();let postCommand="",postedInputs:unknown[]=[];
  const fetcher=(async(_input:string|URL|Request,init?:RequestInit)=>{if(init?.method==="POST"){const body=JSON.parse(String(init.body)) as {command_id:string;input:unknown};postCommand ||= body.command_id;assert.equal(body.command_id,postCommand);postedInputs.push(body.input);if(postedInputs.length===1)throw new TypeError("disconnected");return Response.json(result(body.command_id),{status:200});}return Response.json({message:"not found"},{status:404});}) as typeof fetch;
  const value=controller(fetcher,journal,drafts);await assert.rejects(value.execute("money.record_entry",{amount:"12.00",quoted_at:"2026-09-11T00:00:00Z"},"quick-money"));const recovered=await value.execute("money.record_entry",{amount:"13.00",quoted_at:"2026-09-11T01:00:00Z"},"quick-money");
  assert.equal(recovered.command_id,postCommand);assert.deepEqual(postedInputs,[{amount:"12.00",quoted_at:"2026-09-11T00:00:00Z"},{amount:"12.00",quoted_at:"2026-09-11T00:00:00Z"}]);
});

test("journal stores only a digest while temporary plaintext stays in expiring session storage",async()=>{
  const journal=new MemoryStorage(),drafts=new MemoryStorage();
  const fetcher=(async()=>{throw new TypeError("offline")}) as typeof fetch;
  const value=controller(fetcher,journal,drafts);await assert.rejects(value.execute("money.record_entry",{private_note:"secret-value"},"privacy"));
  const journalText=[...journal.values.values()].join(""),draftText=[...drafts.values.values()].join("");
  assert.doesNotMatch(journalText,/secret-value/);assert.match(journalText,/[0-9a-f]{64}/);assert.match(draftText,/secret-value/);assert.match(draftText,/expiresAt/);
});

test("migrates a legacy journal and recovers it without creating a replacement command",async()=>{
  const journal=new MemoryStorage(),drafts=new MemoryStorage();let gets=0,posts=0;
  journal.setItem("test:quick-money",JSON.stringify({version:1,capability:"money.record_entry",inputHash:'{"amount":"12.00"}',commandId:"cmd_web_legacy",state:"committed"}));
  const fetcher=(async(input:string|URL|Request,init?:RequestInit)=>{if(init?.method==="POST"){posts+=1;throw new Error("must not post");}gets+=1;assert.match(String(input),/cmd_web_legacy$/);return Response.json(result("cmd_web_legacy"));}) as typeof fetch;
  const value=controller(fetcher,journal,drafts),recovered=await value.execute("money.record_entry",{amount:"99.00"},"quick-money");
  assert.equal(recovered.command_id,"cmd_web_legacy");assert.equal(gets,1);assert.equal(posts,0);assert.equal(journal.values.size,0);
});

test("keeps the recovery journal when post-commit draft cleanup fails",async()=>{
  const journal=new MemoryStorage(),drafts=new MemoryStorage();drafts.removeItem=()=>{throw new Error("quota")};
  const fetcher=(async(_input:string|URL|Request,init?:RequestInit)=>{const body=JSON.parse(String(init?.body)) as {command_id:string};return Response.json(result(body.command_id));}) as typeof fetch;
  const committed=await controller(fetcher,journal,drafts).execute("money.record_entry",{amount:"12.00"},"quick-money");
  assert.match(committed.warnings.join("\n"),/服务端已保存/);assert.equal(journal.values.size,1);
});
