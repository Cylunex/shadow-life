import { agentContextInputSchema, agentContextResultSchema, profileAllows, type AgentContextInput, type AgentContextRecord, type AgentContextResult, type AgentScenarioName } from '@shadow/contracts';
import { invalidInput, notFound, permissionDenied } from './errors.js';
import type { RequestContext, UnitOfWork } from './ports.js';

type Kind = AgentContextRecord['ref']['kind'];
const effects: Record<Kind, string> = { meal: 'life.meal.read', purchase: 'life.meal.read', money_entry: 'money.entry.read', health_measurement: 'health.measurement.read', health_workout: 'health.measurement.read', trip: 'travel.trip.read', library_item: 'library.item.read' };
const tools: Record<Kind, 'life.get_record'|'health.get_record'|'travel.get_trip'|'library.get_item'> = { meal:'life.get_record', purchase:'life.get_record', money_entry:'life.get_record', health_measurement:'health.get_record', health_workout:'health.get_record', trip:'travel.get_trip', library_item:'library.get_item' };
export const contextScenarioKinds: Record<AgentScenarioName, readonly Kind[]> = { daily:['meal','purchase','health_measurement'], spending:['purchase','money_entry'], health:['health_measurement','health_workout'], travel:['trip'], library:['library_item'], planning:['meal','purchase','money_entry'] };
export interface AgentContextReadOptions { input: AgentContextInput; kinds: readonly Kind[]; preferenceScopes: readonly string[]; includeMoney: boolean; memoryRefs?: readonly {id:string;revision:number}[]; }
export interface AgentContextReadData { records: AgentContextRecord[]; memories: AgentContextResult['memories']; matchedRecords: number; matchedMemories: number; refsAvailable: boolean; asOf: string; }

export async function queryAgentContext(unitOfWork: UnitOfWork, context: RequestContext, input: unknown) {
  if (!context.effects.has('agent.run')) throw permissionDenied('agent.run');
  const parsed = agentContextInputSchema.safeParse(input);
  if (!parsed.success) throw invalidInput('Task context query is invalid', parsed.error.issues.map(issue => issue.path.join('.')));
  const request = parsed.data;
  const permitted = (Object.keys(effects) as Kind[]).filter(kind => context.effects.has(effects[kind]) && profileAllows(request.profile ?? 'authorized', tools[kind]));
  const kinds = permitted.filter(kind => !request.scenario || contextScenarioKinds[request.scenario].includes(kind));
  // Explicit hidden, stale and out-of-scope references have the same unavailable semantics.
  if (request.object_refs.some(ref => !kinds.includes(ref.kind))) throw notFound('Requested context reference is unavailable');
  const preferenceScopes = Object.entries(contextScenarioKinds).filter(([, scoped]) => scoped.some(kind => permitted.includes(kind))).map(([scope]) => scope);
  const data = await unitOfWork.read(store => store.agentContext(context.subjectId, { input: request, kinds, preferenceScopes, includeMoney: context.effects.has('money.entry.read') }));
  if (!data.refsAvailable) throw notFound('Requested context reference is unavailable');
  return boundAgentContext(data, request, kinds);
}

// Keep complete objects and all provenance/completeness metadata. Measure the final serialized JSON.
export function boundAgentContext(data: AgentContextReadData, input: AgentContextInput, kinds: readonly Kind[]): AgentContextResult {
  const result: AgentContextResult = {
    as_of:data.asOf, time_zone:input.time_zone, range:{from_on:input.from_on??null,to_on_exclusive:input.to_on_exclusive??null}, response_format:input.response_format,
    records:[], memories:[],
    coverage:{authorized_kinds:[...kinds],matched_records:data.matchedRecords,returned_records:0,matched_memories:data.matchedMemories,unknown:['Missing nutrition, sleep, payment and processing evidence remains unknown; purchase is not intake.'],complete:false},
    truncation:{truncated:false,reasons:[],omitted_records:0,omitted_memories:0,result_bytes:0,byte_budget:input.byte_budget},
    continuation:{capability:'agent.context',next_offset:null,instruction:'Use each record detail tool for full fields. Continue with the same filters and next_offset; each page rechecks current facts. For oversized records use concise format or a larger budget.'}
  };
  let consumed = 0;
  const reasons = new Set<AgentContextResult['truncation']['reasons'][number]>();
  const refresh = () => {
    result.coverage.returned_records=result.records.length;
    result.truncation.omitted_records=Math.max(0,data.matchedRecords-input.offset-result.records.length);
    result.truncation.omitted_memories=data.matchedMemories-result.memories.length;
    const next=input.offset+consumed;
    result.continuation.next_offset=next<data.matchedRecords&&next<=10000?next:null;
    if(next<data.matchedRecords&&next>10000)reasons.add('offset_limit');
    result.truncation.reasons=[...reasons];
    result.truncation.truncated=result.truncation.omitted_records>0||result.truncation.omitted_memories>0;
    result.coverage.complete=input.offset===0&&!result.truncation.truncated;
    // result_bytes includes its own decimal digits; converge before making a budget decision.
    let size=Buffer.byteLength(JSON.stringify(result),'utf8');
    while(size!==result.truncation.result_bytes){result.truncation.result_bytes=size;size=Buffer.byteLength(JSON.stringify(result),'utf8');}
    return size;
  };
  if(data.matchedRecords-input.offset>input.limit)reasons.add('limit');
  if(data.matchedMemories>20)reasons.add('memory_limit');
  if(data.memories.length<Math.min(20,data.matchedMemories))reasons.add('byte_budget');
  for (const record of data.records.slice(0,input.limit)) {
    result.records.push(record);consumed++;
    if(refresh()>input.byte_budget){
      result.records.pop();consumed--;reasons.add('byte_budget');
      if(!result.records.length){reasons.add('oversized_record');consumed++;}
      break;
    }
  }
  for(const memory of data.memories.slice(0,20)){
    result.memories.push(memory);
    if(refresh()>input.byte_budget){result.memories.pop();reasons.add('byte_budget');break;}
  }
  // Metadata can grow by a few bytes when adding truncation reasons.
  while(refresh()>input.byte_budget&&result.memories.length)result.memories.pop();
  while(refresh()>input.byte_budget&&result.records.length){result.records.pop();consumed=Math.max(0,consumed-1);reasons.add('byte_budget');}
  if(!result.records.length&&data.records.length&&consumed===0){consumed=1;reasons.add('oversized_record');}
  if(refresh()>input.byte_budget)throw invalidInput('Budget is too small for context metadata',['byte_budget']);
  return agentContextResultSchema.parse(result);
}

/** Replay query evidence only while its entire permission and revision scope remains valid. */
export async function revalidateAgentContext(unitOfWork:UnitOfWork, context:RequestContext, value:unknown):Promise<boolean>{
  const parsed=agentContextResultSchema.safeParse(value);
  if(!parsed.success||!context.effects.has('agent.run'))return false;
  const result=parsed.data;
  if(result.coverage.authorized_kinds.some(kind=>!context.effects.has(effects[kind])))return false;
  const refs=[...result.records.map(record=>record.ref),...result.memories.flatMap(memory=>memory.evidence_refs)];
  // Stored results can have more references than one public request. This internal validity read
  // does not expose their summaries; its shared predicate is evaluated once in one SQL snapshot.
  const input=agentContextInputSchema.parse({scenario:'daily'});
  const data=await unitOfWork.read(store=>store.agentContext(context.subjectId,{input:{...input,object_refs:refs},kinds:result.coverage.authorized_kinds,preferenceScopes:[],includeMoney:context.effects.has('money.entry.read'),memoryRefs:result.memories.map(memory=>({id:memory.id,revision:memory.revision}))}));
  return data.refsAvailable;
}
