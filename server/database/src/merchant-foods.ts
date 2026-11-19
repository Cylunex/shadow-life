import {sql} from "drizzle-orm";
import type {NodePgDatabase} from "drizzle-orm/node-postgres";
import {rememberMerchantDishSchema,type merchantMenuInputSchema} from "@shadow/contracts";
import {conflict,permissionDenied,sha256Fingerprinter,type TransactionStore} from "@shadow/kernel";

type Database=Pick<NodePgDatabase,"execute">;
type Write=Parameters<TransactionStore["executeDomainWrite"]>[0];

async function resolveMerchant(db:Database,subject:string,merchant:string|undefined,effects:ReadonlySet<string>){
  if(merchant)return merchant;
  if(!effects.has("agent.run"))throw permissionDenied("agent.run");
  const r=await db.execute<{statement:string}>(sql`select data->>'statement' statement from agent_intentions where subject_id=${subject}
    and scope='daily' and business_key='dining.usual_canteen' and data->>'state'='active' and data->>'assertion'='explicit'
    and data->>'kind'='preference' and data->>'category'='dietary'
    and (data->>'valid_from' is null or (data->>'valid_from')::date<=current_date)
    and (data->>'valid_to_exclusive' is null or current_date<(data->>'valid_to_exclusive')::date)`);
  const name=/^常去食堂[：:]\s*([^｜|\n]+)$/u.exec(r.rows[0]?.statement??"")?.[1]?.trim();
  if(!name)throw conflict("请指定门店，或先设置常去食堂");return name;
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

export async function merchantMenu(db:Database,subject:string,v:ReturnType<typeof merchantMenuInputSchema.parse>,effects:ReadonlySet<string>){
  const merchant=await resolveMerchant(db,subject,v.merchant,effects);
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
  return {merchant,items,stall_prices:prices.rows.map(p=>({...p,valid_to_exclusive:p.valid_to_exclusive??undefined})),next:rows.rows.length>v.limit?items.at(-1)!.id:null};
}
