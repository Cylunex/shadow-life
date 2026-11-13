import {sql} from "drizzle-orm";
import type {NodePgDatabase} from "drizzle-orm/node-postgres";
import {saveContainerSchema,placeItemSchema,type containerQuerySchema,type railTicketInputSchema} from "@shadow/contracts";
import {conflict,notFound,type TransactionStore} from "@shadow/kernel";
type Database=Pick<NodePgDatabase,"execute">;
type Write=Parameters<TransactionStore["executeDomainWrite"]>[0];

export async function railTicket(db:Database,subject:string,v:ReturnType<typeof railTicketInputSchema.parse>,_effects:ReadonlySet<string>){
  const library=(await db.execute<{revision:number;body:string}>(sql`select l.current_revision revision,coalesce(nullif(r.text,''),s.original_text,'') body
    from library_items l join library_revisions r on r.item_id=l.id and r.revision=l.current_revision left join sources s on s.id=l.source_id and s.subject_id=l.subject_id
    where l.id=${v.library_item_id} and l.subject_id=${subject}
      and not exists(select 1 from capture_screenshot_sources cs where cs.item_id=l.id and cs.deleted_at is not null)
      and exists(select 1 from trips t where t.id=${v.trip_id} and (t.subject_id=${subject} or exists(select 1 from trip_members m where m.trip_id=t.id and m.subject_id=${subject})))`)).rows[0];
  if(!library)throw notFound("铁路资料或旅程");
  const quote=library.body.slice(0,12000);
  const train=/(?:车次\s*[：:]?\s*|\b)([GDCZTKSY]\d{1,5})(?:次|\b)/iu.exec(quote)?.[1]?.toUpperCase()??null;
  const code=/(?:订单号|订票单号|电子客票号)[：:\s]*([A-Z\d]{6,30})/iu.exec(quote)?.[1]?.toUpperCase()??null;
  const found=/(20\d{2})[年\/-](\d{1,2})[月\/-](\d{1,2})日?/u.exec(quote);
  let date=found?[found[1],found[2]!.padStart(2,"0"),found[3]!.padStart(2,"0")].join("-"):null;
  if(date&&(!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))date=null;
  const time=/(?:发车|开车|出发)(?:时间)?[：:\s]*(\d{1,2}):(\d{2})|(?:^|\s)(\d{1,2}):(\d{2})\s*开/u.exec(quote);
  const hour=time?Number(time[1]??time[3]):24,minute=time?Number(time[2]??time[4]):60;
  const starts_at=date&&hour<24&&minute<60?date+"T"+String(hour).padStart(2,"0")+":"+String(minute).padStart(2,"0")+":00+08:00":null;
  const route=/([\p{Script=Han}]{2,15})\s*(?:→|->|—|至)\s*([\p{Script=Han}]{2,15})/u.exec(quote);
  const origin=/(?:发站|出发站)[：:\s]*([\p{Script=Han}]{2,15})/u.exec(quote)?.[1]??route?.[1]??null;
  const destination=/(?:到站|到达站)[：:\s]*([\p{Script=Han}]{2,15})/u.exec(quote)?.[1]??route?.[2]??null;
  const printed_fare=/(?:票价|票面金额)[：:\s]*[￥¥]?\s*(\d+(?:\.\d{1,2})?)/u.exec(quote)?.[1]??null;
  const matched=code?(await db.execute(sql`select id,revision,title from reservations where subject_id=${subject} and trip_id=${v.trip_id} and
    reservation_type='rail' and upper(confirmation_code)=${code} and voided_at is null order by id`)).rows:[];
  return {library_item_id:v.library_item_id,library_revision:library.revision,quote,date,starts_at,origin,destination,service_number:train,confirmation_code:code,printed_fare,matched};
}

export async function saveContainer(db:Database,{subjectId,command,nextId}:Write):ReturnType<TransactionStore["executeDomainWrite"]>{
  const v=saveContainerSchema.parse(command.input),id=v.id??nextId("container");
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${subjectId+":containers"},15))`);
  if(v.parent_id){
    const check=await db.execute(sql`with recursive parents as (select id,parent_id from storage_containers where subject_id=${subjectId} and id=${v.parent_id}
      union all select c.id,c.parent_id from storage_containers c join parents p on c.id=p.parent_id where c.subject_id=${subjectId})
      select 1 where exists(select from parents) and not exists(select from parents where id=${id})`);
    if(!check.rowCount)throw conflict("父容器不存在或移动会造成循环");
  }
  const result=v.id?await db.execute<{revision:number}>(sql`update storage_containers set label=${v.label},parent_id=${v.parent_id},revision=revision+1
    where id=${id} and subject_id=${subjectId} and revision=${v.expected_revision} returning revision`):
    await db.execute<{revision:number}>(sql`insert into storage_containers(id,subject_id,label,parent_id) values(${id},${subjectId},${v.label},${v.parent_id}) returning revision`);
  const row=result.rows[0];if(!row)throw conflict("容器已变更");
  return {resources:[{type:"storage_container",id,...row}],actualValues:{container_id:id,...row}};
}
export async function placeItem(db:Database,{subjectId,command}:Write):ReturnType<TransactionStore["executeDomainWrite"]>{
  const v=placeItemSchema.parse(command.input);
  const r=await db.execute<{revision:number}>(sql`with old as (select * from owned_items where subject_id=${subjectId} and id=${v.item_id} and revision=${v.expected_revision}
    and (${v.container_id}::text is null or exists(select from storage_containers where id=${v.container_id} and subject_id=${subjectId})) for update),
    history as (insert into owned_item_revisions(owned_item_id,revision,snapshot,reason) select id,revision,to_jsonb(old),'移动收纳位置' from old on conflict do nothing)
    update owned_items i set container_id=${v.container_id},revision=i.revision+1,updated_at=now() from old where old.id=i.id returning i.revision`);
  const row=r.rows[0];if(!row)throw conflict("物品或容器已变更");
  return {resources:[{type:"owned_item",id:v.item_id,...row}],actualValues:{item_id:v.item_id,...row}};
}
export async function containers(db:Database,subject:string,v:ReturnType<typeof containerQuerySchema.parse>,_effects:ReadonlySet<string>){
  const paths=sql`with recursive tree as (select id,label,parent_id,revision,array[label] path,array[id] ids from storage_containers where subject_id=${subject} and parent_id is null
    union all select c.id,c.label,c.parent_id,c.revision,array_append(t.path,c.label),array_append(t.ids,c.id) from storage_containers c join tree t on c.parent_id=t.id where c.subject_id=${subject})`;
  const boxes=await db.execute(sql`${paths} select id,label,parent_id,revision,path from tree where true
    ${v.container_id?sql`and ${v.container_id}=any(ids)`:sql` `} ${v.query?sql`and strpos(lower(array_to_string(path,' ')),lower(${v.query}))>0`:sql` `}
    order by path,id offset ${v.offset} limit ${v.limit+1}`);
  const items=await db.execute(sql`${paths} select i.id,i.name,i.container_id,i.revision,coalesce(to_jsonb(t.path),i.location_path,
    case when i.location is not null then jsonb_build_array(i.location) else '[]'::jsonb end) path from owned_items i left join tree t on t.id=i.container_id
    where i.subject_id=${subject} ${v.container_id?sql`and ${v.container_id}=any(t.ids)`:sql` `}
    ${v.query?sql`and strpos(lower(concat_ws(' ',i.name,array_to_string(t.path,' '),case when t.id is null then coalesce(i.location_path::text,i.location) end)),lower(${v.query}))>0`:sql` `}
    order by i.name,i.id offset ${v.offset} limit ${v.limit+1}`);
  return {containers:boxes.rows.slice(0,v.limit),items:items.rows.slice(0,v.limit),more_containers:boxes.rows.length>v.limit,more_items:items.rows.length>v.limit};
}
