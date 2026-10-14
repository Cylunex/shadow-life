import { foundationEffects, foundationKinds, foundationQueries, foundationRefSchema, workspaceResultSchema, type FoundationQueryName, type FoundationRef } from '@shadow/contracts';
import { invalidInput, notFound, permissionDenied, retryableNotApplied } from './errors.js';
import type { RequestContext, TransactionStore, UnitOfWork } from './ports.js';

export { foundationEffects, foundationKinds } from "@shadow/contracts";
export function foundationReadKinds(context: RequestContext, scenario?: string): FoundationRef['kind'][] {
  return (scenario ? [...foundationKinds[scenario]!, 'agent_intention', 'agent_task', 'agent_learning', 'agent_subscription'] as FoundationRef['kind'][] : Object.keys(foundationEffects) as FoundationRef['kind'][]).filter(kind => context.effects.has(foundationEffects[kind]));
}
export function foundationWriteEffects(input: unknown): string[] {
  const value = input as {object_refs?: FoundationRef[]; project_ref?: FoundationRef};
  return [...new Set(['agent.run', ...(value.object_refs ?? []).map(ref => foundationEffects[ref.kind]), ...(value.project_ref ? [foundationEffects[value.project_ref.kind]] : [])])];
}
export interface FoundationOptions { kinds: FoundationRef['kind'][]; scenario?: string; effects: string[]; }
export interface FoundationStore {
  now(): Promise<string>;
  read(name: FoundationQueryName, subjectId: string, input: any, options: FoundationOptions): Promise<any>;
  nodes(subjectId: string, kinds: FoundationRef['kind'][], input: {object_refs?: FoundationRef[]; query?: string; from_on?: string; to_on_exclusive?: string; limit: number; offset?: number}, options: FoundationOptions): Promise<any>;
}
function assertStore(store: TransactionStore): FoundationStore {
  if (!store.foundation) throw retryableNotApplied('Personal Agent data storage is unavailable.');
  return store.foundation;
}
export async function queryFoundation(unitOfWork: UnitOfWork, context: RequestContext, name: FoundationQueryName, untrusted: unknown) {
  if (!context.effects.has('agent.run')) throw permissionDenied('agent.run');
  const input = foundationQueries[name].input.parse(untrusted) as any;
  const kinds = foundationReadKinds(context, input.scenario);
  const options: FoundationOptions = {kinds, effects: [...context.effects], ...(input.scenario ? {scenario: input.scenario} : {})};
  for (const ref of input.object_refs ?? []) if (!kinds.includes(foundationRefSchema.parse(ref).kind)) throw notFound('Requested object is unavailable');
  if (!unitOfWork.snapshot) throw retryableNotApplied('Consistent personal context reads are unavailable.');
  return unitOfWork.snapshot(async store => {
    const foundation = assertStore(store);
    if (name !== 'agent.workspace') return foundationQueries[name].result.parse(boundFoundationResult(await foundation.read(name, context.subjectId, input, options),input));
    const asOf = await foundation.now();
    const intentions = await foundation.read('agent.intentions', context.subjectId, {on: input.from_on, until: input.to_on_exclusive, limit: input.limit, offset: input.offset, include_inactive: false}, options);
    const sections: any[] = [], unknown: string[] = [];
    const add = (kind: string, semantic: string, data: unknown, truncated = false) => {const snapshotData=data&&typeof data==='object'&&!Array.isArray(data)&&'as_of' in data?{...data,as_of:asOf}:data;sections.push({kind, semantic, as_of:asOf,data:snapshotData,truncated});};
    const legacy=await store.agentMemories(context.subjectId,undefined,50);
    const applicable=legacy.items.filter((memory:any)=>memory.category==='explicit_preference'&&!intentions.items.some((item:any)=>item.key===memory.memory_key)&&(memory.evidence_refs??[]).every((ref:FoundationRef)=>kinds.includes(ref.kind))&&(!input.scenario||memory.memory_key===input.scenario||memory.memory_key.startsWith(`${input.scenario}.`)||!Object.keys(foundationKinds).some(scope=>memory.memory_key===scope||memory.memory_key.startsWith(`${scope}.`))));
    if(applicable.length)add('legacy_preferences','derived',applicable,legacy.items.length>=50);
    const historicalKinds=['meal','purchase','money_entry','health_measurement','health_workout','health_observation','health_sleep','health_activity','health_habit','library_item'];
    const facts = kinds.filter(kind => historicalKinds.includes(kind));
    if (facts.length) {
      const value = await foundation.nodes(context.subjectId, facts, input, options);
      add('records', 'fact', value.nodes, value.truncated);
    }
    const plans = kinds.filter(kind => !historicalKinds.includes(kind)&&kind!=='source'&&!kind.startsWith('agent_'));
    if (plans.length) {
      const value = await foundation.nodes(context.subjectId, plans, input, options);
      add('plans_and_resources', 'plan', value.nodes, value.truncated);
    }
    if (kinds.includes('meal_plan')) {
      const meal = await store.mealPlanning(context.subjectId, input.limit) as any;
      // These are current plans and stock. Their own dates remain in the result.
      add('meal_planning', 'plan', meal, meal.stock_truncated || meal.meal_plans.length >= input.limit);
    }
    if (context.effects.has('health.measurement.read') && (!input.scenario || ['daily', 'health', 'planning'].includes(input.scenario))) {
      add('health_sources', 'source', await store.healthSources(context.subjectId));
      unknown.push('A missing device fact may be awaiting sync. Source permission/cursor state is not proof of a zero measurement.');
    }
    add('tasks', 'task', await foundation.read('agent.tasks', context.subjectId, {...input, include_terminal: false}, options));
    add('learning', 'derived', await foundation.read('agent.learning', context.subjectId, {...input, on: input.from_on}, options));
    unknown.push('Planned meals, purchases, payments and actual intake are independent. Unrecorded facts and unspecified stock conversions remain unknown.');
    const result = {from_on: input.from_on, to_on_exclusive: input.to_on_exclusive, time_zone: input.time_zone, as_of: asOf,
      intentions: intentions.items, sections, coverage: {authorized_sections: sections.map(section => section.kind), unknown, complete: !intentions.has_more && intentions.total_is_exact && !sections.some(section => section.truncated || section.data?.next_offset != null || section.data?.total_is_exact===false || section.data?.has_more)},
      truncation: {truncated: false, result_bytes: 0, byte_budget: input.byte_budget}};
    const size = () => {let bytes = Buffer.byteLength(JSON.stringify(result), 'utf8'); while (bytes !== result.truncation.result_bytes) {result.truncation.result_bytes = bytes; bytes = Buffer.byteLength(JSON.stringify(result), 'utf8');} return bytes;};
    while (size() > input.byte_budget && (result.sections.length || result.intentions.length)) {
      if (result.sections.length) result.sections.pop(); else result.intentions.pop();
      result.truncation.truncated = true; result.coverage.complete = false;
    }
    if (result.truncation.truncated) result.coverage.unknown.push('Byte budget omitted sections. Use the corresponding dedicated query with its offset or a smaller date range.');
    while (size() > input.byte_budget && result.sections.length) result.sections.pop();
    if (size() > input.byte_budget) throw invalidInput('Workspace metadata exceeds byte budget', ['byte_budget']);
    return workspaceResultSchema.parse(result);
  });
}

export function operationEvidenceVisible(capability:string,effects:readonly string[]):boolean {
  if(capability.startsWith('agent.')||capability.startsWith('notifications.'))return false;
  const effect=capability.startsWith('money.')?'money.entry.read':capability.startsWith('health.')?'health.measurement.read':capability.startsWith('travel.')?'travel.trip.read':capability.startsWith('library.')?'library.item.read':capability.includes('owned_item')?'life.item.read':capability.includes('project')||capability.includes('action_item')?'life.project.read':'life.meal.read';
  return effects.includes(effect);
}

export function boundFoundationResult(value:any,input:any){
  const result={...value,truncation:{truncated:false,result_bytes:0,byte_budget:input.byte_budget??64000}};
  const size=()=>{let bytes=Buffer.byteLength(JSON.stringify(result),'utf8');while(bytes!==result.truncation.result_bytes){result.truncation.result_bytes=bytes;bytes=Buffer.byteLength(JSON.stringify(result),'utf8')}return bytes};
  const list=Array.isArray(result.items)?'items':Array.isArray(result.nodes)?'nodes':undefined;
  while(size()>result.truncation.byte_budget&&list&&result[list].length){result[list].pop();result.truncation.truncated=true;
    if(!result[list].length)throw invalidInput('A single item exceeds the byte budget; increase byte_budget or narrow the query',['byte_budget']);
    if(list==='nodes'){const keys=new Set(result.nodes.map((node:any)=>`${node.ref.kind}:${node.ref.id}`));result.edges=result.edges.filter((edge:any)=>keys.has(`${edge.from.kind}:${edge.from.id}`)&&keys.has(`${edge.to.kind}:${edge.to.id}`));result.truncated=true;}
    if('next_offset' in result){result.has_more=true;const next=(input.offset??0)+result.items.length;result.next_offset=next<=10000?next:null;}
    if('cursor' in result){result.cursor=result.items.at(-1)?.sequence??input.after??result.acknowledged_cursor;result.has_more=true;}
  }
  if(size()>result.truncation.byte_budget)throw invalidInput('Result metadata exceeds the byte budget',['byte_budget']);
  return result;
}
