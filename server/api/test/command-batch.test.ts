import assert from "node:assert/strict";
import test from "node:test";
import { KernelError } from "@shadow/kernel";
import { createApp } from "../src/app.js";

const command=(id:string)=>({protocol:"shadow.command",capability:"health.ingest_raw",command_id:id,input:{}});

test("command batch returns an independent receipt or deterministic error for every command",async()=>{
  const seen:string[]=[];
  const dependencies={
    unitOfWork:{ensurePrincipal:async()=>undefined,pool:{query:async()=>({rows:[]})}},
    executor:{
      execute:async(_context:unknown,value:{command_id:string;capability:string})=>{
        seen.push(value.command_id);
        if(value.command_id==="cmd_batch_conflict")throw new KernelError(409,{protocol:"shadow.error",code:"conflict",message:"stale source version"});
        return{protocol:"shadow.execution-result",capability:value.capability,command_id:value.command_id,execution_id:`execution_${value.command_id}`,status:"committed",result_kind:"record",resources:[{type:"health_raw",id:"raw_test",revision:1}],actual_values:{records:1},warnings:[],replayed:false};
      },
      getOperation:async()=>({})
    },queries:{},developmentAuth:true
  } as unknown as Parameters<typeof createApp>[0];
  const response=await createApp(dependencies).request("/api/commands/batch",{method:"POST",headers:{authorization:"Bearer dev:subject_test","content-type":"application/json"},body:JSON.stringify({commands:[command("cmd_batch_ok"),command("cmd_batch_conflict")]})});
  assert.equal(response.status,200);
  const body=await response.json() as {protocol:string;items:Array<{command_id:string;http_status:number;result?:{status:string};error?:{code:string}}>};
  assert.equal(body.protocol,"shadow.command-batch-result");
  assert.deepEqual(seen,["cmd_batch_ok","cmd_batch_conflict"]);
  assert.deepEqual(body.items.map(item=>[item.command_id,item.http_status,item.result?.status??item.error?.code]),[["cmd_batch_ok",201,"committed"],["cmd_batch_conflict",409,"conflict"]]);
});

test("command batch rejects duplicate identities before execution",async()=>{
  let calls=0;
  const dependencies={unitOfWork:{ensurePrincipal:async()=>undefined,pool:{query:async()=>({rows:[]})}},executor:{execute:async()=>{calls++;return{}},getOperation:async()=>({})},queries:{},developmentAuth:true} as unknown as Parameters<typeof createApp>[0];
  const response=await createApp(dependencies).request("/api/commands/batch",{method:"POST",headers:{authorization:"Bearer dev:subject_test","content-type":"application/json"},body:JSON.stringify({commands:[command("cmd_batch_same"),command("cmd_batch_same")]})});
  assert.equal(response.status,422);assert.equal(calls,0);
});
