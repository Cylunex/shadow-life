import { sql } from 'drizzle-orm';
import { capabilityRegistry, foundationWriteSchemas, type FoundationQueryName, type FoundationRef } from '@shadow/contracts';
import { conflict, notFound, foundationEffects, foundationKinds, operationEvidenceVisible, type FoundationStore, type RequestContext } from '@shadow/kernel';

type Database = {execute: (statement: any) => Promise<any>};
type Options = import('@shadow/kernel').FoundationOptions;
type Node = {ref: FoundationRef; title: string; semantic: string; data: Record<string, any>; detail: {capability: string; input: Record<string, any>}};
const timestamp = (value: string) => sql.raw(`to_char(${value} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`);
const json = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;
const array = (values: readonly string[]) => sql`array[${sql.join(values.map(value => sql`${value}`), sql`, `)}]::text[]`;
const legacyKinds = ['meal','purchase','money_entry','health_measurement','health_workout','trip','library_item'] as const;
const extraTables: Record<string, {table: string; title: string; columns: string; semantic: string; detail: string; active: string}> = {
  activity_capture:{table:'activity_captures',title:'title',columns:'kind,started_at,ended_at,time_zone,app_package,text',semantic:'source',detail:'life.activity_source',active:'deleted_at is null'},
  life_project: {table:'life_projects', title:'title', columns:'title,goal,starts_on,ends_on,state', semantic:'plan', detail:'life.projects', active:"state<>'cancelled'"},
  action_item: {table:'action_items', title:'title', columns:'title,project_id,due_on,state,scheduled_at,scheduled_time_zone', semantic:'plan', detail:'life.projects', active:"state<>'cancelled'"},
  meal_plan: {table:'meal_plans', title:'title', columns:'title,starts_on,ends_on,time_zone,state', semantic:'plan', detail:'life.meal_planning', active:"state<>'cancelled'"},
  food_stock_lot: {table:'food_stock_lots', title:'name', columns:'name,quantity::text,unit,expires_on,note', semantic:'fact', detail:'life.meal_planning', active:'true'},
  owned_item: {table:'owned_items', title:'name', columns:'name,ownership_state,location,location_path,started_on,warranty_ends_on,return_by', semantic:'fact', detail:'life.owned_items', active:"ownership_state='owned'"},
  health_source:{table:'health_source_instances',title:'source_type',columns:'source_type,instance_key,permission_state,sync_epoch',semantic:'source',detail:'health.sources',active:'true'},
  health_observation:{table:'health_observations',title:'metric_key',columns:'metric_key,value::text,unit,occurred_on,occurred_at,raw_id,raw_version,original_field',semantic:'fact',detail:'health.get_record',active:'effective'},
  health_sleep:{table:'health_sleep_sessions',title:'id',columns:'wake_date,total_minutes,deep_minutes,light_minutes,rem_minutes,raw_id,raw_version,started_at,ended_at',semantic:'fact',detail:'health.get_record',active:'effective'},
  health_activity:{table:'health_daily_activity',title:'id',columns:'occurred_on,steps,active_minutes,raw_id,raw_version',semantic:'fact',detail:'health.get_record',active:'effective'},
  health_habit:{table:'health_habit_logs',title:'habit_key',columns:'occurred_on,habit_key,done_count,explicit_denial,raw_id,raw_version',semantic:'fact',detail:'health.get_record',active:'effective'},
  food: {table:'food_references',title:'name',columns:'name,serving_amount::text,serving_unit,nutrients,provenance',semantic:'plan',detail:'life.food_catalog',active:"state='active'"},
  place: {table:'places',title:'name',columns:'name,address,latitude::text,longitude::text,tags',semantic:'plan',detail:'travel.workspace',active:'true'},
  recipe: {table:'recipes', title:'title', columns:'title,state,servings::text,instructions,source_url', semantic:'plan', detail:'life.food_catalog', active:"state='active'"},
  reservation: {table:'reservations', title:'title', columns:'title,trip_id,reservation_type,starts_at,ends_at,state,origin,destination,service_number', semantic:'plan', detail:'travel.get_trip', active:'voided_at is null'},
  source: {table:'sources', title:'kind', columns:'kind,external_id,captured_on,captured_at,time_zone,original_text,asset_version_id', semantic:'source', detail:'agent.objects', active:'true'}
};
// All identifiers and projections come from this closed registry, never user input.
function extraProjection(kind: string, definition: typeof extraTables[string], subject: string) {
  const fields = definition.columns.split(',').map(field => {
    const name = field.split('::')[0]!;
    return sql`${name}::text,${field==='original_text'?sql`left(n.original_text,16000)`:sql.raw(`n.${field}`)}`;
  });
  return sql`select ${kind} kind,n.id,${kind==='health_source'?sql`n.agent_revision`:sql`n.revision`} revision,${kind==='health_sleep'?sql`'睡眠'`:kind==='health_activity'?sql`'日常活动'`:sql`n.${sql.identifier(definition.title)}`} title,
    ${definition.semantic} semantic,jsonb_build_object(${sql.join(fields,sql`,`)}${kind==='source'?sql`, 'original_text_truncated',length(n.original_text)>16000`:sql``}${kind==='recipe'?sql`, 'ingredients',coalesce((select jsonb_agg(item.snapshot order by item.position) from recipe_items item where item.recipe_id=n.id),'[]'::jsonb)`:sql``}) data
    from ${sql.identifier(definition.table)} n where n.subject_id=${subject} and ${sql.raw(definition.active==='true'?'true':'n.'+definition.active)}`;
}
export function createFoundationStore(database: Database): FoundationStore {
  const now = async () => String((await database.execute(sql`select ${timestamp('transaction_timestamp()')} as_of`)).rows[0].as_of);
  function nodeParts(subject:string,kinds:readonly string[],refs:FoundationRef[]=[],currentOnly=true,readableKinds:readonly string[]=kinds) {
    const parts: any[] = [];
    const add = (kind: string, statement: any) => {if (kinds.includes(kind)) parts.push(statement);};
    add('meal',sql`select 'meal' kind,m.id,m.revision,coalesce(m.note,m.meal_type) title,'fact' semantic,jsonb_build_object('occurred_on',m.occurred_on,'occurred_at',m.occurred_at,'time_zone',m.time_zone,'meal_type',m.meal_type,'note',m.note) data from meals m where m.subject_id=${subject} and m.state='active'`);
    add('purchase',sql`select 'purchase' kind,p.id,p.revision,coalesce(p.note,p.merchant,'购买') title,'fact' semantic,jsonb_build_object('record_id',p.record_id,'merchant',p.merchant,'note',p.note,'occurred_on',r.occurred_on,'occurred_at',r.occurred_at,'time_zone',r.time_zone) data from purchases p join consumption_records r on r.id=p.record_id where p.subject_id=${subject} and r.state='confirmed'`);
    add('money_entry',sql`select 'money_entry' kind,e.id,e.revision,coalesce(e.counterparty,e.note,e.entry_type) title,'fact' semantic,jsonb_build_object('record_id',e.record_id,'occurred_on',e.occurred_on,'occurred_at',e.occurred_at,'time_zone',e.time_zone,'amount',e.amount::text,'currency',e.currency,'entry_type',e.entry_type) data from money_entries e join consumption_records r on r.id=e.record_id where e.subject_id=${subject} and r.state='confirmed'`);
    add('health_measurement',sql`select 'health_measurement' kind,h.id,h.revision,coalesce(h.label,h.metric) title,'fact' semantic,jsonb_build_object('occurred_on',h.occurred_on,'occurred_at',h.occurred_at,'time_zone',h.time_zone,'value',h.value::text,'unit',h.unit,'metric',h.metric) data from health_measurements h where h.subject_id=${subject} and h.effective`);
    add('health_workout',sql`select 'health_workout' kind,h.id,h.revision,h.session_type title,'fact' semantic,jsonb_build_object('occurred_on',h.occurred_on,'duration_minutes',h.duration_minutes) data from health_workout_sessions h where h.subject_id=${subject} and h.effective`);
    add('trip',sql`select 'trip' kind,t.id,t.revision,t.title,'plan' semantic,jsonb_build_object('starts_on',t.starts_on,'ends_on',t.ends_on,'time_zone',t.time_zone) data from trips t where t.subject_id=${subject} or exists(select 1 from trip_members m where m.trip_id=t.id and m.subject_id=${subject})`);
    add('library_item',sql`select 'library_item' kind,i.id,r.revision,i.title,'fact' semantic,jsonb_build_object('text',left(r.text,2000),'document_date',r.document_date,'tags',r.tags) data from library_items i join library_revisions r on r.item_id=i.id ${currentOnly && !refs.length ? sql`and r.revision=i.current_revision` : sql``} where i.subject_id=${subject} and i.state='active'`);
    for (const [kind, definition] of Object.entries(extraTables)) if (kinds.includes(kind)) parts.push(kind==='source'?sql`select * from (${extraProjection(kind,definition,subject)}) source_node where ${readableKinds.includes('library_item')?sql`exists(select 1 from library_items i where i.subject_id=${subject} and i.state='active' and i.source_id=source_node.id)`:sql`false`} or ${readableKinds.includes('meal')?sql`exists(select 1 from meal_source_links l join meals m on m.id=l.meal_id where m.subject_id=${subject} and m.state='active' and l.source_id=source_node.id)`:sql`false`} or ${readableKinds.includes('purchase')?sql`exists(select 1 from purchase_source_links l join purchases p on p.id=l.purchase_id join consumption_records r on r.id=p.record_id where p.subject_id=${subject} and r.state='confirmed' and l.source_id=source_node.id)`:sql`false`} or ${readableKinds.includes('reservation')?sql`exists(select 1 from reservations r where r.subject_id=${subject} and r.voided_at is null and r.source_id=source_node.id)`:sql`false`}`:extraProjection(kind, definition, subject));
    for (const [kind,table] of Object.entries({agent_intention:'agent_intentions',agent_task:'agent_tasks',agent_learning:'agent_learning',agent_subscription:'agent_subscriptions'})) if(kinds.includes(kind)) parts.push(sql`select ${kind} kind,id,revision,coalesce(data->>'statement',data->>'title',business_key) title,'plan' semantic,data from ${sql.identifier(table)} where subject_id=${subject}`);
    return parts;
  }
  async function nodeRows(subject:string,kinds:readonly string[],refs:FoundationRef[]=[],currentOnly=true,scenario?:string,filter:any={},readableKinds:readonly string[]=kinds):Promise<Node[] & {total?:number}> {
    const parts=nodeParts(subject,kinds,refs,currentOnly,readableKinds);
    if (!parts.length) return [];
    const selection = refs.length ? sql`exists(select 1 from jsonb_to_recordset(${json(refs)}) ref(kind text,id text,revision integer) where ref.kind=n.kind and ref.id=n.id ${currentOnly ? sql`and ref.revision=n.revision` : sql`and (n.kind<>'library_item' or ref.revision=n.revision)`})` : sql`true`;
    const aliases=filter.query?(await database.execute(sql`select target_value from personal_aliases where subject_id=${subject} and lower(alias)=lower(${filter.query}) limit 30`)).rows.map((row:any)=>String(row.target_value)):[];
    const businessDay=sql`coalesce(case when n.data->>'occurred_at' is not null then to_char((n.data->>'occurred_at')::timestamptz at time zone ${filter.time_zone??'Asia/Shanghai'},'YYYY-MM-DD') else n.data->>'occurred_on' end,n.data->>'due_on',n.data->>'document_date',n.data->>'wake_date')`;
    const rows = (await database.execute(sql`select *,count(*) over()::int matched_total from (${sql.join(parts,sql` union all `)}) n where ${selection}
      and (${filter.query??null}::text is null or position(lower(${filter.query??''}) in lower(coalesce(n.title,'')||' '||n.data::text))>0 or n.id=any(${array(aliases)}) or n.title=any(${array(aliases)}) or (n.kind='library_item' and exists(select 1 from library_revisions text_revision where text_revision.item_id=n.id and text_revision.revision=n.revision and position(lower(${filter.query??''}) in lower(coalesce(text_revision.text,'')))>0)))
      and (${filter.from_on??null}::text is null or ${businessDay} is null or ${businessDay}>=${filter.from_on??''} and ${businessDay}<${filter.to_on_exclusive??''})
      and (${filter.from_on??null}::text is null or n.data->>'starts_on' is null or n.data->>'starts_on'<${filter.to_on_exclusive??''} and (n.data->>'ends_on' is null or n.data->>'ends_on'>=${filter.from_on??''}))
      and (${filter.ids?sql`n.id=any(${array(filter.ids)})`:sql`true`})
      order by kind,id,revision desc limit ${filter.limit??1000} offset ${filter.offset??0}`)).rows;
    const projected:Node[] = rows.map((row: any) => {
      const definition = extraTables[row.kind], capability = definition?.detail ?? (row.kind==='library_item'?'library.get_item':row.kind==='trip'?'travel.get_trip':row.kind.startsWith('health_')?'health.get_record':'life.get_record');
      const detailId = row.kind==='action_item'?row.data.project_id:row.kind==='reservation'?row.data.trip_id:row.data.record_id??row.id;
      const input = capability==='agent.objects'?{object_refs:[{kind:row.kind,id:row.id,revision:row.revision}],depth:0}:capability==='life.meal_planning'?{limit:100}:capability==='life.food_catalog'?{query:row.title,limit:100}:capability==='travel.workspace'||capability==='health.sources'?{}:{id:detailId};
      return {ref:{kind:row.kind,id:row.id,revision:row.revision},title:row.title,semantic:row.semantic,data:row.data,detail:{capability,input}};
    });
    const safe:Node[]=[];
    for(const node of projected){if(node.ref.kind.startsWith('agent_')){const checked=await evidence(subject,node.data,{kinds:[...readableKinds] as FoundationRef['kind'][],effects:readableKinds.map(kind=>foundationEffects[kind as FoundationRef['kind']])});if(!checked.visible || (node.ref.kind==='agent_learning'&&!checked.current) || (scenario&&node.data.scope!=='global'&&node.data.scope!==scenario))continue;node.detail={capability:node.ref.kind==='agent_task'?'agent.tasks':node.ref.kind==='agent_intention'?'agent.intentions':node.ref.kind==='agent_learning'?'agent.learning':'agent.export',input:node.ref.kind==='agent_task'?{id:node.ref.id}:{on:new Date().toISOString().slice(0,10)}};}safe.push(node);}
    return Object.assign(safe,{total:rows[0]?.matched_total??0});
  }
  async function evidence(subject: string, data: any, options: Options) {
    const refs: FoundationRef[] = [...(data.object_refs??[]),...(data.project_ref?[data.project_ref]:[])];
    if (refs.some(ref=>!options.kinds.includes(ref.kind))) return {visible:false,current:false};
    const current = refs.length ? await nodeRows(subject, options.kinds, refs, true, options.scenario) : [];
    const visible = refs.length ? await nodeRows(subject, options.kinds, refs, false, options.scenario) : [];
    const has = (nodes: Node[], ref: FoundationRef) => nodes.some(node=>node.ref.kind===ref.kind&&node.ref.id===ref.id&&(ref.kind==='library_item'?node.ref.revision===ref.revision:true));
    const receiptIds: string[] = data.operation_ids??[];
    const receipts = receiptIds.length ? (await database.execute(sql`select execution_id,capability,result from operations where subject_id=${subject} and execution_id=any(${array(receiptIds)})`)).rows : [];
    if (receipts.length !== receiptIds.length) return {visible:false,current:false};
    // Receipts may themselves reference another protected domain; inspect their resource types.
    const resourceKind: Record<string,string> = {health_workout_session:'health_workout',food_stock_lot:'food_stock_lot'};
    if(receipts.some((receipt:any)=>!operationEvidenceVisible(receipt.capability,options.effects)))return {visible:false,current:false};
    for (const receipt of receipts) for (const resource of receipt.result.resources) {
      const kind=resourceKind[resource.type]??resource.type;
      if ([...legacyKinds,...Object.keys(extraTables)].includes(kind) && !options.kinds.includes(kind as any)) return {visible:false,current:false};
    }
    return {visible:refs.every(ref=>has(visible,ref)),current:refs.every(ref=>current.some(node=>node.ref.kind===ref.kind&&node.ref.id===ref.id&&node.ref.revision===ref.revision))};
  }
  function visibleEvidence(subject:string,data:any,options:Options,current=false){
    const parts=nodeParts(subject,options.kinds.filter(kind=>!kind.startsWith('agent_')),[],false);
    const objects=sql`coalesce(${data}->'object_refs','[]'::jsonb)||case when ${data}->'project_ref' is not null then jsonb_build_array(${data}->'project_ref') else '[]'::jsonb end`;
    const objectCheck=parts.length?sql`not exists(select 1 from jsonb_to_recordset(${objects}) r(kind text,id text,revision integer) where not exists(select 1 from (${sql.join(parts,sql` union all `)}) n where n.kind=r.kind and n.id=r.id and ${current?sql`n.revision=r.revision`:sql`(n.kind<>'library_item' or n.revision=r.revision)`}))`:sql`jsonb_array_length(${objects})=0`;
    const allowed=Object.keys(capabilityRegistry).filter(capability=>operationEvidenceVisible(capability,options.effects));
    const resourceKinds=options.kinds.flatMap(kind=>kind==='health_workout'?['health_workout','health_workout_session']:[kind]);
    return sql`${objectCheck} and not exists(select 1 from jsonb_array_elements_text(coalesce(${data}->'operation_ids','[]'::jsonb)) execution(id) where not exists(select 1 from operations op where op.subject_id=${subject} and op.execution_id=execution.id and op.capability=any(${array(allowed)}) and not exists(select 1 from jsonb_array_elements(op.result->'resources') resource where resource->>'type'=any(${array([...legacyKinds,...Object.keys(extraTables),'health_workout_session'])}) and not(resource->>'type'=any(${array(resourceKinds)})))))`;
  }
  async function list(subject:string,table:string,input:any,options:Options){
    const data=sql`data`,visible=visibleEvidence(subject,data,options),current=visibleEvidence(subject,data,options,true);
    const predicate=sql`subject_id=${subject} and ${visible} ${options.scenario?sql`and scope in ('global',${options.scenario})`:sql``}
      and (${input.id??null}::text is null or id=${input.id??''})
      and (${table!=='agent_tasks'||input.include_terminal?sql`true`:sql`data->>'state' not in ('completed','cancelled')`})
      and (${table==='agent_tasks'||input.include_inactive?sql`true`:sql`data->>'state'='active' and (${input.on??null}::text is null or (data->>'valid_from' is null or data->>'valid_from'<${input.until??(input.on?addDay(input.on):'')}) and (data->>'valid_to_exclusive' is null or data->>'valid_to_exclusive'>${input.on??''}))`})
      and (${input.query??null}::text is null or position(lower(${input.query??''}) in lower(data::text||' '||business_key))>0)
      and (${input.environment??null}::text is null or data->>'environment'=${input.environment??''})
      and (${input.workflow_revision??null}::text is null or data->>'workflow_revision'=${input.workflow_revision??''})
      and (${table==='agent_learning'?current:sql`true`})`;
    const lease=table==='agent_tasks'?sql`case when lease_token is not null then jsonb_build_object('client_id',lease_client_id,'expires_at',${timestamp('lease_expires_at')},'active',lease_expires_at>clock_timestamp(),'token',case when lease_client_id=${options.clientId??''} then lease_token else null end) else null end`:sql`null::jsonb`;
    const query=await database.execute(sql`with selected as (select id,data,revision,${lease} lease,${timestamp('updated_at')} updated_at,${current} evidence_current from ${sql.identifier(table)} where ${predicate}),page as(select * from selected order by updated_at desc,id desc limit ${input.limit??30} offset ${input.offset??0}) select (select count(*)::int from selected) total,coalesce((select jsonb_agg(data||jsonb_build_object('id',id,'revision',revision,'updated_at',updated_at,'evidence_current',evidence_current)||case when lease is not null then jsonb_build_object('lease',lease) else '{}'::jsonb end order by updated_at desc,id desc) from page),'[]'::jsonb) items`);
    const value=query.rows[0],offset=input.offset??0,limit=input.limit??30;
    return {...value,total_is_exact:true,has_more:offset+limit<value.total,next_offset:offset+limit<value.total&&offset+limit<=10000?offset+limit:null,as_of:await now()};
  }
  async function nodes(subject: string,kinds: FoundationRef['kind'][],input: any,options: Options) {
    const found=await nodeRows(subject,kinds,input.object_refs??[],true,options.scenario,{...input,offset:input.offset??0},options.kinds);
    if(input.object_refs?.some((ref:FoundationRef)=>!found.some(node=>node.ref.kind===ref.kind&&node.ref.id===ref.id&&node.ref.revision===ref.revision)))throw notFound('Requested object is unavailable');
    return {nodes:found,edges:[],total:found.total??found.length,truncated:(found.total??found.length)>(input.offset??0)+found.length,as_of:await now()};
  }
  async function graph(subject: string,input: any,options: Options) {
    const root=await nodes(subject,options.kinds,input,options);let frontier=root.nodes as Node[],truncated=root.truncated;
    const result=new Map<string,Node>(frontier.map(node=>[`${node.ref.kind}:${node.ref.id}`,node]));const edges: any[]=[];
    for (let depth=0;depth<input.depth&&frontier.length;depth++) {
      const ids=frontier.map(node=>node.ref.id);
      const links=(await database.execute(sql`
        select 'life_project' from_kind,l.project_id from_id,l.ref_kind to_kind,l.ref_id to_id,l.role relation from life_project_links l join life_projects p on p.id=l.project_id where p.subject_id=${subject} and (l.project_id=any(${array(ids)}) or l.ref_id=any(${array(ids)}))
        union all select 'life_project',project_id,'action_item',id,'action' from action_items where subject_id=${subject} and (project_id=any(${array(ids)}) or id=any(${array(ids)}))
        union all select 'trip',trip_id,'reservation',id,'reservation' from reservations where subject_id=${subject} and (trip_id=any(${array(ids)}) or id=any(${array(ids)}))
        union all select 'reservation',id,'money_entry',fare_entry_id,'fare' from reservations where subject_id=${subject} and fare_entry_id is not null and (id=any(${array(ids)}) or fare_entry_id=any(${array(ids)}))
        union all select 'meal',l.meal_id,'money_entry',l.money_entry_id,'payment' from meal_money_links l join meals m on m.id=l.meal_id where m.subject_id=${subject} and (l.meal_id=any(${array(ids)}) or l.money_entry_id=any(${array(ids)}))
        union all select 'meal',l.meal_id,'purchase',p.id,'purchase' from meal_consumption_links l join purchases p on p.record_id=l.consumption_record_id where l.subject_id=${subject} and (l.meal_id=any(${array(ids)}) or p.id=any(${array(ids)}))
        union all select 'owned_item',d.owned_item_id,'library_item',d.library_item_id,d.role from owned_item_documents d join owned_items o on o.id=d.owned_item_id where o.subject_id=${subject} and (d.owned_item_id=any(${array(ids)}) or d.library_item_id=any(${array(ids)}))
        union all select 'owned_item',o.id,'purchase',p.id,'purchase' from owned_items o join purchase_items i on i.id=o.purchase_item_id join purchases p on p.id=i.purchase_id where o.subject_id=${subject} and (o.id=any(${array(ids)}) or p.id=any(${array(ids)}))
        union all select 'library_item',id,'source',source_id,'original' from library_items where subject_id=${subject} and source_id is not null and (id=any(${array(ids)}) or source_id=any(${array(ids)}))
        union all select 'reservation',id,'source',source_id,'original' from reservations where subject_id=${subject} and source_id is not null and (id=any(${array(ids)}) or source_id=any(${array(ids)}))
        union all select 'meal',l.meal_id,'source',l.source_id,'original' from meal_source_links l join meals m on m.id=l.meal_id where m.subject_id=${subject} and (l.meal_id=any(${array(ids)}) or l.source_id=any(${array(ids)}))
        union all select 'purchase',l.purchase_id,'source',l.source_id,'original' from purchase_source_links l join purchases p on p.id=l.purchase_id where p.subject_id=${subject} and (l.purchase_id=any(${array(ids)}) or l.source_id=any(${array(ids)}))
        limit 501
      `)).rows;
      if(links.length>500)truncated=true;
      const possible=await nodeRows(subject,options.kinds,[],true,options.scenario,{ids:[...new Set(links.flatMap((link:any)=>[link.from_id,link.to_id]))],limit:1000});frontier=[];
      for(const link of links.slice(0,500)){
        const from=possible.find(node=>node.ref.kind===link.from_kind&&node.ref.id===link.from_id),to=possible.find(node=>node.ref.kind===link.to_kind&&node.ref.id===link.to_id);
        if(!from||!to)continue;
        for(const node of [from,to])if(!result.has(`${node.ref.kind}:${node.ref.id}`)){if(result.size>=input.limit){truncated=true;continue;}result.set(`${node.ref.kind}:${node.ref.id}`,node);frontier.push(node);}
        if(result.has(`${from.ref.kind}:${from.ref.id}`)&&result.has(`${to.ref.kind}:${to.ref.id}`)&&!edges.some(edge=>edge.from.id===from.ref.id&&edge.to.id===to.ref.id&&edge.relation===link.relation))edges.push({from:from.ref,to:to.ref,relation:link.relation});
      }
    }
    return {nodes:[...result.values()],edges,as_of:await now(),truncated};
  }
  async function read(name: FoundationQueryName,subject: string,input: any,options: Options): Promise<any> {
    if(name==='agent.intentions')return list(subject,'agent_intentions',input,options);
    if(name==='agent.tasks')return list(subject,'agent_tasks',input,options);
    if(name==='agent.learning')return list(subject,'agent_learning',input,options);
    if(name==='agent.objects')return graph(subject,input,options);
    if(name==='agent.changes'){
      const subscriptions=await list(subject,'agent_subscriptions',{limit:10000},options),subscription=subscriptions.items.find((item:any)=>item.consumer===input.consumer);
      if(!subscription)throw notFound('Consumer is unavailable');
      const cursors=(await database.execute(sql`select cursor::text from agent_change_cursors where subject_id=${subject} and consumer=${input.consumer}`)).rows;
      const acknowledged=cursors[0]?.cursor??'0',after=input.after??acknowledged;
      const changes=(await database.execute(sql`select sequence::text,event_type,refs,${timestamp('created_at')} occurred_at from agent_changes where subject_id=${subject} and sequence>${after}::bigint order by sequence limit 501`)).rows;
      let cursor=after;const items: any[]=[];
      for(const change of changes.slice(0,500)){
        if(items.length>=input.limit)break;cursor=change.sequence;
        const permitted=change.refs.filter((ref:FoundationRef)=>options.kinds.includes(ref.kind)&&(subscription.scope==='global'||ref.kind.startsWith('agent_')||foundationKinds[subscription.scope]?.includes(ref.kind)));
        if(!permitted.length)continue;
        const visible=await nodeRows(subject,options.kinds,permitted,true,options.scenario??(subscription.scope==='global'?undefined:subscription.scope));const refs=permitted.filter((ref:FoundationRef)=>visible.some(node=>node.ref.kind===ref.kind&&node.ref.id===ref.id&&node.ref.revision===ref.revision));
        const invalidated:FoundationRef[]=[];
        const identityTables:Record<string,string>={meal:'meals',purchase:'purchases',money_entry:'money_entries',health_measurement:'health_measurements',health_workout:'health_workout_sessions',trip:'trips',library_item:'library_items',...Object.fromEntries(Object.entries(extraTables).map(([kind,value])=>[kind,value.table]))};
        for(const ref of permitted)if(!refs.some((current:FoundationRef)=>current.kind===ref.kind&&current.id===ref.id)){
          const table=identityTables[ref.kind];if(!table)continue;
          const access=(await database.execute(sql`select 1 from ${sql.identifier(table)} where id=${ref.id} and subject_id=${subject}`)).rowCount;
          if(access&&ref.kind!=='source')invalidated.push(ref);
        }
        const interested=subscription.object_refs??[];
        if((refs.length||invalidated.length)&&(!interested.length||[...refs,...invalidated].some((ref:FoundationRef)=>interested.some((watch:FoundationRef)=>watch.kind===ref.kind&&watch.id===ref.id))))items.push({sequence:change.sequence,type:change.event_type,refs,invalidated_refs:invalidated,occurred_at:change.occurred_at});
      }
      return {items,cursor,acknowledged_cursor:acknowledged,has_more:changes.some((row:any)=>BigInt(row.sequence)>BigInt(cursor)),as_of:await now()};
    }
    if(name==='agent.export'){
      const tables={intentions:'agent_intentions',tasks:'agent_tasks',learning:'agent_learning',subscriptions:'agent_subscriptions'};
      let value:any;
      if(input.section==='sources') {const data=await nodes(subject,options.kinds.filter(kind=>kind==='source'),input,options);value={items:data.nodes.map((node:Node)=>({...node.data,id:node.ref.id,revision:node.ref.revision})),total:data.total,total_is_exact:true,has_more:data.truncated,next_offset:data.truncated?input.offset+input.limit:null,as_of:data.as_of};}
      else if(input.section==='history'){
        const rows=(await database.execute(sql`select kind,object_id,revision,snapshot,reason,${timestamp('created_at')} created_at from agent_foundation_history where subject_id=${subject} order by created_at,kind,object_id,revision limit 10001`)).rows;
        const filtered=[];for(const row of rows)if((!options.scenario||['global',options.scenario].includes(row.snapshot.scope))&&(await evidence(subject,row.snapshot,options)).visible)filtered.push(row);
        value={items:filtered.slice(input.offset,input.offset+input.limit),total:filtered.length,total_is_exact:rows.length<=10000,has_more:input.offset+input.limit<filtered.length||rows.length>10000,next_offset:input.offset+input.limit<filtered.length?input.offset+input.limit:null,as_of:await now()};
      }else value=await list(subject,tables[input.section as keyof typeof tables],{...input,include_inactive:true,include_terminal:true},options);
      return {format:'shadow-life.personal-data',section:input.section,...value,original_assets_included:false};
    }
    throw new Error(`Unknown personal data query: ${name}`);
  }
  return {now,read,nodes};
}
function addDay(value:string){return new Date(Date.parse(value)+86400000).toISOString().slice(0,10);}

export async function writeFoundation(database:Database,subject:string,capability:string,raw:any,nextId:(prefix:string)=>string,context:RequestContext) {
  const schema=foundationWriteSchemas[capability as keyof typeof foundationWriteSchemas];
  if(!schema)return undefined;
  if(capability==='agent.restore'){
    const restore=foundationWriteSchemas['agent.restore'].parse(raw),mapping={intentions:['agent.set_intention','key'],tasks:['agent.save_task','task_key'],learning:['agent.save_learning','key']} as const;
    const [target,key]=mapping[restore.section],targetSchema=foundationWriteSchemas[target];const resources:any[]=[];
    for(const [index,entry] of restore.entries.entries()){
      const shape=targetSchema.shape,fields=Object.fromEntries(Object.keys(shape).filter(field=>!["id","expected_revision","reason","lease_token","claim_seconds"].includes(field)&&entry[field]!==undefined).map(field=>[field,entry[field]]));
      fields[key]=`${restore.copy_key}.${index}`;
      const written=await writeFoundation(database,subject,target,targetSchema.parse(fields),nextId,context);resources.push(...written!.resources);
    }
    return {resources,actualValues:{restored:resources.length,section:restore.section}};
  }
  const input=schema.parse(raw) as any;
  const store=createFoundationStore(database),options:Options={kinds:context.effects.has('agent.run')?Object.entries(foundationEffects).filter(([,effect])=>context.effects.has(effect)).map(([kind])=>kind as FoundationRef['kind']):[],effects:[...context.effects]};
  const refs=[...(input.object_refs??[]),...(input.project_ref?[input.project_ref]:[])];
  if(refs.length)await store.nodes(subject,options.kinds,{object_refs:refs,limit:100},options);
  if(input.operation_ids?.length){
    const operations=(await database.execute(sql`select capability,result from operations where subject_id=${subject} and execution_id=any(${array(input.operation_ids)})`)).rows;
    if(operations.some((row:any)=>!operationEvidenceVisible(row.capability,options.effects)))throw notFound("Operation evidence is unavailable");
    if(operations.length!==new Set(input.operation_ids).size)throw notFound('Operation evidence is unavailable');
    for(const row of operations)for(const resource of row.result.resources){const kind=resource.type==='health_workout_session'?'health_workout':resource.type;if([...legacyKinds,...Object.keys(extraTables)].includes(kind)&&!options.kinds.includes(kind))throw notFound('Operation evidence is unavailable');}
  }
  if(capability==='agent.ack_changes'){
    const subscription=(await database.execute(sql`select id,revision from agent_subscriptions where subject_id=${subject} and business_key=${input.consumer} and data->>'state'='active'`)).rows[0];
    if(!subscription)throw notFound('Consumer is unavailable');
    const maximum=String((await database.execute(sql`select coalesce(max(sequence),0)::text maximum from agent_changes where subject_id=${subject}`)).rows[0].maximum);
    if(BigInt(input.cursor)>BigInt(maximum))throw conflict('Cursor was not observed');
    await database.execute(sql`insert into agent_change_cursors(subject_id,consumer) values(${subject},${input.consumer}) on conflict do nothing`);
    const updated=await database.execute(sql`update agent_change_cursors set cursor=${input.cursor}::bigint,updated_at=now() where subject_id=${subject} and consumer=${input.consumer} and cursor=${input.expected_cursor}::bigint returning cursor::text`);
    if(!updated.rowCount)throw conflict('Consumer cursor changed; reread changes');
    return {resources:[{type:'agent_subscription',id:subscription.id,revision:subscription.revision}],actualValues:{consumer:input.consumer,cursor:input.cursor}};
  }
  const mapping:Record<string,[string,string,string]>={'agent.set_intention':['agent_intentions','agent_intention','key'],'agent.save_task':['agent_tasks','agent_task','task_key'],'agent.save_learning':['agent_learning','agent_learning','key'],'agent.set_subscription':['agent_subscriptions','agent_subscription','consumer']};
  const [table,kind,keyField]=mapping[capability]!;const key=input[keyField];
  await database.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${subject}:${table}:${table==='agent_subscriptions'?'consumer':input.scope}:${key}`},7))`);
  const rows=(await database.execute(sql`select *,${table==='agent_tasks'?sql`lease_expires_at>clock_timestamp()`:sql`false`} lease_active from ${sql.identifier(table)} where subject_id=${subject} and ${input.id?sql`id=${input.id}`:sql`${table==='agent_subscriptions'?sql`true`:sql`scope=${input.scope}`} and business_key=${key}`} for update`)).rows;
  const before=rows[0];
  // Re-evaluate expiry only after acquiring the row lock; lock waits may outlive the lease.
  if(before&&table==='agent_tasks')before.lease_active=(await database.execute(sql`select lease_expires_at>clock_timestamp() lease_active from agent_tasks where id=${before.id}`)).rows[0].lease_active;
  const collision=(await database.execute(sql`select id from ${sql.identifier(table)} where subject_id=${subject} and ${table==='agent_subscriptions'?sql`true`:sql`scope=${input.scope}`} and business_key=${key} and id<>${input.id??''}`)).rows[0];
  if(input.id&&collision)throw conflict('Key already belongs to another object');
  if(input.id&&(!before||before.revision!==input.expected_revision))throw conflict('Object revision changed or is unavailable');
  if(!input.id&&before)throw conflict('Key already exists; read its current id and revision before updating');
  if(before&&table==='agent_tasks'&&before.lease_active&&(before.lease_client_id!==context.clientId||before.lease_token!==input.lease_token))throw conflict('Task is claimed by another execution');
  const id=input.id??nextId(kind),revision=(before?.revision??0)+1;
  const {id:ignoredId,expected_revision,reason,lease_token,claim_seconds,...data}=input;
  const provenance={actor_id:context.actorId,client_id:context.clientId,trace_id:context.traceId,...(context.agentRun?{run_id:context.agentRun.runId,tool_call_id:context.agentRun.toolCallId}:{})};
  const stored={...data,provenance};
  if(before)await database.execute(sql`insert into agent_foundation_history(subject_id,kind,object_id,revision,snapshot,reason) values(${subject},${kind},${id},${before.revision},${json(before.data)},${reason})`);
  if(before)await database.execute(sql`update ${sql.identifier(table)} set scope=${input.scope},business_key=${key},data=${json(stored)},revision=${revision},updated_at=now() where id=${id} and subject_id=${subject}`);
  else await database.execute(sql`insert into ${sql.identifier(table)}(id,subject_id,scope,business_key,data) values(${id},${subject},${input.scope},${key},${json(stored)})`);
  let claim:any={};
  if(table==='agent_tasks'){
    const token=claim_seconds?(before?.lease_active?before.lease_token:nextId('lease')):(before?.lease_active&&input.state==='running'?before.lease_token:null);
    const result=await database.execute(sql`update agent_tasks set lease_token=${token},lease_client_id=${token?context.clientId:null},lease_expires_at=${token?(claim_seconds?sql`clock_timestamp()+${claim_seconds}*interval '1 second'`:sql`${before.lease_expires_at}`):sql`null`} where id=${id} returning ${timestamp('lease_expires_at')} lease_expires_at`);
    claim={...(token?{lease_token:token,lease_expires_at:result.rows[0].lease_expires_at}:{})};
  }
  return {resources:[{type:kind,id,revision}],actualValues:{id,revision,...claim}};
}
