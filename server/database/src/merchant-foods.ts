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
  const merchant=await resolveMerchant(db,subjectId,v.merchant,effects),fullName=merchant+"｜"+v.dish,normalized=fullName.toLocaleLowerCase();
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
  const existing=(await db.execute<{id:string;revision:number}>(sql`
    select f.id,f.revision from food_references f left join merchant_foods m on m.food_id=f.id
    where f.subject_id=${subjectId} and ((lower(m.merchant)=lower(${merchant}) and lower(m.dish)=lower(${v.dish}))
    or (m.food_id is null and lower(trim(f.name))=${normalized})) order by m.food_id nulls last,f.id limit 1 for update of f`)).rows[0];
  const id=existing?.id??nextId("food");
  if(!existing)await db.execute(sql`insert into food_references(id,subject_id,name,provenance) values(${id},${subjectId},${fullName},${evidence.note??null})`);
  await db.execute(sql`insert into merchant_foods(food_id,subject_id,merchant,dish) values(${id},${subjectId},${merchant},${v.dish}) on conflict(food_id) do nothing`);
  const key=evidence.kind==="meal_intake"?evidence.intake_id:evidence.kind==="menu_photo"?evidence.library_item_id:sha256Fingerprinter.fingerprint(evidence.note);
  await db.execute(sql`insert into merchant_food_evidence(food_id,kind,source_key,meal_id,intake_id,library_item_id,note)
    values(${id},${evidence.kind},${key},${evidence.kind==="meal_intake"?evidence.meal_id:null},${evidence.kind==="meal_intake"?evidence.intake_id:null},
      ${evidence.kind==="menu_photo"?evidence.library_item_id:null},${evidence.note??null}) on conflict do nothing`);
  return {resources:[{type:"food",id,revision:existing?.revision??1}],actualValues:{food_id:id,merchant,dish:v.dish,reused:!!existing}};
}

export async function merchantMenu(db:Database,subject:string,v:ReturnType<typeof merchantMenuInputSchema.parse>,effects:ReadonlySet<string>){
  const merchant=await resolveMerchant(db,subject,v.merchant,effects);
  const rows=await db.execute<{id:string}>(sql`with menu as (
    select food_id,dish from merchant_foods where subject_id=${subject} and lower(merchant)=lower(${merchant})
    union all
    select f.id,split_part(f.name,'｜',2) from food_references f where f.subject_id=${subject}
      and lower(split_part(f.name,'｜',1))=lower(${merchant}) and f.name ~ '^[^｜|]+｜[^｜|]+$'
      and nullif(trim(f.provenance),'') is not null
      and not exists(select 1 from merchant_foods m where m.food_id=f.id)
  ) select f.id,m.dish,f.name,f.revision,f.serving_amount::text,f.serving_unit,f.nutrients,f.provenance,
    coalesce((select jsonb_agg(jsonb_build_object('kind',e.kind,'meal_id',e.meal_id,'intake_id',e.intake_id,'library_item_id',e.library_item_id,'note',e.note)
      order by e.kind,e.source_key) from merchant_food_evidence e where e.food_id=f.id and (e.kind<>'menu_photo' or (${effects.has("library.item.read")} and not exists(
      select 1 from capture_screenshot_sources c where c.item_id=e.library_item_id and c.deleted_at is not null)))
      and (e.kind<>'meal_intake' or exists(select 1 from intake_items i join meals m on m.id=i.meal_id where i.id=e.intake_id and i.effective and m.state='active'))),'[]') evidence
    from menu m join food_references f on f.id=m.food_id
    where f.subject_id=${subject} and f.state='active'
    ${v.query?sql`and strpos(lower(m.dish),lower(${v.query}))>0`:sql` `}
    ${v.after?sql`and f.id>${v.after}`:sql` `} order by f.id limit ${v.limit+1}`);
  const items=rows.rows.slice(0,v.limit);
  return {merchant,items,next:rows.rows.length>v.limit?items.at(-1)!.id:null};
}
