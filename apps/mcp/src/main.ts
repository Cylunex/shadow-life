import { createInterface } from "node:readline";
import { assertCompleteQueryTransport, buildCapabilityHttpRequest, capabilityRegistry, parseCapabilityResult, type CapabilityName } from "@shadow/contracts";

const api=(process.env.SHADOW_API_URL??"http://127.0.0.1:8787").replace(/\/$/u,"");
const token=process.env.SHADOW_ACCESS_TOKEN;
const reply=(id:unknown,result?:unknown,error?:unknown)=>process.stdout.write(`${JSON.stringify({jsonrpc:"2.0",id,...(error?{error}:{result})})}\n`);
assertCompleteQueryTransport();

async function visibleTools():Promise<unknown[]>{
  if(!token)throw new Error("SHADOW_ACCESS_TOKEN is required");
  const response=await fetch(`${api}/api/capabilities`,{headers:{authorization:`Bearer ${token}`}});
  if(!response.ok)throw new Error(`Capability discovery failed with HTTP ${response.status}`);
  const body=await response.json() as {capabilities:{name:string;description:string}[]};
  return Promise.all(body.capabilities.map(async item=>{
    const detail=await fetch(`${api}/api/capabilities/${encodeURIComponent(item.name)}`,{headers:{authorization:`Bearer ${token}`}});
    if(!detail.ok)throw new Error(`Capability schema failed with HTTP ${detail.status}`);
    const capability=await detail.json() as {input_schema:unknown},registered=capabilityRegistry[item.name as CapabilityName];
    return{name:item.name,description:item.description,inputSchema:registered?.idempotency==="required"?{type:"object",additionalProperties:false,required:["command_id","input"],properties:{command_id:{type:"string",description:"Stable idempotency key"},input:capability.input_schema}}:capability.input_schema};
  }));
}

async function call(name:string,args:unknown):Promise<unknown>{
  if(!token)throw new Error("SHADOW_ACCESS_TOKEN is required");
  if(!(name in capabilityRegistry))throw new Error("Unknown capability");
  const capabilityName=name as CapabilityName,request=buildCapabilityHttpRequest(api,capabilityName,args),headers={authorization:`Bearer ${token}`,"content-type":"application/json"};
  const response=await fetch(request.url,{method:request.method,headers,...(request.body?{body:request.body}:{})});
  const body=await response.json();if(!response.ok)throw new Error(JSON.stringify(body));return parseCapabilityResult(capabilityName,body);
}

const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
for await(const line of lines){
  if(!line.trim())continue;let message:Record<string,unknown>;try{message=JSON.parse(line) as Record<string,unknown>;}catch{continue;}
  try{
    if(message.method==="initialize")reply(message.id,{protocolVersion:"2025-06-18",capabilities:{tools:{listChanged:false}},serverInfo:{name:"shadow-life",version:"0.2.0"}});
    else if(message.method==="notifications/initialized")continue;
    else if(message.method==="tools/list")reply(message.id,{tools:await visibleTools()});
    else if(message.method==="tools/call"){const params=message.params as {name:string;arguments:unknown},result=await call(params.name,params.arguments);reply(message.id,{content:[{type:"text",text:JSON.stringify(result)}],structuredContent:result});}
    else reply(message.id,undefined,{code:-32601,message:"Method not found"});
  }catch(error){reply(message.id,undefined,{code:-32000,message:error instanceof Error?error.message:"MCP call failed"});}
}
