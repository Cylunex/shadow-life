import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { mealDietNutrients, merchantMenuResultSchema, type DietReviewInput } from "@shadow/contracts";
import type { DietEvidence, MealDietEvidence } from "@shadow/kernel";
import { merchantMenu } from "./merchant-foods.js";
import { readWellnessDays } from "./wellness-review.js";
import type * as schema from "./schema.js";

export async function readDietEvidence(
  database:NodePgDatabase<typeof schema>, subject:string, input:DietReviewInput,
  window:{from:string;previousFrom:string;weightFrom:string}, effects:ReadonlySet<string>,
):Promise<DietEvidence> {
  return database.transaction(async db=>{
    const canHealth=effects.has("health.measurement.read");
    const wellness=await readWellnessDays(db,subject,window.previousFrom,input.to,{health:canHealth,consumedOnly:true});
    const mealRows=await db.execute<DietEvidence["meals"][number]>(sql`
      select m.id,m.revision,m.occurred_on::text date,m.meal_type type,
        identity.merchant,
        coalesce(jsonb_agg(jsonb_build_object('name',i.name,'estimated',i.estimate or coalesce(i.provenance='estimated',false) or coalesce(i.weight_basis='payment_derived',false),
          'energy_kcal',i.energy_kcal * coalesce(i.consumed_fraction,1), 'grams',i.amount_g * coalesce(i.consumed_fraction,1),
          'calcium_mg',i.calcium_mg * coalesce(i.consumed_fraction,1),'iron_mg',i.iron_mg * coalesce(i.consumed_fraction,1),
          'groups',i.dish_profile_snapshot->'groups','staple',i.dish_profile_snapshot->'staple') order by i.position) filter(where i.id is not null),'[]') items
      from meals m
      left join intake_items i on i.meal_id=m.id and i.subject_id=m.subject_id and i.effective and coalesce(i.consumed_fraction,1)>0
      left join lateral (
        with candidates as (
          select 1 priority,coalesce(item.dish_profile_snapshot->>'merchant',menu.merchant,
            case when f.name like '%｜%' then split_part(f.name,'｜',1) end) candidate
          from intake_items item join food_references f on f.id=item.food_ref_id and f.subject_id=m.subject_id
          left join merchant_foods menu on menu.food_id=f.id and menu.subject_id=m.subject_id
          where item.meal_id=m.id and item.subject_id=m.subject_id and item.effective and coalesce(item.consumed_fraction,1)>0
          union all
          -- Older oral entries explicitly identify the canteen in the meal note.
          -- The payment counterparty can instead identify its settlement company.
          select 2,substring(m.note from '^食堂「([^」]{1,160})」')
          union all
          select 3,p.merchant from meal_consumption_links link
          join consumption_records r on r.id=link.consumption_record_id and r.subject_id=link.subject_id and r.state='confirmed'
          join purchases p on p.record_id=r.id and p.subject_id=r.subject_id
          where link.meal_id=m.id and link.subject_id=m.subject_id
          ${effects.has("money.entry.read")?sql`union all
            select 4,e.counterparty from meal_consumption_links link
            join consumption_records r on r.id=link.consumption_record_id and r.subject_id=link.subject_id and r.state='confirmed'
            join money_entries e on e.record_id=r.id and e.subject_id=r.subject_id and e.entry_type='expense'
            where link.meal_id=m.id and link.subject_id=m.subject_id`:sql``}
        ), ranked as (
          select candidate, dense_rank() over(order by priority) strength
          from candidates where nullif(trim(candidate),'') is not null
        )
        select case when count(distinct lower(candidate))=1 then min(candidate) end merchant
        from ranked where strength=1
      ) identity on true
      where m.subject_id=${subject} and m.state='active' and m.occurred_on between least(${window.from}::date,${input.to}::date-6) and ${input.to}::date
      group by m.id,identity.merchant order by m.occurred_on,m.occurred_at nulls last,m.created_at,m.id`);

    const saved=effects.has("agent.run")?(await db.execute<DietEvidence["intentions"][number]>(sql`
      select i.id,i.revision,i.business_key key,i.data->>'statement' statement,
        (i.business_key='wellness.diary.'||(i.data->>'valid_from')||'.'||${input.time_zone} and (
          exists(select 1 from meals m where m.subject_id=i.subject_id and m.occurred_on=(i.data->>'valid_from')::date
            and coalesce(m.membership_updated_at,m.created_at)>i.updated_at)
          or exists(select 1 from meal_revisions r join meals m on m.id=r.meal_id
            where m.subject_id=i.subject_id and r.created_at>i.updated_at
            and (r.snapshot->>'occurred_on'=i.data->>'valid_from' or m.occurred_on=(i.data->>'valid_from')::date)
            and (m.state<>'active' or m.occurred_on::text<>r.snapshot->>'occurred_on'))
        )) recheck
      from agent_intentions i where i.subject_id=${subject} and i.data->>'state'='active' and i.data->>'assertion'='explicit' and (
        (i.scope='health' and i.data->>'kind'='goal' and i.data->>'category'='dietary' and i.business_key in ('wellness.weight','wellness.energy','wellness.waist')
          and (i.data->>'valid_from' is null or (i.data->>'valid_from')::date<=${input.to}::date)
          and (i.data->>'valid_to_exclusive' is null or (i.data->>'valid_to_exclusive')::date>${input.to}::date))
        or (i.scope='health' and i.data->>'kind'='preference' and i.data->>'category'='dietary'
          and (i.data->>'valid_from')::date between ${window.from}::date and ${input.to}::date
          and i.business_key='wellness.diary.'||(i.data->>'valid_from')||'.'||${input.time_zone})
        or (i.scope='health' and i.data->>'kind'='preference' and i.data->>'category'='dietary' and i.business_key='wellness.weighing'
          and (i.data->>'valid_from' is null or (i.data->>'valid_from')::date<=${input.to}::date)
          and (i.data->>'valid_to_exclusive' is null or (i.data->>'valid_to_exclusive')::date>${input.to}::date))
        or (i.scope='daily' and i.data->>'kind'='preference' and i.data->>'category'='dietary' and i.business_key='dining.usual_canteen'
          and (i.data->>'valid_from' is null or (i.data->>'valid_from')::date<=${input.to}::date)
          and (i.data->>'valid_to_exclusive' is null or (i.data->>'valid_to_exclusive')::date>${input.to}::date))
      )`)).rows:[];
    const targets=canHealth?(await db.execute<NonNullable<DietEvidence["healthTargets"]>[number]>(sql`
      select distinct on (metric_key) id,revision,metric_key,name,target_value::float8 target_value,unit,due_on::text
      from health_goals
      where subject_id=${subject} and state='active'
        and (created_at at time zone ${input.time_zone})::date<=${input.to}::date
        and (due_on is null or due_on>=${input.to}::date)
        and ((metric_key='weight' and unit='kg' and target_value>0)
          or (metric_key='weight_change_per_week' and unit='kg/week')
          or (metric_key='energy_kcal' and unit='kcal/day' and target_value>0))
      order by metric_key, updated_at desc, id desc`)).rows:[];
    // Reuse the menu's evidence filtering and compatibility with legacy food references.
    const canteen=/^常去食堂[：:]\s*([^｜|\n]{1,160})$/u.exec(saved.find(row=>row.key==="dining.usual_canteen")?.statement??"")?.[1]?.trim();
    const menu=canteen?merchantMenuResultSchema.parse(await merchantMenu(db,subject,{merchant:canteen,on:input.to,limit:100,with_profiles:"1"},effects)):null;

    const measurements=canHealth?(await db.execute<DietEvidence["measurements"][number]>(sql`
      select o.id,o.revision,(o.occurred_at at time zone ${input.time_zone})::date::text date,
        to_char(o.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') occurred_at,
        s.id source,o.raw_id session,o.metric_key metric,o.value::float8 value,o.unit,o.original_field method
      from health_observations o
      join health_raw_records r on r.id=o.raw_id and r.subject_id=o.subject_id and r.current_version=o.raw_version
      join health_source_instances s on s.id=r.source_instance_id and s.subject_id=o.subject_id
      where o.subject_id=${subject} and o.effective and o.occurred_at is not null
        and o.occurred_on between ${window.weightFrom}::date-1 and ${input.to}::date+2
        and ((s.source_type='scale' and ((o.metric_key='weight' and not o.autofilled)
          or (o.metric_key in ('body_fat','muscle_mass','body_water_rate','visceral_fat') and (not o.autofilled or o.original_field='xiaomi-bia-v1'))))
          or (o.metric_key='waist' and not o.autofilled))
      order by o.occurred_at,o.id`)).rows:[];
    const activity=canHealth?(await db.execute<DietEvidence["activity"][number]>(sql`
      select distinct on (occurred_on) occurred_on::text date,(result #>> '{activity,steps}')::int steps,
        (result #>> '{activity,active_minutes}')::int active_minutes
      from health_daily_summaries where subject_id=${subject} and occurred_on between ${window.from}::date and ${input.to}::date
      order by occurred_on,updated_at desc,algorithm_version desc`)).rows:[];
    return {...wellness,meals:mealRows.rows,intentions:saved,healthTargets:targets,measurements,activity,menu:menu?{
      merchant:menu.merchant,dishes:menu.items.filter(row=>row.provenance||row.evidence.length)
        .map(row=>({name:row.dish,groups:row.profile?.groups??null}))
    }:null};
  },{isolationLevel:"repeatable read",accessMode:"read only"});
}


export async function readMealDietEvidence(database:NodePgDatabase<typeof schema>,subject:string,mealId:string):Promise<MealDietEvidence|undefined> {
  const nutrients=sql.join(mealDietNutrients.flatMap(key=>[sql`${key}::text`,sql`i.${sql.identifier(key)}`]),sql`,`);
  const row=(await database.execute<MealDietEvidence>(sql`
    select m.id,m.revision,m.occurred_on::text date,m.meal_type type,
      to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as_of,
      coalesce(jsonb_agg(jsonb_build_object(
        'id',i.id,'revision',i.revision,'name',i.name,'food_id',f.id,'food_revision',i.dish_profile_snapshot->'revision',
        'merchant',coalesce(i.dish_profile_snapshot->>'merchant',menu.merchant,case when f.name like '%｜%' then split_part(f.name,'｜',1) end),
        'stall',i.dish_profile_snapshot->>'stall','groups',i.dish_profile_snapshot->'groups','staple',i.dish_profile_snapshot->'staple',
        'consumed_fraction',i.consumed_fraction,'quantity',i.quantity,'unit',i.unit,'grams',i.amount_g,
        'estimated',i.estimate or coalesce(i.provenance='estimated',false) or coalesce(i.weight_basis='payment_derived',false),
        'weight_basis',i.weight_basis,'basis',i.evidence_note,'nutrients',jsonb_strip_nulls(jsonb_build_object(${nutrients})))
      order by i.position) filter(where i.id is not null),'[]') items
    from meals m left join intake_items i on i.meal_id=m.id and i.subject_id=m.subject_id and i.effective
    left join food_references f on f.id=i.food_ref_id and f.subject_id=m.subject_id
    left join merchant_foods menu on menu.food_id=f.id and menu.subject_id=m.subject_id
    where m.id=${mealId} and m.subject_id=${subject} and m.state='active' group by m.id`)).rows[0];
  return row;
}
