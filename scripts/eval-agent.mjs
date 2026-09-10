const scenario=process.argv[2];
const scenarios=new Set(["record-daily-life","context-pack","notification-redaction"]);
if(!scenario||!scenarios.has(scenario)){console.error(`Available evaluations: ${[...scenarios].join(", ")}`);process.exit(64);}
const api=(process.env.SHADOW_EVAL_API_URL??"").replace(/\/$/u,""),token=process.env.SHADOW_EVAL_ACCESS_TOKEN;
if(!api||!token){console.error("A verified evaluation target requires SHADOW_EVAL_API_URL and SHADOW_EVAL_ACCESS_TOKEN; no result was claimed.");process.exit(78);}
const headers={authorization:`Bearer ${token}`,"content-type":"application/json"};
async function request(path,options={}){const response=await fetch(`${api}${path}`,{...options,headers:{...headers,...options.headers}}),text=await response.text();let value;try{value=JSON.parse(text);}catch{value=text;}if(!response.ok)throw new Error(`${path} returned HTTP ${response.status}: ${text}`);return value;}
function assert(value,message){if(!value)throw new Error(message);}

if(scenario==="notification-redaction"){
  const view=await request("/api/notifications?limit=100");assert(Array.isArray(view.items),"notification response has no items");
  const forbidden=/(?:¥|￥|\b[A-Z]{2}\d{4,}\b|\b\d{6,}\b|confirmation|seat|金额|票号|座位|读数)/iu;
  for(const item of view.items){assert(typeof item.title==="string"&&typeof item.body==="string","notification copy is missing");assert(!forbidden.test(`${item.title} ${item.body}`),`notification ${item.id} exposes a forbidden detail`);assert(["disabled","quiet","snoozed","scheduled","ready"].includes(item.delivery_state),`notification ${item.id} has no delivery state`);}
  console.log(JSON.stringify({scenario,status:"passed",notifications:view.items.length,as_of:view.as_of}));process.exit(0);
}

const capabilities=await request("/api/capabilities"),names=new Set(capabilities.capabilities.map(item=>item.name));assert(names.has("agent.create_context_pack"),"context-pack capability is not visible");
const thread=await request("/api/threads",{method:"POST",body:JSON.stringify({title:`Eval ${scenario}`})}),prompt=process.env.SHADOW_EVAL_PROMPT??(scenario==="context-pack"?"仅根据附加对象说明可核验事实，并指出仍需查询的内容。":"记录今天午餐；如果缺少必要事实，只询问缺少字段。"),contextPackId=scenario==="context-pack"?process.env.SHADOW_EVAL_CONTEXT_PACK_ID:undefined;
if(scenario==="context-pack"){assert(contextPackId,"context-pack evaluation requires SHADOW_EVAL_CONTEXT_PACK_ID");const pack=await request(`/api/agent/context-packs/${encodeURIComponent(contextPackId)}`);assert(pack.id===contextPackId&&Array.isArray(pack.object_refs),"context pack is unavailable or malformed");}
const response=await fetch(`${api}/api/threads/${encodeURIComponent(thread.id)}/runs`,{method:"POST",headers:{...headers,accept:"text/event-stream"},body:JSON.stringify({text:prompt,...(contextPackId?{context_pack_id:contextPackId}:{})})});assert(response.ok&&response.body,`agent run returned HTTP ${response.status}`);
const stream=await response.text(),states=[...stream.matchAll(/"type":"run\.state","state":"([^"]+)"/gu)].map(match=>match[1]),commits=[...stream.matchAll(/"type":"operation\.committed"/gu)].length;assert(states.some(state=>state==="completed"||state==="awaiting_input"),"run had no valid terminal state");assert(!/"authority":"runtime"/u.test(stream),"runtime forged operation authority");
console.log(JSON.stringify({scenario,status:"passed",thread_id:thread.id,terminal_state:states.at(-1),committed_operations:commits}));
