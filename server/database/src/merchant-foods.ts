import {sql} from "drizzle-orm";
import type {NodePgDatabase} from "drizzle-orm/node-postgres";
import {localDate,rememberMerchantDishSchema,takeoutDetailsSchema,type merchantMenuInputSchema} from "@shadow/contracts";
import {conflict,inspectTakeoutOrder,isDiningOrderServiceLine,mergeOrderObservations,permissionDenied,sha256Fingerprinter,type TransactionStore} from "@shadow/kernel";

type Database=Pick<NodePgDatabase,"execute">;
type Write=Parameters<TransactionStore["executeDomainWrite"]>[0];

async function defaultMerchant(db:Database,subject:string,on?:string){
  const r=await db.execute<{statement:string}>(sql`select data->>'statement' statement from agent_intentions where subject_id=${subject}
    and scope='daily' and business_key='dining.usual_canteen' and data->>'state'='active' and data->>'assertion'='explicit'
    and data->>'kind'='preference' and data->>'category'='dietary'
    and (data->>'valid_from' is null or (data->>'valid_from')::date<=coalesce(${on??null}::date,current_date))
    and (data->>'valid_to_exclusive' is null or coalesce(${on??null}::date,current_date)<(data->>'valid_to_exclusive')::date)`);
  return /^常去食堂[：:]\s*([^｜|\n]{1,160})$/u.exec(r.rows[0]?.statement??"")?.[1]?.trim()||null;
}

async function resolveMerchant(db:Database,subject:string,merchant:string|undefined,effects:ReadonlySet<string>){
  if(merchant)return merchant;
  if(!effects.has("agent.run"))throw permissionDenied("agent.run");
  const name=await defaultMerchant(db,subject);
  if(!name)throw conflict("请指定门店，或先设置常去食堂");
  return name;
}

export async function rememberMerchantDish(db:Database,{subjectId,command,nextId,context}:Write):ReturnType<TransactionStore["executeDomainWrite"]>{
  const v=rememberMerchantDishSchema.parse(command.input),effects=context?.effects??new Set<string>();
  const merchant=await resolveMerchant(db,subjectId,v.merchant,effects),fullName=merchant+"｜"+v.dish+(v.stall?`（${v.stall}）`:""),normalized=fullName.toLocaleLowerCase();
  if(fullName.length>200)throw conflict("门店与菜名合计超过食品名称长度");
  const evidence=v.evidence;
  if(evidence.kind==="meal_intake"){
    if(!effects.has("life.meal.read"))throw permissionDenied("life.meal.read");
    const r=await db.execute(sql`select i.id from intake_items i join meals m on m.id=i.meal_id where i.id=${evidence.intake_id} and i.meal_id=${evidence.meal_id}
      and i.subject_id=${subjectId} and m.subject_id=${subjectId} and i.effective and m.state='active' for share of i,m`);
    if(!r.rowCount)throw conflict("餐次或摄入出处不可用");
  }else if(evidence.kind==="menu_photo"){
    if(!effects.has("library.item.read"))throw permissionDenied("library.item.read");
    const r=await db.execute(sql`select l.id from library_items l join sources s on s.id=l.source_id and s.subject_id=l.subject_id
      join asset_versions v on v.id=s.asset_version_id join assets a on a.id=v.asset_id and a.subject_id=l.subject_id
      where l.subject_id=${subjectId} and l.id=${evidence.library_item_id} and a.media_type like 'image/%'
      and not exists(select 1 from capture_screenshot_sources c where c.item_id=l.id and c.deleted_at is not null)`);
    if(!r.rowCount)throw conflict("菜单照片不可用");
  }
  await db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${subjectId+":food:"+normalized},7))`);
  const existing=(await db.execute<{id:string;revision:number;state:string;stall:string|null}>(sql`
    select f.id,f.revision,f.state,m.stall from food_references f left join merchant_foods m on m.food_id=f.id
    where f.subject_id=${subjectId} and ((lower(m.merchant)=lower(${merchant}) and lower(m.dish)=lower(${v.dish})
      and (${v.food_id??null}::text is not null or lower(m.stall) is not distinct from lower(${v.stall??null}::text)))
    or (m.food_id is null and lower(trim(f.name))=${normalized}))
    and (${v.food_id??null}::text is null or f.id=${v.food_id??null})
    order by m.food_id nulls last,f.id limit 1 for update of f`)).rows[0];
  if(v.food_id&&(!existing||existing.revision!==v.expected_revision))throw conflict("菜品已变化或不可用，请重新读取");
  if(existing?.state==="archived")throw conflict("该菜品已归档");
  if(existing && v.profile && !v.food_id)throw conflict("补充已有菜品档案需要食品编号与版本");
  const stall=v.stall??existing?.stall??null,id=existing?.id??nextId("food");
  if(existing&&v.stall&&existing.stall!==v.stall) {
    const occupied=await db.execute(sql`select 1 from merchant_foods where subject_id=${subjectId} and lower(merchant)=lower(${merchant})
      and lower(dish)=lower(${v.dish}) and lower(stall)=lower(${stall}) and food_id<>${id}`);
    if(occupied.rowCount)throw conflict("这个档口已有同名菜，请使用已有编号");
  }
  if(!existing)await db.execute(sql`insert into food_references(id,subject_id,name,provenance) values(${id},${subjectId},${fullName},${evidence.note??null})`);
  let revision=existing?.revision??1;
  const profile=v.profile?JSON.stringify(v.profile):null;
  if(existing&&(v.profile||stall!==existing.stall)){
    await db.execute(sql`insert into food_revisions(food_id,revision,snapshot,reason)
      select f.id,f.revision,to_jsonb(f)||jsonb_build_object('merchant_profile',m.profile,'stall',m.stall),${evidence.note??"本人补充菜品档案"}
      from food_references f left join merchant_foods m on m.food_id=f.id where f.id=${id}`);
    await db.execute(sql`update food_references set revision=revision+1,updated_at=now() where id=${id}`);
    revision++;
  }
  await db.execute(sql`insert into merchant_foods(food_id,subject_id,merchant,dish,stall,profile)
    values(${id},${subjectId},${merchant},${v.dish},${stall},${profile}::jsonb)
    on conflict(food_id) do update set stall=excluded.stall,profile=coalesce(excluded.profile,merchant_foods.profile)`);
  const key=evidence.kind==="meal_intake"?evidence.intake_id:evidence.kind==="menu_photo"?evidence.library_item_id:sha256Fingerprinter.fingerprint(evidence.note);
  await db.execute(sql`insert into merchant_food_evidence(food_id,kind,source_key,meal_id,intake_id,library_item_id,note)
    values(${id},${evidence.kind},${key},${evidence.kind==="meal_intake"?evidence.meal_id:null},${evidence.kind==="meal_intake"?evidence.intake_id:null},
      ${evidence.kind==="menu_photo"?evidence.library_item_id:null},${evidence.note??null}) on conflict do nothing`);
  if(v.stall_price){
    const price=v.stall_price;
    // Same effective date is immutable, including under concurrent writers.
    const saved=await db.execute(sql`insert into merchant_stall_prices(subject_id,merchant,stall,price_name,valid_from,valid_to_exclusive,terms,evidence_note)
      values(${subjectId},${merchant.toLowerCase()},${price.stall},${price.price_name},${price.valid_from}::date,${price.valid_to_exclusive??null}::date,${JSON.stringify(price.terms)}::jsonb,${price.evidence_note})
      on conflict(subject_id,merchant,stall,price_name,valid_from) do update set terms=excluded.terms
      where merchant_stall_prices.terms=excluded.terms and merchant_stall_prices.valid_to_exclusive is not distinct from excluded.valid_to_exclusive
        and merchant_stall_prices.evidence_note=excluded.evidence_note returning valid_from`);
    if(!saved.rowCount)throw conflict("该档口价目在此生效日已有不同依据或价格");
  }
  return {resources:[{type:"food",id,revision}],actualValues:{food_id:id,merchant,dish:v.dish,revision,reused:!!existing}};
}

async function capturedDiningOrders(db:Database,subject:string,from:string,to:string,zone:string,merchant?:string){
  const result=await db.execute<{
    id:string;record_id:string|null;source_ids:string[];captured_on:string;
    observations:Parameters<typeof mergeOrderObservations>[0];
  }>(sql`
    select o.id,r.id record_id,
      array_agg(a.id order by a.started_at,a.id) source_ids,
      (max(a.started_at) at time zone ${zone})::date::text captured_on,
      jsonb_agg(s.fields order by a.started_at,a.id) observations
    from capture_orders o join capture_order_sources s on s.order_id=o.id
    join activity_captures a on a.id=s.capture_id and a.subject_id=o.subject_id and a.deleted_at is null
    left join consumption_records r on r.id=o.record_id and r.subject_id=o.subject_id and r.state='confirmed'
    where o.subject_id=${subject} and not o.conflict and jsonb_typeof(o.fields->'takeout')='object'
      ${merchant?sql`and lower(trim(o.fields->>'merchant'))=lower(${merchant})`:sql``}
      and a.started_at>=${from}::date::timestamp at time zone ${zone}
      and a.started_at<(${to}::date+1)::timestamp at time zone ${zone}
    group by o.id,r.id having bool_or(jsonb_typeof(s.fields->'takeout')='object')
    order by max(a.started_at) desc,o.id limit 150`);
  const candidates=result.rows.flatMap(row=>{
    const merged=mergeOrderObservations(row.observations);
    const {merchant:name,takeout,order_time}=merged.fields;
    if(merged.conflict||typeof name!=="string"||!name.trim())return [];
    if(merchant&&name.trim().toLowerCase()!==merchant.toLowerCase())return [];
    const details=takeoutDetailsSchema.safeParse(takeout);
    if(!details.success||/取消|退款/u.test(details.data.delivery_status??""))return [];
    const orderDate=localDate.safeParse(typeof order_time==="string"?order_time.slice(0,10):undefined);
    const date=orderDate.success?orderDate.data:row.captured_on;
    // The chosen takeout payload is one complete observation, so keep its
    // own source rather than linking whichever screenshot arrived last.
    const sourceIndex=row.observations.findIndex(value=>"takeout" in value&&value.takeout===takeout);
    const source_id=row.source_ids[sourceIndex];
    if(!source_id||date<from||date>to)return [];
    return [{id:row.id,record_id:row.record_id,source_id,merchant:name.trim(),date,
      extracted:details.data}];
  });
  if(!candidates.length)return [];
  const ids=sql.join(candidates.map(order=>sql`${order.source_id}`),sql`,`);
  const sources=await db.execute<{id:string;text:string|null}>(sql`
    select id,text from activity_captures where subject_id=${subject} and deleted_at is null and id in (${ids})`);
  const originals=new Map(sources.rows.map(row=>[row.id,row.text]));
  return candidates.flatMap(({extracted,...order})=>{
    if(!originals.has(order.source_id))return [];
    const original=originals.get(order.source_id);
    const rechecked=original?inspectTakeoutOrder(original):null;
    // This exact source is already bound to the stored order. A crop may
    // omit the number, while its visible product titles remain usable.
    const detail=rechecked?.takeout.platform===extracted.platform?rechecked.takeout:extracted;
    const items=[...new Set(detail.items.filter(item=>!item.option&&!isDiningOrderServiceLine(item.name))
      .map(item=>item.name.trim()).filter(Boolean))];
    return items.length?[{...order,items,linked_meal:false}]:[];
  });
}

async function diningDirectory(db:Database,subject:string,on:string|undefined,zone:string,effects:ReadonlySet<string>,merchant?:string){
  const window=(await db.execute<{from:string;to:string}>(sql`
    select (local_day-29)::text "from",local_day::text "to" from
    (select coalesce(${on??null}::date,(now() at time zone ${zone})::date) as local_day) days`)).rows[0]!;
  const result=await db.execute<{
    merchants:Array<{name:string;menu_items:number;meals:number}>;
    dishes:Array<{name:string;merchant:string|null;food_id:string|null;meals:number;meal_id:string}>;
  }>(sql`
    with catalog as (
      select f.id,m.merchant,m.dish from merchant_foods m
      join food_references f on f.id=m.food_id and f.subject_id=m.subject_id
      where m.subject_id=${subject} and f.state='active'
      union all
      select f.id,split_part(f.name,'｜',1),split_part(f.name,'｜',2) from food_references f
      where f.subject_id=${subject} and f.state='active' and f.name ~ '^[^｜|]+｜[^｜|]+$'
        and nullif(trim(f.provenance),'') is not null and not exists(select 1 from merchant_foods m where m.food_id=f.id)
    ), eaten as (
      select m.id meal_id,m.occurred_on,m.occurred_at,i.name,c.id food_id,c.dish,
        coalesce(nullif(i.dish_profile_snapshot->>'merchant',''),c.merchant) item_merchant
      from meals m join intake_items i on i.meal_id=m.id and i.subject_id=m.subject_id
      left join catalog c on c.id=i.food_ref_id
      where m.subject_id=${subject} and m.state='active' and m.occurred_on between ${window.from}::date and ${window.to}::date
        and i.effective and coalesce(i.consumed_fraction,1)>0 and nullif(trim(i.name),'') is not null
    ), meal_ids as (select distinct meal_id from eaten),
    candidates as (
      select meal_id,item_merchant merchant,1 priority from eaten where item_merchant is not null
      union all
      select l.meal_id,trim(p.merchant),2 from meal_ids m join meal_consumption_links l on l.meal_id=m.meal_id and l.subject_id=${subject}
      join consumption_records r on r.id=l.consumption_record_id and r.subject_id=l.subject_id and r.state='confirmed'
      join purchases p on p.record_id=r.id and p.subject_id=r.subject_id where nullif(trim(p.merchant),'') is not null
    ), ranked as (
      select *,dense_rank() over(partition by meal_id order by priority) strength from candidates
    ), meal_merchants as (
      select meal_id,min(merchant) merchant from ranked where strength=1
      group by meal_id having count(distinct lower(merchant))=1
    ), visits as (
      select meal_id,item_merchant merchant from eaten where item_merchant is not null
      union select meal_id,merchant from meal_merchants
    ), stores as (
      select merchant,count(*)::int menu_items,0 meals from catalog group by merchant
      union all
      select min(merchant),0,count(distinct meal_id)::int from visits group by lower(merchant)
    ), store_summary as (
      select min(merchant) name,sum(menu_items)::int menu_items,sum(meals)::int meals from stores
      where length(merchant)<=160 and merchant !~ '[｜|[:cntrl:]]'
      group by lower(merchant) order by meals desc,menu_items desc,name limit 100
    ), dish_summary as (
      select min(coalesce(e.dish,trim(e.name))) name,min(coalesce(e.item_merchant,m.merchant)) merchant,e.food_id,
        count(distinct e.meal_id)::int meals,
        (array_agg(e.meal_id order by e.occurred_on desc,e.occurred_at desc nulls last,e.meal_id))[1] meal_id
      from eaten e left join meal_merchants m on m.meal_id=e.meal_id
      group by lower(coalesce(e.item_merchant,m.merchant)),e.food_id,case when e.food_id is null then lower(trim(e.name)) end
      having count(distinct e.meal_id)>1 order by meals desc,max(e.occurred_on) desc,name limit 12
    )
    select coalesce((select jsonb_agg(s order by s.meals desc,s.menu_items desc,s.name) from store_summary s),'[]') merchants,
      coalesce((select jsonb_agg(d order by d.meals desc) from dish_summary d),'[]') dishes`);
  const default_merchant=effects.has("agent.run")?await defaultMerchant(db,subject,window.to):null;
  const takeout=effects.has("library.item.read")
    ?await capturedDiningOrders(db,subject,window.from,window.to,zone,merchant):[];
  return {...window,...result.rows[0]!,default_merchant,takeout};
}

export async function merchantMenu(db:Database,subject:string,v:ReturnType<typeof merchantMenuInputSchema.parse>,effects:ReadonlySet<string>){
  const directory=v.browse?await diningDirectory(db,subject,v.on,v.time_zone??"UTC",effects,v.merchant):undefined;
  const merchant=v.merchant??(directory?directory.default_merchant:await resolveMerchant(db,subject,undefined,effects));
  if(!merchant)return {merchant:"",items:[],next:null,directory};
  const rows=await db.execute<{id:string}>(sql`with menu as (
    select food_id,dish,stall,profile from merchant_foods where subject_id=${subject} and lower(merchant)=lower(${merchant})
    union all
    select f.id,split_part(f.name,'｜',2),null::text,null::jsonb from food_references f where f.subject_id=${subject}
      and lower(split_part(f.name,'｜',1))=lower(${merchant}) and f.name ~ '^[^｜|]+｜[^｜|]+$'
      and nullif(trim(f.provenance),'') is not null
      and not exists(select 1 from merchant_foods m where m.food_id=f.id)
  ) select f.id,m.dish,f.name,f.revision,f.serving_amount::text,f.serving_unit,f.nutrients,f.provenance,
    ${v.with_profiles?sql`coalesce(m.profile,'{"aliases":[]}'::jsonb)||jsonb_build_object('stall',m.stall) profile,`:sql``}
    coalesce((select jsonb_agg(jsonb_build_object('kind',e.kind,'meal_id',e.meal_id,'intake_id',e.intake_id,'library_item_id',e.library_item_id,'note',e.note)
      order by e.kind,e.source_key) from merchant_food_evidence e where e.food_id=f.id and (e.kind<>'menu_photo' or (${effects.has("library.item.read")} and not exists(
      select 1 from capture_screenshot_sources c where c.item_id=e.library_item_id and c.deleted_at is not null)))
      and (e.kind<>'meal_intake' or exists(select 1 from intake_items i join meals m on m.id=i.meal_id where i.id=e.intake_id and i.effective and m.state='active'))),'[]') evidence
    from menu m join food_references f on f.id=m.food_id
    where f.subject_id=${subject} and f.state='active'
    ${v.query?sql`and (strpos(lower(m.dish),lower(${v.query}))>0 or exists(
      select 1 from jsonb_array_elements_text(coalesce(m.profile->'aliases','[]')) alias where strpos(lower(alias),lower(${v.query}))>0))`:sql``}
    ${v.after?sql`and f.id>${v.after}`:sql` `} order by f.id limit ${v.limit+1}`);
  const items=rows.rows.slice(0,v.limit);
  const prices=await db.execute(sql`with periods as (
    select *,least(valid_to_exclusive,lead(valid_from) over(partition by stall,price_name order by valid_from)) until
    from merchant_stall_prices where subject_id=${subject} and merchant=${merchant.toLowerCase()})
    select stall,price_name,valid_from::text,until::text valid_to_exclusive,terms,evidence_note from periods
    where valid_from<=coalesce(${v.on??null}::date,current_date) and (until is null or until>coalesce(${v.on??null}::date,current_date))
    order by stall,price_name`);
  return {merchant,items,...(directory?{directory}:{}),stall_prices:prices.rows.map(p=>({...p,valid_to_exclusive:p.valid_to_exclusive??undefined})),next:rows.rows.length>v.limit?items.at(-1)!.id:null};
}
